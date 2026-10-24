import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEM_ART_PENDING, itemImageUrl } from '../src/ui/icons';

const batches = [
  { cls: 'warrior', specs: ['arms', 'fury', 'prot'] },
  { cls: 'paladin', specs: ['holy', 'protection', 'retribution'] },
  { cls: 'hunter', specs: ['beast_mastery', 'marksmanship', 'survival'] },
  { cls: 'rogue', specs: ['assassination', 'combat', 'subtlety'] },
  { cls: 'priest', specs: ['discipline', 'holy', 'shadow'] },
  { cls: 'shaman', specs: ['elemental', 'enhancement', 'restoration'] },
  { cls: 'mage', specs: ['arcane', 'fire', 'frost'] },
  { cls: 'warlock', specs: ['affliction', 'demonology', 'destruction'] },
  { cls: 'druid', specs: ['balance', 'feral', 'restoration'] },
];

describe.each(batches)('Season 2 $cls painted inventory art', ({ cls, specs }) => {
  const itemIds = specs.flatMap((spec) =>
    ['helmet', 'shoulder', 'chest', 'legs', 'gloves'].map(
      (slot) => `vanguard_${cls}_${spec}_${slot}`,
    ),
  );
  const batchPath = `docs/achievements/warfare-season2-${cls}-icons-2026-10-22/accepted-art.json`;

  it('serves all three complete sets as static art instead of procedural fallbacks', () => {
    expect(itemIds).toHaveLength(15);
    for (const id of itemIds) {
      expect(ITEM_ART_PENDING.has(id), id).toBe(false);
      expect(itemImageUrl(id), id).toBe(`/ui/items/${id}.webp`);
    }
  });

  it('pins each accepted painting to its shipping bytes and its own generation prompt', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(batchPath), 'utf8')) as {
      assets: Array<{
        id: string;
        runtimeUrl: string;
        acceptedSha256: string;
        acceptedBytes: number;
        generation: { prompt: string };
      }>;
    };
    expect(manifest.assets.map((asset) => asset.id).sort()).toEqual([...itemIds].sort());
    for (const asset of manifest.assets) {
      expect(asset.runtimeUrl).toBe(itemImageUrl(asset.id));
      const bytes = readFileSync(path.resolve(`public${asset.runtimeUrl}`));
      expect(bytes.length, asset.id).toBe(asset.acceptedBytes);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.id).toBe(asset.acceptedSha256);
      expect(asset.generation.prompt.length, asset.id).toBeGreaterThan(100);
    }
  });
});
