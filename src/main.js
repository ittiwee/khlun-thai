// จุดเริ่ม: ประกอบทุก module
import './styles/tokens.css';
import './styles/app.css';
import { DEFAULT_VOLUME } from './config.js';
import { createPlayer } from './player.js';
import { createTuner, fmtFreq } from './ui/tuner.js';
import { createBar } from './ui/bar.js';
import { createStationList } from './ui/stations.js';
import { SAMPLE_STATIONS } from './sample-stations.js';

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
$('count').textContent = `${items.length} สถานี`;
