import { describe, it, expect } from 'vitest';
import { pageItems } from './pager.js';

describe('pageItems', () => {
  it('single page', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 0)).toEqual([1]);
  });

  it('middle of many pages', () => {
    expect(pageItems(6, 120)).toEqual([1, '…', 4, 5, 6, 7, 8, '…', 120]);
  });

  it('near the start', () => {
    expect(pageItems(1, 120)).toEqual([1, 2, 3, '…', 120]);
    expect(pageItems(3, 120)).toEqual([1, 2, 3, 4, 5, '…', 120]);
  });

  it('fills a one-page gap with the number instead of …', () => {
    expect(pageItems(4, 120)).toEqual([1, 2, 3, 4, 5, 6, '…', 120]);
    expect(pageItems(117, 120)).toEqual([1, '…', 115, 116, 117, 118, 119, 120]);
  });

  it('near the end', () => {
    expect(pageItems(120, 120)).toEqual([1, '…', 118, 119, 120]);
  });

  it('few pages show all', () => {
    expect(pageItems(2, 4)).toEqual([1, 2, 3, 4]);
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('unknown total ends at current page', () => {
    expect(pageItems(5, null)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(8, null)).toEqual([1, '…', 6, 7, 8]);
  });
});
