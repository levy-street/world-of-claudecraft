import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { SPEC_ART_IDS, specIconUrl } from '../src/ui/spec_icon_art';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specsDir = path.join(repoRoot, 'public/ui/specs');

function committedFiles(): string[] {
  if (!existsSync(specsDir)) return [];
  const files: string[] = [];
  for (const classEntry of readdirSync(specsDir, { withFileTypes: true })) {
    if (classEntry.name.startsWith('.')) continue;
    if (!classEntry.isDirectory()) {
      files.push(classEntry.name);
      continue;
    }
    for (const file of readdirSync(path.join(specsDir, classEntry.name))) {
      if (!file.startsWith('.')) files.push(`${classEntry.name}/${file}`);
    }
  }
  return files.sort();
}

describe('specialization emblem art', () => {
  const liveIds = Object.values(TALENTS)
    .flatMap((talents) => talents.specs.map((spec) => `${spec.class}/${spec.id}`))
    .sort();

  it('is an exact registry, catalog, and filesystem bijection', () => {
    expect([...SPEC_ART_IDS].sort()).toEqual(liveIds);
    expect(committedFiles()).toEqual(liveIds.map((id) => `${id}.webp`));
  });

  it('resolves every live spec and rejects synthetic identities', () => {
    for (const talents of Object.values(TALENTS)) {
      for (const spec of talents.specs) {
        expect(specIconUrl(spec)).toBe(`/ui/specs/${spec.class}/${spec.id}.webp`);
      }
    }
    expect(specIconUrl({ class: 'rogue', id: 'missing' })).toBeNull();
  });

  it('ships distinct opaque 128px WebPs within the item-icon budget', async () => {
    const hashes = new Set<string>();
    for (const id of SPEC_ART_IDS) {
      const file = path.join(specsDir, `${id}.webp`);
      const bytes = readFileSync(file);
      expect(bytes.length, `${id} byte budget`).toBeLessThanOrEqual(15 * 1024);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hashes.has(hash), `${id} must not duplicate another spec`).toBe(false);
      hashes.add(hash);

      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([decoded.info.width, decoded.info.height], `${id} dimensions`).toEqual([128, 128]);
      for (let offset = 3; offset < decoded.data.length; offset += decoded.info.channels) {
        expect(decoded.data[offset], `${id} must remain opaque`).toBe(255);
      }
    }
  });
});
