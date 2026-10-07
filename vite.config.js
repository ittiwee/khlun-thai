import { defineConfig } from 'vite';

// URL เต็มของเว็บที่ deploy แล้ว เช่น SITE_URL=https://example.com/ หรือ https://user.github.io/khlun-thai/
// ใช้ทำ canonical, og:url และ og:image แบบ absolute (Facebook/LINE/X ต้องการ URL เต็มของรูป)
// ถ้าไม่ตั้ง จะใส่ og:image แบบ path อย่างเดียว ซึ่งบางแอปจะไม่แสดงรูป
function siteMeta(siteUrl) {
  let base = '/';
  return {
    name: 'khlun-thai-site-meta',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml() {
      const meta = (attr, key, content) => ({ tag: 'meta', attrs: { [attr]: key, content }, injectTo: 'head' });
      // og:image:* ต้องตามหลัง og:image ตามสเปก Open Graph
      const imageTags = (image) => [
        meta('property', 'og:image', image),
        meta('property', 'og:image:width', '1200'),
        meta('property', 'og:image:height', '630'),
        meta('property', 'og:image:alt', 'โลโก้คลื่นไทยและหน้าปัดวิทยุ FM 88–108 MHz'),
      ];
      if (!siteUrl) return imageTags(`${base}og-image.png`);
      const root = new URL(siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
      const image = new URL('og-image.png', root).href;
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: root.href }, injectTo: 'head' },
        meta('property', 'og:url', root.href),
        ...imageTags(image),
        meta('name', 'twitter:image', image),
      ];
    },
  };
}

export default defineConfig({
  plugins: [siteMeta(process.env.SITE_URL)],
});
