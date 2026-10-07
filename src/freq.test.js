import { describe, it, expect } from 'vitest';
import { parseFreq, formatFreq } from './freq.js';

describe('parseFreq', () => {
  it.each([
    ['FM 88 radio Thailand: English language service', 88],
    ['88.5 MHz. Voice of Navy', 88.5],
    ['Best Radio FM. 89.0 MHz.', 89],
    ['89.75 Radio Trip', 89.75],
    ['90 rakthai', 90],
    ['Talay 90.25 FM', 90.25],
    ['FM 91', 91],
    ['FM 103 MHz คนลูกทุ่ง', 103],
    ['MCOT Loei FM 100.00', 100],
    ['สถานีวิทยุกระจายเสียงแห่งประเทศไทย (FM 92.5 MHz)', 92.5],
    ['COOL Fahrenheit 93 FM', 93],
    ['Smooth 105.5 (RStream)', 105.5],
    ['FM99 Active', 99],
    ['88,6 Der Musiksender', 88.6],
    ['Radio 21 - 104,5', 104.5],
    ['106 Family News Radio', 106],
    ['Mcot Radio Buriram 92.0 FM', 92],
    ['94 Smile', 94],
    ['ลูกทุ่ง รักไทย ๙๐ FM', 90],
    ['คลื่น ๑๐๒.๕', 102.5],
  ])('%s → %s', (name, f) => {
    expect(parseFreq(name)).toBe(f);
  });

  it.each([
    'BKK.FM',
    'Top 100 Hits',
    'Radio 90s',
    '90s90s Hits',
    'AM 99 Talk',
    '100% Dance',
    'Absolute 80\'s',
    'สถานีวิทยุกระจายเสียงแห่งประเทศไทย (AM 891 KHz)',
    'วพท. am 792KHZ กรุงเทพฯ',
    'Radio 2000',
    'FM 120',
    '1000 Hits Classical',
    'Station 98.13',
    '',
    null,
  ])('%s → null', (name) => {
    expect(parseFreq(name)).toBeNull();
  });

  it('prefers number next to FM/MHz over other numbers', () => {
    expect(parseFreq('Radio 105 Live FM 89.5')).toBe(89.5);
  });
});

describe('formatFreq', () => {
  it('shows one decimal for whole numbers', () => {
    expect(formatFreq(93)).toBe('93.0');
    expect(formatFreq(90.25)).toBe('90.25');
    expect(formatFreq(null)).toBeNull();
  });
});
