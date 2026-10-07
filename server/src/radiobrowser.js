// เลือก mirror ของ Radio Browser + lookup uuid → url (มี cache)
import { LRUCache } from 'lru-cache';
import { normalizeUuid } from './uuid.js';

const SERVERS_URL = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK_HOSTS = ['de1', 'nl1', 'at1'].map((h) => `${h}.api.radio-browser.info`);
const LOOKUP_TIMEOUT_MS = 5000;
const MAX_TRIES = 3;
const REFRESH_MS = 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 1000;
const CACHE_MAX = 5000;
// ชื่อ mirror ต้องเป็นโดเมนของ Radio Browser เท่านั้น (กันรายชื่อ server ถูกปลอม)
const MIRROR_RE = /^[a-z0-9-]+\.api\.radio-browser\.info$/;

export class LookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LookupError';
    this.statusCode = 502;
  }
}

const NOT_FOUND = Symbol('not_found');

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// เก็บเฉพาะที่ proxy ต้องใช้
export function toStationInfo(raw) {
  const url = String(raw.url_resolved || raw.url || '').trim();
  if (!url) return null;
  return {
    stationuuid: String(raw.stationuuid || '').toLowerCase(),
    url,
    codec: String(raw.codec || ''),
    hls: Number(raw.hls) === 1,
  };
}

export function createRadioBrowser({
  userAgent,
  ttlSec,
  fetchFn = (...args) => globalThis.fetch(...args),
  random = Math.random,
  log = { warn() {}, info() {} },
  timeoutMs = LOOKUP_TIMEOUT_MS,
  clock, // { now() } สำหรับ test เท่านั้น — production ใช้ performance.now ของ lru-cache
} = {}) {
  let hosts = shuffle(FALLBACK_HOSTS, random);
  let active = 0;
  let refreshTimer = null;
  const cache = new LRUCache({ max: CACHE_MAX, ttl: ttlSec * 1000, ...(clock ? { perf: clock, ttlResolution: 0 } : {}) });
  const inflight = new Map(); // uuid → Promise (รวม lookup ซ้ำที่มาพร้อมกัน)
  const headers = { 'User-Agent': userAgent, Accept: 'application/json' };

  async function getJson(url) {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function refreshMirrors() {
    try {
      const list = await getJson(SERVERS_URL);
      const names = [...new Set((Array.isArray(list) ? list : []).map((s) => String(s?.name || '').toLowerCase()))].filter((n) =>
        MIRROR_RE.test(n),
      );
      if (names.length) {
        hosts = shuffle(names, random);
        active = 0;
        return true;
      }
      log.warn({ count: 0 }, 'radio browser server list empty, keep current mirrors');
    } catch (err) {
      log.warn({ err: { message: err.message } }, 'radio browser server list failed, keep current mirrors');
    }
    return false;
  }

  async function fetchStation(uuid) {
    const tries = Math.min(MAX_TRIES, hosts.length);
    let lastErr;
    for (let i = 0; i < tries; i++) {
      const idx = (active + i) % hosts.length;
      try {
        const data = await getJson(`https://${hosts[idx]}/json/stations/byuuid/${uuid}`);
        active = idx;
        const raw = Array.isArray(data) ? data[0] : null;
        return (raw && toStationInfo(raw)) || NOT_FOUND;
      } catch (err) {
        lastErr = err;
        // 4xx (ยกเว้น 429) = คำขอผิด ไม่ใช่ mirror ล่ม — ไม่ต้องลองตัวอื่น
        if (err.status >= 400 && err.status < 500 && err.status !== 429) break;
      }
    }
    log.warn({ err: { message: lastErr?.message } }, 'radio browser lookup failed');
    throw new LookupError('ติดต่อ Radio Browser ไม่ได้');
  }

  // คืน { stationuuid, url, codec, hls } หรือ null ถ้าไม่พบ; throw LookupError ถ้า Radio Browser ล่ม
  async function lookup(rawUuid) {
    const uuid = normalizeUuid(rawUuid);
    if (!uuid) return null;
    const hit = cache.get(uuid);
    if (hit !== undefined) return hit === NOT_FOUND ? null : hit;
    if (inflight.has(uuid)) return inflight.get(uuid);
    const p = fetchStation(uuid)
      .then((result) => {
        if (result === NOT_FOUND) {
          cache.set(uuid, NOT_FOUND, { ttl: Math.min(NOT_FOUND_TTL_MS, ttlSec * 1000) });
          return null;
        }
        cache.set(uuid, result);
        return result;
      })
      .finally(() => inflight.delete(uuid));
    inflight.set(uuid, p);
    return p;
  }

  async function start() {
    await refreshMirrors();
    refreshTimer = setInterval(refreshMirrors, REFRESH_MS);
    refreshTimer.unref();
  }

  function stop() {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  return {
    lookup,
    start,
    stop,
    refreshMirrors,
    mirror: () => hosts[active] ?? null,
    mirrors: () => [...hosts],
  };
}
