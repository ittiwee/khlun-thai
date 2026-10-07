// อ่านความถี่ FM (MHz) จากชื่อสถานี — ห้ามแตะ DOM
import { FM_MIN, FM_MAX } from './config.js';

// ตัวเลข 2–3 หลัก มีทศนิยม (จุดหรือจุลภาค) ได้ ไม่ติดตัวเลข/จุดด้านหน้า
const NUM = /(?<![\d.,])(\d{2,3})(?:[.,](\d{1,2}))?(?![\d]|[.,]\d)/g;

function toFreq(intPart, frac) {
  const f = Number(frac ? `${intPart}.${frac}` : intPart);
  if (!(f >= FM_MIN && f <= FM_MAX)) return null;
  // คลื่น FM ไปทีละ 0.05 MHz (เช่น 90.25, 104.75)
  if (Math.round(f * 100) % 5 !== 0) return null;
  return f;
}

export function parseFreq(name) {
  if (!name) return null;
  // เลขไทย ๐–๙ → 0–9 (เช่น "ลูกทุ่ง รักไทย ๙๐")
  const text = String(name).replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
  let decimal = null;
  let leading = null;
  for (const m of text.matchAll(NUM)) {
    const f = toFreq(m[1], m[2]);
    if (f == null) continue;
    const before = text.slice(Math.max(0, m.index - 5), m.index).toLowerCase();
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 5).toLowerCase();
    // "90s", "100%", "80's", "AM 99", "99 kHz" ไม่ใช่คลื่น FM
    if (/^(?:s|%|'s|’s)|^\s*k\s*hz/.test(after) || /(?:^|[^a-z])am\s*$/.test(before)) continue;
    // ติดกับ FM หรือ MHz → มั่นใจที่สุด
    if (/fm[\s.:-]*$/.test(before) || /^\s*(?:mhz|fm)/.test(after)) return f;
    if (m[2] && decimal == null) decimal = f;
    if (!m[2] && m.index === 0 && leading == null) leading = f;
  }
  return decimal ?? leading;
}

export function formatFreq(f) {
  if (f == null) return null;
  return Number.isInteger(f) ? f.toFixed(1) : String(f);
}
