// error ที่ส่งกลับ client เป็น JSON { error, message } ภาษาไทย
export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ข้อความตามรหัสที่ proxy ตอบ (ตรงกับ docs/PROXY.md ข้อ 4)
export const MESSAGES = {
  400: ['bad_uuid', 'รหัสสถานีไม่ถูกต้อง'],
  403: ['forbidden_target', 'ปลายทางของสถานีไม่ได้รับอนุญาต'],
  404: ['not_found', 'ไม่พบสถานีใน Radio Browser'],
  415: ['hls_unsupported', 'ยังไม่รองรับ HLS ผ่าน proxy'],
  429: ['too_many', 'เปิดสตรีมพร้อมกันหรือถี่เกินไป ลองใหม่อีกครั้ง'],
  502: ['bad_upstream', 'สถานีออฟไลน์หรือตอบผิดปกติ'],
  503: ['server_full', 'เซิร์ฟเวอร์เต็มชั่วคราว ลองใหม่อีกครั้ง'],
  504: ['upstream_timeout', 'สถานีตอบช้าเกินไป'],
};

export const httpError = (status) => new HttpError(status, ...(MESSAGES[status] ?? ['error', 'เกิดข้อผิดพลาด']));
