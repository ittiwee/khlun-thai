// เชื่อมต่อสตรีมปลายทาง: guard ทุก hop, redirect แบบ manual, playlist, fallback ICY และส่งต่อให้ client
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { pipeline, PassThrough } from 'node:stream';
import { guardUrl, pinnedLookup, systemResolve, GuardError } from './guard.js';
import { isHls, isPlaylist, looksLikeHls, parsePlaylist, readLimited } from './playlist.js';

export const MAX_REDIRECTS = 5;
const MAX_HEADER_BYTES = 16 * 1024;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class UpstreamError extends Error {
  // statusCode = รหัสที่ proxy จะตอบ client (415/502/504/403)
  constructor(statusCode, reason, message) {
    super(message);
    this.name = 'UpstreamError';
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

const requestHeaders = () => ({ 'Icy-MetaData': '0', 'User-Agent': BROWSER_UA, Accept: '*/*', Connection: 'close' });
const hostHeader = ({ hostname, port, protocol }) => {
  const h = hostname.includes(':') ? `[${hostname}]` : hostname;
  const defaultPort = protocol === 'https:' ? 443 : 80;
  return port === defaultPort ? h : `${h}:${port}`;
};
const isParseError = (err) => typeof err?.code === 'string' && err.code.startsWith('HPE_');

// ---------- ขอ 1 ครั้ง ด้วย http/https ของ Node ----------
function requestOnce(target, { connectTimeoutMs, headerTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const mod = target.protocol === 'https:' ? https : http;
    let settled = false;
    const timers = [];
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      fn(v);
    };
    const req = mod.request({
      protocol: target.protocol,
      host: target.hostname, // Host header + TLS SNI = ชื่อเดิม
      servername: target.protocol === 'https:' && !net.isIP(target.hostname) ? target.hostname : undefined,
      port: target.port,
      path: `${target.url.pathname}${target.url.search}`,
      method: 'GET',
      headers: { ...requestHeaders(), Host: hostHeader(target) },
      lookup: pinnedLookup(target.address, target.family), // เชื่อมต่อ IP ที่ guard ตรวจแล้วเท่านั้น
      agent: false,
    });
    timers.push(
      setTimeout(() => {
        req.destroy();
        done(reject, new UpstreamError(504, 'header_timeout', 'สถานีตอบช้าเกินไป'));
      }, headerTimeoutMs),
    );
    req.on('socket', (socket) => {
      if (!socket.connecting) return;
      const t = setTimeout(() => {
        req.destroy();
        done(reject, new UpstreamError(504, 'connect_timeout', 'เชื่อมต่อสถานีไม่ทันเวลา'));
      }, connectTimeoutMs);
      timers.push(t);
      socket.once('connect', () => clearTimeout(t));
    });
    req.on('response', (res) => {
      done(resolve, { statusCode: res.statusCode, headers: res.headers, body: res, raw: false });
    });
    req.on('error', (err) => done(reject, err));
    req.end();
  });
}

// ---------- fallback: SHOUTcast v1 ตอบ "ICY 200 OK" ซึ่ง parser ของ Node ไม่รับ ----------
// เซิร์ฟเวอร์สตรีมบางตัวขึ้นบรรทัดด้วย \n อย่างเดียว — รับทั้งสองแบบ
export function findHeadEnd(buf) {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf < 0 && lf < 0) return null;
  if (lf < 0 || (crlf >= 0 && crlf <= lf)) return { end: crlf, sep: 4 };
  return { end: lf, sep: 2 };
}

export function parseRawHead(head) {
  const lines = head.split(/\r?\n/);
  const m = /^(?:ICY|HTTP\/\d(?:\.\d)?)\s+(\d{3})(?:\s+.*)?$/i.exec(lines[0].trim());
  if (!m) return null;
  const headers = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
  }
  return { statusCode: Number(m[1]), headers };
}

function requestRaw(target, { connectTimeoutMs, headerTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const opts = { host: target.address, port: target.port };
    const socket =
      target.protocol === 'https:'
        ? tls.connect({ ...opts, servername: net.isIP(target.hostname) ? undefined : target.hostname })
        : net.connect(opts);
    let settled = false;
    let buf = Buffer.alloc(0);
    const timers = [];
    const fail = (err) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      socket.destroy();
      reject(err);
    };
    timers.push(setTimeout(() => fail(new UpstreamError(504, 'connect_timeout', 'เชื่อมต่อสถานีไม่ทันเวลา')), connectTimeoutMs));
    timers.push(setTimeout(() => fail(new UpstreamError(504, 'header_timeout', 'สถานีตอบช้าเกินไป')), headerTimeoutMs));

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const found = findHeadEnd(buf);
      if (!found) {
        if (buf.length > MAX_HEADER_BYTES) fail(new UpstreamError(502, 'bad_header', 'header ของสถานียาวผิดปกติ'));
        return;
      }
      const { end, sep } = found;
      if (end > MAX_HEADER_BYTES) {
        fail(new UpstreamError(502, 'bad_header', 'header ของสถานียาวผิดปกติ'));
        return;
      }
      socket.off('data', onData);
      const parsed = parseRawHead(buf.subarray(0, end).toString('latin1'));
      if (!parsed) {
        fail(new UpstreamError(502, 'bad_header', 'สถานีตอบรูปแบบที่ไม่รู้จัก'));
        return;
      }
      settled = true;
      timers.forEach(clearTimeout);
      // ส่วนที่เหลือหลัง header คือเสียง — ส่งต่อก่อน แล้วตามด้วยข้อมูลจาก socket
      // ใช้ PassThrough + pipeline: ไม่มีข้อมูลหล่นระหว่างทาง และทำลาย body = ทำลาย socket ด้วย
      const body = new PassThrough();
      const rest = buf.subarray(end + sep);
      if (rest.length) body.write(rest);
      pipeline(socket, body, () => socket.destroy());
      resolve({ ...parsed, body, raw: true });
    };
    socket.once(target.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      clearTimeout(timers[0]);
      const path = `${target.url.pathname}${target.url.search}` || '/';
      const head = [`GET ${path} HTTP/1.0`, `Host: ${hostHeader(target)}`, ...Object.entries(requestHeaders()).map(([k, v]) => `${k}: ${v}`)];
      socket.write(`${head.join('\r\n')}\r\n\r\n`);
    });
    socket.on('data', onData);
    socket.on('error', fail);
    socket.on('close', () => fail(new UpstreamError(502, 'closed', 'สถานีปิดการเชื่อมต่อ')));
  });
}

async function fetchHead(target, timeouts) {
  try {
    return await requestOnce(target, timeouts);
  } catch (err) {
    if (isParseError(err)) return requestRaw(target, timeouts);
    throw err;
  }
}

function toUpstreamError(err) {
  if (err instanceof UpstreamError) return err;
  if (err instanceof GuardError) return new UpstreamError(err.statusCode, `guard_${err.reason}`, err.message);
  return new UpstreamError(502, 'network', 'เชื่อมต่อสถานีไม่ได้');
}

// เปิดสตรีม: คืน { statusCode, headers, body, host, contentType } เมื่อได้เสียงจริง
// guard(url) ต้องคืนผลแบบ guardUrl — production ใช้ guardUrl + DNS จริงเสมอ (ฉีดแทนได้เฉพาะใน test)
export async function openUpstream(startUrl, {
  hls = false,
  connectTimeoutMs = 8000,
  headerTimeoutMs = 10000,
  guard = (u) => guardUrl(u, { resolve: systemResolve }),
} = {}) {
  if (isHls({ url: startUrl, hls })) throw new UpstreamError(415, 'hls', 'ยังไม่รองรับ HLS ผ่าน proxy');
  let url = startUrl;
  let hops = 0; // redirect + playlist รวมกันไม่เกิน MAX_REDIRECTS
  const timeouts = { connectTimeoutMs, headerTimeoutMs };

  for (;;) {
    let res;
    let target;
    try {
      target = await guard(url); // ทุก URL ใหม่ผ่าน guard ซ้ำทั้งหมด
      if (isHls({ url: target.url.href })) throw new UpstreamError(415, 'hls', 'ยังไม่รองรับ HLS ผ่าน proxy');
      res = await fetchHead(target, timeouts);
    } catch (err) {
      throw toUpstreamError(err);
    }
    const { statusCode, headers, body } = res;
    const contentType = headers['content-type'] || '';

    if (REDIRECT.has(statusCode)) {
      body.destroy();
      if (!headers.location) throw new UpstreamError(502, 'bad_redirect', 'สถานี redirect โดยไม่บอกปลายทาง');
      if (++hops > MAX_REDIRECTS) throw new UpstreamError(502, 'too_many_redirects', 'สถานี redirect มากเกินไป');
      try {
        url = new URL(headers.location, target.url).href;
      } catch {
        throw new UpstreamError(502, 'bad_redirect', 'ปลายทาง redirect ไม่ถูกต้อง');
      }
      continue;
    }
    if (statusCode < 200 || statusCode >= 300) {
      body.destroy();
      throw new UpstreamError(502, 'bad_status', `สถานีตอบ ${statusCode}`);
    }
    if (isHls({ contentType })) {
      body.destroy();
      throw new UpstreamError(415, 'hls', 'ยังไม่รองรับ HLS ผ่าน proxy');
    }
    if (isPlaylist({ url: target.url.href, contentType })) {
      let text;
      try {
        ({ text } = await readLimited(body));
      } catch {
        throw new UpstreamError(502, 'playlist_read', 'อ่าน playlist ของสถานีไม่ได้');
      }
      if (looksLikeHls(text)) throw new UpstreamError(415, 'hls', 'ยังไม่รองรับ HLS ผ่าน proxy');
      const next = parsePlaylist(text);
      if (!next) throw new UpstreamError(502, 'playlist_empty', 'playlist ไม่มี URL ที่ใช้ได้');
      if (++hops > MAX_REDIRECTS) throw new UpstreamError(502, 'too_many_redirects', 'สถานี redirect มากเกินไป');
      url = next;
      continue;
    }
    return { statusCode, headers, body, host: target.hostname, contentType };
  }
}

// ---------- ส่งเสียงต่อให้ client ----------
// คืน Promise<{ reason, bytes }> — reason: client_closed | upstream_end | idle_timeout | error | max_duration
// ทำความสะอาดทุกกรณี: ทำลายทั้งสองฝั่งเสมอ ไม่มี socket ค้าง
export function relay(source, dest, { idleTimeoutMs = 30000, maxDurationMs = 6 * 60 * 60 * 1000, onBytes } = {}) {
  return new Promise((resolve) => {
    let bytes = 0;
    let reason = null;
    let finished = false;
    const set = (r) => {
      reason ??= r;
    };
    let idle = setTimeout(onIdle, idleTimeoutMs);
    const max = setTimeout(() => {
      set('max_duration');
      source.destroy();
      dest.destroy();
    }, maxDurationMs);
    function onIdle() {
      set('idle_timeout');
      source.destroy();
      dest.destroy();
    }
    source.on('data', (chunk) => {
      bytes += chunk.length;
      onBytes?.(chunk.length);
      clearTimeout(idle);
      idle = setTimeout(onIdle, idleTimeoutMs);
    });
    source.once('end', () => set('upstream_end'));
    dest.once('close', () => {
      // ปิดก่อนส่งครบ = client ปิดเอง
      if (!dest.writableFinished) set('client_closed');
    });
    pipeline(source, dest, (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(idle);
      clearTimeout(max);
      if (err) set('error');
      set('upstream_end');
      // pipeline ทำลายทั้งคู่เมื่อ error อยู่แล้ว — ทำซ้ำเผื่อกรณีจบปกติให้แน่ใจว่าไม่มีอะไรค้าง
      source.destroy();
      if (!dest.destroyed && !dest.writableFinished) dest.destroy();
      resolve({ reason, bytes });
    });
  });
}
