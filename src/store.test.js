import { describe, it, expect } from 'vitest';
import { createStore, snapshot, RECENT_MAX } from './store.js';

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  return {
    get: (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null),
    set: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))),
    m,
  };
}

const st = (id, extra = {}) => ({
  stationuuid: id,
  name: `Station ${id}`,
  url_resolved: `https://x.test/${id}`,
  countrycode: 'TH',
  favicon: '',
  codec: 'MP3',
  bitrate: 128,
  hls: 0,
  homepage: '',
  tags: 'pop,rock',
  clickcount: 99,
  ...extra,
});

describe('snapshot', () => {
  it('keeps only fields needed to show and play', () => {
    const s = snapshot(st('a'));
    expect(s).toEqual({ stationuuid: 'a', name: 'Station a', url_resolved: 'https://x.test/a', countrycode: 'TH', favicon: '', codec: 'MP3', bitrate: 128, hls: 0, homepage: '' });
    expect(s).not.toHaveProperty('tags');
  });
});

describe('favorites', () => {
  it('toggles and persists across instances', () => {
    const storage = memStorage();
    const a = createStore(storage);
    expect(a.toggleFavorite(st('1'))).toBe(true);
    expect(a.toggleFavorite(st('2'))).toBe(true);
    expect(a.isFavorite('1')).toBe(true);
    const b = createStore(storage);
    expect(b.favorites().map((s) => s.stationuuid)).toEqual(['2', '1']);
    expect(b.toggleFavorite(st('1'))).toBe(false);
    expect(createStore(storage).isFavorite('1')).toBe(false);
  });

  it('notifies listeners', () => {
    const store = createStore(memStorage());
    const seen = [];
    store.onChange((w) => seen.push(w));
    store.toggleFavorite(st('1'));
    store.addRecent(st('1'));
    expect(seen).toEqual(['favs', 'recent']);
  });

  it('ignores corrupt stored data', () => {
    const store = createStore(memStorage({ 'kt-favs-v2': [{ nope: 1 }, null, st('ok')], 'kt-recent-v1': 'garbage' }));
    expect(store.favorites().map((s) => s.stationuuid)).toEqual(['ok']);
    expect(store.recent()).toEqual([]);
  });
});

describe('recent', () => {
  it('keeps newest first, unique, max 20', () => {
    const store = createStore(memStorage());
    for (let i = 0; i < 25; i++) store.addRecent(st(String(i)));
    store.addRecent(st('10'));
    const ids = store.recent().map((s) => s.stationuuid);
    expect(ids).toHaveLength(RECENT_MAX);
    expect(ids[0]).toBe('10');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('0');
  });
});

describe('volume and last country', () => {
  it('stores and validates', () => {
    const storage = memStorage();
    const store = createStore(storage);
    expect(store.volume(0.8)).toBe(0.8);
    store.setVolume(0.3);
    store.setLastCountry('JP');
    expect(createStore(storage).volume(0.8)).toBe(0.3);
    expect(createStore(storage).lastCountry()).toBe('JP');
    expect(createStore(memStorage({ 'kt-vol': 7, 'kt-country': '../x' })).volume(0.8)).toBe(0.8);
    expect(createStore(memStorage({ 'kt-country': '../x' })).lastCountry()).toBeNull();
  });

  it('works when localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const boom = () => {
      throw new Error('SecurityError');
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: boom, setItem: boom } });
    try {
      const store = createStore();
      expect(store.favorites()).toEqual([]);
      expect(store.toggleFavorite(st('1'))).toBe(true);
      expect(store.isFavorite('1')).toBe(true);
      expect(store.volume(0.5)).toBe(0.5);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });
});
