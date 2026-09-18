import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

describe('HDR assets retain binary bytes across Git conversion policies', () => {
  it.each(['true', 'false', 'input'])('does not normalize HDR bytes with autocrlf=%s', (policy) => {
    // An RGBE image can contain no NUL bytes and still be binary. Preserve CR/LF
    // byte pairs in both its header and pixels instead of relying on detection.
    const bytes = Buffer.from('#?RADIANCE\r\nFORMAT=32-bit_rle_rgbe\r\n\r\n-Y 1 +X 1\r\n\r\nAB');
    const expected = createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex');
    const actual = execFileSync(
      'git',
      [
        '-c',
        `core.autocrlf=${policy}`,
        'hash-object',
        '--stdin',
        '--path=public/env/byte-preservation-fixture.hdr',
      ],
      { input: bytes, encoding: 'utf8' },
    ).trim();
    expect(actual).toBe(expected);
  });

  it.each(['evergarden_day_1k', 'evergarden_day_2k'])(
    'ships a fingerprint for the exact %s HDR bytes',
    (name) => {
      const logical = `env/${name}.hdr`;
      const bytes = readFileSync(new URL(`../public/${logical}`, import.meta.url));
      const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      expect(MEDIA_ASSETS[logical]).toBe(`/media/env/${name}.${digest}.hdr`);
    },
  );
});
