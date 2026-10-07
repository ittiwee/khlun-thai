// integration test ด้วย upstream ปลอมที่ 127.0.0.1 — ไม่แตะเครือข่ายภายนอก
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { openUpstream, relay, parseRawHead, findHeadEnd, UpstreamError } from '../src/upstream.js';
import { guardUrl } from '../src/guard.js';

const CHUNK = Buffer.from('AUDIO-FRAME-'.repeat(50));
const tracked = { httpOpen: 0, icyOpen: 0, icyClosed: 0, httpClosed: 0 };
const icyRequests = []; // บรรทัดแรกของทุก request ที่ upstream ICY ได้รับ
const icySockets = new Set();
let httpSrv;
let icySrv;
let H; // base URL ของ upstream HTTP
let I; // base URL ของ upstream ICY

// guard สำหรับ test: ยอมเฉพาะ upstream ปลอมของเรา (127.0.0.1 ที่ port รู้จัก) นอกนั้นใช้ guard จริง
// โดยไม่ resolve DNS จริง — production ไม่มีทางปิด guard (openUpstream ใช้ guardUrl เสมอเมื่อไม่ฉีด)
const allowed = new Set();
const guardCalls = [];
async function testGuard(u) {
  guardCalls.push(u);
  const url = new URL(u);
  if (url.hostname === '127.0.0.1' && allowed.has(Number(url.port))) {
    return { url, protocol: url.protocol, hostname: '127.0.0.1', port: Number(url.port), address: '127.0.0.1', family: 4, ipLiteral: true };
  }
  return guardUrl(u, {
    resolve: async () => {
      throw new Error('no dns in tests');
    },
  });
}
const open = (path, opts = {}) => openUpstream(path.startsWith('http') ? path : `${H}${path}`, { guard: testGuard, connectTimeoutMs: 1000, headerTimeoutMs: 800, ...opts });

function streamForever(res, sockets) {
  const t = setInterval(() => res.write(CHUNK), 20);
  res.write(CHUNK);
  res.on('close', () => clearInterval(t));
  sockets?.add(res);
}

before(async () => {
  httpSrv = http.createServer((req, res) => {
    tracked.httpOpen++;
    req.socket.once('close', () => tracked.httpClosed++);
    assert.equal(req.headers['icy-metadata'], '0');
    switch (req.url) {
      case '/live':
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-name': 'Fake', 'Set-Cookie': 'a=b' });
        streamForever(res);
        break;
      case '/short':
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end(Buffer.concat([CHUNK, CHUNK]));
        break;
      case '/redirect':
        res.writeHead(302, { Location: '/live' });
        res.end();
        break;
      case '/to-icy':
        res.writeHead(301, { Location: `${I}/stream` });
        res.end();
        break;
      case '/loop':
        res.writeHead(307, { Location: '/loop' });
        res.end();
        break;
      case '/to-private':
        res.writeHead(302, { Location: 'http://10.0.0.1:8000/admin' });
        res.end();
        break;
      case '/to-bad-port':
        res.writeHead(302, { Location: 'http://127.0.0.1:22/' });
        res.end();
        break;
      case '/listen.pls':
        res.writeHead(200, { 'Content-Type': 'audio/x-scpls' });
        res.end(`[playlist]\nFile1=${H}/live\nNumberOfEntries=1\n`);
        break;
      case '/pls-to-private':
        res.writeHead(200, { 'Content-Type': 'audio/x-scpls' });
        res.end('[playlist]\nFile1=http://192.168.1.1/\n');
        break;
      case '/empty.m3u':
        res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
        res.end('#EXTM3U\n#EXTINF:-1,Nothing\n');
        break;
      case '/hidden-hls.m3u':
        res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
        res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\nseg.ts\n');
        break;
      case '/hls-type':
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end('#EXTM3U\n');
        break;
      case '/missing':
        res.writeHead(404);
        res.end();
        break;
      case '/silent':
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.flushHeaders();
        break; // ไม่ส่งข้อมูลเลย → idle timeout
      case '/no-headers':
        break; // ไม่ตอบ header → header timeout
      default:
        res.writeHead(500);
        res.end();
    }
  });
  icySrv = net.createServer((socket) => {
    tracked.icyOpen++;
    icySockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => {
      tracked.icyClosed++;
      icySockets.delete(socket);
    });
    let head = '';
    socket.on('data', (d) => {
      head += d.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      socket.removeAllListeners('data');
      icyRequests.push({ line: head.split('\r\n')[0], icyMeta: /\r\nicy-metadata: 0\r\n/i.test(head) });
      // header + เสียงก้อนแรกใน packet เดียวกัน (ทดสอบส่วนเหลือหลัง header)
      socket.write(Buffer.concat([Buffer.from('ICY 200 OK\r\nicy-name: Fake ICY\r\nicy-br: 128\r\ncontent-type: audio/mpeg\r\n\r\n', 'latin1'), CHUNK]));
      const t = setInterval(() => socket.write(CHUNK), 20);
      socket.on('close', () => clearInterval(t));
    });
  });
  httpSrv.listen(0, '127.0.0.1');
  icySrv.listen(0, '127.0.0.1');
  await Promise.all([once(httpSrv, 'listening'), once(icySrv, 'listening')]);
  allowed.add(httpSrv.address().port);
  allowed.add(icySrv.address().port);
  H = `http://127.0.0.1:${httpSrv.address().port}`;
  I = `http://127.0.0.1:${icySrv.address().port}`;
});

after(() => {
  httpSrv.closeAllConnections();
  httpSrv.close();
  for (const s of icySockets) s.destroy();
  icySrv.close();
});

async function readBytes(stream, n) {
  let got = 0;
  for await (const chunk of stream) {
    got += chunk.length;
    if (got >= n) break;
  }
  return got;
}

const waitFor = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('parseRawHead: แปลง ICY เป็น status + header', () => {
  assert.deepEqual(parseRawHead('ICY 200 OK\r\nicy-name: X\r\nContent-Type: audio/mpeg'), { statusCode: 200, headers: { 'icy-name': 'X', 'content-type': 'audio/mpeg' } });
  assert.equal(parseRawHead('HTTP/1.0 302 Found\r\nLocation: /a').statusCode, 302);
  assert.equal(parseRawHead('garbage'), null);
  // status line จบด้วย \n อย่างเดียว (เจอจริงกับ QuantumCast Streamer)
  assert.deepEqual(parseRawHead('HTTP/1.0 200 OK\nContent-Type: audio/mpeg\r\nX-A: 1'), { statusCode: 200, headers: { 'content-type': 'audio/mpeg', 'x-a': '1' } });
});

test('findHeadEnd: รับทั้ง \\r\\n\\r\\n และ \\n\\n', () => {
  assert.deepEqual(findHeadEnd(Buffer.from('ICY 200 OK\r\nA: b\r\n\r\nDATA')), { end: 16, sep: 4 });
  assert.deepEqual(findHeadEnd(Buffer.from('ICY 200 OK\nA: b\n\nDATA')), { end: 15, sep: 2 });
  assert.equal(findHeadEnd(Buffer.from('ICY 200 OK\r\nA: b\r\n')), null);
});

test('upstream HTTP ปกติ: pipe เสียงได้', async () => {
  const up = await open('/live');
  assert.equal(up.statusCode, 200);
  assert.equal(up.contentType, 'audio/mpeg');
  assert.equal(up.host, '127.0.0.1');
  assert.ok((await readBytes(up.body, CHUNK.length * 3)) >= CHUNK.length * 3);
  up.body.destroy();
});

test('upstream ตอบ ICY 200 OK: fallback เป็น socket เอง แล้ว pipe ได้ (รวมเสียงที่มากับ header)', async () => {
  icyRequests.length = 0;
  const up = await open(`${I}/stream`);
  // ครั้งแรกผ่าน http ของ Node (HTTP/1.1) แล้ว parse error → ครั้งที่สองเขียน request เอง (HTTP/1.0)
  assert.deepEqual(icyRequests.map((r) => r.line), ['GET /stream HTTP/1.1', 'GET /stream HTTP/1.0']);
  assert.ok(icyRequests.every((r) => r.icyMeta), 'ต้องส่ง Icy-MetaData: 0 ทุกครั้ง');
  assert.equal(up.statusCode, 200);
  assert.equal(up.contentType, 'audio/mpeg');
  assert.equal(up.headers['icy-name'], 'Fake ICY');
  const first = await new Promise((r) => up.body.once('data', r));
  assert.ok(first.toString('latin1').startsWith('AUDIO-FRAME-'), 'ก้อนแรกต้องเป็นเสียง ไม่ใช่ header');
  assert.ok((await readBytes(up.body, CHUNK.length * 3)) > 0);
  up.body.destroy();
});

test('redirect: ตามได้ และทุก hop ผ่าน guard ซ้ำ', async () => {
  guardCalls.length = 0;
  const up = await open('/redirect');
  assert.equal(up.statusCode, 200);
  up.body.destroy();
  assert.deepEqual(guardCalls, [`${H}/redirect`, `${H}/live`]);
  const icy = await open('/to-icy');
  assert.equal(icy.headers['icy-name'], 'Fake ICY');
  icy.body.destroy();
});

test('redirect ไปที่อยู่ภายใน / port ต้องห้าม → 403', async () => {
  await assert.rejects(open('/to-private'), (e) => e instanceof UpstreamError && e.statusCode === 403);
  await assert.rejects(open('/to-bad-port'), (e) => e instanceof UpstreamError && e.statusCode === 403);
});

test('redirect เกิน 5 ครั้ง → 502', async () => {
  guardCalls.length = 0;
  await assert.rejects(open('/loop'), (e) => e.statusCode === 502 && e.reason === 'too_many_redirects');
  assert.equal(guardCalls.length, 6); // ต้นทาง + 5 redirect
});

test('playlist: .pls → ตาม URL ข้างใน (ผ่าน guard) / ว่าง → 502 / ชี้ที่อยู่ภายใน → 403', async () => {
  const up = await open('/listen.pls');
  assert.equal(up.contentType, 'audio/mpeg');
  up.body.destroy();
  await assert.rejects(open('/empty.m3u'), (e) => e.statusCode === 502 && e.reason === 'playlist_empty');
  await assert.rejects(open('/pls-to-private'), (e) => e.statusCode === 403);
});

test('HLS → 415 (จาก path, content-type, เนื้อหา m3u หรือ hls: 1)', async () => {
  for (const p of ['/a/playlist.m3u8', '/hls-type', '/hidden-hls.m3u']) {
    await assert.rejects(open(p), (e) => e.statusCode === 415, p);
  }
  await assert.rejects(open('/live', { hls: true }), (e) => e.statusCode === 415);
});

test('upstream ตอบ 4xx/5xx → 502, ไม่ตอบ header → 504', async () => {
  await assert.rejects(open('/missing'), (e) => e.statusCode === 502 && e.reason === 'bad_status');
  await assert.rejects(open('/nope'), (e) => e.statusCode === 502);
  await assert.rejects(open('/no-headers'), (e) => e.statusCode === 504 && e.reason === 'header_timeout');
  await assert.rejects(open('http://127.0.0.1:1/'), (e) => e.statusCode === 403); // port ต้องห้าม (guard จริง)
});

// ตัวกลางแบบเดียวกับ route จริง: openUpstream → relay ไปที่ response ของ client
async function startRelayServer(path, relayOpts) {
  const results = [];
  const srv = http.createServer(async (req, res) => {
    const up = await open(path);
    res.writeHead(200, { 'Content-Type': up.contentType });
    res.flushHeaders(); // แบบเดียวกับ route จริง: ส่ง header ทันที
    results.push(await relay(up.body, res, relayOpts));
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return { srv, results, url: `http://127.0.0.1:${srv.address().port}/` };
}

for (const [label, path, counter] of [
  ['HTTP', '/live', 'httpClosed'],
  ['ICY', null, 'icyClosed'],
]) {
  test(`client ปิด → upstream ${label} ถูกปิดตาม และ relay รายงาน client_closed`, async () => {
    const before = tracked[counter];
    const { srv, results, url } = await startRelayServer(path ?? `${I}/stream`, { idleTimeoutMs: 5000 });
    const res = await new Promise((r) => http.get(url, r));
    assert.ok((await readBytes(res, CHUNK.length * 2)) > 0);
    res.destroy(); // ผู้ฟังปิดแท็บ
    await waitFor(() => results.length === 1);
    assert.equal(results[0].reason, 'client_closed');
    assert.ok(results[0].bytes >= CHUNK.length * 2);
    await waitFor(() => tracked[counter] > before); // socket ไปยัง upstream ถูกปิดจริง
    srv.closeAllConnections();
    srv.close();
  });
}

test('idle timeout: upstream ไม่ส่งข้อมูล → ตัดทั้งสองฝั่ง', async () => {
  const before = tracked.httpClosed;
  const { srv, results, url } = await startRelayServer('/silent', { idleTimeoutMs: 200 });
  const res = await new Promise((r) => http.get(url, r));
  res.on('error', () => {}); // proxy ตัดกลางทาง → client ได้ 'aborted' เป็นเรื่องปกติ
  const closed = new Promise((r) => res.once('close', r));
  const t0 = Date.now();
  await waitFor(() => results.length === 1);
  assert.equal(results[0].reason, 'idle_timeout');
  assert.ok(Date.now() - t0 < 1500);
  await closed;
  await waitFor(() => tracked.httpClosed > before);
  srv.closeAllConnections();
  srv.close();
});

test('upstream จบเอง → upstream_end และ client ได้ข้อมูลครบ', async () => {
  const { srv, results, url } = await startRelayServer('/short', {});
  const res = await new Promise((r) => http.get(url, r));
  let got = 0;
  for await (const c of res) got += c.length;
  assert.equal(got, CHUNK.length * 2);
  await waitFor(() => results.length === 1);
  assert.deepEqual(results[0], { reason: 'upstream_end', bytes: CHUNK.length * 2 });
  srv.closeAllConnections();
  srv.close();
});

test('max duration: ตัดเมื่อครบอายุสูงสุด', async () => {
  const { srv, results, url } = await startRelayServer('/live', { idleTimeoutMs: 5000, maxDurationMs: 150 });
  const res = await new Promise((r) => http.get(url, r));
  res.resume();
  await waitFor(() => results.length === 1);
  assert.equal(results[0].reason, 'max_duration');
  srv.closeAllConnections();
  srv.close();
});
