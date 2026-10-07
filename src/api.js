// Radio Browser API: เลือก mirror, สลับเมื่อล่ม, cache — ห้ามแตะ DOM
import { COUNTRY_CACHE_MS, PAGE_SIZE } from './config.js';

const SERVERS_URL = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK_HOSTS = ['de1', 'nl1', 'at1'].map((h) => `${h}.api.radio-browser.info`);
const COUNTRY_CACHE_KEY = 'kt-countries-v1';

const STATION_FIELDS = [
  'stationuuid', 'name', 'url_resolved', 'homepage', 'favicon', 'tags', 'countrycode',
  'codec', 'bitrate', 'hls', 'clickcount', 'lastcheckok',
];

export function pickStation(raw) {
  const s = {};
  for (const k of STATION_FIELDS) s[k] = raw[k] ?? '';
  s.name = String(s.name).trim() || '(ไม่มีชื่อ)';
  s.bitrate = Number(s.bitrate) || 0;
  s.hls = Number(s.hls) || 0;
  s.clickcount = Number(s.clickcount) || 0;
  return s;
}

// url จาก /json/url อาจเป็น playlist (.pls/.m3u/.asx) ที่ <audio> เล่นไม่ได้ — กรณีนั้นใช้ url_resolved
const PLAYLIST = /\.(pls|m3u|asx|xspf)$/i;
export function playableUrl(clickUrl, station) {
  const path = (clickUrl || '').split(/[?#]/)[0];
  if (!clickUrl || PLAYLIST.test(path)) return station.url_resolved;
  return clickUrl;
}

export class ApiError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function safeStorage() {
  return {
    get(key) {
      try {
        const v = globalThis.localStorage?.getItem(key);
        return v ? JSON.parse(v) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
      } catch {
        // เต็มหรือถูกปิดไว้ — ทำงานต่อโดยไม่มี cache
      }
    },
  };
}

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// รวมรหัสซ้ำที่ต่างแค่ตัวพิมพ์ (เช่น "gr" กับ "GR"), ตัดรายการที่ไม่มีชื่อหรือไม่มีสถานี, เรียงตามจำนวนสถานี
export function normalizeCountries(raw) {
  const byCode = new Map();
  for (const c of raw) {
    const code = String(c.iso_3166_1 || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || !(c.stationcount > 0)) continue;
    const prev = byCode.get(code);
    if (prev) {
      prev.stationcount += c.stationcount;
      if (!prev.name) prev.name = c.name || '';
    } else {
      byCode.set(code, { code, name: c.name || '', stationcount: c.stationcount });
    }
  }
  return [...byCode.values()].filter((c) => c.name).sort((a, b) => b.stationcount - a.stationcount);
}

export function createApi({
  fetchFn = (...args) => globalThis.fetch(...args),
  storage = safeStorage(),
  now = () => Date.now(),
  random = Math.random,
  timeoutMs = 10000,
} = {}) {
  let serversPromise = null;
  let active = 0; // index ของ mirror ที่ใช้ได้ล่าสุด

  async function fetchWithTimeout(url, ms = timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetchFn(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function servers() {
    serversPromise ??= (async () => {
      try {
        const res = await fetchWithTimeout(SERVERS_URL);
        if (!res.ok) throw new Error(`servers ${res.status}`);
        const names = [...new Set((await res.json()).map((s) => s.name).filter(Boolean))];
        if (names.length) return shuffle(names, random);
      } catch {
        // ใช้รายชื่อสำรองด้านล่าง
      }
      return shuffle(FALLBACK_HOSTS, random);
    })();
    return serversPromise;
  }

  async function request(path, params = {}, { timeout = timeoutMs, failover = true } = {}) {
    const hosts = await servers();
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString();
    const tries = failover ? hosts.length : 1;
    for (let i = 0; i < tries; i++) {
      const idx = (active + i) % hosts.length;
      let res;
      try {
        res = await fetchWithTimeout(`https://${hosts[idx]}${path}${qs ? `?${qs}` : ''}`, timeout);
      } catch {
        continue; // network error / timeout → mirror ถัดไป
      }
      if (res.status >= 500) continue;
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`, { status: res.status });
      active = idx;
      return res.json();
    }
    throw new ApiError('ติดต่อเซิร์ฟเวอร์ Radio Browser ไม่ได้');
  }

  async function getCountries() {
    const cached = storage.get(COUNTRY_CACHE_KEY);
    const valid = cached && Array.isArray(cached.data) && cached.data.length;
    if (valid && now() - cached.time < COUNTRY_CACHE_MS) return cached.data;
    try {
      const data = normalizeCountries(await request('/json/countries'));
      storage.set(COUNTRY_CACHE_KEY, { time: now(), data });
      return data;
    } catch (err) {
      if (valid) return cached.data; // ออฟไลน์: ใช้ของเก่าแม้หมดอายุ
      throw err;
    }
  }

  // สถานีตามประเทศ (+ tag) เรียงตามความนิยม — cache ในหน่วยความจำ key = ประเทศ + tag + หน้า
  const stationCache = new Map();
  async function getStations({ countrycode, tag = '', page = 1 }) {
    const key = `${countrycode}|${tag}|${page}`;
    if (stationCache.has(key)) return stationCache.get(key);
    const raw = await request('/json/stations/search', {
      countrycode,
      tag,
      order: 'clickcount',
      reverse: 'true',
      hidebroken: 'true',
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    const list = raw.map(pickStation);
    stationCache.set(key, list);
    return list;
  }

  // หน้าสุดท้ายที่มีสถานีจริง (stationcount ของประเทศนับสถานีเสียด้วย จึงสูงกว่าจริง)
  // lo = หน้าที่รู้ว่ามีสถานี, hi = หน้าที่รู้ว่าว่าง — ค้นแบบ binary ด้วย limit=1
  async function findLastPage({ countrycode, tag = '', lo, hi }) {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const probe = await request('/json/stations/search', {
        countrycode,
        tag,
        hidebroken: 'true',
        limit: 1,
        offset: (mid - 1) * PAGE_SIZE,
      });
      if (probe.length) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // ตรวจว่าหน้า upper (จาก stationcount) มีสถานีจริงไหม ถ้าว่างหาหน้าสุดท้ายจริง
  async function verifyLastPage({ countrycode, tag = '', upper }) {
    const probe = await request('/json/stations/search', {
      countrycode,
      tag,
      hidebroken: 'true',
      limit: 1,
      offset: (upper - 1) * PAGE_SIZE,
    });
    if (probe.length) return upper;
    return findLastPage({ countrycode, tag, lo: 1, hi: upper });
  }

  // นับคลิกให้สถานี (มารยาทของ Radio Browser) แล้วคืน URL ที่ใช้เล่น — ถ้าไม่สำเร็จใช้ url_resolved
  async function clickUrl(station, { timeout = 3000 } = {}) {
    try {
      const res = await request(`/json/url/${encodeURIComponent(station.stationuuid)}`, {}, { timeout, failover: false });
      return playableUrl(res?.ok === false ? '' : res?.url, station);
    } catch {
      return station.url_resolved;
    }
  }

  return { request, getCountries, getStations, findLastPage, verifyLastPage, clickUrl };
}

export const api = createApi();
