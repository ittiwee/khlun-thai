// แถบควบคุมด้านล่าง: เล่น/หยุด, ก่อนหน้า/ถัดไป, ระดับเสียง, ลิงก์เว็บสถานี
const ICON_PLAY = '<path d="M7 4v16l13-8z"/>';
const ICON_PAUSE = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>';

const STATUS_TEXT = {
  idle: 'พร้อม',
  connecting: 'กำลังเชื่อมต่อ…',
  buffering: 'กำลังบัฟเฟอร์…',
  playing: 'กำลังออกอากาศ',
  paused: 'หยุดชั่วคราว',
};
const ERROR_TEXT = {
  offline: 'สถานีออฟไลน์ ลองสถานีอื่น',
  mixed: 'สตรีม http ถูกบล็อกบนหน้า https',
  busy: 'เซิร์ฟเวอร์เต็มชั่วคราว ลองใหม่อีกครั้ง',
  unsupported: 'สถานีนี้ยังเล่นผ่าน proxy ไม่ได้',
};

export function createBar(root, { onToggle, onPrev, onNext, onVolume }) {
  root.innerHTML = `
    <div class="bar-in">
      <div class="btns">
        <button type="button" class="btn" data-prev aria-label="สถานีก่อนหน้า"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
        <button type="button" class="btn play" data-play aria-label="เล่น"><svg viewBox="0 0 24 24" aria-hidden="true" data-icon>${ICON_PLAY}</svg></button>
        <button type="button" class="btn" data-next aria-label="สถานีถัดไป"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button>
      </div>
      <div class="now">
        <div class="now-label">NOW PLAYING</div>
        <b data-name>เลือกสถานีเพื่อเริ่มฟัง</b>
        <div class="status" data-status role="status" aria-live="polite"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span data-status-text>${STATUS_TEXT.idle}</span></div>
      </div>
      <div class="vol"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9z"/></svg><input data-vol type="range" min="0" max="1" step="0.01" aria-label="ระดับเสียง"></div>
      <a class="home" data-home href="#" target="_blank" rel="noopener" hidden>เว็บสถานี ↗</a>
    </div>`;
  const $ = (k) => root.querySelector(`[data-${k}]`);
  const play = $('play');
  const icon = $('icon');
  const name = $('name');
  const status = $('status');
  const statusText = $('status-text');
  const vol = $('vol');
  const home = $('home');

  $('prev').addEventListener('click', onPrev);
  $('next').addEventListener('click', onNext);
  play.addEventListener('click', onToggle);
  vol.addEventListener('input', () => onVolume(Number(vol.value)));

  function setStation(station) {
    name.textContent = station.name;
    if (station.homepage && /^https?:/i.test(station.homepage)) {
      home.href = station.homepage;
      home.hidden = false;
    } else {
      home.hidden = true;
    }
  }

  function setStatus({ state, reason }) {
    const err = state === 'error';
    statusText.textContent = err ? ERROR_TEXT[reason] || ERROR_TEXT.offline : STATUS_TEXT[state] || '';
    status.classList.toggle('err', err);
  }

  function setOn(on) {
    root.classList.toggle('on', on);
    icon.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    play.setAttribute('aria-label', on ? 'หยุด' : 'เล่น');
  }

  function setVolume(v) {
    vol.value = String(v);
  }

  return { setStation, setStatus, setOn, setVolume };
}
