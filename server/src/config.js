// อ่านค่าจาก env พร้อมค่าเริ่มต้นและตรวจความถูกต้อง — ค่าผิดให้ล้มตั้งแต่เริ่ม ไม่ใช่ตอนมีผู้ฟัง
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const int = (min, max) => (raw, name) => {
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} ต้องเป็นจำนวนเต็ม (ได้ "${raw}")`);
  const n = Number(raw);
  if (n < min || n > max) throw new ConfigError(`${name} ต้องอยู่ระหว่าง ${min}–${max} (ได้ ${n})`);
  return n;
};

const origin = (raw, name) => {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new ConfigError(`${name} ต้องเป็น origin เช่น https://example.com (ได้ "${raw}")`);
  }
  if (!/^https?:$/.test(u.protocol) || u.origin !== raw.replace(/\/$/, '')) {
    throw new ConfigError(`${name} ต้องเป็น origin แบบ http(s) ไม่มี path (ได้ "${raw}")`);
  }
  return u.origin;
};

// IP หรือ CIDR คั่นด้วยจุลภาค เช่น "127.0.0.1" หรือ "127.0.0.1,172.16.0.0/12" (ส่งให้ trustProxy ของ Fastify)
const trusted = (raw, name) => {
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new ConfigError(`${name} ต้องมีอย่างน้อย 1 IP`);
  for (const item of list) {
    const [ip, bits, extra] = item.split('/');
    const v = isIP(ip);
    const okBits = bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= (v === 6 ? 128 : 32));
    if (!v || !okBits || extra !== undefined) throw new ConfigError(`${name} มีค่าที่ไม่ใช่ IP/CIDR: "${item}"`);
  }
  return list;
};

const text = (raw, name) => {
  if (!raw.trim() || /[\r\n]/.test(raw)) throw new ConfigError(`${name} ต้องไม่ว่างและไม่มีขึ้นบรรทัดใหม่`);
  return raw.trim();
};

// ชื่อ env → [ชื่อใน config, ค่าเริ่มต้น, ตัวแปลง]
const SCHEMA = {
  PORT: ['port', '3000', int(1, 65535)],
  ALLOWED_ORIGIN: ['allowedOrigin', 'http://localhost:5173', origin],
  TRUSTED_PROXY: ['trustedProxy', '127.0.0.1', trusted],
  MAX_STREAMS: ['maxStreams', '200', int(1, 100000)],
  MAX_STREAMS_PER_IP: ['maxStreamsPerIp', '3', int(1, 1000)],
  RATE_LIMIT_PER_MIN: ['rateLimitPerMin', '30', int(1, 100000)],
  LOOKUP_TTL_SEC: ['lookupTtlSec', '600', int(1, 86400)],
  CONNECT_TIMEOUT_MS: ['connectTimeoutMs', '8000', int(100, 120000)],
  HEADER_TIMEOUT_MS: ['headerTimeoutMs', '10000', int(100, 120000)],
  IDLE_TIMEOUT_MS: ['idleTimeoutMs', '30000', int(1000, 600000)],
  RB_USER_AGENT: ['rbUserAgent', 'khlun-thai-proxy/1.0', text],
};

export function loadConfig(env = process.env) {
  const config = {};
  const errors = [];
  for (const [key, [name, fallback, parse]] of Object.entries(SCHEMA)) {
    const raw = env[key] === undefined || env[key] === '' ? fallback : String(env[key]);
    try {
      config[name] = parse(raw, key);
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (errors.length) throw new ConfigError(`ค่า config ไม่ถูกต้อง:\n- ${errors.join('\n- ')}`);
  return Object.freeze(config);
}

// โหลด server/.env ถ้ามี (ตอนรันเครื่องตัวเอง) — env ที่ตั้งไว้แล้วมาก่อนเสมอ
export function loadEnvFile(path = new URL('../.env', import.meta.url)) {
  if (!existsSync(path) || typeof process.loadEnvFile !== 'function') return false;
  process.loadEnvFile(path);
  return true;
}
