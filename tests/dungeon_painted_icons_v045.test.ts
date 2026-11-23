import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iconDataUrl, itemImageUrl, weaponIconUrl } from '../src/ui/icons';

const batches = [
  {
    family: 'crypt-blues',
    ids: [
      'spadeworn_gauntlets',
      'heroic_spadeworn_gauntlets',
      'gravedirt_grips',
      'heroic_gravedirt_grips',
      'bellrope_mitts',
      'heroic_bellrope_mitts',
      'rimewreath_coif',
      'heroic_rimewreath_coif',
      'rime_laced_hood',
      'heroic_rime_laced_hood',
      'lamenting_veil',
      'heroic_lamenting_veil',
      'choirward_pauldrons',
      'heroic_choirward_pauldrons',
      'choristers_spaulders',
      'heroic_choristers_spaulders',
      'cantors_stole',
      'heroic_cantors_stole',
      'knellbound_hauberk',
      'heroic_knellbound_hauberk',
      'candlewatch_jerkin',
      'heroic_candlewatch_jerkin',
      'robe_of_the_unquiet_rite',
      'heroic_robe_of_the_unquiet_rite',
      'gravecallers_rod',
    ],
    weapons: ['gravecallers_rod'],
    supersededBatch: 'lower-dungeon-blues-icons-2026-10-08',
  },
  {
    family: 'temple-blues',
    ids: [
      'conchplate_sabatons',
      'heroic_conchplate_sabatons',
      'pale_chorus_slippers',
      'heroic_pale_chorus_slippers',
      'tideglass_gauntlets',
      'heroic_tideglass_gauntlets',
      'moonburn_grips',
      'heroic_moonburn_grips',
      'prism_etched_handwraps',
      'heroic_prism_etched_handwraps',
      'mere_crested_helm',
      'heroic_mere_crested_helm',
      'mereskin_hood',
      'heroic_mereskin_hood',
      'merewater_cowl',
      'heroic_merewater_cowl',
      'merecleaver',
      'moonwrack_stave',
    ],
    weapons: ['merecleaver', 'moonwrack_stave'],
    supersededBatch: 'lower-dungeon-blues-icons-2026-10-08',
  },
  {
    family: 'bastion-blues',
    ids: [
      'portcullis_girdle',
      'heroic_portcullis_girdle',
      'cellwatch_belt',
      'heroic_cellwatch_belt',
      'lanternwick_sash',
      'heroic_lanternwick_sash',
      'turnkeys_shank',
      'gaolyard_jerkin',
      'heroic_gaolyard_jerkin',
      'brinewarden_robe',
      'heroic_brinewarden_robe',
      'fogbinders_rod',
    ],
    weapons: ['turnkeys_shank', 'fogbinders_rod'],
    supersededBatch: 'lower-dungeon-blues-icons-2026-10-08',
  },
  {
    family: 'crypt',
    ids: [
      'gravedirt_treads',
      'bellrope_girdle',
      'sextons_spadehaft',
      'rimesilk_mantle',
      'bonechill_carapace_vest',
      'rimeweb_hunters_leggings',
      'rimeweb_fang',
      'cantors_cassock',
      'choirward_leggings',
      'choristers_gloves',
      'cantors_hymnal',
      'heroic_cantors_hymnal',
      'gravecallers_vestments',
      'unquiet_stalkers_hood',
      'sextons_burial_spade',
      'rimesilk_hood',
    ],
    weapons: ['sextons_spadehaft', 'rimeweb_fang', 'sextons_burial_spade'],
    supersededBatch: 'hollow-crypt-icons-2026-10-03',
  },
  {
    family: 'gravewyrm',
    ids: [
      'foremans_grips',
      'serac_stride_boots',
      'seal_rune_mantle',
      'thawbound_legguards',
      'pyre_tenders_hood',
      'meltwater_cord',
      'hammer_of_the_open_lock',
      'vestments_of_the_waking_rite',
      'foremans_last_link',
      'phial_of_the_tithe',
      'quenchwater_flask',
    ],
    weapons: ['hammer_of_the_open_lock'],
    supersededBatch: 'gravewyrm-sanctum-icons-2026-10-03',
  },
  {
    family: 'wildheart',
    ids: [
      'beastpit_warbelt',
      'jaguar_hide_jerkin',
      'hexbone_handwraps',
      'rootbound_sabatons',
      'pollen_dusted_leggings',
      'bloomsilk_cowl',
      'falls_blessed_staff',
      'fanglords_hide_mantle',
      'thornroot_greathelm',
      'fanglords_whistle',
      'gorgebloom_seedpod',
    ],
    weapons: ['falls_blessed_staff'],
    supersededBatch: 'wildheart-basin-icons-2026-10-02',
  },
  {
    family: 'temple',
    ids: [
      'conchplate_girdle',
      'pale_chorus_leggings',
      'refrain_silk_gloves',
      'chorus_conch',
      'heroic_chorus_conch',
      'tideglass_pauldrons',
      'moonburn_treads',
      'prism_etched_cowl',
      'tideglass_shiv',
      'pale_chorus_vestment',
      'tideglass_warmaul',
    ],
    weapons: ['tideglass_shiv', 'tideglass_warmaul'],
    supersededBatch: 'drowned-temple-icons-2026-09-30',
  },
  {
    family: 'bastion',
    ids: [
      'knight_commanders_longsword',
      'gaolers_chain_girdle',
      'rusted_shackle_grips',
      'drowned_wardens_mantle',
      'gaolyard_cudgel',
      'drowned_commanders_breastplate',
      'gaolyard_striders',
      'gaolers_iron_key',
      'jailers_iron_gauntlets',
      'turnkeys_keyring_belt',
      'turnkeys_lantern_cowl',
    ],
    weapons: ['knight_commanders_longsword', 'gaolyard_cudgel'],
    supersededBatch: 'sunken-bastion-icons-2026-09-29',
  },
];

describe.each(batches)('integration 45 dungeon paintings: $family', (batch) => {
  it('ships each literal identity through its correct route with one current owner', () => {
    const batchId = `dungeon-${batch.family}-painted-icons-v045-2026-10-22`;
    const recordPath = `docs/achievements/${batchId}/accepted-art.json`;
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const mapping = JSON.parse(readFileSync('public/ui/items/mapping.json', 'utf8'));
    const ids = batch.ids;
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
      expect(asset.superseded.batchId, id).toBe(batch.supersededBatch);
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
