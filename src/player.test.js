import { describe, it, expect } from 'vitest';
import { resolvePlayback, isHlsStation, reasonForProxyStatus } from './player.js';
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

  it('blocks when no proxy (mixed), or http HLS that would need the proxy (unsupported)', () => {
    expect(resolvePlayback(st(), 'http://x.test/live', { protocol: 'https:', proxyBase: '' })).toEqual({ blocked: true, reason: 'mixed' });
    expect(resolvePlayback(st({ hls: 1 }), 'http://x.test/a.m3u8', { protocol: 'https:', proxyBase: '/stream/' })).toEqual({ blocked: true, reason: 'unsupported' });
  });

  it('always=true routes http streams through proxy even on http page (dev testing)', () => {
    const o = { protocol: 'http:', proxyBase: '/stream/', always: true };
    expect(resolvePlayback(st(), 'http://x.test/live', o)).toEqual({ url: '/stream/abc-123', viaProxy: true });
    expect(resolvePlayback(st(), 'https://x.test/live', o)).toEqual({ url: 'https://x.test/live', viaProxy: false });
    expect(resolvePlayback(st(), 'http://x.test/live', { ...o, proxyBase: '' })).toEqual({ url: 'http://x.test/live', viaProxy: false });
  });
});

describe('reasonForProxyStatus (docs/PROXY.md ข้อ 9)', () => {
  it('maps proxy status codes to user-facing reasons', () => {
    expect(reasonForProxyStatus(429)).toBe('busy');
    expect(reasonForProxyStatus(503)).toBe('busy');
    expect(reasonForProxyStatus(415)).toBe('unsupported');
    for (const s of [403, 404, 502, 504, 500]) expect(reasonForProxyStatus(s)).toBe('offline');
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
