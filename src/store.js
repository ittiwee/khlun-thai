// สถานีโปรด, ฟังล่าสุด, ระดับเสียง, ประเทศล่าสุด — ห้ามแตะ DOM
// เก็บใน localStorage แบบครอบ try/catch ถ้าใช้ไม่ได้ก็ทำงานต่อในหน่วยความจำ

const KEYS = { favs: 'kt-favs-v2', recent: 'kt-recent-v1', volume: 'kt-vol', country: 'kt-country' };
export const RECENT_MAX = 20;

// snapshot พอให้แสดงการ์ดและเล่นได้โดยไม่ต้องเรียก API
const SNAPSHOT_FIELDS = ['stationuuid', 'name', 'countrycode', 'favicon', 'url_resolved', 'codec', 'bitrate', 'hls', 'homepage'];
export function snapshot(station) {
  const s = {};
  for (const k of SNAPSHOT_FIELDS) if (station[k] !== undefined) s[k] = station[k];
  return s;
}

function browserStorage() {
  return {
    get(key) {
      try {
        const v = globalThis.localStorage?.getItem(key);
        return v == null ? null : JSON.parse(v);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
      } catch {
        // เต็มหรือถูกปิด — ค่าอยู่ในหน่วยความจำต่อ
      }
    },
  };
}

const validList = (v) => (Array.isArray(v) ? v.filter((s) => s && typeof s.stationuuid === 'string' && s.url_resolved) : []);

export function createStore(storage = browserStorage()) {
  let favs = validList(storage.get(KEYS.favs));
  let recent = validList(storage.get(KEYS.recent)).slice(0, RECENT_MAX);
  const listeners = new Set();
  const changed = (what) => listeners.forEach((fn) => fn(what));

  return {
    favorites: () => [...favs],
    isFavorite: (id) => favs.some((s) => s.stationuuid === id),
    toggleFavorite(station) {
      const id = station.stationuuid;
      const had = favs.some((s) => s.stationuuid === id);
      favs = had ? favs.filter((s) => s.stationuuid !== id) : [snapshot(station), ...favs];
      storage.set(KEYS.favs, favs);
      changed('favs');
      return !had;
    },

    recent: () => [...recent],
    addRecent(station) {
      recent = [snapshot(station), ...recent.filter((s) => s.stationuuid !== station.stationuuid)].slice(0, RECENT_MAX);
      storage.set(KEYS.recent, recent);
      changed('recent');
    },

    volume(fallback) {
      const v = storage.get(KEYS.volume);
      return typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback;
    },
    setVolume: (v) => storage.set(KEYS.volume, v),

    lastCountry() {
      const c = storage.get(KEYS.country);
      return typeof c === 'string' && /^[A-Z]{2}$/.test(c) ? c : null;
    },
    setLastCountry: (code) => storage.set(KEYS.country, code),

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
