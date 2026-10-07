// ค่าคงที่ของแอป
export const PAGE_SIZE = 30;

// proxy สำหรับสตรีม http บนหน้า https (docs/PROXY.md) — ตั้งตอน build ด้วย VITE_PROXY_BASE
// '' = ไม่มี proxy (เช่น GitHub Pages): การ์ดสถานี http จะจางบนหน้า https
const env = import.meta.env ?? {};
export const PROXY_BASE = env.VITE_PROXY_BASE ?? '/stream/';

// ส่งสตรีม http ผ่าน proxy แม้หน้าเว็บเป็น http — ใช้ทดสอบ proxy ตอน npm run dev เท่านั้น (VITE_PROXY_ALWAYS=1)
export const PROXY_ALWAYS = env.VITE_PROXY_ALWAYS === '1';

// cache รายชื่อประเทศใน localStorage (มิลลิวินาที)
export const COUNTRY_CACHE_MS = 24 * 60 * 60 * 1000;

// ช่วงหน้าปัด FM
export const FM_MIN = 87.5;
export const FM_MAX = 108;

export const DEFAULT_VOLUME = 0.8;

// ประเทศเริ่มต้น (ขั้น 4 จะเดาจากภาษา/timezone ของเครื่อง)
export const DEFAULT_COUNTRY = 'TH';
