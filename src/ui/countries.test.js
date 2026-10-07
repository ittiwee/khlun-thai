import { describe, it, expect } from 'vitest';
import { localizeCountries, matchCountries, thaiName } from './countries.js';

const list = localizeCountries([
  { code: 'US', name: 'The United States Of America', stationcount: 7000 },
  { code: 'JP', name: 'Japan', stationcount: 224 },
  { code: 'TH', name: 'Thailand', stationcount: 135 },
  { code: 'NL', name: 'The Netherlands', stationcount: 900 },
]);
const codes = (q) => matchCountries(list, q).map((c) => c.code);

describe('country search', () => {
  it('finds Japan by English prefix, Thai name, and code', () => {
    expect(codes('jap')).toEqual(['JP']);
    expect(codes('ญี่ปุ่น')).toEqual(['JP']);
    expect(codes('jp')).toEqual(['JP']);
    expect(codes('JAPAN ')).toEqual(['JP']);
  });

  it('puts exact code match first', () => {
    expect(codes('th')[0]).toBe('TH');
  });

  it('matches Intl English name too', () => {
    expect(codes('united states')).toEqual(['US']);
  });

  it('empty query returns all', () => {
    expect(codes('')).toHaveLength(4);
  });

  it('thaiName falls back to API name', () => {
    expect(thaiName('JP')).toBe('ญี่ปุ่น');
    expect(thaiName('XX', 'Unknown')).toBe('Unknown');
  });
});
