import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRadioBrowser, LookupError, toStationInfo } from '../src/radiobrowser.js';

const UUID = 'c764e9db-1d62-47fb-bb10-bcf132702499';
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const station = { stationuuid: UUID, url: 'http://orig.example/listen.pls', url_resolved: 'http://stream.example:8000/live', codec: 'MP3', hls: 0 };

// fetch ปลอมตามตารางของ host → response (ไม่แตะเครือข่ายจริง)
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, ua: opts?.headers?.['User-Agent'] });
    const host = new URL(url).host;
    const r = routes[host];
    if (!r) throw new TypeError('fetch failed');
    return typeof r === 'function' ? r(url) : r;
  };
  fn.calls = calls;
  return fn;
}

const make = (fetchFn, extra = {}) => createRadioBrowser({ userAgent: 'test-ua/1', ttlSec: 600, fetchFn, random: () => 0.999, ...extra });

test('toStationInfo ใช้ url_resolved ถ้าว่างใช้ url', () => {
  assert.deepEqual(toStationInfo(station), { stationuuid: UUID, url: 'http://stream.example:8000/live', codec: 'MP3', hls: false });
  assert.equal(toStationInfo({ ...station, url_resolved: '' }).url, 'http://orig.example/listen.pls');
  assert.equal(toStationInfo({ ...station, hls: 1 }).hls, true);
  assert.equal(toStationInfo({ url: '', url_resolved: '' }), null);
});

test('lookup ส่ง User-Agent และ cache ผล', async () => {
  const fetchFn = fakeFetch({ 'de1.api.radio-browser.info': json([station]), 'nl1.api.radio-browser.info': json([station]), 'at1.api.radio-browser.info': json([station]) });
  const rb = make(fetchFn);
  const a = await rb.lookup(UUID);
  const b = await rb.lookup(UUID.toUpperCase());
  assert.equal(a.url, 'http://stream.example:8000/live');
  assert.deepEqual(a, b);
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].ua, 'test-ua/1');
  assert.match(fetchFn.calls[0].url, new RegExp(`/json/stations/byuuid/${UUID}$`));
});

test('lookup พร้อมกันหลายครั้งเรียก API ครั้งเดียว', async () => {
  const fetchFn = fakeFetch({ 'de1.api.radio-browser.info': json([station]), 'nl1.api.radio-browser.info': json([station]), 'at1.api.radio-browser.info': json([station]) });
  const rb = make(fetchFn);
  await Promise.all([rb.lookup(UUID), rb.lookup(UUID), rb.lookup(UUID)]);
  assert.equal(fetchFn.calls.length, 1);
});

test('mirror ล้มเหลว (network / 5xx) สลับตัวถัดไป ไม่เกิน 3 ตัว แล้วจำตัวที่ใช้ได้', async () => {
  const fetchFn = fakeFetch({
    'all.api.radio-browser.info': json([{ name: 'a1.api.radio-browser.info' }, { name: 'b1.api.radio-browser.info' }, { name: 'c1.api.radio-browser.info' }, { name: 'd1.api.radio-browser.info' }]),
    'a1.api.radio-browser.info': () => {
      throw new TypeError('network');
    },
    'b1.api.radio-browser.info': json(null, 503),
    'c1.api.radio-browser.info': json([station]),
    'd1.api.radio-browser.info': json([station]),
  });
  const rb = make(fetchFn);
  await rb.refreshMirrors();
  assert.equal((await rb.lookup(UUID)).url, 'http://stream.example:8000/live');
  assert.equal(rb.mirror(), 'c1.api.radio-browser.info');
  const hosts = fetchFn.calls.slice(1).map((c) => new URL(c.url).host);
  assert.deepEqual(hosts, ['a1.api.radio-browser.info', 'b1.api.radio-browser.info', 'c1.api.radio-browser.info']);
});

test('ล้มเหลวครบ 3 mirror → LookupError (502) และไม่ cache', async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    throw new TypeError('down');
  };
  const rb = make(fetchFn);
  await assert.rejects(rb.lookup(UUID), (e) => e instanceof LookupError && e.statusCode === 502);
  assert.equal(n, 3);
  await assert.rejects(rb.lookup(UUID), LookupError);
  assert.equal(n, 6);
});

test('ไม่พบสถานี → null และ cache แค่ 60 วินาที (ผลที่พบ cache ตาม LOOKUP_TTL_SEC)', async () => {
  let now = 1_000;
  const clock = { now: () => now };
  let n = 0;
  const fetchFn = async () => {
    n++;
    return json([]);
  };
  const rb = make(fetchFn, { clock });
  assert.equal(await rb.lookup(UUID), null);
  now += 59_000;
  assert.equal(await rb.lookup(UUID), null);
  assert.equal(n, 1);
  now += 2_000;
  assert.equal(await rb.lookup(UUID), null);
  assert.equal(n, 2);

  // ผลที่พบอยู่ได้ตาม ttlSec (600 วินาที)
  let found = 0;
  const rb2 = make(async () => (found++, json([station])), { clock });
  await rb2.lookup(UUID);
  now += 599_000;
  await rb2.lookup(UUID);
  assert.equal(found, 1);
  now += 2_000;
  await rb2.lookup(UUID);
  assert.equal(found, 2);
});

test('uuid ผิดรูปแบบไม่เรียก API', async () => {
  let n = 0;
  const rb = make(async () => {
    n++;
    return json([station]);
  });
  assert.equal(await rb.lookup('../etc/passwd'), null);
  assert.equal(n, 0);
});

test('รายชื่อ server: รับเฉพาะโดเมน *.api.radio-browser.info, ดึงไม่ได้ใช้ de1/nl1/at1', async () => {
  const evil = make(
    fakeFetch({ 'all.api.radio-browser.info': json([{ name: 'evil.example.com' }, { name: '127.0.0.1' }, { name: 'ok1.api.radio-browser.info' }]) }),
  );
  await evil.refreshMirrors();
  assert.deepEqual(evil.mirrors(), ['ok1.api.radio-browser.info']);

  const down = make(fakeFetch({}));
  assert.equal(await down.refreshMirrors(), false);
  assert.deepEqual(down.mirrors().sort(), ['at1.api.radio-browser.info', 'de1.api.radio-browser.info', 'nl1.api.radio-browser.info']);
});
