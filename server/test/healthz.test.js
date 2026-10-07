import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/index.js';
import { loadConfig, ConfigError } from '../src/config.js';

const fakeRb = { mirror: () => 'de1.api.radio-browser.info', lookup: async () => null };

test('GET /healthz ตอบ ok พร้อม no-store', async () => {
  const app = await buildServer(loadConfig({}), { logger: false, radioBrowser: fakeRb });
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.uptime, 'number');
  assert.equal(body.activeStreams, 0);
  assert.equal(body.mirror, 'de1.api.radio-browser.info');
  await app.close();
});

test('path อื่นตอบ 404 เป็น JSON ภาษาไทย', async () => {
  const app = await buildServer(loadConfig({}), { logger: false, radioBrowser: fakeRb });
  const res = await app.inject({ method: 'GET', url: '/nope' });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(Object.keys(res.json()).sort(), ['error', 'message']);
  await app.close();
});

test('config: ค่าเริ่มต้นตรงตาม PROXY.md', () => {
  assert.deepEqual(loadConfig({}), {
    port: 3000,
    host: '0.0.0.0',
    allowedOrigin: 'http://localhost:5173',
    trustedProxy: ['127.0.0.1'],
    maxStreams: 200,
    maxStreamsPerIp: 3,
    rateLimitPerMin: 30,
    lookupTtlSec: 600,
    connectTimeoutMs: 8000,
    headerTimeoutMs: 10000,
    idleTimeoutMs: 30000,
    rbUserAgent: 'khlun-thai-proxy/1.0',
  });
});

test('config: อ่านค่าจาก env', () => {
  const c = loadConfig({ PORT: '8081', ALLOWED_ORIGIN: 'https://radio.example.com/', TRUSTED_PROXY: '127.0.0.1, 172.16.0.0/12', MAX_STREAMS_PER_IP: '5' });
  assert.equal(c.port, 8081);
  assert.equal(c.allowedOrigin, 'https://radio.example.com');
  assert.deepEqual(c.trustedProxy, ['127.0.0.1', '172.16.0.0/12']);
  assert.equal(c.maxStreamsPerIp, 5);
  assert.equal(loadConfig({ HOST: '127.0.0.1' }).host, '127.0.0.1');
  assert.equal(loadConfig({ HOST: '::1' }).host, '::1');
});

test('config: ค่าผิดต้อง error พร้อมบอกทุกตัวที่ผิด', () => {
  assert.throws(
    () => loadConfig({ PORT: 'abc', MAX_STREAMS: '0', ALLOWED_ORIGIN: 'https://x.com/path', TRUSTED_PROXY: 'nginx', RB_USER_AGENT: 'a\nb' }),
    (err) => {
      assert.ok(err instanceof ConfigError);
      for (const k of ['PORT', 'MAX_STREAMS', 'ALLOWED_ORIGIN', 'TRUSTED_PROXY', 'RB_USER_AGENT']) assert.match(err.message, new RegExp(k));
      return true;
    },
  );
  assert.throws(() => loadConfig({ TRUSTED_PROXY: '10.0.0.0/40' }), ConfigError);
  assert.throws(() => loadConfig({ ALLOWED_ORIGIN: 'ftp://x.com' }), ConfigError);
  assert.throws(() => loadConfig({ HOST: 'localhost' }), ConfigError);
});
