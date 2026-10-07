// จุดเริ่ม: ประกอบทุก module
import './styles/tokens.css';
import './styles/app.css';
import { DEFAULT_VOLUME, DEFAULT_COUNTRY, PAGE_SIZE } from './config.js';
import { api } from './api.js';
import { createPlayer, canPlay } from './player.js';
import { createStore } from './store.js';
import { createRouter, guessCountry } from './router.js';
import { parseFreq, formatFreq } from './freq.js';
import { createTuner } from './ui/tuner.js';
import { createBar } from './ui/bar.js';
import { createStationList } from './ui/stations.js';
import { createPager } from './ui/pager.js';
import { createSearch } from './ui/search.js';
import { createTagChips, tagLabel } from './ui/tags.js';
import { createCountryGrid, localizeCountries, thaiName, flagEl } from './ui/countries.js';
import { registerServiceWorker } from './sw-register.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('th');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- state ----
const store = createStore();
let countries = [];
const view = {
  tab: 'country', // 'country' | 'fav' | 'recent'
  country: DEFAULT_COUNTRY,
  routePage: 1, // หน้าจาก URL (รายการประเทศแบบไม่กรอง)
  filterPage: 1, // หน้าของผลค้นหา/แนวเพลง (ไม่อยู่ใน URL)
  query: '',
  scope: 'country', // 'country' | 'all'
  tag: '',
  page: 1, // หน้าที่แสดงอยู่จริง
  routeKey: '', // "CC/page" ของ route ที่โหลดไปแล้ว — กันโหลดซ้ำเมื่อ hashchange ตามหลัง goPage
  items: [], // [{ station, freq }] ของรายการที่แสดงอยู่
  loading: null,
};
const lastPage = new Map(); // filter key → หน้าสุดท้ายที่รู้แน่นอนแล้ว
let loadToken = 0;

const filtered = () => Boolean(view.query || view.tag);
function currentFilter() {
  const f = {};
  if (view.query) f.name = view.query;
  if (view.tag) f.tag = view.tag;
  if (!view.query || view.scope === 'country') f.countrycode = view.country;
  return f;
}
const filterKey = (f) => `${f.countrycode || '*'}|${f.tag || ''}|${(f.name || '').toLowerCase()}`;
const countryOf = (code) => countries.find((c) => c.code === code);

// จำนวนหน้า: รู้ได้เฉพาะรายการประเทศแบบไม่กรอง (จาก stationcount ซึ่งเป็นขอบบน) หรือเมื่อเจอหน้าสุดท้ายแล้ว
function totalPages(f) {
  const key = filterKey(f);
  if (lastPage.has(key)) return lastPage.get(key);
  if (f.name || f.tag) return null;
  const c = countryOf(f.countrycode);
  return c ? Math.max(1, Math.ceil(c.stationcount / PAGE_SIZE)) : null;
}

// ---- components ----
const player = createPlayer($('audio'));
const tuner = createTuner($('tuner'), { onSelect: playStation });
const list = createStationList($('grid'), {
  onPlay: (s) => (player.current?.stationuuid === s.stationuuid ? player.toggle() : playStation(s)),
  canPlay: (s) => canPlay(s),
  isFavorite: (id) => store.isFavorite(id),
  onToggleFavorite: (s) => store.toggleFavorite(s),
});
const pager = createPager($('pager'), { onPage: (p) => goPage(p) });
const togglePlay = () => player.toggle() || (view.items.length && playStation(view.items[0].station));
const bar = createBar($('bar'), {
  onToggle: togglePlay,
  onPrev: () => step(-1),
  onNext: () => step(1),
  onVolume: (v) => {
    player.setVolume(v);
    store.setVolume(v);
  },
});
const search = createSearch($('controls'), {
  onChange: ({ query, scope }) => {
    view.query = query;
    view.scope = scope;
    view.filterPage = 1;
    loadCurrent();
  },
});
const chips = createTagChips($('chips'), {
  onSelect: (tag) => {
    view.tag = tag;
    view.filterPage = 1;
    chips.setSelected(tag);
    loadCurrent();
  },
});
const countryGrid = createCountryGrid($('countries'), {
  onSelect: (c) => {
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    router.navigate({ view: 'country', country: c.code, page: 1 });
  },
});

// ---- playback ----
let pendingRecent = null;
function playStation(station) {
  const freq = parseFreq(station.name);
  tuner.setTuned(freq);
  bar.setStation(station);
  list.setCurrent(station.stationuuid);
  pendingRecent = station;
  const artist = freq != null ? `${formatFreq(freq)} MHz` : thaiName(station.countrycode || view.country);
  // นับคลิกผ่าน /json/url ก่อนเสมอ แล้วเล่น URL ที่ได้ (ล้มเหลว → url_resolved)
  player.play(station, { url: api.clickUrl(station), artist });
}

// ก่อนหน้า/ถัดไปในรายการที่แสดงอยู่ ถ้าสุดหน้าให้โหลดหน้าถัดไป/ก่อนหน้า (หน้าแรก↔หน้าสุดท้ายวนกัน)
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
  let target = view.page;
  if (view.tab === 'country') {
    const total = totalPages(currentFilter());
    const hasMore = total != null ? view.page < total : items.length === PAGE_SIZE;
    if (next < 0) target = view.page > 1 ? view.page - 1 : (total ?? 1);
    else target = hasMore ? view.page + 1 : 1;
  }
  if (target === view.page) {
    playStation(items[(next + items.length) % items.length].station);
    return;
  }
  await goPage(target, { scroll: false });
  const fresh = view.items;
  if (fresh.length) playStation((next < 0 ? fresh[fresh.length - 1] : fresh[0]).station);
}

player.on('status', (s) => {
  const on = s.state === 'playing';
  tuner.setOn(on);
  bar.setOn(on);
  bar.setStatus(s);
  if (on && pendingRecent && pendingRecent.stationuuid === player.current?.stationuuid) {
    store.addRecent(pendingRecent);
    pendingRecent = null;
  }
});
player.setMediaActions({ prev: () => step(-1), next: () => step(1) });
const volume = store.volume(DEFAULT_VOLUME);
player.setVolume(volume);
bar.setVolume(volume);

// ---- lists ----
function showItems(stations, { empty, multiCountry = false }) {
  view.items = stations.map((station) => ({ station, freq: parseFreq(station.name) }));
  list.setStations(view.items, { empty, showCountry: multiCountry });
  list.setCurrent(player.current?.stationuuid ?? null);
  tuner.setStations(view.items);
}

function renderPager() {
  if (view.tab !== 'country') {
    pager.set({ page: 1, total: 1 });
    return;
  }
  const total = totalPages(currentFilter());
  pager.set({ page: view.page, total, hasNext: total == null && view.items.length === PAGE_SIZE });
}

function renderListHead() {
  let text = '';
  if (view.tab === 'fav') text = view.items.length ? `${nf.format(view.items.length)} สถานีโปรด` : '';
  else if (view.tab === 'recent') text = view.items.length ? `${nf.format(view.items.length)} สถานีที่ฟังล่าสุด` : '';
  else if (filtered()) {
    const where = view.query && view.scope === 'all' ? 'ทุกประเทศ' : thaiName(view.country, countryOf(view.country)?.name);
    const parts = [];
    if (view.query) parts.push(`ผลค้นหา “${view.query}”`);
    if (view.tag) parts.push(`แนว ${tagLabel(view.tag)}`);
    text = `${parts.join(' · ')} — ${where}`;
  }
  $('listHead').textContent = text;
}

async function loadStations(page) {
  const t = ++loadToken;
  const f = currentFilter();
  const key = filterKey(f);
  view.page = page;
  list.setLoading();
  renderPager();
  renderListHead();
  try {
    let stations = await api.getStations({ ...f, page });
    if (t !== loadToken) return;
    if (stations.length < PAGE_SIZE) {
      // หน้าสั้น = หน้าสุดท้าย; หน้าว่าง = เลยหน้าสุดท้ายไปแล้ว หาหน้าสุดท้ายจริงแล้วไปที่นั่น
      if (!stations.length && page > 1) {
        const last = await api.findLastPage({ ...f, lo: 1, hi: page });
        if (t !== loadToken) return;
        lastPage.set(key, last);
        view.page = last;
        stations = await api.getStations({ ...f, page: last });
        if (t !== loadToken) return;
      } else {
        lastPage.set(key, page);
      }
    }
    const empty = view.query
      ? 'ไม่พบสถานีที่ตรงกับคำค้น'
      : view.tag
        ? 'ไม่พบสถานีแนวนี้ในประเทศนี้'
        : 'ประเทศนี้ยังไม่มีสถานีที่ใช้งานได้';
    showItems(stations, { empty, multiCountry: !f.countrycode });
    renderPager();
    renderListHead();
    checkLastPage(f);
  } catch {
    if (t !== loadToken) return;
    view.items = [];
    list.setError(() => goPage(page, { scroll: false }));
  }
}

// เบื้องหลัง: หาหน้าสุดท้ายจริงให้ตัวแบ่งหน้าแสดงจำนวนถูกตั้งแต่แรก (เฉพาะรายการประเทศแบบไม่กรอง)
const checking = new Set();
async function checkLastPage(f) {
  const key = filterKey(f);
  const upper = totalPages(f);
  if (f.name || f.tag || lastPage.has(key) || upper == null || upper <= view.page || checking.has(key)) return;
  checking.add(key);
  try {
    lastPage.set(key, await api.verifyLastPage({ ...f, upper }));
    if (filterKey(currentFilter()) === key) renderPager();
  } catch {
    // ไม่เป็นไร ใช้ค่าประมาณต่อ
  } finally {
    checking.delete(key);
  }
}

function track(promise) {
  const loading = promise.finally(() => {
    if (view.loading === loading) view.loading = null;
  });
  view.loading = loading;
  return loading;
}

function clampPage(page) {
  const total = totalPages(currentFilter());
  return Math.max(1, total != null ? Math.min(page, total) : page);
}

function scrollToList() {
  const top = $('tabs').getBoundingClientRect().top + window.scrollY - 12;
  if (window.scrollY > top) window.scrollTo({ top, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

// โหลดรายการตามสถานะปัจจุบันของแท็บสถานี
function loadCurrent() {
  if (view.tab !== 'country') return;
  return track(loadStations(clampPage(filtered() ? view.filterPage : view.routePage)));
}

// เปลี่ยนหน้า: รายการประเทศแบบไม่กรองไปผ่าน URL (#jp/3), ผลค้นหา/แนวเพลงเปลี่ยนในหน้าเลย
function goPage(page, { scroll = true } = {}) {
  if (view.tab !== 'country') return Promise.resolve();
  const p = clampPage(page);
  if (scroll) scrollToList();
  if (filtered()) {
    view.filterPage = p;
    return track(loadStations(p));
  }
  // โหลดทันที (step() รอผลได้) แล้วค่อยอัปเดต URL — onRoute จะเห็นว่า route เดิมและไม่โหลดซ้ำ
  view.routePage = p;
  view.routeKey = `${view.country}/${p}`;
  const loading = track(loadStations(p));
  router.navigate({ view: 'country', country: view.country, page: p });
  renderTabs();
  return loading;
}

function showSaved(tab) {
  ++loadToken;
  const stations = tab === 'fav' ? store.favorites() : store.recent();
  const empty = tab === 'fav' ? 'ยังไม่มีสถานีโปรด กด ☆ ที่การ์ดเพื่อเพิ่ม' : 'ยังไม่มีสถานีที่ฟังล่าสุด';
  showItems(stations, { empty, multiCountry: true });
  view.page = 1;
  renderPager();
  renderListHead();
}

// ---- tabs + header ----
function renderTabs() {
  const countryTab = document.querySelector('[data-tab="country"]');
  countryTab.href = view.routePage > 1 ? `#${view.country.toLowerCase()}/${view.routePage}` : `#${view.country.toLowerCase()}`;
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === view.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const n = store.favorites().length;
  document.querySelector('[data-n="fav"]').textContent = n ? nf.format(n) : '';
  $('controls').hidden = view.tab !== 'country';
  $('chips').hidden = view.tab !== 'country' || !$('chips').childElementCount;
}

function renderWhere() {
  const c = countryOf(view.country);
  $('whereName').replaceChildren(flagEl(view.country), document.createTextNode(c?.th ?? thaiName(view.country)));
  $('count').textContent = c ? `${nf.format(c.stationcount)} สถานี` : '';
}

store.onChange((what) => {
  if (what === 'favs') {
    list.refreshFavorites();
    renderTabs();
    if (view.tab === 'fav') showSaved('fav');
  }
  // ฟังล่าสุด: ไม่ render ใหม่ทันทีระหว่างดูแท็บนี้ (กันการ์ดกระโดด) — จะเห็นตอนเปิดแท็บครั้งถัดไป
});

// ---- routing ----
function onRoute(route) {
  if (route.view === 'fav' || route.view === 'recent') {
    view.tab = route.view;
    view.routeKey = '';
    renderTabs();
    showSaved(route.view);
    return;
  }
  const key = `${route.country}/${route.page}`;
  if (view.tab === 'country' && view.routeKey === key) {
    renderTabs();
    return;
  }
  const countryChanged = route.country !== view.country;
  view.routeKey = key;
  view.tab = 'country';
  view.country = route.country;
  view.routePage = route.page;
  if (countryChanged) view.filterPage = 1;
  store.setLastCountry(route.country);
  countryGrid.setSelected(route.country);
  renderWhere();
  renderTabs();
  loadCurrent();
}

const router = createRouter({
  onRoute,
  fallback: () => ({
    view: 'country',
    page: 1,
    country:
      store.lastCountry() ??
      guessCountry(
        { languages: navigator.languages?.length ? navigator.languages : [navigator.language], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        DEFAULT_COUNTRY,
      ),
  }),
});

// ---- data ที่ไม่ขึ้นกับ route ----
async function loadCountries() {
  countryGrid.setLoading();
  try {
    countries = localizeCountries(await api.getCountries());
    countryGrid.setCountries(countries);
    countryGrid.setSelected(view.country);
    renderWhere();
    renderPager();
    if (!view.loading && view.tab === 'country') checkLastPage(currentFilter());
  } catch {
    countryGrid.setError(loadCountries);
  }
}

async function loadTags() {
  try {
    chips.setTags(await api.getTags());
    chips.setSelected(view.tag);
    renderTabs();
  } catch {
    // ไม่มี chips ก็ใช้งานได้
  }
}

// ---- คีย์ลัด: Space = เล่น/หยุด, ← → = สถานีก่อนหน้า/ถัดไป (ยกเว้นตอนพิมพ์) ----
const isTyping = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
  if (e.key === ' ' || e.code === 'Space') {
    // Space บนปุ่ม/ลิงก์/การ์ด = กดสิ่งนั้น ไม่ใช่คีย์ลัด
    if (e.target.closest?.('button, a, [role="button"]')) return;
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    step(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    step(-1);
  }
});

renderWhere();
router.start();
loadCountries();
loadTags();
registerServiceWorker();
