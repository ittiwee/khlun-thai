// ตรวจรูปแบบ stationuuid — สิ่งเดียวที่ proxy รับจากผู้ใช้
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// คืน uuid ตัวพิมพ์เล็ก (ใช้เป็น key cache) หรือ null ถ้ารูปแบบผิด
export function normalizeUuid(value) {
  return isValidUuid(value) ? value.toLowerCase() : null;
}
