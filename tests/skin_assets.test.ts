import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  validateSkinPng, isBlockedIpv4, isBlockedIpv6, isBlockedIp, asHttpUrl, MAX_SKIN_BYTES,
} from '../server/skin_assets';

// --- a self-contained valid-PNG builder (truecolor+alpha, non-interlaced) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf: Buffer, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type: string, data: Buffer): Buffer {
  const c = Buffer.alloc(12 + data.length);
  c.writeUInt32BE(data.length, 0);
  c.write(type, 4, 4, 'ascii');
  data.copy(c, 8);
  c.writeUInt32BE(crc32(c, 4, 8 + data.length), 8 + data.length);
  return c;
}
function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit truecolor+alpha
  const raw = Buffer.alloc((width * 4 + 1) * height); // zeroed scanlines (filter byte 0)
  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('validateSkinPng — atlas conformance', () => {
  it('accepts a conforming 1024² and 512² PNG and returns a content hash', () => {
    const r1 = validateSkinPng(makePng(1024, 1024));
    expect(r1.ok).toBe(true);
    if (r1.ok) { expect(r1.width).toBe(1024); expect(r1.sha256).toMatch(/^[0-9a-f]{64}$/); }
    expect(validateSkinPng(makePng(512, 512)).ok).toBe(true);
  });
  it('rejects a disallowed dimension', () => {
    expect(validateSkinPng(makePng(256, 256))).toEqual({ ok: false, reason: 'invalid_png' });
    expect(validateSkinPng(makePng(1024, 512))).toEqual({ ok: false, reason: 'invalid_png' });
  });
  it('rejects non-PNG bytes', () => {
    expect(validateSkinPng(Buffer.from('not a png at all'))).toEqual({ ok: false, reason: 'invalid_png' });
  });
  it('rejects an over-size buffer before parsing', () => {
    expect(validateSkinPng(Buffer.alloc(MAX_SKIN_BYTES + 1))).toEqual({ ok: false, reason: 'too_large' });
  });
  it('is deterministic: same bytes → same hash', () => {
    const png = makePng(512, 512);
    const a = validateSkinPng(png); const b = validateSkinPng(Buffer.from(png));
    expect(a.ok && b.ok && a.sha256 === b.sha256).toBe(true);
  });
});

describe('SSRF guard — block private/reserved hosts (creator-supplied URL safety)', () => {
  it('blocks IPv4 private/loopback/link-local/CGNAT/metadata ranges', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
      expect(isBlockedIpv4(ip)).toBe(true);
    }
  });
  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
      expect(isBlockedIpv4(ip)).toBe(false);
    }
  });
  it('blocks IPv6 loopback / ULA / link-local / IPv4-mapped-private', () => {
    expect(isBlockedIpv6('::1')).toBe(true);
    expect(isBlockedIpv6('::')).toBe(true);
    expect(isBlockedIpv6('fc00::1')).toBe(true);
    expect(isBlockedIpv6('fd12:3456::1')).toBe(true);
    expect(isBlockedIpv6('fe80::1')).toBe(true);
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true);
  });
  it('allows public IPv6', () => {
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false);
  });
  it('asHttpUrl accepts only http(s) absolute URLs', () => {
    expect(asHttpUrl('https://cdn.example.com/skin.png')?.protocol).toBe('https:');
    expect(asHttpUrl('http://example.com/x')?.protocol).toBe('http:');
    expect(asHttpUrl('ftp://example.com/x')).toBeNull();
    expect(asHttpUrl('file:///etc/passwd')).toBeNull();
    expect(asHttpUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(asHttpUrl('/relative/path')).toBeNull();
    expect(asHttpUrl('not a url')).toBeNull();
  });
});
