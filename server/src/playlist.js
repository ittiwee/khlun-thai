// แตกไฟล์ .pls / .m3u เอา URL สตรีมจริง และตรวจว่าเป็น HLS หรือไม่
export const PLAYLIST_MAX_BYTES = 64 * 1024;

const PLAYLIST_TYPES = new Set(['audio/x-scpls', 'audio/x-mpegurl', 'audio/mpegurl']);
const HLS_TYPES = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl']);

const mediaType = (contentType) => String(contentType || '').split(';')[0].trim().toLowerCase();
const pathOf = (url) => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
};

export function isHls({ url, contentType, hls = false } = {}) {
  return Boolean(hls) || HLS_TYPES.has(mediaType(contentType)) || pathOf(url).endsWith('.m3u8');
}

export function isPlaylist({ url, contentType } = {}) {
  const p = pathOf(url);
  return PLAYLIST_TYPES.has(mediaType(contentType)) || p.endsWith('.pls') || p.endsWith('.m3u');
}

// เนื้อหา m3u ที่มีแท็กของ HLS (#EXT-X-...) = HLS แม้ content-type จะบอกว่าเป็น m3u ธรรมดา
export const looksLikeHls = (text) => /^#EXT-X-/im.test(text);

const isHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

// .pls: File1=, File2=, ... เรียงตามเลข เอา URL แรกที่เป็น http(s)
export function parsePls(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*file(\d+)\s*=\s*(.+?)\s*$/i.exec(line);
    if (m) entries.push([Number(m[1]), m[2]]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  return entries.map(([, url]) => url).find(isHttpUrl) ?? null;
}

// .m3u: บรรทัดแรกที่ไม่ขึ้นต้นด้วย # และเป็น http(s)
export function parseM3u(text) {
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (isHttpUrl(line)) return line;
  }
  return null;
}

export function parsePlaylist(text) {
  const t = String(text);
  if (/^\s*\[playlist\]/im.test(t) || /^\s*file\d+\s*=/im.test(t)) return parsePls(t);
  return parseM3u(t);
}

// อ่าน body ไม่เกิน max ไบต์ (เกินแล้วหยุดอ่านและปิด stream — ใช้เฉพาะส่วนแรก)
export function readLimited(stream, max = PLAYLIST_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (truncated) => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ text: Buffer.concat(chunks).toString('utf8'), truncated });
    };
    const onData = (chunk) => {
      const room = max - size;
      if (chunk.length >= room) {
        chunks.push(chunk.subarray(0, room));
        size = max;
        stream.destroy();
        finish(true);
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    };
    const onEnd = () => finish(false);
    const onError = (err) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    };
    const onClose = () => finish(false);
    function cleanup() {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('close', onClose);
    }
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.on('close', onClose);
  });
}
