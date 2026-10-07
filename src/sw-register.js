// ลงทะเบียน service worker (เฉพาะ production build — dev server ของ Vite ไม่ใช้)
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      if (wasControlled) return; // SW คุมหน้าอยู่แล้ว ไฟล์ทุกตัวผ่าน fetch handler อยู่แล้ว
      await navigator.serviceWorker.ready;
      // เปิดครั้งแรก: ไฟล์ที่โหลดก่อน SW เริ่มคุมหน้า (เช่นธงที่แสดงอยู่) ส่งให้ SW เก็บไว้ด้วย
      const post = (entries) =>
        (navigator.serviceWorker.controller || reg.active)?.postMessage({
          type: 'precache',
          urls: entries.map((e) => e.name),
        });
      post(performance.getEntriesByType('resource'));
      new PerformanceObserver((list) => post(list.getEntries())).observe({ type: 'resource' });
    } catch {
      // ไม่มี SW ก็ใช้งานออนไลน์ได้ตามปกติ
    }
  });
}
