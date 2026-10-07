import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidUuid, normalizeUuid } from '../src/uuid.js';

test('uuid ถูกรูปแบบ', () => {
  for (const u of ['c764e9db-1d62-47fb-bb10-bcf132702499', '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff']) {
    assert.equal(isValidUuid(u), true, u);
  }
});

test('ตัวพิมพ์ใหญ่ใช้ได้ และ normalize เป็นตัวเล็ก', () => {
  assert.equal(isValidUuid('C764E9DB-1D62-47FB-BB10-BCF132702499'), true);
  assert.equal(normalizeUuid('C764E9DB-1D62-47FB-BB10-BCF132702499'), 'c764e9db-1d62-47fb-bb10-bcf132702499');
});

test('รูปแบบผิด', () => {
  for (const u of [
    '', 'abc', 'c764e9db1d6247fbbb10bcf132702499', // ไม่มีขีด
    'c764e9db-1d62-47fb-bb10-bcf13270249', // สั้นไป 1 ตัว
    'c764e9db-1d62-47fb-bb10-bcf1327024999', // ยาวไป 1 ตัว
    'g764e9db-1d62-47fb-bb10-bcf132702499', // อักขระไม่ใช่ hex
    '{c764e9db-1d62-47fb-bb10-bcf132702499}',
    ' c764e9db-1d62-47fb-bb10-bcf132702499',
    'c764e9db-1d62-47fb-bb10-bcf132702499 ',
    'c764e9db-1d62-47fb-bb10-bcf132702499\n',
  ]) {
    assert.equal(isValidUuid(u), false, JSON.stringify(u));
    assert.equal(normalizeUuid(u), null);
  }
});

test('อักขระแปลก / path traversal / URL', () => {
  for (const u of [
    '../../etc/passwd',
    'c764e9db-1d62-47fb-bb10-bcf132702499/../x',
    '..%2F..%2Fetc%2Fpasswd',
    'c764e9db-1d62-47fb-bb10-bcf132702499%00',
    'c764e9db-1d62-47fb-bb10-bcf13270249\u0000',
    'http://127.0.0.1/',
    'c764e9db-1d62-47fb-bb10-bcf132702499?url=http://evil',
    'c764e9db-1d62-47fb-bb10-bcf132702499#x',
    'c764e9db‐1d62‐47fb‐bb10‐bcf132702499', // ขีดแบบ unicode
    'с764e9db-1d62-47fb-bb10-bcf132702499', // ตัว с ซีริลลิก
  ]) {
    assert.equal(isValidUuid(u), false, JSON.stringify(u));
  }
});

test('ค่าที่ไม่ใช่ string', () => {
  for (const u of [null, undefined, 123, {}, [], ['c764e9db-1d62-47fb-bb10-bcf132702499']]) assert.equal(isValidUuid(u), false);
});
