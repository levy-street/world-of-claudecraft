// The party ping icons' painted art (public/ui/pings/, wired by
// src/ui/ping_icons.ts): exactly one keyed 128 px WebP per ping kind, each with
// a real alpha matte (no circle or plate behind it), and nothing else in the
// folder but its provenance.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PING_KIND_COUNT } from '../src/sim/social/party_pings';
import { pingIconArtUrl } from '../src/ui/ping_icons';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'public/ui/pings');

describe('party ping icon art', () => {
  const urls = Array.from({ length: PING_KIND_COUNT }, (_, kind) => pingIconArtUrl(kind));

  it('gives every ping kind its own file, and the folder holds only those', () => {
    expect(new Set(urls).size).toBe(PING_KIND_COUNT);
    const files = urls.map((url) => url.replace('/ui/pings/', ''));
    expect(readdirSync(DIR).sort()).toEqual([...files, 'mapping.json'].sort());
  });

  it('ships each as a 128 px square WebP with a keyed alpha matte', async () => {
    for (const url of urls) {
      const file = join(DIR, url.replace('/ui/pings/', ''));
      const meta = await sharp(file).metadata();
      expect(meta.format, url).toBe('webp');
      expect([meta.width, meta.height], url).toEqual([128, 128]);
      expect(meta.hasAlpha, url).toBe(true);
      // The corners are background: keyed fully transparent, not a plate.
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({
        resolveWithObject: true,
      });
      const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
      expect([alphaAt(0, 0), alphaAt(127, 0), alphaAt(0, 127), alphaAt(127, 127)], url).toEqual([
        0, 0, 0, 0,
      ]);
    }
  });

  it('records each icon in the folder provenance', () => {
    const mapping = JSON.parse(readFileSync(join(DIR, 'mapping.json'), 'utf8'));
    for (const url of urls) {
      const name = url.replace('/ui/pings/', '').replace('.webp', '');
      expect(mapping.icons[name], name).toBeTruthy();
    }
  });
});
