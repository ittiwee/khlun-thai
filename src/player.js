// เล่นสตรีมผ่าน <audio> + hls.js และจัดการ Media Session — ห้ามแตะ DOM ยกเว้น <audio>
//
// สถานะที่ส่งออกทาง on('status'):
//   { state: 'idle' | 'connecting' | 'buffering' | 'playing' | 'paused' | 'error', reason?: 'offline' | 'mixed' | 'busy' }

export function isHlsStation(station) {
  if (Number(station.hls) === 1) return true;
  const path = (station.url_resolved || '').split(/[?#]/)[0];
  return path.toLowerCase().endsWith('.m3u8');
}

export function isMixedContent(url, pageProtocol = globalThis.location?.protocol) {
  return pageProtocol === 'https:' && /^http:/i.test(url || '');
}

export function createPlayer(audio) {
  const listeners = { status: new Set() };
  let hls = null;
  let current = null;
  let token = 0; // กันผลของสถานีเก่าเขียนทับสถานีใหม่ตอนกดเปลี่ยนเร็วๆ
  let state = 'idle';

  function emit(next) {
    state = next.state;
    listeners.status.forEach((fn) => fn(next));
  }

  function fail(url) {
    emit({ state: 'error', reason: isMixedContent(url) ? 'mixed' : 'offline' });
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

  function start(t, url) {
    audio.play().catch((err) => {
      if (t !== token || err?.name === 'AbortError') return;
      fail(url);
    });
  }

  async function play(station, { url = station.url_resolved, artist = '' } = {}) {
    const t = ++token;
    current = station;
    reset();
    emit({ state: 'connecting' });
    setMetadata(station, artist);

    const useHlsJs = isHlsStation(station) && !audio.canPlayType('application/vnd.apple.mpegurl');
    if (!useHlsJs) {
      audio.src = url;
      start(t, url);
      return;
    }

    const { default: Hls } = await import('hls.js/light');
    if (t !== token) return;
    if (!Hls.isSupported()) {
      fail(url);
      return;
    }
    hls = new Hls();
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (t === token && data.fatal) fail(url);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (t === token) start(t, url);
    });
    hls.loadSource(url);
    hls.attachMedia(audio);
  }

  function toggle() {
    if (!current) return false;
    if (audio.paused) {
      // สตรีมสดค้างนานแล้ว resume มักได้เสียงเก่า/หลุด จึงเริ่มสถานีใหม่ถ้าเคย error
      if (state === 'error') play(current);
      else start(token, current.url_resolved);
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

  audio.addEventListener('playing', () => emit({ state: 'playing' }));
  audio.addEventListener('waiting', () => {
    if (current) emit({ state: 'buffering' });
  });
  audio.addEventListener('pause', () => {
    if (current && state !== 'error' && state !== 'connecting') emit({ state: 'paused' });
  });
  audio.addEventListener('error', () => {
    if (current && audio.getAttribute('src') && !hls) fail(current.url_resolved);
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
