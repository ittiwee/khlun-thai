// Radio Browser API: เลือก mirror, สลับเมื่อล่ม, cache — ห้ามแตะ DOM
import { COUNTRY_CACHE_MS } from './config.js';

const SERVERS_URL = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK_HOSTS = ['de1', 'nl1', 'at1'].map((h) => `${h}.api.radio-browser.info`);
const COUNTRY_CACHE_KEY = 'kt-countries-v1';

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

  async function fetchWithTimeout(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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

  async function request(path, params = {}) {
    const hosts = await servers();
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString();
    for (let i = 0; i < hosts.length; i++) {
      const idx = (active + i) % hosts.length;
      let res;
      try {
        res = await fetchWithTimeout(`https://${hosts[idx]}${path}${qs ? `?${qs}` : ''}`);
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

  return { request, getCountries };
}

export const api = createApi();
