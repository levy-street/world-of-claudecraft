import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEM_ART_PENDING, iconDataUrl, itemImageUrl } from '../src/ui/icons';

const hoardIds = (pieces: string[]) =>
  ['rare_', '', 'legendary_'].flatMap((prefix) => pieces.map((piece) => `${prefix}${piece}`));

// Accepted scope is explicit: a missing file or provenance row cannot shrink the test.
const batches = [
  {
    id: 'rewards-painted-icons-v045-2026-10-22',
    replacements: true,
    supersededBatch: 'faction-rewards-icons-2026-09-17',
    items: [
      'allied_hearthstone',
      'allied_vanguard_duffel',
      'rift_feather_glider',
      'formula_enchant_feet_shadowstride',
      'recipe_potion_of_invisibility',
      'potion_of_invisibility',
      'pattern_reinforced_armor_kit',
      'reinforced_armor_kit',
      'dawn_battle_standard',
      'formula_enchant_offhand_spirit',
      'recipe_elixir_of_mana_regeneration',
      'elixir_of_mana_regeneration',
      'clockwork_target_dummy',
      'schematic_clockwork_shock_bomb',
      'clockwork_shock_bomb',
      'plans_dense_sharpening_stone',
      'dense_sharpening_stone',
      'formula_enchant_gloves_forged_might',
    ],
  },
  {
    id: 'clue-painted-icons-v045-2026-10-22',
    replacements: true,
    supersededBatch: 'clue-scroll-icons-2026-09-17',
    items: ['clue_scroll', 'treasure_casket'],
  },
  {
    id: 'hoard-tide-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'chalice_of_living_tides',
      'pendant_continuous_flow',
      'coral_encrusted_girdle',
      'riptide_handwraps',
    ]),
  },
  {
    id: 'hoard-necro-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'bone_studded_pauldrons',
      'legguards_of_the_ossuary',
      'seal_of_the_cryptwalker',
      'ossuary_bone_crown',
    ]),
  },
  {
    id: 'hoard-venom-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'silkstalker_woven_vest',
      'spun_venom_spaulders',
      'broodmother_chitin_cowl',
      'venom_etched_waistcord',
    ]),
  },
  {
    id: 'hoard-brute-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'breastplate_tectonic_might',
      'band_mountains_weight',
      'monolithic_shoulderguards',
      'earthshaker_warboots',
    ]),
  },
  {
    id: 'hoard-storm-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'storm_tuned_buckler',
      'hauberk_tempest_gale',
      'gale_strider_boots',
      'tempest_strike_grips',
    ]),
  },
  {
    id: 'hoard-ember-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'ember_wrought_crown',
      'cinder_stitched_robes',
      'chained_ember_choker',
      'molten_clinker_girdle',
    ]),
  },
  {
    id: 'hoard-frost-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'glacier_hewn_bulwark',
      'permafrost_legguards',
      'frostbitten_rime_slippers',
      'rime_crusted_grips',
    ]),
  },
  {
    id: 'referral-reward-icons-v045-2026-10-22',
    replacements: false,
    items: [
      'reins_referral_raptor',
      'referral_satchel',
      'referral_hollow_charm',
      'referral_fog_charm',
      'reins_referral_tank',
    ],
  },
  {
    id: 'hoard-arcane-painted-icons-v045-2026-10-22',
    replacements: true,
    items: hoardIds([
      'collapsar_band_of_nyxaris',
      'orb_collapsing_void',
      'cowl_of_event_horizon',
      'mantle_of_singularity',
    ]),
  },
];

describe.each(batches)('integration 45 accepted art: $id', (batch) => {
  it('resolves every accepted identity to its own painting and sole current owner', () => {
    const recordPath = `docs/achievements/${batch.id}/accepted-art.json`;
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const mapping = JSON.parse(readFileSync('public/ui/items/mapping.json', 'utf8'));
    expect(record.assets.map((a: { id: string }) => a.id).sort()).toEqual([...batch.items].sort());
    const hashes = new Set<string>();
    for (const id of batch.items) {
      const url = `/ui/items/${id}.webp`;
      expect(itemImageUrl(id), id).toBe(url);
      expect(iconDataUrl('item', id), id).toBe(url);
      expect(ITEM_ART_PENDING.has(id), id).toBe(false);
      const asset = record.assets.find((a: { id: string }) => a.id === id);
      const bytes = readFileSync(`public${url}`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash, id).toBe(asset.acceptedSha256);
      expect(bytes.length, id).toBe(asset.acceptedBytes);
      expect(bytes.length, id).toBeLessThanOrEqual(15 * 1024);
      expect(asset.generation.prompt, id).toContain(id);
      hashes.add(hash);
      const owners = mapping.generatedBatches.filter((b: { itemIds?: string[] }) =>
        b.itemIds?.includes(id),
      );
      expect(owners, id).toHaveLength(1);
      expect(owners[0].batchId, id).toBe(batch.id);
      expect(owners[0].provenanceRecord, id).toBe(recordPath);
      if (batch.replacements) {
        expect(asset.superseded.batchId, id).toBe(
          batch.supersededBatch ?? 'hoard-boss-loot-icons-2026-09-20',
        );
        expect(asset.superseded.sha256, id).toMatch(/^[a-f0-9]{64}$/);
        expect(hash, id).not.toBe(asset.superseded.sha256);
      }
    }
    expect(hashes.size, 'each authored identity has a separate painting').toBe(batch.items.length);
  });
});
