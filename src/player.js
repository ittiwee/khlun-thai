// เล่นสตรีมผ่าน <audio> + hls.js และจัดการ Media Session — ห้ามแตะ DOM ยกเว้น <audio>
//
// สถานะที่ส่งออกทาง on('status'):
//   { state: 'idle' | 'connecting' | 'buffering' | 'playing' | 'paused' | 'error', reason?: 'offline' | 'mixed' | 'busy' | 'unsupported' }
import { PROXY_BASE, PROXY_ALWAYS } from './config.js';

// wav เปล่า ใช้ "ปลดล็อก" <audio> ใน gesture ของผู้ใช้ (iOS Safari ไม่ยอมให้ play() หลัง await fetch)
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export function isHlsStation(station, url = station.url_resolved) {
  if (Number(station.hls) === 1) return true;
  const path = (url || '').split(/[?#]/)[0];
  return path.toLowerCase().endsWith('.m3u8');
}

export function isMixedContent(url, pageProtocol = globalThis.location?.protocol) {
  return pageProtocol === 'https:' && /^http:/i.test(url || '');
}

// เลือกว่าจะเล่นจากไหน: ตรง, ผ่าน proxy (http บนหน้า https) หรือเล่นไม่ได้ (reason บอกสาเหตุ)
// proxy ยังไม่รองรับ HLS (ดู docs/PROXY.md) จึงถือว่า HLS แบบ http ที่ต้องผ่าน proxy เล่นไม่ได้
export function resolvePlayback(
  station,
  url,
  { protocol = globalThis.location?.protocol, proxyBase = PROXY_BASE, always = PROXY_ALWAYS } = {},
) {
  const needsProxy = isMixedContent(url, protocol) || (always && Boolean(proxyBase) && /^http:/i.test(url || ''));
  if (!needsProxy) return { url, viaProxy: false };
  if (!proxyBase) return { blocked: true, reason: 'mixed' };
  if (isHlsStation(station, url)) return { blocked: true, reason: 'unsupported' };
  return { url: proxyBase + encodeURIComponent(station.stationuuid), viaProxy: true };
}

// รหัสที่ proxy ตอบ → สาเหตุที่แสดงให้ผู้ใช้ (docs/PROXY.md ข้อ 9)
export function reasonForProxyStatus(status) {
  if (status === 429 || status === 503) return 'busy';
  if (status === 415) return 'unsupported';
  return 'offline'; // 403 / 404 / 502 / 504 / อื่นๆ / proxy ไม่ตอบ
}

export function canPlay(station, opts) {
  return !resolvePlayback(station, station.url_resolved, opts).blocked;
}

export function createPlayer(audio) {
  const listeners = { status: new Set() };
  let hls = null;
  let current = null;
  let source = null; // { url, viaProxy } ที่กำลังเล่น
  let token = 0; // กันผลของสถานีเก่าเขียนทับสถานีใหม่ตอนกดเปลี่ยนเร็วๆ
  let state = 'idle';
  let primed = false;

  const isSilent = () => audio.src === SILENT;

  function emit(next) {
    state = next.state;
    listeners.status.forEach((fn) => fn(next));
  }

  // audio ไม่บอก status code — ถ้าเล่นผ่าน proxy ให้ถาม HEAD เพื่ออ่านรหัสมาแสดงสาเหตุ
  let failing = 0; // token ที่กำลังหาสาเหตุอยู่ — audio 'error' กับ play() reject มักมาพร้อมกัน ให้ถาม HEAD ครั้งเดียว
  async function fail(t) {
    if (t !== token || state === 'error' || failing === t) return;
    failing = t;
    let reason = source && isMixedContent(source.url) ? 'mixed' : 'offline';
    if (source?.viaProxy) {
      try {
        const res = await fetch(source.url, { method: 'HEAD', cache: 'no-store' });
        reason = res.ok ? 'offline' : reasonForProxyStatus(res.status);
      } catch {
        reason = 'offline'; // proxy ไม่ตอบ
      }
    }
    if (t === token) emit({ state: 'error', reason });
  }

  function reset() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function start(t) {
    audio.play().catch((err) => {
      if (t !== token || err?.name === 'AbortError') return;
      if (err?.name === 'NotAllowedError') emit({ state: 'paused' });
      else fail(t);
    });
  }

  // url เป็น string หรือ Promise<string> (เช่นรอ /json/url) ก็ได้ — เรียกจาก click handler ตรงๆ
  async function play(station, { url = station.url_resolved, artist = '' } = {}) {
    const t = ++token;
    current = station;
    source = null;
    reset();
    if (!primed && typeof url?.then === 'function') {
      primed = true;
      audio.src = SILENT;
      audio.play().catch(() => {});
    }
    emit({ state: 'connecting' });
    setMetadata(station, artist);

    const raw = await url;
    if (t !== token) return;
    const pick = resolvePlayback(station, raw);
    if (pick.blocked) {
      reset();
      emit({ state: 'error', reason: pick.reason });
      return;
    }
    source = pick;

    const useHlsJs = isHlsStation(station, raw) && !audio.canPlayType('application/vnd.apple.mpegurl');
    if (!useHlsJs) {
      audio.src = pick.url;
      start(t);
      return;
    }

    const { default: Hls } = await import('hls.js/light');
    if (t !== token) return;
    audio.removeAttribute('src');
    if (!Hls.isSupported()) {
      fail(t);
      return;
    }
    hls = new Hls();
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) fail(t);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (t === token) start(t);
    });
    hls.loadSource(pick.url);
    hls.attachMedia(audio);
  }

  function toggle() {
    if (!current) return false;
    if (audio.paused) {
      // ถ้าเคย error หรือยังไม่ได้เริ่ม ให้เริ่มสถานีใหม่ทั้งหมด
      if (state === 'error' || !source) play(current);
      else start(token);
    } else {
      audio.pause();
    }
    return true;
  }

  function setVolume(v) {
    audio.volume = Math.min(1, Math.max(0, v));
  }

  function setMetadata(station, artist) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const artwork = station.favicon && /^https:/i.test(station.favicon) ? [{ src: station.favicon }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: artist || 'Online',
      album: 'คลื่นไทย',
      artwork,
    });
  }

  function setMediaActions({ prev, next }) {
    if (!('mediaSession' in navigator)) return;
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        // เบราว์เซอร์บางตัวไม่รองรับบาง action
      }
    };
    set('previoustrack', prev);
    set('nexttrack', next);
    set('play', () => toggle());
    set('pause', () => audio.pause());
  }

  audio.addEventListener('playing', () => {
    if (!isSilent()) emit({ state: 'playing' });
  });
  audio.addEventListener('waiting', () => {
    if (current && source && !isSilent()) emit({ state: 'buffering' });
  });
  audio.addEventListener('pause', () => {
    if (current && source && !isSilent() && state !== 'error' && state !== 'connecting') emit({ state: 'paused' });
  });
  audio.addEventListener('error', () => {
    if (current && source && !hls && audio.getAttribute('src') && !isSilent()) fail(token);
  });

  return {
    play,
    toggle,
    setVolume,
    setMediaActions,
    get current() {
      return current;
    },
    get state() {
      return state;
    },
    on(type, fn) {
      listeners[type].add(fn);
      return () => listeners[type].delete(fn);
    },
  };
}
