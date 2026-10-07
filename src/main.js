// จุดเริ่ม: ประกอบทุก module
import './styles/tokens.css';
import './styles/app.css';
import { DEFAULT_VOLUME, DEFAULT_COUNTRY, PAGE_SIZE } from './config.js';
import { api } from './api.js';
import { createPlayer, canPlay } from './player.js';
import { parseFreq, formatFreq } from './freq.js';
import { createTuner } from './ui/tuner.js';
import { createBar } from './ui/bar.js';
import { createStationList } from './ui/stations.js';
import { createPager } from './ui/pager.js';
import { createCountryGrid, localizeCountries, thaiName, flagEl } from './ui/countries.js';
import { registerServiceWorker } from './sw-register.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('th');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- state ----
let countries = [];
const view = {
  country: DEFAULT_COUNTRY,
  page: 1,
  items: [], // [{ station, freq }] ของหน้าปัจจุบัน
  loading: null, // Promise ของการโหลดหน้าล่าสุด
};
const lastPage = new Map(); // ประเทศ → หน้าสุดท้ายที่รู้แน่นอนแล้ว
let loadToken = 0;

const countryOf = (code) => countries.find((c) => c.code === code);
// stationcount ของประเทศนับสถานีเสียด้วย จึงเป็นแค่ขอบบน จนกว่าจะเจอหน้าสุดท้ายจริง
function totalPages(code) {
  if (lastPage.has(code)) return lastPage.get(code);
  const c = countryOf(code);
  return c ? Math.max(1, Math.ceil(c.stationcount / PAGE_SIZE)) : null;
}

// ---- components ----
const player = createPlayer($('audio'));
const tuner = createTuner($('tuner'), { onSelect: playStation });
const list = createStationList($('grid'), {
  onPlay: (s) => (player.current?.stationuuid === s.stationuuid ? player.toggle() : playStation(s)),
  canPlay: (s) => canPlay(s),
});
const pager = createPager($('pager'), { onPage: (p) => goPage(p, { scroll: true }) });
const bar = createBar($('bar'), {
  onToggle: () => player.toggle() || (view.items.length && playStation(view.items[0].station)),
  onPrev: () => step(-1),
  onNext: () => step(1),
  onVolume: (v) => player.setVolume(v),
});
const countryGrid = createCountryGrid($('countries'), {
  onSelect: (c) => selectCountry(c.code, { scroll: 'top' }),
});

// ---- playback ----
function playStation(station) {
  const freq = parseFreq(station.name);
  tuner.setTuned(freq);
  bar.setStation(station);
  list.setCurrent(station.stationuuid);
  const artist = freq != null ? `${formatFreq(freq)} MHz` : thaiName(station.countrycode || view.country);
  // นับคลิกผ่าน /json/url ก่อนเสมอ แล้วเล่น URL ที่ได้ (ล้มเหลว → url_resolved)
  player.play(station, { url: api.clickUrl(station), artist });
}

// ก่อนหน้า/ถัดไปในหน้าปัจจุบัน ถ้าสุดหน้าให้โหลดหน้าถัดไป/ก่อนหน้า (หน้าแรก↔หน้าสุดท้ายวนกัน)
async function step(d) {
  if (view.loading) await view.loading;
  const { items } = view;
  if (!items.length) return;
  const pos = items.findIndex((it) => it.station.stationuuid === player.current?.stationuuid);
  if (pos < 0) {
    playStation((d > 0 ? items[0] : items[items.length - 1]).station);
    return;
  }
  const next = pos + d;
  if (next >= 0 && next < items.length) {
    playStation(items[next].station);
    return;
  }
  const total = totalPages(view.country);
  let target;
  if (next < 0) target = view.page > 1 ? view.page - 1 : (total ?? 1);
  else target = total != null && view.page >= total ? 1 : view.page + 1;
  if (target === view.page) {
    playStation(items[(next + items.length) % items.length].station);
    return;
  }
  await goPage(target);
  const fresh = view.items;
  if (fresh.length) playStation((next < 0 ? fresh[fresh.length - 1] : fresh[0]).station);
}

player.on('status', (s) => {
  const on = s.state === 'playing';
  tuner.setOn(on);
  bar.setOn(on);
  bar.setStatus(s);
});
player.setMediaActions({ prev: () => step(-1), next: () => step(1) });
player.setVolume(DEFAULT_VOLUME);
bar.setVolume(DEFAULT_VOLUME);

// ---- stations + pages ----
function renderPager() {
  const total = totalPages(view.country);
  pager.set({ page: view.page, total, hasNext: total == null && view.items.length === PAGE_SIZE });
}

function scrollToList() {
  const top = $('grid').getBoundingClientRect().top + window.scrollY - 16;
  if (window.scrollY > top) window.scrollTo({ top, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

async function loadPage(code, page) {
  const t = ++loadToken;
  view.country = code;
  view.page = page;
  list.setLoading();
  renderPager();
  try {
    let stations = await api.getStations({ countrycode: code, page });
    if (t !== loadToken) return;
    if (stations.length < PAGE_SIZE) {
      // หน้าสั้น = หน้าสุดท้าย; หน้าว่าง = เลยหน้าสุดท้ายไปแล้ว หาหน้าสุดท้ายจริงแล้วไปที่นั่น
      if (!stations.length && page > 1) {
        const last = await api.findLastPage({ countrycode: code, lo: 1, hi: page });
        if (t !== loadToken) return;
        lastPage.set(code, last);
        view.page = last;
        stations = await api.getStations({ countrycode: code, page: last });
        if (t !== loadToken) return;
      } else {
        lastPage.set(code, page);
      }
    }
    view.items = stations.map((station) => ({ station, freq: parseFreq(station.name) }));
    list.setStations(view.items, { empty: 'ประเทศนี้ยังไม่มีสถานีที่ใช้งานได้' });
    list.setCurrent(player.current?.stationuuid ?? null);
    tuner.setStations(view.items);
    renderPager();
    checkLastPage(code);
  } catch {
    if (t !== loadToken) return;
    view.items = [];
    list.setError(() => goPage(page));
  }
}

// เบื้องหลัง: หาหน้าสุดท้ายจริงให้ตัวแบ่งหน้าแสดงจำนวนถูกตั้งแต่แรก
const checking = new Set();
async function checkLastPage(code) {
  const upper = totalPages(code);
  if (lastPage.has(code) || upper == null || upper <= view.page || checking.has(code)) return;
  checking.add(code);
  try {
    lastPage.set(code, await api.verifyLastPage({ countrycode: code, upper }));
    if (view.country === code) renderPager();
  } catch {
    // ไม่เป็นไร ใช้ค่าประมาณต่อ
  } finally {
    checking.delete(code);
  }
}

function goPage(page, { scroll = false } = {}) {
  const total = totalPages(view.country);
  const p = Math.max(1, total != null ? Math.min(page, total) : page);
  if (scroll) scrollToList();
  const loading = loadPage(view.country, p).finally(() => {
    if (view.loading === loading) view.loading = null;
  });
  view.loading = loading;
  return loading;
}

// ---- countries ----
function renderWhere() {
  const c = countryOf(view.country);
  $('whereName').replaceChildren(flagEl(view.country), document.createTextNode(c?.th ?? thaiName(view.country)));
  $('count').textContent = c ? `${nf.format(c.stationcount)} สถานี` : '';
}

function selectCountry(code, { scroll } = {}) {
  view.country = code;
  countryGrid.setSelected(code);
  renderWhere();
  if (scroll === 'top') window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  return goPage(1);
}

async function loadCountries() {
  countryGrid.setLoading();
  try {
    countries = localizeCountries(await api.getCountries());
    countryGrid.setCountries(countries);
    countryGrid.setSelected(view.country);
    renderWhere();
    renderPager();
    if (!view.loading) checkLastPage(view.country);
  } catch {
    countryGrid.setError(loadCountries);
  }
}

renderWhere();
loadCountries();
selectCountry(view.country);
registerServiceWorker();
