import { closeSync, existsSync, openSync, readdirSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { ITEM_IMAGE_IDS, itemImageUrl } from '../src/ui/icons';

// Gate for the committed WebP item icons (mirror of tests/skill_icons.test.ts). Art under
// public/ui/items/<id>.webp is the source of truth (WebP only), served by itemImageUrl for
// kind 'item' (bags, tooltips, loot, vendor, the /wiki guide). The guard is a bijection plus
// a scope check (wired ids are real, non-equipment items):
//   A) every id in ITEM_IMAGE_IDS resolves to a committed, VALID .webp;
//   B) only .webp art (+ mapping.json) is committed under public/ui/items;
//   C) every committed .webp is a WIRED item id;
//   D) every wired id is a real ITEMS entry whose kind is not armor/weapon (resource scope).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const itemsDir = path.join(publicDir, 'ui/items');

const isDotfile = (p: string): boolean => path.basename(p).startsWith('.');
const isMapping = (p: string): boolean => path.basename(p) === 'mapping.json';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

function isValidWebp(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(12);
    const n = readSync(fd, buf, 0, 12, 0);
    return (
      n === 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
    );
  } finally {
    closeSync(fd);
  }
}

const webpFiles = (): string[] =>
  walk(itemsDir).filter((p) => path.extname(p).toLowerCase() === '.webp');

describe('item webp icons', () => {
  it('has image-backed item ids wired (guards the fixture)', () => {
    expect(ITEM_IMAGE_IDS.size).toBeGreaterThan(0);
  });

  it('A) every image-backed item id resolves to a committed, valid .webp', () => {
    const broken: string[] = [];
    for (const id of ITEM_IMAGE_IDS) {
      const url = itemImageUrl(id);
      expect(url, `${id} must resolve to a webp url`).toMatch(/^\/ui\/items\/.+\.webp$/);
      const file = path.join(publicDir, (url as string).replace(/^\//, ''));
      if (!existsSync(file)) broken.push(`${id} -> ${url} (missing file)`);
      else if (!isValidWebp(file)) broken.push(`${id} -> ${url} (not a valid webp)`);
    }
    expect(broken).toEqual([]);
  });

  it('B) commits only webp art (+ mapping.json) under public/ui/items', () => {
    const stray = walk(itemsDir)
      .filter((p) => !isDotfile(p) && !isMapping(p) && path.extname(p).toLowerCase() !== '.webp')
      .map((p) => path.relative(repoRoot, p));
    expect(stray, 'run the item icon converter; only .webp + mapping.json may live here').toEqual(
      [],
    );
  });

  it('C) every committed webp is a wired item id', () => {
    const orphans: string[] = [];
    for (const file of webpFiles()) {
      const id = path.basename(file, '.webp');
      if (!ITEM_IMAGE_IDS.has(id))
        orphans.push(`${path.relative(repoRoot, file)} (not in ITEM_IMAGE_IDS)`);
    }
    expect(orphans, 'remove dead-weight art or wire the id into ITEM_IMAGE_IDS').toEqual([]);
  });

  it('D) every wired id is a real, non-equipment item', () => {
    const bad: string[] = [];
    for (const id of ITEM_IMAGE_IDS) {
      const def = (ITEMS as Record<string, { kind?: string }>)[id];
      if (!def) bad.push(`${id} (no such item)`);
      else if (def.kind === 'armor' || def.kind === 'weapon')
        bad.push(`${id} (equipment: ${def.kind})`);
    }
    expect(bad, 'ITEM_IMAGE_IDS is for real resource/consumable items only').toEqual([]);
  });
});
