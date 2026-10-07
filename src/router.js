// hash routing: #th (หน้า 1), #jp/3, #fav, #recent — ห้ามแตะ DOM
//
// route = { view: 'country', country: 'JP', page: 3 } | { view: 'fav' } | { view: 'recent' }

export function parseHash(hash) {
  const h = String(hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  if (!h) return null;
  if (h === 'fav') return { view: 'fav' };
  if (h === 'recent') return { view: 'recent' };
  const m = /^([a-z]{2})(?:\/(\d{1,5}))?\/?$/.exec(h);
  if (!m) return null;
  const page = m[2] ? Number(m[2]) : 1;
  if (page < 1) return null;
  return { view: 'country', country: m[1].toUpperCase(), page };
}

export function formatHash(route) {
  if (route.view === 'fav') return '#fav';
  if (route.view === 'recent') return '#recent';
  const cc = route.country.toLowerCase();
  return route.page > 1 ? `#${cc}/${route.page}` : `#${cc}`;
}

export const sameRoute = (a, b) => Boolean(a && b) && formatHash(a) === formatHash(b);

// timezone → ประเทศ (เฉพาะโซนที่ใช้บ่อย; ใช้เมื่อภาษาไม่ได้ระบุประเทศ)
const TZ_COUNTRY = {
  'Asia/Bangkok': 'TH', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Vientiane': 'LA', 'Asia/Phnom_Penh': 'KH', 'Asia/Yangon': 'MM',
  'Asia/Rangoon': 'MM', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP', 'Asia/Colombo': 'LK', 'Asia/Jerusalem': 'IL', 'Asia/Riyadh': 'SA',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT',
  'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Europe/Athens': 'GR', 'Europe/Istanbul': 'TR', 'Europe/Moscow': 'RU',
  'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Lisbon': 'PT', 'Europe/Bucharest': 'RO',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Phoenix': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA',
  'America/Vancouver': 'CA', 'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR',
  'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL', 'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Pacific/Auckland': 'NZ',
  'Africa/Johannesburg': 'ZA', 'Africa/Cairo': 'EG', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE',
};

function regionOf(tag, { maximize = false } = {}) {
  try {
    const loc = new Intl.Locale(tag);
    const region = loc.region || (maximize ? loc.maximize().region : undefined);
    return region && /^[A-Z]{2}$/.test(region) ? region : null;
  } catch {
    return null;
  }
}

// ลำดับ: ภาษาที่ระบุประเทศ (th-TH → TH) → timezone → ภาษาอย่างเดียว (th → TH) → fallback
export function guessCountry({ languages = [], timeZone = '' } = {}, fallback = 'TH') {
  for (const tag of languages) {
    const r = regionOf(tag);
    if (r) return r;
  }
  if (TZ_COUNTRY[timeZone]) return TZ_COUNTRY[timeZone];
  for (const tag of languages) {
    const r = regionOf(tag, { maximize: true });
    if (r) return r;
  }
  return fallback;
}

// ตัว router: env ฉีดได้เพื่อ test — ค่าเริ่มต้นใช้ window.location + hashchange
export function createRouter({ onRoute, fallback }, env = globalThis) {
  const read = () => parseHash(env.location.hash);

  function navigate(route, { replace = false } = {}) {
    const hash = formatHash(route);
    if (env.location.hash === hash) return onRoute(route);
    if (replace) env.history.replaceState(null, '', hash);
    else env.location.hash = hash;
    if (replace) onRoute(route);
  }

  function handle() {
    const route = read();
    if (route) onRoute(route);
    else navigate(fallback(), { replace: true });
  }

  env.addEventListener('hashchange', handle);
  return { navigate, start: handle, current: read };
}
