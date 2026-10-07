// ค่าคงที่ของแอป
export const PAGE_SIZE = 30;

// proxy สำหรับสตรีม http บนหน้า https ('' = ไม่มี proxy) — ใช้ตั้งแต่ขั้น 3/5
export const PROXY_BASE = '/stream/';

// cache รายชื่อประเทศใน localStorage (มิลลิวินาที)
export const COUNTRY_CACHE_MS = 24 * 60 * 60 * 1000;

// ช่วงหน้าปัด FM
export const FM_MIN = 87.5;
export const FM_MAX = 108;

export const DEFAULT_VOLUME = 0.8;

// ประเทศเริ่มต้น (ขั้น 4 จะเดาจากภาษา/timezone ของเครื่อง)
export const DEFAULT_COUNTRY = 'TH';
