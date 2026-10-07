import { describe, it, expect } from 'vitest';
import { parseHash, formatHash, guessCountry, createRouter, sameRoute } from './router.js';

describe('parseHash', () => {
  it.each([
    ['#th', { view: 'country', country: 'TH', page: 1 }],
    ['#jp/3', { view: 'country', country: 'JP', page: 3 }],
    ['#JP/2/', { view: 'country', country: 'JP', page: 2 }],
    ['#/de/10', { view: 'country', country: 'DE', page: 10 }],
    ['#fav', { view: 'fav' }],
    ['#recent', { view: 'recent' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it.each(['', '#', '#thailand', '#t', '#jp/0', '#jp/abc', '#jp/3/4', '#../etc', '#jp/999999'])('%s → null', (hash) => {
    expect(parseHash(hash)).toBeNull();
  });
});

describe('formatHash', () => {
  it('round-trips', () => {
    for (const h of ['#th', '#jp/3', '#fav', '#recent']) expect(formatHash(parseHash(h))).toBe(h);
  });
  it('omits page 1', () => {
    expect(formatHash({ view: 'country', country: 'US', page: 1 })).toBe('#us');
  });
  it('sameRoute', () => {
    expect(sameRoute(parseHash('#th'), parseHash('#TH/1'))).toBe(true);
    expect(sameRoute(parseHash('#th'), parseHash('#th/2'))).toBe(false);
  });
});

describe('guessCountry', () => {
  it('uses region from language tag first', () => {
    expect(guessCountry({ languages: ['th-TH'], timeZone: 'Asia/Tokyo' })).toBe('TH');
    expect(guessCountry({ languages: ['en', 'ja-JP'] })).toBe('JP');
  });
  it('falls back to timezone, then language default region', () => {
    expect(guessCountry({ languages: ['en'], timeZone: 'Asia/Bangkok' })).toBe('TH');
    expect(guessCountry({ languages: ['ja'], timeZone: 'UTC' })).toBe('JP');
    expect(guessCountry({ languages: ['th'], timeZone: '' })).toBe('TH');
  });
  it('uses fallback when nothing works', () => {
    expect(guessCountry({ languages: ['x-bogus-'], timeZone: 'Mars/Base' })).toBe('TH');
    expect(guessCountry({})).toBe('TH');
  });
});

describe('createRouter', () => {
  function fakeEnv(hash = '') {
    const listeners = [];
    let current = hash;
    const env = {
      location: {},
      history: {
        // replaceState ของจริงไม่ยิง hashchange
        replaceState: (_, __, h) => {
          current = h;
        },
      },
      addEventListener: (type, fn) => type === 'hashchange' && listeners.push(fn),
    };
    // จำลองเบราว์เซอร์: ตั้ง hash แล้วยิง hashchange
    Object.defineProperty(env.location, 'hash', {
      get: () => current,
      set: (v) => {
        const changed = v !== current;
        current = v;
        if (changed) listeners.forEach((fn) => fn());
      },
    });
    return env;
  }

  it('starts with hash route', () => {
    const seen = [];
    const r = createRouter({ onRoute: (x) => seen.push(formatHash(x)), fallback: () => parseHash('#th') }, fakeEnv('#jp/2'));
    r.start();
    expect(seen).toEqual(['#jp/2']);
  });

  it('replaces invalid/empty hash with fallback', () => {
    const env = fakeEnv('#garbage');
    const seen = [];
    createRouter({ onRoute: (x) => seen.push(formatHash(x)), fallback: () => parseHash('#kr') }, env).start();
    expect(seen).toEqual(['#kr']);
    expect(env.location.hash).toBe('#kr');
  });

  it('navigate sets hash and routes via hashchange', () => {
    const seen = [];
    const env = fakeEnv('#th');
    const r = createRouter({ onRoute: (x) => seen.push(formatHash(x)), fallback: () => parseHash('#th') }, env);
    r.navigate(parseHash('#fav'));
    r.navigate(parseHash('#fav')); // ซ้ำ → route อีกรอบ (ไม่มี hashchange)
    expect(seen).toEqual(['#fav', '#fav']);
    expect(env.location.hash).toBe('#fav');
  });
});
