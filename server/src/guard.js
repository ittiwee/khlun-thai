// กัน SSRF: ตรวจ URL, port, IP ปลายทาง
// ฟังก์ชันส่วนใหญ่เป็น pure function; การ resolve DNS รับ resolver เข้ามาเป็น parameter เพื่อ test ได้โดยไม่พึ่ง DNS จริง
import { isIP } from 'node:net';

export class GuardError extends Error {
  // reason: 'scheme' | 'port' | 'credentials' | 'host' | 'blocked_ip' | 'dns'
  constructor(reason, message) {
    super(message);
    this.name = 'GuardError';
    this.reason = reason;
    // dns resolve ไม่ได้ = ปลายทางไม่มีอยู่จริง (สถานีออฟไลน์) ไม่ใช่การละเมิดนโยบาย
    this.statusCode = reason === 'dns' ? 502 : 403;
  }
}

// ---------- IPv4 ----------
function v4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function v4Cidr(cidr) {
  const [ip, bits] = cidr.split('/');
  const b = Number(bits);
  return { base: v4ToInt(ip), size: 2 ** (32 - b) };
}

// ตามข้อ 5.2 ของ docs/PROXY.md
const V4_BLOCKED = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
].map(v4Cidr);

export function isBlockedIPv4(ip) {
  const n = v4ToInt(ip);
  if (n == null) return true; // แปลงไม่ได้ = ไม่เชื่อ
  return V4_BLOCKED.some(({ base, size }) => n >= base && n < base + size);
}

// ---------- IPv6 ----------
// แปลงเป็น 8 ตัวเลข 16 บิต รองรับ "::", zone id และท้ายแบบ IPv4 (::ffff:1.2.3.4) — รูปแบบผิดคืน null
export function expandIPv6(ip) {
  let s = ip.toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  s = s.split('%')[0];
  // ท้ายแบบ IPv4 → แปลงเป็น 2 กลุ่ม hex ก่อน
  const last = s.lastIndexOf(':');
  if (last >= 0 && s.includes('.', last)) {
    const n = v4ToInt(s.slice(last + 1));
    if (n == null) return null;
    s = `${s.slice(0, last + 1)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  if (![...head, ...tail].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const zeros = Array(8 - head.length - tail.length).fill('0');
  return [...head, ...zeros, ...tail].map((g) => parseInt(g, 16));
}

const groupsToV4 = (g) => [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');

function inV6Prefix(groups, prefix, bits) {
  for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
    const take = Math.min(16, bits);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((groups[i] & mask) !== (prefix[i] & mask)) return false;
  }
  return true;
}

const v6 = (s) => expandIPv6(s);
// ตามข้อ 5.2: ::/128, ::1/128, fc00::/7, fe80::/10, ff00::/8
// เพิ่มที่เข้มกว่าแผน: ::/96 (IPv4-compatible แบบเก่า) — ทั้งหมดนี้ไม่ใช่ที่อยู่สาธารณะ
const V6_BLOCKED = [
  [v6('::'), 128],
  [v6('::1'), 128],
  [v6('fc00::'), 7],
  [v6('fe80::'), 10],
  [v6('ff00::'), 8],
  [v6('::'), 96],
];
// prefix ที่ฝัง IPv4 ไว้ 32 บิตท้าย → ตรวจตามกฎ IPv4
const V6_EMBEDS_V4 = [
  [v6('::ffff:0:0'), 96], // IPv4-mapped (ตามแผน)
  [v6('64:ff9b::'), 96], // NAT64 well-known prefix (เข้มกว่าแผน)
];

export function isBlockedIPv6(ip) {
  const g = expandIPv6(ip);
  if (!g) return true;
  for (const [prefix, bits] of V6_EMBEDS_V4) if (inV6Prefix(g, prefix, bits)) return isBlockedIPv4(groupsToV4(g));
  return V6_BLOCKED.some(([prefix, bits]) => inV6Prefix(g, prefix, bits));
}

export function isBlockedIP(ip) {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const v = isIP(bare.split('%')[0]);
  if (v === 4) return isBlockedIPv4(bare);
  if (v === 6) return isBlockedIPv6(bare);
  return true;
}

// ---------- URL ----------
const ALLOWED_PORT = (p) => p === 80 || p === 443 || (p >= 1024 && p <= 65535);

// ตรวจส่วนที่ไม่ต้องใช้ DNS — คืน { url, protocol, hostname, port, ipLiteral }
export function checkUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input));
  } catch {
    throw new GuardError('scheme', 'URL ไม่ถูกต้อง');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new GuardError('scheme', 'รองรับเฉพาะ http และ https');
  if (url.username || url.password) throw new GuardError('credentials', 'URL ต้องไม่มีชื่อผู้ใช้/รหัสผ่าน');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORT(port)) throw new GuardError('port', `ไม่อนุญาต port ${port}`);
  // WHATWG URL แปลง host แปลกๆ (0x7f.1, 2130706433, [::ffff:7f00:1]) เป็นรูปมาตรฐานให้แล้ว
  let hostname = url.hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
  if (!hostname) throw new GuardError('host', 'ไม่มีชื่อโฮสต์');
  const ipLiteral = isIP(hostname) !== 0;
  if (ipLiteral && isBlockedIP(hostname)) throw new GuardError('blocked_ip', 'ปลายทางเป็นที่อยู่ภายใน');
  return { url, protocol: url.protocol, hostname, port, ipLiteral };
}

// ตรวจ URL ครบ รวม resolve DNS — ปฏิเสธถ้า IP ใดๆ ที่ได้เป็นที่อยู่ภายใน
// resolve(hostname) ต้องคืน [{ address, family }] (รูปแบบเดียวกับ dns.promises.lookup(host, { all: true }))
// คืน { url, hostname, port, address, family } — ใช้ address นี้เชื่อมต่อตรง (กัน DNS rebinding)
export async function guardUrl(input, { resolve }) {
  const target = checkUrl(input);
  if (target.ipLiteral) {
    return { ...target, address: target.hostname, family: isIP(target.hostname) };
  }
  let addrs;
  try {
    addrs = await resolve(target.hostname);
  } catch {
    throw new GuardError('dns', 'หาที่อยู่ของเซิร์ฟเวอร์สตรีมไม่พบ');
  }
  if (!Array.isArray(addrs) || !addrs.length) throw new GuardError('dns', 'หาที่อยู่ของเซิร์ฟเวอร์สตรีมไม่พบ');
  for (const a of addrs) {
    if (!a || typeof a.address !== 'string' || isBlockedIP(a.address)) {
      throw new GuardError('blocked_ip', 'ปลายทางเป็นที่อยู่ภายใน');
    }
  }
  const { address, family } = addrs[0];
  return { ...target, address, family: family === 6 || family === 'IPv6' ? 6 : 4 };
}

// lookup function สำหรับ http(s).request / net.connect / tls.connect: คืน IP ที่ตรวจแล้วเสมอ
// ใช้คู่กับ host = ชื่อเดิม (Host header + TLS SNI ถูกต้อง) แต่ไม่ resolve DNS ซ้ำ
export function pinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    if (opts.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

// resolver จริงสำหรับ production: getaddrinfo ทั้ง A และ AAAA (รวม /etc/hosts)
export async function systemResolve(hostname) {
  const { lookup } = await import('node:dns/promises');
  return lookup(hostname, { all: true, verbatim: true });
}
