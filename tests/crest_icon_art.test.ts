import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { ALL_CLASSES } from '../src/sim/types';
import {
  classCrestId,
  crestIconUrl,
  FAMILY_CREST_ART_IDS,
  STATUS_CREST_ART_IDS,
} from '../src/ui/crest_icon_art';
import { iconDataUrl } from '../src/ui/icons';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const familyDir = path.join(repoRoot, 'public/ui/crests/families');
const statusDir = path.join(repoRoot, 'public/ui/crests/status');

const committedIds = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => !file.startsWith('.'))
        .map((file) => path.basename(file, path.extname(file)))
        .sort()
    : [];

describe('painted crest routing', () => {
  it('reuses every painted class emblem for its class crest identity', () => {
    for (const cls of ALL_CLASSES) {
      expect(classCrestId(cls)).toBe(`class_${cls}`);
      expect(crestIconUrl(classCrestId(cls))).toBe(`/ui/classes/${cls}.webp`);
      expect(iconDataUrl('crest', classCrestId(cls))).toBe(`/ui/classes/${cls}.webp`);
    }
  });

  it('routes the closed family and status sets to dedicated painted assets', () => {
    expect([...STATUS_CREST_ART_IDS].sort()).toEqual(['boss', 'combat', 'dead', 'npc']);
    for (const family of FAMILY_CREST_ART_IDS) {
      expect(crestIconUrl(`family_${family}`)).toBe(`/ui/crests/families/${family}.webp`);
      expect(iconDataUrl('crest', `family_${family}`)).toBe(`/ui/crests/families/${family}.webp`);
    }
    for (const status of STATUS_CREST_ART_IDS) {
      expect(crestIconUrl(`status_${status}`)).toBe(`/ui/crests/status/${status}.webp`);
      expect(iconDataUrl('crest', `status_${status}`)).toBe(`/ui/crests/status/${status}.webp`);
    }
  });

  it('covers every live mob family plus the dormant sheep fallback', () => {
    const live = [...new Set(Object.values(MOBS).map((mob) => mob.family))].sort();
    expect([...FAMILY_CREST_ART_IDS].sort()).toEqual([...live, 'sheep'].sort());
  });

  it('has an exact WebP-only filesystem bijection', () => {
    expect(committedIds(familyDir)).toEqual([...FAMILY_CREST_ART_IDS].sort());
    expect(committedIds(statusDir)).toEqual([...STATUS_CREST_ART_IDS].sort());
    for (const dir of [familyDir, statusDir]) {
      const foreign = existsSync(dir)
        ? readdirSync(dir).filter(
            (file) => !file.startsWith('.') && path.extname(file).toLowerCase() !== '.webp',
          )
        : [];
      expect(foreign).toEqual([]);
    }
  });

  it('ships centered-use opaque 256px paintings within budget and without duplicates', async () => {
    const hashes = new Set<string>();
    for (const [dir, ids] of [
      [familyDir, FAMILY_CREST_ART_IDS],
      [statusDir, STATUS_CREST_ART_IDS],
    ] as const) {
      for (const id of ids) {
        const file = path.join(dir, `${id}.webp`);
        const bytes = readFileSync(file);
        expect(bytes.length, `${id} byte budget`).toBeLessThanOrEqual(35 * 1024);
        const hash = createHash('sha256').update(bytes).digest('hex');
        expect(hashes.has(hash), `${id} must not duplicate another crest`).toBe(false);
        hashes.add(hash);

        const decoded = await sharp(bytes)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect([decoded.info.width, decoded.info.height], `${id} dimensions`).toEqual([256, 256]);
        for (let offset = 3; offset < decoded.data.length; offset += decoded.info.channels) {
          expect(decoded.data[offset], `${id} must remain opaque`).toBe(255);
        }
      }
    }
  });

  it('does not invent a path for unknown or malformed crest IDs', () => {
    expect(crestIconUrl('class_missing')).toBeNull();
    expect(crestIconUrl('family_missing')).toBeNull();
    expect(crestIconUrl('status_missing')).toBeNull();
    expect(crestIconUrl('warrior')).toBeNull();
    expect(crestIconUrl('')).toBeNull();
  });

  it('prefixes Fiesta class identities before resolving their crest art', () => {
    const hud = readFileSync(path.join(repoRoot, 'src/ui/hud.ts'), 'utf8');
    expect(hud).toContain("iconDataUrl('crest', classCrestId(playerClass))");
  });
});
