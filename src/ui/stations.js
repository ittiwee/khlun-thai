// รายการการ์ดสถานี (ขั้น 1: การ์ดแบบต้นแบบ — โลโก้, ปุ่มโปรด, ป้ายต่างๆ ตามแผนจะเพิ่มในขั้น 3)
import { fmtFreq } from './tuner.js';

export function createStationList(root, { onPlay }) {
  let items = [];
  let currentId = null;

  function card({ station, freq }) {
    const el = document.createElement('div');
    el.className = 'st';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `ฟัง ${station.name}`);
    el.dataset.id = station.stationuuid;

    const fq = document.createElement('div');
    fq.className = 'fq';
    fq.textContent = freq != null ? fmtFreq(freq) : 'NET';
    const unit = document.createElement('small');
    unit.textContent = freq != null ? 'MHz' : 'ONLINE';
    fq.append(unit);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = station.name;
    const sub = document.createElement('div');
    sub.className = 'sub';
    const tags = (station.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3);
    for (const text of [...tags, station.codec, station.bitrate ? `${station.bitrate}k` : '']) {
      if (!text) continue;
      const s = document.createElement('span');
      s.textContent = text;
      sub.append(s);
    }
    if (/^http:/i.test(station.url_resolved)) {
      const s = document.createElement('span');
      s.className = 'http';
      s.title = 'สตรีม http อาจถูกเบราว์เซอร์บล็อกบนหน้า https';
      s.textContent = 'http';
      sub.append(s);
    }
    meta.append(nm, sub);
    el.append(fq, meta);

    el.addEventListener('click', () => onPlay(station));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPlay(station);
      }
    });
    return el;
  }

  function render() {
    root.replaceChildren(...items.map(card));
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'ไม่พบสถานีที่ตรงกับคำค้น';
      root.append(p);
    }
    setCurrent(currentId);
  }

  function setStations(next) {
    items = next;
    render();
  }

  function setCurrent(id) {
    currentId = id;
    root.querySelectorAll('.st').forEach((el) => el.classList.toggle('playing', el.dataset.id === id));
  }

  return { setStations, setCurrent };
}
