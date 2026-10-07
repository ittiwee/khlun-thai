// Service worker: เก็บไฟล์หน้าเว็บไว้ให้รีเฟรชได้ตอนออฟไลน์
// - หน้า HTML: network-first (ได้เวอร์ชันใหม่เสมอเมื่อออนไลน์) ถ้าเน็ตหลุดใช้ของใน cache
// - assets/* (ชื่อมี hash) และฟอนต์ Google: cache-first
// - API, สตรีม และ /stream/ ไม่ยุ่ง ปล่อยผ่านเครือข่ายตรง
const CACHE = 'kt-shell-v1';
const SCOPE = new URL(self.registration.scope);
const INDEX = new URL('./', SCOPE).href;
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
// ไฟล์มี hash ในชื่ออยู่แล้ว จึงไม่ต้องสน Vary (เซิร์ฟเวอร์ส่ง Vary: Origin ทำให้ <script crossorigin> หาใน cache ไม่เจอ)
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(INDEX))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kt-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isAsset(url) {
  return url.origin === SCOPE.origin && url.pathname.startsWith(`${SCOPE.pathname}assets/`);
}

function isFont(url) {
  return FONT_HOSTS.has(url.hostname);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(INDEX, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(INDEX, MATCH);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === SCOPE.origin) {
    event.respondWith(networkFirstPage(request));
  } else if (isAsset(url) || isFont(url)) {
    event.respondWith(cacheFirst(request));
  }
});

// หน้าเว็บส่งรายชื่อไฟล์ที่โหลดไปก่อน SW จะเริ่มคุม (ครั้งแรกที่เปิด) มาให้เก็บเพิ่ม
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.map((u) => new URL(u)).filter((u) => isAsset(u) || isFont(u));
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        urls.map(async (u) => {
          if (await cache.match(u.href, MATCH)) return;
          try {
            const res = await fetch(u.href, { mode: isFont(u) ? 'cors' : 'same-origin' });
            if (res.ok) await cache.put(u.href, res);
          } catch {
            // ข้ามไฟล์ที่โหลดไม่ได้
          }
        }),
      ),
    ),
  );
});
