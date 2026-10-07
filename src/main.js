// จุดเริ่ม: ประกอบทุก module
import './styles/tokens.css';
import './styles/app.css';
import { DEFAULT_VOLUME, DEFAULT_COUNTRY } from './config.js';
import { api } from './api.js';
import { createPlayer } from './player.js';
import { createTuner, fmtFreq } from './ui/tuner.js';
import { createBar } from './ui/bar.js';
import { createStationList } from './ui/stations.js';
import { createCountryGrid, localizeCountries, thaiName, flagEl } from './ui/countries.js';
import { SAMPLE_STATIONS } from './sample-stations.js';
import { registerServiceWorker } from './sw-register.js';

const $ = (id) => document.getElementById(id);

// ขั้น 1 ใช้ freq จากข้อมูลตัวอย่าง — ขั้น 3 จะเปลี่ยนเป็น freq.js
const items = SAMPLE_STATIONS.map((station) => ({ station, freq: station.freq ?? null }));
const freqOf = (station) => items.find((it) => it.station.stationuuid === station.stationuuid)?.freq ?? null;

const player = createPlayer($('audio'));
const tuner = createTuner($('tuner'), { onSelect: playStation });
const list = createStationList($('grid'), { onPlay: (s) => (player.current === s ? player.toggle() : playStation(s)) });
const bar = createBar($('bar'), {
  onToggle: () => player.toggle() || (items.length && playStation(items[0].station)),
  onPrev: () => step(-1),
  onNext: () => step(1),
  onVolume: (v) => player.setVolume(v),
});

function playStation(station) {
  const freq = freqOf(station);
  tuner.setTuned(freq);
  bar.setStation(station);
  list.setCurrent(station.stationuuid);
  player.play(station, { artist: freq != null ? `${fmtFreq(freq)} MHz` : 'Online' });
}

function step(d) {
  if (!items.length) return;
  const pos = items.findIndex((it) => it.station === player.current);
  const next = pos < 0 ? (d > 0 ? 0 : items.length - 1) : (pos + d + items.length) % items.length;
  playStation(items[next].station);
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

tuner.setStations(items);
list.setStations(items);

// ประเทศ
const nf = new Intl.NumberFormat('th');
let countries = [];
let country = DEFAULT_COUNTRY;
const countryGrid = createCountryGrid($('countries'), { onSelect: (c) => selectCountry(c.code, { scroll: true }) });

function renderWhere() {
  const c = countries.find((x) => x.code === country);
  const name = $('whereName');
  name.replaceChildren(flagEl(country), document.createTextNode(c?.th ?? thaiName(country)));
  $('count').textContent = c ? `${nf.format(c.stationcount)} สถานี` : '';
}

function selectCountry(code, { scroll = false } = {}) {
  country = code;
  countryGrid.setSelected(code);
  renderWhere();
  // ขั้น 3: โหลดสถานีหน้า 1 ของประเทศนี้
  if (scroll) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }
}

async function loadCountries() {
  countryGrid.setLoading();
  try {
    countries = localizeCountries(await api.getCountries());
    countryGrid.setCountries(countries);
    selectCountry(country);
  } catch {
    countryGrid.setError(loadCountries);
  }
}

renderWhere();
loadCountries();
registerServiceWorker();
