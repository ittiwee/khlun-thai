// ตารางธงประเทศ + ค้นหาประเทศ
import 'flag-icons/css/flag-icons.min.css';

const SHOW_FIRST = 48;
const nf = new Intl.NumberFormat('th');

let thaiNames = null;
let enNames = null;
try {
  thaiNames = new Intl.DisplayNames(['th'], { type: 'region' });
  enNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  // เบราว์เซอร์เก่า: ใช้ชื่อจาก API
}

function regionName(dn, code) {
  try {
    const n = dn?.of(code);
    return n && n !== code ? n : '';
  } catch {
    return '';
  }
}

export function thaiName(code, fallback = '') {
  return regionName(thaiNames, code) || fallback || code;
}

// เพิ่มชื่อไทยและคำสำหรับค้นหาให้รายการจาก api.getCountries()
export function localizeCountries(list) {
  return list.map((c) => {
    const th = thaiName(c.code, c.name);
    const en = regionName(enNames, c.code);
    return { ...c, th, keys: [th, c.name, en].filter(Boolean).map((s) => s.toLowerCase()) };
  });
}

// ค้นด้วยชื่อไทย ชื่ออังกฤษ หรือรหัส 2 หลัก — รหัสตรงขึ้นก่อน แล้วชื่อที่ขึ้นต้นด้วยคำค้น
export function matchCountries(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const rank = (c) => {
    if (c.code.toLowerCase() === q) return 0;
    if (c.keys.some((k) => k.startsWith(q))) return 1;
    if (c.keys.some((k) => k.includes(q))) return 2;
    return -1;
  };
  return list
    .map((c) => [rank(c), c])
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c);
}

export function flagEl(code) {
  const f = document.createElement('span');
  f.className = `fi fi-${code.toLowerCase()}`;
  f.setAttribute('aria-hidden', 'true');
  return f;
}

export function createCountryGrid(root, { onSelect }) {
  root.innerHTML = `
    <div class="sec-head">
      <h2 id="countries-title">เลือกประเทศ</h2>
      <div class="search"><input data-q type="search" placeholder="ค้นหาประเทศ เช่น ญี่ปุ่น, japan, jp" aria-label="ค้นหาประเทศ"></div>
    </div>
    <div class="cgrid" data-grid role="group" aria-labelledby="countries-title"></div>
    <div class="more" data-more hidden><button type="button" class="chip" data-all>แสดงทั้งหมด</button></div>`;
  const $ = (k) => root.querySelector(`[data-${k}]`);
  const input = $('q');
  const grid = $('grid');
  const more = $('more');

  let all = [];
  let selected = null;
  let expanded = false;

  function tile(c) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ct';
    b.dataset.code = c.code;
    b.title = c.name;
    if (c.code === selected) b.setAttribute('aria-current', 'true');
    const nm = document.createElement('span');
    nm.className = 'ct-nm';
    nm.textContent = c.th;
    const n = document.createElement('span');
    n.className = 'ct-n';
    n.textContent = nf.format(c.stationcount);
    b.append(flagEl(c.code), nm, n);
    b.setAttribute('aria-label', `${c.th} ${nf.format(c.stationcount)} สถานี`);
    b.addEventListener('click', () => onSelect(c));
    return b;
  }

  function render() {
    const matched = matchCountries(all, input.value);
    const shown = expanded ? matched : matched.slice(0, SHOW_FIRST);
    grid.replaceChildren(...shown.map(tile));
    if (!matched.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'ไม่พบประเทศที่ตรงกับคำค้น';
      grid.append(p);
    }
    more.hidden = shown.length >= matched.length;
  }

  input.addEventListener('input', render);
  $('all').addEventListener('click', () => {
    expanded = true;
    render();
  });

  function setLoading() {
    more.hidden = true;
    grid.replaceChildren(
      ...Array.from({ length: 12 }, () => {
        const s = document.createElement('div');
        s.className = 'ct sk';
        s.setAttribute('aria-hidden', 'true');
        return s;
      }),
    );
    grid.setAttribute('aria-busy', 'true');
  }

  function setError(onRetry) {
    grid.removeAttribute('aria-busy');
    more.hidden = true;
    const box = document.createElement('div');
    box.className = 'error';
    box.setAttribute('role', 'alert');
    const p = document.createElement('p');
    p.textContent = 'โหลดรายชื่อประเทศไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = 'ลองใหม่';
    btn.addEventListener('click', onRetry);
    box.append(p, btn);
    grid.replaceChildren(box);
  }

  function setCountries(list) {
    grid.removeAttribute('aria-busy');
    all = list;
    render();
  }

  function setSelected(code) {
    selected = code;
    grid.querySelectorAll('.ct[data-code]').forEach((el) => {
      if (el.dataset.code === code) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
  }

  return { setLoading, setError, setCountries, setSelected };
}
