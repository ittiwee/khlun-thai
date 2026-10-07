// GET /stream/:uuid — ส่งเสียงของสถานีกลับผ่าน proxy
// HEAD /stream/:uuid — lookup + guard + ตรวจขีดจำกัด แต่ไม่ต่อ upstream (ให้หน้าเว็บอ่านรหัส error)
import { normalizeUuid } from '../uuid.js';
import { LookupError } from '../radiobrowser.js';
import { guardUrl, systemResolve } from '../guard.js';
import { openUpstream, relay, UpstreamError } from '../upstream.js';
import { isHls } from '../playlist.js';
import { httpError, HttpError } from '../errors.js';
import { maskIp, hostOf } from '../log.js';

const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

export function guessContentType(codec) {
  const c = String(codec || '').toUpperCase();
  if (c === 'MP3') return 'audio/mpeg';
  if (c === 'AAC' || c === 'AAC+') return 'audio/aac';
  if (c === 'OGG' || c === 'OPUS' || c === 'VORBIS') return 'audio/ogg';
  return 'audio/mpeg';
}

// content-type ที่ส่งต่อได้: ต้องเป็นสื่อเสียง/วิดีโอหรือ octet-stream — กันสถานีส่ง text/html มาแสดงผลบนโดเมนเรา
const SAFE_TYPE = /^(audio\/[\w.+-]+|video\/[\w.+-]+|application\/(ogg|octet-stream))(\s*;.*)?$/i;
const pickContentType = (upstreamType, codec) => (SAFE_TYPE.test(upstreamType || '') ? upstreamType : guessContentType(codec));

export default async function streamRoutes(app, { limits, guard, maxDurationMs = MAX_DURATION_MS }) {
  const { config } = app;
  const rb = app.radioBrowser;
  const checkTarget = guard ?? ((u) => guardUrl(u, { resolve: systemResolve }));
  const active = new Map(); // AbortController → Promise ที่จบเมื่อสตรีมปิดและคืนโควตาแล้ว — ใช้ตอนปิด server

  const baseHeaders = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': config.allowedOrigin,
    'X-Content-Type-Options': 'nosniff',
  };

  // log หนึ่งบรรทัดต่อคำขอ /stream: ไม่มี IP เต็ม ไม่มี URL เต็ม
  const logLine = (req, fields) => req.log.info({ ip: maskIp(req.ip), method: req.method, ...fields }, 'stream closed');

  async function lookupStation(uuid) {
    let station;
    try {
      station = await rb.lookup(uuid);
    } catch (err) {
      if (err instanceof LookupError) throw httpError(502);
      throw err;
    }
    if (!station) throw httpError(404);
    if (isHls({ url: station.url, hls: station.hls })) throw httpError(415);
    return station;
  }

  // error ของ route นี้ (รวม 429 จาก rate limit ซึ่งเกิดก่อน handler) ต้องมี CORS header
  // เพื่อให้หน้าเว็บอ่านรหัสได้ด้วย HEAD
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500 && !(err instanceof HttpError)) req.log.error({ error: { message: err.message, code: err.code } }, 'stream route failed');
    const body = err instanceof HttpError ? { error: err.code, message: err.message } : { error: 'internal', message: 'เกิดข้อผิดพลาดภายใน' };
    reply.headers(baseHeaders).code(status).send(body);
  });

  // ปิดสตรีมทั้งหมดก่อน server หยุด (graceful shutdown)
  // ตัดทุกสตรีมแล้วรอจนคืนโควตาและเขียน log ครบ (index.js บังคับจบที่ 10 วินาทีอยู่แล้ว)
  app.addHook('preClose', async () => {
    const pending = [...active.values()];
    for (const ctrl of active.keys()) ctrl.abort();
    await Promise.allSettled(pending);
  });

  app.route({
    method: ['GET', 'HEAD'],
    url: '/stream/:uuid',
    config: {
      rateLimit: {
        max: config.rateLimitPerMin,
        timeWindow: 60_000,
        errorResponseBuilder: () => httpError(429),
      },
    },
    handler: async (req, reply) => {
      reply.headers(baseHeaders);
      const started = Date.now();
      const uuid = normalizeUuid(req.params.uuid);
      if (!uuid) throw httpError(400);

      // ---------- HEAD: ตรวจทุกอย่างยกเว้นการต่อ upstream ----------
      if (req.method === 'HEAD') {
        const full = limits.check(req.ip);
        if (full) throw httpError(full);
        const station = await lookupStation(uuid);
        try {
          await checkTarget(station.url);
        } catch (err) {
          throw httpError(err.statusCode === 502 ? 502 : 403);
        }
        reply.header('Content-Type', guessContentType(station.codec));
        return reply.code(200).send();
      }

      // ---------- GET ----------
      const lease = limits.acquire(req.ip);
      if (lease.error) throw httpError(lease.error);
      let host = null;
      let clientGone = false;
      const onClientClose = () => {
        clientGone = true;
      };
      req.raw.once('close', onClientClose);

      let up;
      try {
        const station = await lookupStation(uuid);
        host = hostOf(station.url);
        up = await openUpstream(station.url, {
          hls: station.hls,
          connectTimeoutMs: config.connectTimeoutMs,
          headerTimeoutMs: config.headerTimeoutMs,
          guard: checkTarget,
        });
        host = up.host ?? host;
        up.codec = station.codec;
      } catch (err) {
        lease.release();
        req.raw.off('close', onClientClose);
        const status = err instanceof HttpError ? err.statusCode : err instanceof UpstreamError ? err.statusCode : 502;
        logLine(req, { uuid, host, status, durationMs: Date.now() - started, bytes: 0, reason: err.reason ?? err.code ?? 'error' });
        throw err instanceof HttpError ? err : httpError(status);
      }
      req.raw.off('close', onClientClose);
      if (clientGone || req.raw.destroyed) {
        // ผู้ฟังปิดไปแล้วระหว่างรอสถานี
        up.body.destroy();
        lease.release();
        logLine(req, { uuid, host, status: 200, durationMs: Date.now() - started, bytes: 0, reason: 'client_closed' });
        return reply;
      }

      // ส่งต่อแบบ streaming เอง (ไม่ส่ง header ของ upstream ต่อ: icy-*, set-cookie, server ฯลฯ)
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        ...baseHeaders,
        'Content-Type': pickContentType(up.contentType, up.codec),
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();

      const ctrl = new AbortController();
      const done = relay(up.body, res, { idleTimeoutMs: config.idleTimeoutMs, maxDurationMs, signal: ctrl.signal })
        .then(({ reason, bytes }) => logLine(req, { uuid, host, status: 200, durationMs: Date.now() - started, bytes, reason }))
        .finally(() => {
          active.delete(ctrl);
          lease.release();
        });
      active.set(ctrl, done);
      await done;
      return reply;
    },
  });
}
