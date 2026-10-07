// integration test ของ /stream/:uuid ทั้งเส้น — upstream ปลอมที่ 127.0.0.1, Radio Browser ปลอม, ไม่แตะเครือข่ายภายนอก
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { buildServer } from '../src/index.js';
import { loadConfig } from '../src/config.js';
import { guardUrl } from '../src/guard.js';
import { LookupError } from '../src/radiobrowser.js';
import { maskIp, hostOf } from '../src/log.js';
import { createLimits } from '../src/limits.js';

const CHUNK = Buffer.from('MP3-FRAME-'.repeat(60));
const ids = {
  live: '11111111-1111-4111-8111-111111111111',
  html: '22222222-2222-4222-8222-222222222222',
  hls: '33333333-3333-4333-8333-333333333333',
  priv: '44444444-4444-4444-8444-444444444444',
  slow: '55555555-5555-4555-8555-555555555555',
  rbDown: '66666666-6666-4666-8666-666666666666',
  missing: '77777777-7777-4777-8777-777777777777',
};

let upstream;
let U; // base URL ของ upstream ปลอม
const upstreamHits = [];
const upstreamSockets = new Set();

before(async () => {
  upstream = http.createServer((req, res) => {
    upstreamHits.push(req.url);
    if (req.url.startsWith('/live')) {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-name': 'Secret', 'Set-Cookie': 'sid=1', Server: 'Icecast', 'X-Powered-By': 'x' });
      const t = setInterval(() => res.write(CHUNK), 15);
      res.write(CHUNK);
      res.on('close', () => clearInterval(t));
    } else if (req.url === '/html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<script>alert(1)</script>');
      const t = setInterval(() => res.write(CHUNK), 15);
      res.on('close', () => clearInterval(t));
    } else if (req.url === '/slow') {
      // ไม่ตอบ header
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  upstream.on('connection', (s) => {
    upstreamSockets.add(s);
    s.on('close', () => upstreamSockets.delete(s));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  U = `http://127.0.0.1:${upstream.address().port}`;
});

after(() => {
  upstream.closeAllConnections();
  upstream.close();
});

const fakeRb = () => ({
  mirror: () => 'fake.api.radio-browser.info',
  lookup: async (uuid) => {
    const table = {
      [ids.live]: { stationuuid: ids.live, url: `${U}/live?token=SECRET`, codec: 'MP3', hls: false },
      [ids.html]: { stationuuid: ids.html, url: `${U}/html`, codec: 'AAC', hls: false },
      [ids.hls]: { stationuuid: ids.hls, url: `${U}/a.m3u8`, codec: 'AAC', hls: true },
      [ids.priv]: { stationuuid: ids.priv, url: 'http://10.1.2.3:8000/', codec: 'MP3', hls: false },
      [ids.slow]: { stationuuid: ids.slow, url: `${U}/slow`, codec: 'MP3', hls: false },
    };
    if (uuid === ids.rbDown) throw new LookupError('down');
    return table[uuid.toLowerCase()] ?? null;
  },
});

// ยอมเฉพาะ upstream ปลอม นอกนั้นใช้ guard จริง (resolver ไม่แตะ DNS)
const testGuard = async (u) => {
  const url = new URL(u);
  if (url.hostname === '127.0.0.1' && Number(url.port) === upstream.address().port) {
    return { url, protocol: url.protocol, hostname: '127.0.0.1', port: Number(url.port), address: '127.0.0.1', family: 4, ipLiteral: true };
  }
  return guardUrl(u, {
    resolve: async () => {
      throw new Error('no dns');
    },
  });
};

async function start(env = {}, opts = {}) {
  const logs = [];
  const config = loadConfig({ ALLOWED_ORIGIN: 'https://radio.example', HEADER_TIMEOUT_MS: '400', CONNECT_TIMEOUT_MS: '400', ...env });
  const app = await buildServer(config, {
    logger: { level: 'info', stream: { write: (l) => logs.push(JSON.parse(l)) } },
    radioBrowser: fakeRb(),
    guard: testGuard,
    ...opts,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, logs };
}

// เปิดสตรีมค้างไว้ คืน { res, close }
function openStream(base, uuid, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/stream/${uuid}`, { headers }, (res) => {
      res.on('error', () => {});
      resolve({ res, status: res.statusCode, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}

async function readSome(res, n) {
  let got = 0;
  for await (const c of res) {
    got += c.length;
    if (got >= n) break;
  }
  return got;
}

const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 15));
  }
};

const health = async (base) => (await fetch(`${base}/healthz`)).json();

test('GET: ส่งเสียงพร้อม header ที่กำหนด และไม่ส่ง header ของ upstream ต่อ', async () => {
  const { app, base } = await start();
  const s = await openStream(base, ids.live);
  assert.equal(s.status, 200);
  const h = s.res.headers;
  assert.equal(h['content-type'], 'audio/mpeg');
  assert.equal(h['cache-control'], 'no-store');
  assert.equal(h['x-accel-buffering'], 'no');
  assert.equal(h['access-control-allow-origin'], 'https://radio.example');
  assert.equal(h['x-content-type-options'], 'nosniff');
  for (const k of ['icy-name', 'set-cookie', 'server', 'x-powered-by']) assert.equal(h[k], undefined, k);
  assert.ok((await readSome(s.res, CHUNK.length * 3)) >= CHUNK.length * 3);
  s.close();
  await waitFor(async () => (await health(base)).activeStreams === 0);
  await app.close();
});

test('content-type ที่ไม่ใช่เสียง (text/html) ไม่ส่งต่อ ใช้ค่าจาก codec แทน', async () => {
  const { app, base } = await start();
  const s = await openStream(base, ids.html);
  assert.equal(s.res.headers['content-type'], 'audio/aac');
  s.close();
  await app.close();
});

test('รหัส error: 400 / 404 / 415 / 403 / 502 / 504 เป็น JSON ภาษาไทยพร้อม CORS', async () => {
  const { app, base } = await start();
  const cases = [
    ['not-a-uuid', 400],
    ['..%2F..%2Fetc%2Fpasswd', 400],
    [ids.missing, 404],
    [ids.hls, 415],
    [ids.priv, 403],
    [ids.rbDown, 502],
    [ids.slow, 504],
  ];
  for (const [uuid, code] of cases) {
    const res = await fetch(`${base}/stream/${uuid}`);
    assert.equal(res.status, code, uuid);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://radio.example', uuid);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['error', 'message']);
    assert.match(body.message, /[฀-๿]/, 'ข้อความต้องเป็นภาษาไทย');
  }
  assert.equal((await health(base)).activeStreams, 0);
  await app.close();
});

test('ไม่มี query parameter ใดรับ URL — ใส่ ?url= ก็ไม่มีผล', async () => {
  const { app, base } = await start();
  upstreamHits.length = 0;
  const res = await fetch(`${base}/stream/${ids.missing}?url=${encodeURIComponent(`${U}/live`)}`);
  assert.equal(res.status, 404);
  assert.deepEqual(upstreamHits, []);
  await app.close();
});

test('HEAD: lookup + guard แต่ไม่ต่อ upstream', async () => {
  const { app, base } = await start();
  upstreamHits.length = 0;
  const ok = await fetch(`${base}/stream/${ids.live}`, { method: 'HEAD' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://radio.example');
  for (const [uuid, code] of [[ids.missing, 404], [ids.priv, 403], [ids.hls, 415], ['bad', 400]]) {
    assert.equal((await fetch(`${base}/stream/${uuid}`, { method: 'HEAD' })).status, code, uuid);
  }
  assert.deepEqual(upstreamHits, [], 'HEAD ต้องไม่เชื่อมต่อ upstream');
  await app.close();
});

test('เกิน MAX_STREAMS_PER_IP → 429 (GET และ HEAD) แล้วตัวนับกลับเป็น 0 เมื่อปิดครบ', async () => {
  const { app, base } = await start({ MAX_STREAMS_PER_IP: '3' });
  const open = [];
  for (let i = 0; i < 3; i++) open.push(await openStream(base, ids.live));
  assert.deepEqual(open.map((s) => s.status), [200, 200, 200]);
  assert.equal((await health(base)).activeStreams, 3);
  const fourth = await fetch(`${base}/stream/${ids.live}`);
  assert.equal(fourth.status, 429);
  assert.equal((await fourth.json()).error, 'too_many');
  assert.equal((await fetch(`${base}/stream/${ids.live}`, { method: 'HEAD' })).status, 429);
  open.forEach((s) => s.close());
  await waitFor(async () => (await health(base)).activeStreams === 0);
  await waitFor(() => upstreamSockets.size === 0); // socket ไปยัง upstream ปิดหมด
  assert.equal(app.limits.trackedIps(), 0);
  assert.equal((await openStream(base, ids.live)).status, 200, 'เปิดใหม่ได้หลังปิด');
  await app.close();
});

test('เกิน MAX_STREAMS → 503', async () => {
  const { app, base } = await start({ MAX_STREAMS: '2', TRUSTED_PROXY: '127.0.0.1' });
  const a = await openStream(base, ids.live, { 'X-Forwarded-For': '203.0.113.1' });
  const b = await openStream(base, ids.live, { 'X-Forwarded-For': '203.0.113.2' });
  const c = await fetch(`${base}/stream/${ids.live}`, { headers: { 'X-Forwarded-For': '203.0.113.3' } });
  assert.equal(c.status, 503);
  assert.equal((await c.json()).message, 'เซิร์ฟเวอร์เต็มชั่วคราว ลองใหม่อีกครั้ง');
  a.close();
  b.close();
  await app.close();
});

test('X-Forwarded-For: เชื่อเฉพาะเมื่อมาจาก TRUSTED_PROXY', async () => {
  // มาจาก 127.0.0.1 ซึ่ง trusted → นับต่อ IP ตาม XFF
  const t = await start({ TRUSTED_PROXY: '127.0.0.1', MAX_STREAMS_PER_IP: '1' });
  const a = await openStream(t.base, ids.live, { 'X-Forwarded-For': '198.51.100.7' });
  const b = await openStream(t.base, ids.live, { 'X-Forwarded-For': '198.51.100.8' });
  assert.deepEqual([a.status, b.status], [200, 200]);
  a.close();
  b.close();
  await t.app.close();

  // TRUSTED_PROXY เป็น IP อื่น → XFF ถูกเมิน ทั้งสองคำขอนับเป็น 127.0.0.1
  const u = await start({ TRUSTED_PROXY: '10.9.9.9', MAX_STREAMS_PER_IP: '1' });
  const c = await openStream(u.base, ids.live, { 'X-Forwarded-For': '198.51.100.7' });
  const d = await fetch(`${u.base}/stream/${ids.live}`, { headers: { 'X-Forwarded-For': '198.51.100.8' } });
  assert.deepEqual([c.status, d.status], [200, 429]);
  c.close();
  await u.app.close();
});

test('rate limit ต่อ IP ต่อนาที → 429 พร้อม CORS', async () => {
  const { app, base } = await start({ RATE_LIMIT_PER_MIN: '3' });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/stream/${ids.missing}`)).status);
  assert.deepEqual(codes, [404, 404, 404, 429]);
  const res = await fetch(`${base}/stream/${ids.missing}`);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://radio.example');
  assert.equal((await res.json()).error, 'too_many');
  assert.equal((await fetch(`${base}/healthz`)).status, 200, '/healthz ไม่ถูก rate limit');
  await app.close();
});

test('client ปิดระหว่างรอ upstream → คืนโควตา', async () => {
  const { app, base } = await start({ HEADER_TIMEOUT_MS: '600' });
  const req = http.get(`${base}/stream/${ids.slow}`);
  req.on('error', () => {});
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await health(base)).activeStreams, 1);
  req.destroy();
  await waitFor(async () => (await health(base)).activeStreams === 0);
  await app.close();
});

test('graceful shutdown: app.close() ปิดสตรีมที่ค้างทันที และ log reason shutdown', async () => {
  const { app, base, logs } = await start();
  const s = await openStream(base, ids.live);
  await readSome(s.res, CHUNK.length);
  const t0 = Date.now();
  await app.close();
  assert.ok(Date.now() - t0 < 3000, `ปิดนาน ${Date.now() - t0}ms`);
  assert.equal(app.limits.active(), 0);
  await waitFor(() => logs.some((l) => l.msg === 'stream closed' && l.reason === 'shutdown'));
});

test('log หนึ่งบรรทัดต่อสตรีม: ครบ field, IP ถูกตัด, ไม่มี URL เต็ม/query', async () => {
  const { app, base, logs } = await start();
  const s = await openStream(base, ids.live);
  await readSome(s.res, CHUNK.length * 2);
  s.close();
  await waitFor(() => logs.some((l) => l.msg === 'stream closed'));
  const line = logs.find((l) => l.msg === 'stream closed');
  for (const k of ['uuid', 'host', 'status', 'durationMs', 'bytes', 'reason']) assert.ok(k in line, k);
  assert.equal(line.uuid, ids.live);
  assert.equal(line.host, '127.0.0.1'); // host ปลายทางสุดท้าย (หลัง redirect) ไม่มี path/query
  assert.equal(line.status, 200);
  assert.equal(line.reason, 'client_closed');
  assert.ok(line.bytes > 0);
  assert.equal(line.ip, '127.0.0.0');
  const all = JSON.stringify(logs);
  assert.ok(!all.includes('SECRET'), 'ห้ามมี query string ใน log');
  assert.ok(!/"ip":"127\.0\.0\.1"/.test(all), 'ห้ามมี IP เต็ม');
  assert.ok(!/remoteAddress/.test(all), 'ไม่มี request log ของ Fastify ที่มี IP เต็ม');
  await app.close();
});

test('maskIp / hostOf', () => {
  assert.equal(maskIp('203.0.113.77'), '203.0.113.0');
  assert.equal(maskIp('::ffff:203.0.113.77'), '203.0.113.0');
  assert.equal(maskIp('2001:db8:abcd:12:34::1'), '2001:db8:abcd::/48');
  assert.equal(maskIp('::1'), '0:0:0::/48');
  assert.equal(maskIp('garbage'), 'unknown');
  assert.equal(hostOf('http://stream.example:8000/live?token=x'), 'stream.example:8000');
  assert.equal(hostOf('not a url'), null);
});

test('limits: จอง/คืน ต่อ IP และทั้งระบบ, release ซ้ำไม่ลดซ้ำ', () => {
  const l = createLimits({ maxStreams: 3, maxStreamsPerIp: 2 });
  const a1 = l.acquire('a');
  const a2 = l.acquire('a');
  assert.deepEqual(l.acquire('a'), { error: 429 });
  const b1 = l.acquire('b');
  assert.deepEqual(l.acquire('c'), { error: 503 });
  assert.equal(l.active(), 3);
  a1.release();
  a1.release();
  assert.equal(l.active(), 2);
  assert.equal(l.activeFor('a'), 1);
  a2.release();
  b1.release();
  assert.equal(l.active(), 0);
  assert.equal(l.trackedIps(), 0);
});
