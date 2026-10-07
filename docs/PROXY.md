# PROXY — Stream proxy ของคลื่นไทย

แผนย่อยของขั้น 5 ใน `docs/PLAN.md`
ทำทีละขั้นตามลำดับ และหยุดให้ผู้ดูแลตรวจหลังจบแต่ละขั้น

---

## 1. ปัญหาที่ต้องแก้

- หน้าเว็บเปิดผ่าน https แต่สตรีมวิทยุจำนวนมากเป็น `http://` เบราว์เซอร์จึงบล็อก (mixed content)
- proxy นี้รับแค่ `stationuuid` แล้วไปหา URL จริงจาก Radio Browser เอง จากนั้นส่งเสียงกลับให้ผู้ใช้ผ่าน https ของเรา
- **ห้ามรับ URL ปลายทางจากผู้ใช้โดยเด็ดขาด** ไม่อย่างนั้นจะกลายเป็น open proxy ที่ใครก็เอาไปใช้ยิงเว็บอื่นได้

```
เบราว์เซอร์ ──https──▶ Nginx ──▶ proxy (Node) ──lookup──▶ Radio Browser API
                                      │
                                      └──http──▶ เซิร์ฟเวอร์สตรีมของสถานี
```

## 2. Stack

| เรื่อง | กำหนด |
|---|---|
| Runtime | Node.js 20 LTS ขึ้นไป |
| Framework | Fastify |
| HTTP client | โมดูลในตัวของ Node (`http`, `https`, `net`, `tls`, `dns`) ใช้ `undici` เท่าที่จำเป็น |
| Log | pino (มากับ Fastify) แบบ JSON |
| Rate limit | `@fastify/rate-limit` |
| Cache | `lru-cache` |
| Test | `node:test` (ไม่ต้องติดตั้งเพิ่ม) |
| รูปแบบโค้ด | ESM (`"type": "module"`) |

### โครงสร้างไฟล์

```
server/
├── package.json
├── .env.example
├── Dockerfile
├── src/
│   ├── index.js            # สร้าง Fastify, ลงทะเบียน route, graceful shutdown
│   ├── config.js           # อ่านค่าจาก env พร้อมค่าเริ่มต้นและตรวจความถูกต้อง
│   ├── radiobrowser.js     # เลือก mirror + lookup uuid → url (มี cache)
│   ├── guard.js            # กัน SSRF: ตรวจ URL, port, IP ปลายทาง
│   ├── playlist.js         # แตกไฟล์ .pls / .m3u เอา URL สตรีมจริง
│   ├── upstream.js         # เชื่อมต่อสตรีม รวม fallback สำหรับ ICY
│   ├── limits.js           # นับสตรีมพร้อมกัน ทั้งระบบและต่อ IP
│   └── routes/
│       ├── stream.js       # GET /stream/:uuid
│       └── health.js       # GET /healthz
└── test/
    ├── guard.test.js
    ├── playlist.test.js
    ├── uuid.test.js
    └── upstream.test.js    # integration test ด้วย upstream ปลอม

deploy/
├── docker-compose.yml
└── nginx.conf
```

## 3. ค่า config (env)

ทุกค่าต้องมีใน `.env.example` พร้อมคำอธิบายสั้นๆ

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `PORT` | `3000` | port ที่ proxy ฟัง |
| `ALLOWED_ORIGIN` | `http://localhost:5173` | ค่า `Access-Control-Allow-Origin` (ใส่โดเมนจริงตอน deploy) |
| `TRUSTED_PROXY` | `127.0.0.1` | IP ของ Nginx ที่อนุญาตให้เชื่อ `X-Forwarded-For` |
| `MAX_STREAMS` | `200` | สตรีมพร้อมกันสูงสุดทั้งระบบ |
| `MAX_STREAMS_PER_IP` | `3` | สตรีมพร้อมกันสูงสุดต่อ IP |
| `RATE_LIMIT_PER_MIN` | `30` | จำนวนครั้งที่เปิด `/stream` ได้ต่อ IP ต่อนาที |
| `LOOKUP_TTL_SEC` | `600` | อายุ cache ผล lookup uuid |
| `CONNECT_TIMEOUT_MS` | `8000` | timeout ตอนเชื่อมต่อ upstream |
| `HEADER_TIMEOUT_MS` | `10000` | timeout รอ header จาก upstream |
| `IDLE_TIMEOUT_MS` | `30000` | ตัดสตรีมถ้าไม่มีข้อมูลเข้ามานานเกินนี้ |
| `RB_USER_AGENT` | `khlun-thai-proxy/1.0` | User-Agent ที่ใช้คุยกับ Radio Browser |

## 4. Endpoint

### `GET /stream/:uuid`
- `uuid` ต้องตรงรูปแบบ UUID (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) ถ้าไม่ตรงตอบ `400`
- ไม่มี query parameter ใดๆ ที่รับ URL
- ถ้าเปิดสตรีมสำเร็จ: ส่งเสียงกลับแบบ streaming
- รหัสตอบกลับเมื่อผิดพลาด (body เป็น JSON `{ error, message }` ภาษาไทย)

| รหัส | เมื่อไหร่ |
|---|---|
| `400` | uuid ผิดรูปแบบ |
| `403` | URL ปลายทางไม่ผ่าน guard (IP ภายใน, port ต้องห้าม, scheme ไม่ใช่ http/https) |
| `404` | ไม่พบสถานีใน Radio Browser |
| `415` | สตรีมเป็น HLS (.m3u8) ซึ่งยังไม่รองรับในเฟสนี้ |
| `429` | เกิน rate limit หรือเกิน `MAX_STREAMS_PER_IP` |
| `502` | upstream ตอบผิดปกติ, redirect เกินกำหนด หรือ playlist ไม่มี URL ที่ใช้ได้ |
| `503` | เกิน `MAX_STREAMS` |
| `504` | upstream timeout |

### `GET /healthz`
- ตอบ `{ ok: true, uptime, activeStreams, mirror }` และ `Cache-Control: no-store`

## 5. ขั้นตอนภายใน `/stream/:uuid`

### 5.1 Lookup (radiobrowser.js)
1. รายชื่อ mirror: ดึงจาก `https://all.api.radio-browser.info/json/servers` ตอนเริ่มทำงาน แล้วรีเฟรชทุก 1 ชั่วโมง ถ้าดึงไม่ได้ใช้ `de1`, `nl1`, `at1` `.api.radio-browser.info`
2. เรียก `GET https://{mirror}/json/stations/byuuid/{uuid}` ด้วย `RB_USER_AGENT`, timeout 5 วินาที
3. ถ้า mirror ล้มเหลวให้สลับไป mirror ถัดไป (ลองไม่เกิน 3 ตัว)
4. ใช้ `url_resolved` ถ้าว่างใช้ `url` เก็บ `codec` และ `hls` ไว้ด้วย
5. cache ผลแบบ LRU สูงสุด 5000 รายการ อายุ `LOOKUP_TTL_SEC` (cache ผล "ไม่พบ" ด้วย แต่อายุแค่ 60 วินาที)

### 5.2 ตรวจ URL (guard.js)
- scheme ต้องเป็น `http:` หรือ `https:` เท่านั้น
- port ต้องเป็น `80`, `443` หรืออยู่ในช่วง `1024–65535`
- ห้ามมี username/password ใน URL
- resolve DNS ของ host (ทั้ง A และ AAAA) แล้ว **ปฏิเสธถ้า IP ใดๆ** อยู่ในช่วงเหล่านี้:
  - IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`
  - IPv6: `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`
  - IPv4-mapped IPv6 (`::ffff:a.b.c.d`) ให้แปลงเป็น IPv4 แล้วตรวจตามกฎ IPv4
- host ที่เป็น IP ตรงๆ ก็ต้องผ่านกฎเดียวกัน
- **กัน DNS rebinding:** เชื่อมต่อไปยัง IP ที่ตรวจแล้วโดยตรง (ผ่าน option `lookup` หรือ `host` + `servername`) โดยส่ง `Host` header และ TLS SNI เป็นชื่อ host เดิม
- ฟังก์ชันใน guard.js ต้องเป็น pure function เท่าที่ทำได้ เพื่อให้ test ได้โดยไม่ต้องพึ่ง DNS จริง (รับ resolver เป็น parameter)

### 5.3 Redirect
- ตาม redirect (301, 302, 303, 307, 308) เองแบบ manual ไม่เกิน 5 ครั้ง
- **ทุก URL ใหม่ต้องผ่าน guard ซ้ำทั้งหมด** ก่อนเชื่อมต่อ
- เกิน 5 ครั้งตอบ `502`

### 5.4 Playlist (playlist.js)
- ถ้า content-type เป็น `audio/x-scpls`, `audio/x-mpegurl`, `audio/mpegurl` หรือ path ลงท้าย `.pls` / `.m3u`
  - อ่าน body ไม่เกิน 64KB
  - `.pls`: หา `File1=`, `File2=` … เอา URL แรกที่เป็น http(s)
  - `.m3u`: บรรทัดแรกที่ไม่ขึ้นต้นด้วย `#` และเป็น http(s)
  - URL ที่ได้ต้องกลับไปผ่าน guard (5.2) และนับรวมในจำนวน redirect (5.3)
- ถ้าเป็น HLS (`.m3u8`, `application/vnd.apple.mpegurl`, หรือสถานีมี `hls: 1`) ตอบ `415` พร้อมข้อความ "ยังไม่รองรับ HLS ผ่าน proxy"

### 5.5 เชื่อมต่อ upstream (upstream.js)
- request header ที่ส่ง:
  - `Icy-MetaData: 0` (ไม่อย่างนั้นข้อมูล metadata จะปนมากับเสียงจนเสียงกระตุก)
  - `User-Agent` แบบเบราว์เซอร์ทั่วไป (บางเซิร์ฟเวอร์ปฏิเสธ UA แปลกๆ)
  - `Accept: */*`
- timeout ตาม `CONNECT_TIMEOUT_MS`, `HEADER_TIMEOUT_MS`, `IDLE_TIMEOUT_MS`
- **SHOUTcast v1 ตอบ `ICY 200 OK`** ซึ่ง HTTP parser ของ Node ไม่รับ
  - เมื่อเจอ parse error แบบนี้ ให้ fallback ไปเชื่อมต่อด้วย `net`/`tls` socket เอง
  - เขียน request line + header เอง, อ่าน response header จนถึง `\r\n\r\n` (จำกัด 16KB)
  - แปลงบรรทัดแรก `ICY` เป็น `HTTP/1.0` แล้ว parse header เอง
  - ส่วนที่เหลือหลัง header คือเสียง ให้ pipe ต่อได้เลย
- ตรวจ status ปลายทาง: `2xx` ไปต่อ, `3xx` ไปขั้น 5.3, อื่นๆ ตอบ `502`

### 5.6 ส่งกลับให้ client
- header ที่ส่ง:
  - `Content-Type`: ตามที่ upstream ส่งมา ถ้าไม่มีให้เดาจาก codec (`MP3` → `audio/mpeg`, `AAC`/`AAC+` → `audio/aac`, `OGG` → `audio/ogg`)
  - `Cache-Control: no-store`
  - `X-Accel-Buffering: no`
  - `Access-Control-Allow-Origin: {ALLOWED_ORIGIN}`
  - `X-Content-Type-Options: nosniff`
- **ห้ามส่งต่อ** header `icy-*`, `set-cookie`, `server`, `x-powered-by` และ hop-by-hop headers
- pipe แบบ streaming จริงด้วย `stream.pipeline` ห้ามบัฟเฟอร์ทั้งไฟล์
- **ทำความสะอาดทุกกรณี:** เมื่อ client ปิด (`req.raw.on('close')`), upstream จบ, error หรือ idle timeout ต้อง destroy ทั้งสองฝั่ง และลดตัวนับใน limits.js ทุกครั้ง ห้ามมี socket ค้าง
- จำกัดอายุสตรีมสูงสุด 6 ชั่วโมงต่อการเชื่อมต่อ (กันค้างตลอดไป)

## 6. ขีดจำกัดและการป้องกัน (limits.js)

- นับสตรีมที่เปิดอยู่ทั้งระบบ เกิน `MAX_STREAMS` ตอบ `503`
- นับต่อ IP เกิน `MAX_STREAMS_PER_IP` ตอบ `429`
- IP ของผู้ใช้: อ่านจาก `X-Forwarded-For` **เฉพาะเมื่อ** request มาจาก `TRUSTED_PROXY` (ตั้ง `trustProxy` ของ Fastify ให้ตรง) ไม่อย่างนั้นใช้ IP ของ socket
- rate limit การเปิด `/stream` ต่อ IP ไม่เกิน `RATE_LIMIT_PER_MIN` ครั้งต่อนาที
- graceful shutdown: รับ `SIGTERM` แล้วหยุดรับ request ใหม่ ปิดสตรีมที่ค้างภายใน 10 วินาที

## 7. Log

- JSON ผ่าน pino หนึ่งบรรทัดต่อการปิดสตรีม: `uuid`, `host` ปลายทาง, `status`, `durationMs`, `bytes`, `reason` (`client_closed` / `upstream_end` / `idle_timeout` / `error` / `max_duration`)
- **ห้ามบันทึก IP ผู้ใช้แบบเต็ม** IPv4 ตัด octet สุดท้ายเป็น `0`, IPv6 เก็บแค่ /48
- ห้ามบันทึก URL เต็มที่มี query string (เก็บแค่ host)

## 8. Deploy

### server/Dockerfile
- multi-stage บน `node:20-alpine`
- ติดตั้งเฉพาะ production dependencies (`npm ci --omit=dev`)
- รันด้วยผู้ใช้ `node` (ไม่ใช่ root)
- `HEALTHCHECK` เรียก `http://127.0.0.1:3000/healthz`

### deploy/docker-compose.yml
- service `web`: `nginx:alpine` เสิร์ฟไฟล์ใน `dist/` (ผลจาก `npm run build`) และใช้ `deploy/nginx.conf`
- service `proxy`: build จาก `server/`, อ่าน env จาก `server/.env`, ไม่เปิด port ออกนอก (คุยกับ web ผ่าน network ภายในเท่านั้น)
- `restart: unless-stopped` ทั้งสอง service
- web เปิด port `8080` ไว้ให้ reverse proxy หน้าบ้าน (หรือ Cloudflare Tunnel) เชื่อมต่อ

### deploy/nginx.conf
```nginx
location /stream/ {
    proxy_pass http://proxy:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location /healthz {
    proxy_pass http://proxy:3000;
    allow 127.0.0.1;
    deny all;
}

location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
}
```

## 9. ฝั่งหน้าเว็บ (src/player.js)

- ใช้ `PROXY_BASE` จาก `src/config.js` (ค่าเริ่มต้น `/stream/`)
- ถ้า `location.protocol === 'https:'` และสตรีมเป็น `http:` → เล่นจาก `PROXY_BASE + stationuuid`
- ถ้า `PROXY_BASE` เป็นค่าว่าง → ไม่ใช้ proxy และแสดงการ์ดสถานี http แบบจาง (ตามที่ระบุใน PLAN.md)
- ข้อความ error ตามรหัสจาก proxy:
  - `429` / `503`: "เซิร์ฟเวอร์เต็มชั่วคราว ลองใหม่อีกครั้ง"
  - `415`: "สถานีนี้ยังเล่นผ่าน proxy ไม่ได้"
  - `403` / `404` / `502` / `504`: "สถานีออฟไลน์ ลองสถานีอื่น"
- `<audio>` ไม่ส่ง status code ให้ JavaScript อ่านได้ตรงๆ ให้เรียก `HEAD` หรือ `GET` แบบ abort ทันทีไปที่ URL proxy เมื่อเกิด error เพื่ออ่านรหัสมาแสดงข้อความ (proxy ต้องรองรับ `HEAD /stream/:uuid` โดยทำ lookup + guard แต่ไม่ต่อ upstream)

## 10. Test

| ไฟล์ | สิ่งที่ต้องครอบคลุม |
|---|---|
| `guard.test.js` | IP ทุกช่วงในข้อ 5.2 ทั้งที่ต้องปฏิเสธและที่ต้องผ่าน (เช่น `8.8.8.8`, `2001:4860::8888`), IPv4-mapped IPv6, host ที่ resolve ได้หลาย IP โดยมีตัวเดียวเป็น private (ต้องปฏิเสธ), port ต้องห้าม, scheme อื่น, URL ที่มี user:pass |
| `playlist.test.js` | ไฟล์ .pls ปกติ, .pls ที่มีหลาย File, .m3u ที่มีคอมเมนต์ `#EXTINF`, ไฟล์ที่ไม่มี URL, ไฟล์ใหญ่เกิน 64KB |
| `uuid.test.js` | uuid ถูก/ผิดรูปแบบ, ตัวพิมพ์ใหญ่, มีอักขระแปลกหรือ path traversal |
| `upstream.test.js` | สร้าง upstream ปลอม 2 ตัวใน test (ฟังที่ `127.0.0.1` โดยปิด guard เฉพาะใน test ผ่าน dependency injection): ตัวหนึ่งตอบ HTTP ปกติ อีกตัวตอบ `ICY 200 OK` → ต้อง pipe ได้ทั้งคู่, client ปิดแล้ว upstream ถูกปิดตาม, idle timeout ทำงาน, ตัวนับใน limits.js กลับเป็น 0 |

`npm test` ใน `server/` ต้องผ่านทั้งหมด และต้องไม่เรียกเครือข่ายภายนอกจริง

## 11. ขั้นตอนการทำงาน

### ขั้น P1 — โครงและ config
- `package.json`, `config.js`, `index.js`, `/healthz`, `.env.example`
- **ผ่านเมื่อ:** `npm start` แล้ว `curl localhost:3000/healthz` ได้ `{ ok: true }`

### ขั้น P2 — Lookup + guard
- `radiobrowser.js`, `guard.js`, `uuid` validation และ test ที่เกี่ยวข้อง
- **ผ่านเมื่อ:** `npm test` ผ่าน guard/uuid test ครบ **(ห้ามไปขั้นถัดไปถ้า guard test ยังไม่ผ่าน)**

### ขั้น P3 — Upstream + playlist + ICY
- `playlist.js`, `upstream.js` และ test ที่เกี่ยวข้อง
- **ผ่านเมื่อ:** `npm test` ผ่านทั้งหมด รวม integration test ที่มี upstream ปลอมแบบ ICY

### ขั้น P4 — Route + ขีดจำกัด + log
- `routes/stream.js` (GET + HEAD), `limits.js`, rate limit, log, graceful shutdown
- **ผ่านเมื่อ:** เปิดสตรีม http จริงผ่าน `curl -s localhost:3000/stream/<uuid> --max-time 5 -o test.mp3` แล้วไฟล์มีเสียง, uuid มั่วได้ `400`/`404`, เปิดพร้อมกันเกิน 3 ครั้งจาก IP เดียวได้ `429`

### ขั้น P5 — Docker + Nginx
- `Dockerfile`, `deploy/docker-compose.yml`, `deploy/nginx.conf`
- **ผ่านเมื่อ:** `docker compose -f deploy/docker-compose.yml up --build` แล้วเปิด `http://localhost:8080` เห็นหน้าเว็บ และเล่นสถานี http ผ่าน `/stream/` ได้

### ขั้น P6 — เชื่อมกับหน้าเว็บ + เอกสาร
- แก้ `src/player.js` และ `src/config.js` ตามข้อ 9
- เพิ่มหัวข้อ "Stream proxy" ใน README:
  - ตาราง env ทุกตัว
  - วิธีรันด้วย docker compose
  - การประเมิน bandwidth: สตรีม 128kbps ใช้ราว 58MB ต่อผู้ฟัง 1 คนต่อชั่วโมง (ผู้ฟังพร้อมกัน 50 คน ≈ 6.4Mbps ต่อเนื่อง)
  - ถ้าใช้ Cloudflare: ให้ subdomain ที่เสิร์ฟ `/stream` เป็นแบบ DNS-only (เมฆสีเทา) เพราะเงื่อนไขแผนฟรีจำกัดการส่งสื่อปริมาณมากผ่าน proxy ของ Cloudflare
  - หมายเหตุ: proxy ส่งต่อสตรีมให้ผู้ใช้ที่กดฟังแต่ละคน ไม่ได้อัดหรือออกอากาศซ้ำ ลิขสิทธิ์เนื้อหาเป็นของแต่ละสถานี
- **ผ่านเมื่อ:** รัน `npm run dev` (หน้าเว็บ) คู่กับ proxy แล้วสถานี http เล่นได้, ข้อความ error ตรงกับรหัสที่ proxy ตอบ

## 12. งานเฟส 2 (ยังไม่ต้องทำ)

- รองรับ HLS ผ่าน proxy: rewrite URL ใน playlist ให้ชี้กลับมาที่ proxy พร้อม token ลงลายเซ็น HMAC อายุสั้น ผูกกับ uuid
- metrics แบบ Prometheus (`/metrics`)
- cache รายชื่อสถานีที่ proxy เจอ error บ่อย เพื่อแจ้งหน้าเว็บให้หรี่การ์ดล่วงหน้า

## 13. ข้อห้าม

- ห้ามเพิ่ม endpoint หรือ parameter ที่รับ URL จากผู้ใช้
- ห้ามปิดหรือข้าม guard ในโค้ด production (ปิดได้เฉพาะใน test ผ่าน dependency injection)
- ห้าม commit `server/.env` หรือความลับใดๆ
- ห้ามเปิด port ของ service `proxy` ออกนอก docker network
- ห้าม push จนกว่าผู้ดูแลจะสั่ง

## 14. รูปแบบ commit

- `feat(proxy): scaffold fastify server with healthz`
- `feat(proxy): add radio browser lookup and ssrf guard`
- `test(proxy): cover guard and uuid validation`
- `feat(proxy): stream upstream with icy fallback and playlist support`
- `feat(proxy): add stream route with concurrency and rate limits`
- `build(deploy): add dockerfile, compose and nginx config`
- `feat(player): route http streams through proxy`
- `docs: document stream proxy`
