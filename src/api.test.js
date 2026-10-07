import { describe, it, expect } from 'vitest';
import { createApi, normalizeCountries, ApiError } from './api.js';

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const COUNTRIES = [
  { name: 'Japan', iso_3166_1: 'JP', stationcount: 224 },
  { name: 'Greece', iso_3166_1: 'GR', stationcount: 2311 },
  { name: 'Greece', iso_3166_1: 'gr', stationcount: 1 },
  { name: '', iso_3166_1: 'XX', stationcount: 1 },
  { name: 'Nowhere', iso_3166_1: 'NW', stationcount: 0 },
];

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), m };
}

describe('normalizeCountries', () => {
  it('merges case-duplicates, drops empty/zero, sorts by stationcount', () => {
    expect(normalizeCountries(COUNTRIES)).toEqual([
      { code: 'GR', name: 'Greece', stationcount: 2312 },
      { code: 'JP', name: 'Japan', stationcount: 224 },
    ]);
  });
});

describe('createApi mirrors', () => {
  it('falls back to next mirror on network error and 5xx', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (url.includes('/json/servers')) return json([{ name: 'a.test' }, { name: 'a.test' }, { name: 'b.test' }, { name: 'c.test' }]);
      if (url.startsWith('https://a.test')) throw new TypeError('network');
      if (url.startsWith('https://b.test')) return json(null, 503);
      return json(['ok']);
    };
    const api = createApi({ fetchFn, storage: memStorage(), random: () => 0.999 }); // shuffle keeps order
    expect(await api.request('/json/x', { a: 1, empty: '' })).toEqual(['ok']);
    expect(calls.slice(1)).toEqual(['https://a.test/json/x?a=1', 'https://b.test/json/x?a=1', 'https://c.test/json/x?a=1']);
    // ครั้งถัดไปเริ่มที่ mirror ที่ใช้ได้ล่าสุด
    calls.length = 0;
    await api.request('/json/y');
    expect(calls).toEqual(['https://c.test/json/y']);
  });

  it('uses built-in fallback hosts when server list fails', async () => {
    const hosts = new Set();
    const fetchFn = async (url) => {
      if (url.includes('all.api')) throw new TypeError('offline');
      hosts.add(new URL(url).host);
      throw new TypeError('offline');
    };
    const api = createApi({ fetchFn, storage: memStorage() });
    await expect(api.request('/json/x')).rejects.toBeInstanceOf(ApiError);
    expect([...hosts].sort()).toEqual(['at1.api.radio-browser.info', 'de1.api.radio-browser.info', 'nl1.api.radio-browser.info']);
  });

  it('does not retry on 4xx', async () => {
    let n = 0;
    const fetchFn = async (url) => (url.includes('servers') ? json([{ name: 'a.test' }, { name: 'b.test' }]) : (n++, json(null, 404)));
    const api = createApi({ fetchFn, storage: memStorage() });
    await expect(api.request('/json/x')).rejects.toMatchObject({ status: 404 });
    expect(n).toBe(1);
  });
});

describe('getCountries cache', () => {
  const online = async (url) => (url.includes('servers') ? json([{ name: 'a.test' }]) : json(COUNTRIES));
  const offline = async () => {
    throw new TypeError('offline');
  };

  it('caches for 24h then refetches', async () => {
    const storage = memStorage();
    let t = 0;
    let hits = 0;
    const fetchFn = async (url) => (url.includes('countries') && hits++, online(url));
    const api = createApi({ fetchFn, storage, now: () => t });
    await api.getCountries();
    t = 23 * 3600e3;
    await api.getCountries();
    expect(hits).toBe(1);
    t = 25 * 3600e3;
    await api.getCountries();
    expect(hits).toBe(2);
  });

  it('serves stale cache when offline', async () => {
    const storage = memStorage({ 'kt-countries-v1': { time: 0, data: [{ code: 'JP', name: 'Japan', stationcount: 1 }] } });
    const api = createApi({ fetchFn: offline, storage, now: () => 1e12 });
    expect(await api.getCountries()).toEqual([{ code: 'JP', name: 'Japan', stationcount: 1 }]);
  });

  it('throws when offline with no cache', async () => {
    const api = createApi({ fetchFn: offline, storage: memStorage() });
    await expect(api.getCountries()).rejects.toBeInstanceOf(ApiError);
  });
});
