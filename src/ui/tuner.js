// หน้าปัด FM: สเกล 88–108, จุดสถานีกดเล่นได้, เข็มเลื่อนตามสถานีที่เล่น
import { FM_MIN, FM_MAX } from '../config.js';
import { formatFreq as fmtFreq } from '../freq.js';

const pct = (f) => ((f - FM_MIN) / (FM_MAX - FM_MIN)) * 100;

export function createTuner(root, { onSelect }) {
  root.innerHTML = `
    <div class="tuner-head"><span>FM · MHz</span><span class="lamp"><i></i><span data-lamp>STANDBY</span></span></div>
    <div class="readout" data-readout>—<span>MHz</span></div>
    <div class="dial" data-dial><div class="scale" data-scale></div><div class="needle" data-needle style="left:0%"></div></div>`;
  const $ = (k) => root.querySelector(`[data-${k}]`);
  const dial = $('dial');
  const needle = $('needle');
  const readout = $('readout');
  const lamp = $('lamp');

  const scale = $('scale');
  for (let f = 88; f <= 108; f += 0.5) {
    const major = f % 2 === 0;
    const t = document.createElement('div');
    t.className = `tick ${major ? 'major' : 'minor'}`;
    t.style.left = `${pct(f)}%`;
    scale.append(t);
    if (major) {
      const n = document.createElement('div');
      n.className = 'num';
      n.textContent = f;
      n.style.left = `${pct(f)}%`;
      scale.append(n);
    }
  }

  // stations: [{ station, freq }]
  function setStations(items) {
    dial.querySelectorAll('.mark').forEach((m) => m.remove());
    for (const { station, freq } of items) {
      if (freq == null || freq < FM_MIN || freq > FM_MAX) continue;
      const m = document.createElement('button');
      m.type = 'button';
      m.className = 'mark';
      m.style.left = `${pct(freq)}%`;
      m.title = `${fmtFreq(freq)} · ${station.name}`;
      m.setAttribute('aria-label', `ฟัง ${station.name} ${fmtFreq(freq)} MHz`);
      m.addEventListener('click', () => onSelect(station));
      dial.append(m);
    }
  }

  function setTuned(freq) {
    const hasFreq = freq != null;
    readout.textContent = hasFreq ? fmtFreq(freq) : 'NET';
    const unit = document.createElement('span');
    unit.textContent = hasFreq ? 'MHz' : 'STREAM';
    readout.append(unit);
    needle.style.left = `${hasFreq ? Math.min(100, Math.max(0, pct(freq))) : 100}%`;
  }

  function setOn(on) {
    root.classList.toggle('on', on);
    lamp.textContent = on ? 'ON AIR' : 'STANDBY';
  }

  return { setStations, setTuned, setOn };
}
