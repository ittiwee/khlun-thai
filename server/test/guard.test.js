import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIP, isBlockedIPv4, isBlockedIPv6, expandIPv6, checkUrl, guardUrl, pinnedLookup, GuardError } from '../src/guard.js';

// resolver ปลอม: hostname → รายการ IP (ไม่แตะ DNS จริง)
const fakeResolve = (table) => async (host) => {
  if (!(host in table)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return table[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

const rejectsWith = async (promise, reason) => {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof GuardError, `expected GuardError, got ${err}`);
    assert.equal(err.reason, reason);
    return true;
  });
};

describe('IPv4: ทุกช่วงที่ต้องปฏิเสธ (ขอบล่าง กลาง ขอบบน)', () => {
  const ranges = {
    '0.0.0.0/8': ['0.0.0.0', '0.1.2.3', '0.255.255.255'],
    '10.0.0.0/8': ['10.0.0.0', '10.20.30.40', '10.255.255.255'],
    '100.64.0.0/10': ['100.64.0.0', '100.100.100.100', '100.127.255.255'],
    '127.0.0.0/8': ['127.0.0.1', '127.1.2.3', '127.255.255.255'],
    '169.254.0.0/16': ['169.254.0.0', '169.254.169.254', '169.254.255.255'],
    '172.16.0.0/12': ['172.16.0.0', '172.20.1.1', '172.31.255.255'],
    '192.0.0.0/24': ['192.0.0.0', '192.0.0.170', '192.0.0.255'],
    '192.168.0.0/16': ['192.168.0.0', '192.168.1.1', '192.168.255.255'],
    '198.18.0.0/15': ['198.18.0.0', '198.19.12.34', '198.19.255.255'],
    '224.0.0.0/4': ['224.0.0.0', '239.255.255.250', '239.255.255.255'],
    '240.0.0.0/4': ['240.0.0.0', '250.1.2.3', '255.255.255.255'],
  };
  for (const [range, ips] of Object.entries(ranges)) {
    test(range, () => {
      for (const ip of ips) assert.equal(isBlockedIPv4(ip), true, ip);
    });
  }
});

describe('IPv4: ที่อยู่สาธารณะต้องผ่าน รวมถึงตัวที่ติดขอบช่วงต้องห้าม', () => {
  test('ผ่าน', () => {
    for (const ip of [
      '8.8.8.8', '1.1.1.1', '203.0.113.5', '9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0',
      '126.255.255.255', '128.0.0.0', '169.253.255.255', '169.255.0.0', '172.15.255.255', '172.32.0.0',
      '192.0.1.0', '192.167.255.255', '192.169.0.0', '198.17.255.255', '198.20.0.0', '223.255.255.255',
    ]) {
      assert.equal(isBlockedIPv4(ip), false, ip);
    }
  });
  test('รูปแบบผิดถือว่าห้าม', () => {
    for (const ip of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-1', 'a.b.c.d', '01.2.3.4x']) assert.equal(isBlockedIPv4(ip), true, ip);
  });
});

describe('IPv6', () => {
  test('ช่วงต้องห้ามตามแผน', () => {
    for (const ip of [
      '::', '::1', '0:0:0:0:0:0:0:1',
      'fc00::', 'fd12:3456:789a::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', // fc00::/7
      'fe80::', 'fe80::1%eth0', 'febf:ffff::1', // fe80::/10
      'ff00::', 'ff02::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', // ff00::/8
    ]) {
      assert.equal(isBlockedIPv6(ip), true, ip);
    }
  });
  test('ที่อยู่สาธารณะต้องผ่าน', () => {
    for (const ip of ['2001:4860::8888', '2001:4860:4860::8888', '2606:4700:4700::1111', '2a00:1450:4001::200e', 'fbff::1', 'fec0::1', 'feff::1']) {
      assert.equal(isBlockedIPv6(ip), false, ip);
    }
  });
  test('IPv4-mapped แปลงเป็น IPv4 แล้วตรวจตามกฎ IPv4', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:10.0.0.1', '::ffff:192.168.1.1', '0:0:0:0:0:ffff:a9fe:a9fe', '::ffff:0.0.0.0']) {
      assert.equal(isBlockedIPv6(ip), true, ip);
    }
    for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808']) assert.equal(isBlockedIPv6(ip), false, ip);
  });
  test('เข้มกว่าแผน: IPv4-compatible (::/96) และ NAT64 ที่ฝัง IP ภายใน', () => {
    assert.equal(isBlockedIPv6('::127.0.0.1'), true);
    assert.equal(isBlockedIPv6('::8.8.8.8'), true);
    assert.equal(isBlockedIPv6('64:ff9b::10.0.0.1'), true);
    assert.equal(isBlockedIPv6('64:ff9b::8.8.8.8'), false);
  });
  test('รูปแบบผิดถือว่าห้าม', () => {
    for (const ip of ['1::2::3', '1:2:3:4:5:6:7:8:9', '12345::', 'g::1', ':::', '1:2:3:4:5:6:7']) assert.equal(isBlockedIPv6(ip), true, ip);
  });
  test('expandIPv6', () => {
    assert.deepEqual(expandIPv6('2001:db8::1'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(expandIPv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    assert.equal(expandIPv6('1::2::3'), null);
  });
  test('isBlockedIP รับทั้งสองแบบ และค่าที่ไม่ใช่ IP ถือว่าห้าม', () => {
    assert.equal(isBlockedIP('8.8.8.8'), false);
    assert.equal(isBlockedIP('[::1]'), true);
    assert.equal(isBlockedIP('example.com'), true);
    assert.equal(isBlockedIP(''), true);
  });
});

describe('checkUrl: scheme / port / credentials', () => {
  test('scheme อื่นนอกจาก http/https ถูกปฏิเสธ', () => {
    for (const u of ['ftp://example.com/a', 'file:///etc/passwd', 'gopher://example.com:70/', 'data:audio/mp3,xx', 'javascript:alert(1)', 'ws://example.com/', 'not a url']) {
      assert.throws(() => checkUrl(u), (e) => e instanceof GuardError && e.reason === 'scheme', u);
    }
  });
  test('port ที่อนุญาต: 80, 443, 1024–65535', () => {
    for (const u of ['http://example.com/', 'https://example.com/', 'http://example.com:80/', 'http://example.com:443/', 'http://example.com:1024/', 'http://example.com:8000/', 'https://example.com:65535/']) {
      assert.doesNotThrow(() => checkUrl(u), u);
    }
  });
  test('port ต้องห้าม', () => {
    for (const u of ['http://example.com:22/', 'http://example.com:25/', 'http://example.com:1/', 'http://example.com:81/', 'http://example.com:1023/', 'https://example.com:6/']) {
      assert.throws(() => checkUrl(u), (e) => e instanceof GuardError && e.reason === 'port', u);
    }
  });
  test('URL ที่มี user:pass ถูกปฏิเสธ', () => {
    for (const u of ['http://user:pass@example.com/', 'http://user@example.com/', 'http://:pass@example.com/']) {
      assert.throws(() => checkUrl(u), (e) => e instanceof GuardError && e.reason === 'credentials', u);
    }
  });
  test('host เป็น IP ตรงๆ ใช้กฎเดียวกัน รวมรูปแบบแปลกที่ URL parser แปลงให้', () => {
    for (const u of [
      'http://127.0.0.1/', 'http://10.1.2.3:8000/', 'http://[::1]:8000/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/',
      'http://0x7f.0.0.1/', 'http://2130706433/', 'http://0177.0.0.1/', 'http://127.1/', 'http://0/', 'http://169.254.169.254/latest/meta-data/',
    ]) {
      assert.throws(() => checkUrl(u), (e) => e instanceof GuardError && e.reason === 'blocked_ip', u);
    }
    assert.equal(checkUrl('http://8.8.8.8:8000/live').ipLiteral, true);
    assert.equal(checkUrl('http://[2001:4860::8888]/').hostname, '2001:4860::8888');
  });
});

describe('guardUrl: ตรวจ IP หลัง resolve DNS', () => {
  const resolve = fakeResolve({
    'radio.example': ['93.184.216.34'],
    'dual.example': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
    'mixed.example': ['93.184.216.34', '10.0.0.5'], // มีตัวเดียวเป็น private → ต้องปฏิเสธ
    'mixed6.example': ['2606:4700::1', 'fd00::5'],
    'mapped.example': ['::ffff:127.0.0.1'],
    'localhost': ['127.0.0.1', '::1'],
    'empty.example': [],
  });

  test('host สาธารณะผ่าน และคืน IP ที่ใช้เชื่อมต่อ', async () => {
    const r = await guardUrl('http://radio.example:8000/stream', { resolve });
    assert.equal(r.address, '93.184.216.34');
    assert.equal(r.family, 4);
    assert.equal(r.hostname, 'radio.example');
    assert.equal(r.port, 8000);
    const d = await guardUrl('https://dual.example/', { resolve });
    assert.equal(d.address, '93.184.216.34');
  });

  test('resolve ได้หลาย IP โดยมีตัวเดียวเป็น private ต้องปฏิเสธ', async () => {
    await rejectsWith(guardUrl('http://mixed.example/', { resolve }), 'blocked_ip');
    await rejectsWith(guardUrl('http://mixed6.example/', { resolve }), 'blocked_ip');
  });

  test('ชื่อที่ resolve เป็น loopback / mapped ถูกปฏิเสธ', async () => {
    await rejectsWith(guardUrl('http://localhost:8000/', { resolve }), 'blocked_ip');
    await rejectsWith(guardUrl('http://mapped.example/', { resolve }), 'blocked_ip');
  });

  test('resolve ไม่ได้ หรือได้รายการว่าง → dns (502)', async () => {
    await rejectsWith(guardUrl('http://nope.example/', { resolve }), 'dns');
    await rejectsWith(guardUrl('http://empty.example/', { resolve }), 'dns');
    const err = await guardUrl('http://nope.example/', { resolve }).catch((e) => e);
    assert.equal(err.statusCode, 502);
  });

  test('IP ตรงๆ ไม่เรียก resolver', async () => {
    let called = false;
    const r = await guardUrl('http://8.8.8.8:8000/', {
      resolve: async () => {
        called = true;
        return [];
      },
    });
    assert.equal(called, false);
    assert.equal(r.address, '8.8.8.8');
    await rejectsWith(guardUrl('http://192.168.1.10/', { resolve }), 'blocked_ip');
  });

  test('ตรวจ scheme/port/credentials ก่อน resolve', async () => {
    await rejectsWith(guardUrl('http://radio.example:22/', { resolve }), 'port');
    await rejectsWith(guardUrl('ftp://radio.example/', { resolve }), 'scheme');
    await rejectsWith(guardUrl('http://a:b@radio.example/', { resolve }), 'credentials');
  });

  test('statusCode ของการละเมิดนโยบายคือ 403', async () => {
    const err = await guardUrl('http://127.0.0.1/', { resolve }).catch((e) => e);
    assert.equal(err.statusCode, 403);
  });
});

describe('pinnedLookup: กัน DNS rebinding', () => {
  test('คืน IP ที่ตรวจแล้วเสมอ ไม่ว่าจะถามชื่ออะไร', async () => {
    const lookup = pinnedLookup('93.184.216.34', 4);
    const single = await new Promise((r) => lookup('evil.example', {}, (err, address, family) => r({ err, address, family })));
    assert.deepEqual(single, { err: null, address: '93.184.216.34', family: 4 });
    const all = await new Promise((r) => lookup('evil.example', { all: true }, (err, list) => r(list)));
    assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
    const noOpts = await new Promise((r) => lookup('evil.example', (err, address) => r(address)));
    assert.equal(noOpts, '93.184.216.34');
  });
});
