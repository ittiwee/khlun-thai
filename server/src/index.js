// สร้าง Fastify, ลงทะเบียน route, graceful shutdown
import Fastify, { LogController } from 'fastify';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadEnvFile, ConfigError } from './config.js';
import { HttpError } from './errors.js';
import healthRoutes from './routes/health.js';
import { createRadioBrowser } from './radiobrowser.js';
import rateLimit from '@fastify/rate-limit';
import streamRoutes from './routes/stream.js';
import { createLimits } from './limits.js';

const SHUTDOWN_GRACE_MS = 10_000;

// deps ฉีดได้เพื่อ test (ไม่ให้แตะเครือข่ายจริง)
export async function buildServer(config, { logger = true, radioBrowser, guard, maxDurationMs } = {}) {
  const app = Fastify({
    logger,
    // เชื่อ X-Forwarded-For เฉพาะเมื่อ request มาจาก Nginx ที่กำหนด
    trustProxy: config.trustedProxy,
    // ไม่ log ทุก request (log ปกติของ Fastify มี IP เต็ม) — log ต่อสตรีมจะทำใน routes/stream.js
    logController: new LogController({ disableRequestLogging: true }),
    // GET /stream/:uuid ไม่มี body — ไม่ต้องรับ body ใหญ่
    bodyLimit: 1024,
    // ไม่สร้าง HEAD อัตโนมัติจาก GET (HEAD /stream ต้องไม่ต่อ upstream — กำหนดเองใน routes/stream.js)
    exposeHeadRoutes: false,
  });

  app.decorate('config', config);

  const rb = radioBrowser ?? createRadioBrowser({ userAgent: config.rbUserAgent, ttlSec: config.lookupTtlSec, log: app.log });
  app.decorate('radioBrowser', rb);
  if (!radioBrowser) {
    // โหลดรายชื่อ mirror ตอนเริ่ม (ไม่บล็อกการเปิด server — ใช้รายชื่อสำรองไปก่อน) และรีเฟรชทุกชั่วโมง
    app.addHook('onReady', async () => {
      rb.start();
    });
    app.addHook('onClose', async () => rb.stop());
  }

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not_found', message: 'ไม่พบหน้าที่ขอ' });
  });
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ error: { message: err.message, code: err.code } }, 'request failed');
    if (err instanceof HttpError) return reply.code(status).send({ error: err.code, message: err.message });
    reply.code(status).send({ error: status >= 500 ? 'internal' : 'bad_request', message: status >= 500 ? 'เกิดข้อผิดพลาดภายใน' : 'คำขอไม่ถูกต้อง' });
  });

  const limits = createLimits(config);
  app.decorate('limits', limits);

  // rate limit เฉพาะ route ที่ขอไว้ (/stream) — key = IP จริง (เชื่อ X-Forwarded-For เฉพาะจาก TRUSTED_PROXY)
  await app.register(rateLimit, { global: false });
  await app.register(healthRoutes, { getMirror: () => rb.mirror(), getActiveStreams: () => limits.active() });
  // guard ฉีดได้เฉพาะใน test — ไม่มี env หรือ option ใดใน production ที่ปิด guard
  await app.register(streamRoutes, { limits, guard, maxDurationMs });
  return app;
}

async function main() {
  loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await buildServer(config);
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    // หยุดรับ request ใหม่ แล้วรอของที่ค้างไม่เกิน 10 วินาที
    const force = setTimeout(() => {
      app.log.warn('forced exit after grace period');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ error: { message: err.message } }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ error: { message: err.message, code: err.code } }, err.code === 'EADDRINUSE' ? `port ${config.port} ถูกใช้อยู่แล้ว — ตั้ง PORT เป็นค่าอื่น` : 'listen failed');
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
