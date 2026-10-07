import { describe, it, expect } from 'vitest';
import { resolvePlayback, isHlsStation } from './player.js';
import { playableUrl } from './api.js';
import { formatCount } from './ui/stations.js';

const st = (o = {}) => ({ stationuuid: 'abc-123', url_resolved: 'http://x.test/live', hls: 0, ...o });

describe('resolvePlayback', () => {
  it('plays directly on http page or https stream', () => {
    expect(resolvePlayback(st(), 'http://x.test/live', { protocol: 'http:', proxyBase: '/stream/' })).toEqual({ url: 'http://x.test/live', viaProxy: false });
    expect(resolvePlayback(st(), 'https://x.test/live', { protocol: 'https:', proxyBase: '/stream/' })).toEqual({ url: 'https://x.test/live', viaProxy: false });
  });

  it('uses proxy for http stream on https page', () => {
    expect(resolvePlayback(st(), 'http://x.test/live', { protocol: 'https:', proxyBase: '/stream/' })).toEqual({ url: '/stream/abc-123', viaProxy: true });
  });

  it('blocks when no proxy, or http HLS on https', () => {
    expect(resolvePlayback(st(), 'http://x.test/live', { protocol: 'https:', proxyBase: '' })).toEqual({ blocked: true });
    expect(resolvePlayback(st({ hls: 1 }), 'http://x.test/a.m3u8', { protocol: 'https:', proxyBase: '/stream/' })).toEqual({ blocked: true });
  });
});

describe('isHlsStation', () => {
  it('detects by flag or .m3u8 extension', () => {
    expect(isHlsStation(st({ hls: 1 }))).toBe(true);
    expect(isHlsStation(st(), 'https://x.test/a/playlist.m3u8?token=1')).toBe(true);
    expect(isHlsStation(st(), 'https://x.test/stream.mp3')).toBe(false);
  });
});

describe('playableUrl', () => {
  it('uses click url unless it is a playlist file', () => {
    const s = st({ url_resolved: 'https://r.test/live' });
    expect(playableUrl('https://c.test/live', s)).toBe('https://c.test/live');
    expect(playableUrl('https://c.test/listen.pls', s)).toBe('https://r.test/live');
    expect(playableUrl('https://c.test/a.M3U?x=1', s)).toBe('https://r.test/live');
    expect(playableUrl('https://c.test/a.m3u8', s)).toBe('https://c.test/a.m3u8');
    expect(playableUrl('', s)).toBe('https://r.test/live');
  });
});

describe('formatCount', () => {
  it('formats like 12.3k', () => {
    expect(formatCount(950)).toBe('950');
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(12345)).toBe('12.3k');
    expect(formatCount(123456)).toBe('123k');
    expect(formatCount(999999)).toBe('1M');
    expect(formatCount(1234567)).toBe('1.2M');
  });
});
