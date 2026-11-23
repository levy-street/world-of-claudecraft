import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iconDataUrl, itemImageUrl, weaponIconUrl } from '../src/ui/icons';

const batches = [
  {
    family: 'automaton',
    vendor: [
      'automaton_cog_ring',
      'clockwork_tinkers_pack',
      'artificers_welding_cowl',
      'forgemaster_crag_cleaver',
      'champion_forged_loop',
    ],
    ladder: [
      'cogwork_choker',
      'forgemasters_girdle',
      'forgemasters_sabatons',
      'formula_piston_drive',
      'forgewall_gorget',
    ],
    weapons: ['forgemaster_crag_cleaver'],
  },
  {
    family: 'church',
    vendor: [
      'order_prayer_beads',
      'vestments_of_the_acolyte',
      'templar_dawn_shield',
      'dawnkeeper_consecrated_mace',
      'champion_dawn_medallion',
    ],
    ladder: [
      'acolytes_signet',
      'cord_of_the_dawn',
      'dawnlit_slippers',
      'formula_dawnfire_etching',
      'formula_dawns_benediction',
      'champions_dawn_loop',
      'dawnkeepers_circle',
    ],
    weapons: ['dawnkeeper_consecrated_mace'],
  },
  {
    family: 'rift',
    vendor: [
      'rift_watchers_band',
      'rift_surveyors_satchel',
      'riftwalkers_tunic',
      'riftwarden_voidblade',
      'champion_rift_band',
    ],
    ladder: [
      'tidewatchers_locket',
      'riftwalkers_cord',
      'riftwalkers_treads',
      'formula_riftwalkers_grace',
      'riftwardens_pendant',
    ],
    weapons: ['riftwarden_voidblade'],
  },
];

describe.each(batches)('integration 45 faction paintings: $family', (batch) => {
  it('ships each literal identity through its correct route with one current owner', () => {
    const batchId = `faction-${batch.family}-painted-icons-v045-2026-10-22`;
    const recordPath = `docs/achievements/${batchId}/accepted-art.json`;
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const mapping = JSON.parse(readFileSync('public/ui/items/mapping.json', 'utf8'));
    const ids = [...batch.vendor, ...batch.ladder];
    expect(record.assets.map((a: { id: string }) => a.id).sort()).toEqual([...ids].sort());
    const hashes = new Set<string>();
    for (const id of ids) {
      const url = `/ui/items/${id}.webp`;
      expect(batch.weapons.includes(id) ? weaponIconUrl(id) : itemImageUrl(id), id).toBe(url);
      expect(iconDataUrl('item', id), id).toBe(url);
      const asset = record.assets.find((a: { id: string }) => a.id === id);
      const bytes = readFileSync(`public${url}`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash, id).toBe(asset.acceptedSha256);
      expect(bytes.length, id).toBe(asset.acceptedBytes);
      expect(bytes.length, id).toBeLessThanOrEqual(15 * 1024);
      expect(asset.generation.prompt, id).toContain(id);
      expect(asset.superseded.batchId, id).toBe(
        batch.vendor.includes(id)
          ? 'faction-vendor-icons-2026-09-16'
          : 'faction-ladder-icons-2026-09-23',
      );
      expect(asset.superseded.sha256, id).toMatch(/^[a-f0-9]{64}$/);
      expect(hash, id).not.toBe(asset.superseded.sha256);
      const owners = mapping.generatedBatches.filter((b: { itemIds?: string[] }) =>
        b.itemIds?.includes(id),
      );
      expect(owners, id).toHaveLength(1);
      expect(owners[0].batchId, id).toBe(batchId);
      expect(owners[0].provenanceRecord, id).toBe(recordPath);
      hashes.add(hash);
    }
    expect(hashes.size, 'each authored item has its own painting').toBe(ids.length);
  });
});
