// รายการการ์ดสถานี
import { formatFreq } from '../freq.js';
import { flagEl } from './countries.js';

// 950 → "950", 12345 → "12.3k", 1234567 → "1.2M"
export function formatCount(n) {
  if (n < 1000) return String(n);
  const [v, unit] = n < 999500 ? [n / 1e3, 'k'] : [n / 1e6, 'M'];
  return `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${unit}`;
}

function logo(station) {
  const box = document.createElement('div');
  box.className = 'logo';
  box.setAttribute('aria-hidden', 'true');
  const initial = () => {
    box.replaceChildren();
    box.classList.add('initial');
    box.textContent = [...station.name.replace(/^[^\p{L}\p{N}]+/u, '')][0]?.toUpperCase() || '?';
  };
  const src = station.favicon;
  // http บนหน้า https = mixed content รูปจะถูกบล็อก/เตือน จึงใช้ตัวอักษรแทน
  if (!src || !/^https?:/i.test(src) || (location.protocol === 'https:' && /^http:/i.test(src))) {
    initial();
    return box;
  }
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.width = 44;
  img.height = 44;
  img.src = src;
  img.addEventListener('error', initial, { once: true });
  // favicon บางเว็บเป็นรูป 1×1 หรือเสีย ให้ถือว่าไม่มี
  img.addEventListener('load', () => img.naturalWidth < 8 && initial(), { once: true });
  box.append(img);
  return box;
}

export function createStationList(root, { onPlay, canPlay = () => true, isFavorite = () => false, onToggleFavorite }) {
  let items = [];
  let currentId = null;
  let showCountry = false;

  function card({ station, freq }) {
    const playable = canPlay(station);
    const el = document.createElement('div');
    el.className = `st${playable ? '' : ' off'}`;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `ฟัง ${station.name}${playable ? '' : ' (เล่นบนหน้านี้ไม่ได้)'}`);
    el.dataset.id = station.stationuuid;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = station.name;

    const tags = document.createElement('div');
    tags.className = 'tg';
    for (const t of (station.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3)) {
      const s = document.createElement('span');
      s.textContent = t;
      tags.append(s);
    }

    const sub = document.createElement('div');
    sub.className = 'sub';
    if (showCountry && /^[A-Z]{2}$/i.test(station.countrycode || '')) {
      const cc = document.createElement('span');
      cc.className = 'cc';
      cc.title = station.countrycode.toUpperCase();
      cc.append(flagEl(station.countrycode), station.countrycode.toUpperCase());
      sub.append(cc);
    }
    const clicks = Number.isFinite(station.clickcount) ? `${formatCount(station.clickcount)} คลิก` : '';
    const bits = [station.codec, station.bitrate ? `${station.bitrate}k` : '', clicks];
    for (const text of bits.filter(Boolean)) {
      const s = document.createElement('span');
      s.textContent = text;
      sub.append(s);
    }
    if (/^http:/i.test(station.url_resolved)) {
      const s = document.createElement('span');
      s.className = 'http';
      s.title = playable ? 'สตรีม http (ไม่เข้ารหัส)' : 'สตรีม http ถูกบล็อกบนหน้า https';
      s.textContent = 'http';
      sub.append(s);
    }
    meta.append(nm);
    if (tags.childElementCount) meta.append(tags);
    meta.append(sub);

    const fq = document.createElement('div');
    fq.className = 'fq';
    fq.textContent = freq != null ? formatFreq(freq) : 'NET';
    const unit = document.createElement('small');
    unit.textContent = freq != null ? 'MHz' : 'ONLINE';
    fq.append(unit);

    const side = document.createElement('div');
    side.className = 'side';
    side.append(fq);
    if (onToggleFavorite) side.append(favButton(station));

    el.append(logo(station), meta, side);
    el.addEventListener('click', () => onPlay(station));
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return; // Enter/Space บนปุ่ม ☆ ไม่ใช่การกดเล่น
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPlay(station);
      }
    });
    return el;
  }

  function setFavButton(b, on, name) {
    b.textContent = on ? '★' : '☆';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? `เอา ${name} ออกจากโปรด` : `เพิ่ม ${name} ในโปรด`);
    b.title = on ? 'เอาออกจากโปรด' : 'เพิ่มในโปรด';
  }

  function favButton(station) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fav';
    setFavButton(b, isFavorite(station.stationuuid), station.name);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggleFavorite(station);
    });
    return b;
  }

  // อัปเดตดาวทุกการ์ดหลังสถานีโปรดเปลี่ยน
  function refreshFavorites() {
    root.querySelectorAll('.st[data-id]').forEach((el) => {
      const b = el.querySelector('.fav');
      const it = items.find((x) => x.station.stationuuid === el.dataset.id);
      if (b && it) setFavButton(b, isFavorite(it.station.stationuuid), it.station.name);
    });
  }

  function message(text, { retry } = {}) {
    const box = document.createElement('div');
    box.className = retry ? 'error' : 'empty';
    if (retry) box.setAttribute('role', 'alert');
    const p = document.createElement('p');
    p.textContent = text;
    box.append(p);
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = 'ลองใหม่';
      b.addEventListener('click', retry);
      box.append(b);
    }
    root.replaceChildren(box);
    root.removeAttribute('aria-busy');
  }

  function setLoading(count = 9) {
    root.setAttribute('aria-busy', 'true');
    root.replaceChildren(
      ...Array.from({ length: count }, () => {
        const s = document.createElement('div');
        s.className = 'st sk';
        s.setAttribute('aria-hidden', 'true');
        s.innerHTML = '<div class="logo"></div><div class="meta"><div class="bar1"></div><div class="bar2"></div></div>';
        return s;
      }),
    );
  }

  function setStations(next, { empty = 'ไม่พบสถานีที่ตรงกับคำค้น', showCountry: multi = false } = {}) {
    items = next;
    showCountry = multi;
    root.removeAttribute('aria-busy');
    if (!items.length) {
      message(empty);
      return;
    }
    root.replaceChildren(...items.map(card));
    setCurrent(currentId);
  }

  function setError(onRetry) {
    message('โหลดรายการสถานีไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่', { retry: onRetry });
  }

  function setCurrent(id) {
    currentId = id;
    root.querySelectorAll('.st[data-id]').forEach((el) => el.classList.toggle('playing', el.dataset.id === id));
  }

  return { setLoading, setStations, setError, setCurrent, refreshFavorites };
}
