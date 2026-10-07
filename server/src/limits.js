// นับสตรีมที่เปิดอยู่ ทั้งระบบและต่อ IP
export function createLimits({ maxStreams, maxStreamsPerIp }) {
  let total = 0;
  const perIp = new Map();

  // ตรวจว่าจะรับสตรีมใหม่จาก ip นี้ได้ไหม (ไม่จอง) — คืน null ถ้าได้ หรือ 503 / 429
  function check(ip) {
    if (total >= maxStreams) return 503;
    if ((perIp.get(ip) ?? 0) >= maxStreamsPerIp) return 429;
    return null;
  }

  // จอง 1 ที่ — คืน { release } หรือ { error: 503 | 429 }
  // release เรียกซ้ำได้ ไม่ลดซ้ำ (ทุกทางออกของสตรีมเรียกได้โดยไม่ต้องกลัวนับผิด)
  function acquire(ip) {
    const error = check(ip);
    if (error) return { error };
    total++;
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        total--;
        const n = (perIp.get(ip) ?? 1) - 1;
        if (n > 0) perIp.set(ip, n);
        else perIp.delete(ip);
      },
    };
  }

  return {
    check,
    acquire,
    active: () => total,
    activeFor: (ip) => perIp.get(ip) ?? 0,
    trackedIps: () => perIp.size,
  };
}
