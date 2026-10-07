# คลื่นไทย

เว็บฟังวิทยุออนไลน์จากทุกประเทศ ข้อมูลสถานีจาก [Radio Browser](https://www.radio-browser.info/)

> เอกสารส่วนภาพรวม การรัน dev/build/test และการ deploy หน้าเว็บ จะเขียนเพิ่มในขั้น 6 ของ [docs/PLAN.md](docs/PLAN.md)

## Stream proxy

สตรีมวิทยุจำนวนมากเป็น `http://` เมื่อหน้าเว็บเปิดผ่าน `https://` เบราว์เซอร์จะบล็อก (mixed content)
proxy ใน [`server/`](server/) รับแค่ `stationuuid` แล้วไปหา URL จริงจาก Radio Browser เอง จากนั้นส่งเสียงกลับผ่าน https ของเรา
รายละเอียดการออกแบบอยู่ที่ [docs/PROXY.md](docs/PROXY.md)

```
เบราว์เซอร์ ──https──▶ Nginx ──▶ proxy (Node) ──lookup──▶ Radio Browser API
                                      │
                                      └──http──▶ เซิร์ฟเวอร์สตรีมของสถานี
```

- `GET /stream/:uuid` ส่งเสียง, `HEAD /stream/:uuid` ตรวจว่าเล่นได้ไหม (ไม่ต่อสถานี), `GET /healthz` สถานะ
- **ไม่มี endpoint หรือ parameter ใดรับ URL จากผู้ใช้** — ปลายทางทุกตัว (รวม redirect และ URL ใน playlist) ต้องผ่านการตรวจ: เฉพาะ http/https, port 80/443/1024–65535, ห้าม IP ภายในทุกช่วง และเชื่อมต่อไปยัง IP ที่ตรวจแล้วเท่านั้น (กัน DNS rebinding)
- รองรับ SHOUTcast ที่ตอบ `ICY 200 OK`, playlist `.pls`/`.m3u` และ redirect ไม่เกิน 5 ครั้ง ยังไม่รองรับ HLS (ตอบ `415`)

### ค่า config (env ของ proxy)

คัดลอก [`server/.env.example`](server/.env.example) เป็น `server/.env` แล้วแก้ (ห้าม commit `server/.env`) ทุกค่ามีค่าเริ่มต้น

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `PORT` | `3000` | port ที่ proxy ฟัง |
| `ALLOWED_ORIGIN` | `http://localhost:5173` | ค่า `Access-Control-Allow-Origin` — ใส่ origin ของหน้าเว็บจริงตอน deploy เช่น `https://radio.example.com` |
| `TRUSTED_PROXY` | `127.0.0.1` | IP/CIDR ของ Nginx ที่อนุญาตให้เชื่อ `X-Forwarded-For` (คั่นด้วยจุลภาคได้) — ใน docker compose ตั้งให้อัตโนมัติ |
| `MAX_STREAMS` | `200` | สตรีมพร้อมกันสูงสุดทั้งระบบ (เกิน → `503`) |
| `MAX_STREAMS_PER_IP` | `3` | สตรีมพร้อมกันสูงสุดต่อ IP (เกิน → `429`) |
| `RATE_LIMIT_PER_MIN` | `30` | จำนวนครั้งที่เปิด `/stream` ได้ต่อ IP ต่อนาที (เกิน → `429`) |
| `LOOKUP_TTL_SEC` | `600` | อายุ cache ผล lookup uuid → URL (วินาที) |
| `CONNECT_TIMEOUT_MS` | `8000` | timeout ตอนเชื่อมต่อสถานี |
| `HEADER_TIMEOUT_MS` | `10000` | timeout รอ header จากสถานี |
| `IDLE_TIMEOUT_MS` | `30000` | ตัดสตรีมถ้าไม่มีข้อมูลเข้ามานานเกินนี้ |
| `RB_USER_AGENT` | `khlun-thai-proxy/1.0` | User-Agent ที่ใช้คุยกับ Radio Browser |

ค่าผิดรูปแบบ proxy จะไม่ยอมเริ่มทำงานและบอกทุกตัวที่ผิด

ค่าฝั่งหน้าเว็บ (ตั้งตอน `npm run build` / `npm run dev`):

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `VITE_PROXY_BASE` | `/stream/` | path หรือ URL ของ proxy, ตั้งเป็นค่าว่างถ้าไม่มี proxy (เช่น GitHub Pages) — การ์ดสถานี http จะแสดงแบบจางบนหน้า https |
| `VITE_PROXY_ALWAYS` | ไม่ตั้ง | `1` = ส่งสตรีม http ผ่าน proxy แม้หน้าเว็บเป็น http (ใช้ทดสอบตอน dev) |
| `PROXY_TARGET` | `http://localhost:3000` | ปลายทางที่ `npm run dev` ส่ง `/stream` ต่อไปให้ |

### รันบนเครื่องตัวเอง

ต้องใช้ Node.js 20 ขึ้นไป

```bash
# terminal 1: proxy (ในโฟลเดอร์ server/)
cd server
npm install
npm test
npm start                      # ฟังที่ :3000 (ถ้า port ไม่ว่าง: PORT=3010 npm start)

# terminal 2: หน้าเว็บ — ที่โฟลเดอร์หลักของโปรเจกต์ ไม่ใช่ server/
# (npm run dev ใน server/ คือ proxy แบบ watch ไม่ใช่หน้าเว็บ)
VITE_PROXY_ALWAYS=1 npm run dev                                  # proxy ที่ :3000
VITE_PROXY_ALWAYS=1 PROXY_TARGET=http://localhost:3010 npm run dev  # proxy ที่ port อื่น
```

ลองตรงๆ ด้วย curl:

```bash
curl -s localhost:3000/healthz
curl -s localhost:3000/stream/<stationuuid> --max-time 5 -o test.mp3; file test.mp3
```

### รันด้วย docker compose

```bash
npm ci && npm run build                                  # สร้าง dist/ ของหน้าเว็บ
cp server/.env.example server/.env                       # แก้ ALLOWED_ORIGIN ฯลฯ (ไม่มีไฟล์นี้ก็ใช้ค่าเริ่มต้น)
docker compose -f deploy/docker-compose.yml up --build -d
```

- เปิด `http://localhost:8080` (port ไม่ว่าง: `WEB_PORT=8090 docker compose -f deploy/docker-compose.yml up --build -d`)
- service `web` (nginx) เสิร์ฟ `dist/` และส่ง `/stream/` ต่อให้ service `proxy` ซึ่งไม่เปิด port ออกนอก
- `/healthz` เข้าได้เฉพาะจากในเครื่อง: `docker compose -f deploy/docker-compose.yml exec proxy wget -qO- http://127.0.0.1:3000/healthz`
- ดู log: `docker compose -f deploy/docker-compose.yml logs -f proxy` (หนึ่งบรรทัดต่อสตรีม, IP ถูกตัดเป็น /24 หรือ /48, ไม่มี URL เต็ม)
- image ใช้ Node 24 LTS เป็นค่าเริ่มต้น (`--build-arg NODE_VERSION=22` เพื่อเปลี่ยน)

เมื่อวาง reverse proxy อีกชั้นไว้หน้า nginx (เช่น Cloudflare Tunnel, Caddy) nginx จะเห็น IP ของตัวกลางแทนผู้ใช้ และทุกคนจะใช้โควตา `MAX_STREAMS_PER_IP` ร่วมกัน ให้เปิดส่วน `real_ip` ใน [`deploy/nginx.conf`](deploy/nginx.conf) และใส่ IP ของตัวกลาง

### ข้อความ error บนหน้าเว็บ

`<audio>` อ่านรหัส HTTP ไม่ได้ เมื่อเล่นไม่สำเร็จหน้าเว็บจะเรียก `HEAD /stream/:uuid` เพื่ออ่านรหัสแล้วแสดง:

| รหัสจาก proxy | ข้อความ |
|---|---|
| `429`, `503` | เซิร์ฟเวอร์เต็มชั่วคราว ลองใหม่อีกครั้ง |
| `415` | สถานีนี้ยังเล่นผ่าน proxy ไม่ได้ |
| `403`, `404`, `502`, `504` | สถานีออฟไลน์ ลองสถานีอื่น |

### ประเมิน bandwidth

- สตรีม 128 kbps = 16 KB/วินาที ≈ **58 MB ต่อผู้ฟัง 1 คนต่อชั่วโมง**
- ผู้ฟังพร้อมกัน 50 คน ≈ **6.4 Mbps ต่อเนื่อง** (ขาออก) และขาเข้าจากสถานีเท่ากัน
- ถ้าฟังพร้อมกัน 50 คนตลอด 24 ชั่วโมง ≈ 2.1 TB ต่อเดือนต่อทิศทาง — ตรวจโควตา bandwidth ของ VPS ก่อน และปรับ `MAX_STREAMS` ให้เหมาะ
- proxy ส่งต่อเฉพาะสตรีม http เท่านั้น สตรีม https และ HLS หน้าเว็บเล่นตรงจากสถานี ไม่ผ่านเซิร์ฟเวอร์เรา

### ถ้าใช้ Cloudflare

ให้ subdomain ที่เสิร์ฟ `/stream` เป็นแบบ **DNS-only (เมฆสีเทา)** เพราะเงื่อนไขแผนฟรีของ Cloudflare จำกัดการส่งสื่อปริมาณมากผ่าน proxy ของ Cloudflare
ถ้าแยก proxy ไปไว้คนละ subdomain กับหน้าเว็บ ให้ build หน้าเว็บด้วย `VITE_PROXY_BASE=https://stream.example.com/stream/` และตั้ง `ALLOWED_ORIGIN` ของ proxy เป็น origin ของหน้าเว็บ

### หมายเหตุลิขสิทธิ์

proxy ส่งต่อสตรีมให้ผู้ใช้ที่กดฟังแต่ละคนเท่านั้น ไม่ได้อัด เก็บ หรือออกอากาศซ้ำ ลิขสิทธิ์เนื้อหาเป็นของแต่ละสถานี
