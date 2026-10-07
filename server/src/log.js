// ข้อมูลที่ยอมให้ลง log — ห้ามมี IP เต็มหรือ URL ที่มี query string
import { isIP } from 'node:net';
import { expandIPv6 } from './guard.js';

// IPv4 ตัด octet สุดท้ายเป็น 0, IPv6 เก็บแค่ /48, IPv4-mapped ถือเป็น IPv4
export function maskIp(ip) {
  const s = String(ip || '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  const v4 = mapped ? mapped[1] : s;
  if (isIP(v4) === 4) return v4.replace(/\.\d+$/, '.0');
  if (isIP(s) === 6) {
    const g = expandIPv6(s);
    if (!g) return 'invalid';
    return `${g.slice(0, 3).map((x) => x.toString(16)).join(':')}::/48`;
  }
  return 'unknown';
}

// เก็บแค่ host (ไม่มี path/query ซึ่งอาจมี token ของสถานี)
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
