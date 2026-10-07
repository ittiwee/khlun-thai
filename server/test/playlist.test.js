import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parsePls, parseM3u, parsePlaylist, readLimited, isPlaylist, isHls, looksLikeHls, PLAYLIST_MAX_BYTES } from '../src/playlist.js';

test('.pls ปกติ', () => {
  const pls = '[playlist]\nNumberOfEntries=1\nFile1=http://stream.example:8000/live\nTitle1=Test\nLength1=-1\nVersion=2\n';
  assert.equal(parsePls(pls), 'http://stream.example:8000/live');
  assert.equal(parsePlaylist(pls), 'http://stream.example:8000/live');
});

test('.pls หลาย File: เรียงตามเลข เอาตัวแรกที่เป็น http(s)', () => {
  const pls = '[playlist]\r\nFile3=http://c.example/\r\nFile2=https://b.example/live\r\nFile1=rtsp://a.example/x\r\nNumberOfEntries=3\r\n';
  assert.equal(parsePls(pls), 'https://b.example/live');
  assert.equal(parsePls('[Playlist]\nfile1 = http://x.example/a \n'), 'http://x.example/a');
});

test('.m3u ที่มีคอมเมนต์ #EXTINF', () => {
  const m3u = '﻿#EXTM3U\n#EXTINF:-1,Radio Test\n\n  http://stream.example/mount.mp3  \nhttp://backup.example/\n';
  assert.equal(parseM3u(m3u), 'http://stream.example/mount.mp3');
  assert.equal(parsePlaylist(m3u), 'http://stream.example/mount.mp3');
  assert.equal(parseM3u('#EXTM3U\r\nrelative/path.mp3\r\nftp://x.example/a\r\nhttps://ok.example/s\r\n'), 'https://ok.example/s');
});

test('ไฟล์ที่ไม่มี URL', () => {
  assert.equal(parsePlaylist('[playlist]\nNumberOfEntries=0\n'), null);
  assert.equal(parsePlaylist('#EXTM3U\n#EXTINF:-1,Nothing\n'), null);
  assert.equal(parsePlaylist(''), null);
  assert.equal(parsePlaylist('<html>not a playlist</html>'), null);
  assert.equal(parsePls('File1=javascript:alert(1)\nFile2=file:///etc/passwd'), null);
});

test('ไฟล์ใหญ่เกิน 64KB: อ่านแค่ 64KB แรกแล้วหยุด/ปิด stream', async () => {
  let pulled = 0;
  const chunk = Buffer.alloc(16 * 1024, 0x23); // '#' = คอมเมนต์
  const big = new Readable({
    read() {
      pulled++;
      if (pulled > 1000) this.push(null); // กันวนไม่จบ
      else this.push(chunk);
    },
  });
  const { text, truncated } = await readLimited(big);
  assert.equal(truncated, true);
  assert.equal(Buffer.byteLength(text), PLAYLIST_MAX_BYTES);
  assert.ok(pulled < 20, `อ่านไป ${pulled} chunk — ต้องหยุดใกล้ๆ 64KB`);
  assert.equal(big.destroyed, true);

  // URL ที่อยู่หลัง 64KB จะไม่ถูกอ่าน
  const late = Readable.from([Buffer.alloc(PLAYLIST_MAX_BYTES, 0x23), Buffer.from('\nhttp://late.example/\n')]);
  assert.equal(parsePlaylist((await readLimited(late)).text), null);
  // ไฟล์เล็กอ่านครบ
  const small = await readLimited(Readable.from([Buffer.from('File1=http://a.example/\n')]));
  assert.deepEqual(small, { text: 'File1=http://a.example/\n', truncated: false });
});

test('ตรวจชนิด: playlist / HLS', () => {
  assert.equal(isPlaylist({ url: 'http://x.example/listen.pls' }), true);
  assert.equal(isPlaylist({ url: 'http://x.example/listen.M3U?x=1' }), true);
  assert.equal(isPlaylist({ url: 'http://x.example/a', contentType: 'audio/x-scpls; charset=utf-8' }), true);
  assert.equal(isPlaylist({ url: 'http://x.example/a', contentType: 'audio/mpegurl' }), true);
  assert.equal(isPlaylist({ url: 'http://x.example/live.mp3', contentType: 'audio/mpeg' }), false);
  assert.equal(isPlaylist({ url: 'http://x.example/a.m3u8' }), false);

  assert.equal(isHls({ url: 'http://x.example/a/playlist.m3u8?t=1' }), true);
  assert.equal(isHls({ contentType: 'application/vnd.apple.mpegurl' }), true);
  assert.equal(isHls({ contentType: 'application/x-mpegURL' }), true);
  assert.equal(isHls({ url: 'http://x.example/live', hls: true }), true);
  assert.equal(isHls({ url: 'http://x.example/live.m3u', contentType: 'audio/x-mpegurl' }), false);
  assert.equal(looksLikeHls('#EXTM3U\n#EXT-X-TARGETDURATION:10\nseg1.ts\n'), true);
  assert.equal(looksLikeHls('#EXTM3U\n#EXTINF:-1,Radio\nhttp://a.example/\n'), false);
});
