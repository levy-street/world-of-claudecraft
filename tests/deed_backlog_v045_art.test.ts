import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import { deedCrestId } from '../src/ui/deeds_view';
import { DEED_ART_PENDING, deedImageUrl, iconDataUrl } from '../src/ui/icons';

const batches = [
  {
    id: 'deed-gravewyrm-icons-v045-2026-10-22',
    deeds: [
      'dgn_korgath_all_chains',
      'dgn_korgath_still_bound',
      'dgn_velkhar_cold',
      'dgn_korzul_thin_ice',
      'dgn_sledge_tusker',
    ],
  },
  {
    id: 'deed-wildheart-icons-v045-2026-10-22',
    deeds: [
      'dgn_beastmaster_apart',
      'dgn_gorgebloom_clean',
      'dgn_zulgar_uncaught',
      'dgn_great_saurian',
    ],
  },
  {
    id: 'deed-crypt-icons-v045-2026-10-22',
    deeds: [
      'dgn_crypt_knellwyrm',
      'dgn_marrow_tidy',
      'dgn_lady_nobody_hanging',
      'dgn_ilvane_hush',
      'dgn_morthen_candlelight',
    ],
  },
  {
    id: 'deed-temple-icons-v045-2026-10-22',
    deeds: [
      'dgn_selthe_pitch',
      'dgn_colossus_mirror',
      'dgn_ysolei_high_and_dry',
      'dgn_mere_hydra',
      'dgn_drowned_temple_cantor',
    ],
  },
  {
    id: 'deed-bastion-icons-v045-2026-10-22',
    deeds: [
      'dgn_olen_buttress',
      'dgn_ossick_moored',
      'dgn_vael_beacon',
      'dgn_turretback',
      'dgn_turnkey_cage',
    ],
  },
  {
    id: 'deed-adventures-icons-v045-2026-10-22',
    deeds: [
      'exp_clue_first_casket',
      'exp_clue_ten_caskets',
      'cmb_coinsack_caught',
      'exp_harbor_to_harbor',
      'cmb_balgath',
      'cmb_balgath_ten',
      'cmb_point_taken',
    ],
  },
  {
    id: 'deed-factions-icons-v045-2026-10-22',
    deeds: [
      'prog_rift_watch_trusted',
      'prog_church_order_trusted',
      'prog_automatons_trusted',
      'prog_rift_watch_champion',
      'prog_church_order_champion',
      'prog_automatons_champion',
      'prog_faction_champion_all',
    ],
  },
  {
    id: 'deed-worldquests-icons-v045-2026-10-22',
    deeds: [
      'exp_arcane_calligraphy',
      'exp_arcane_calligraphy_gold',
      'exp_forge_helper',
      'exp_last_barricade',
      'exp_borrowed_face',
      'exp_windrider_slalom',
      'exp_duskweave_dispatches',
      'exp_wisp_maze',
    ],
  },
  {
    id: 'deed-crucible-icons-v045-2026-10-22',
    deeds: [
      'dgn_ignivar',
      'dgn_ignivar_heroic',
      'dgn_varkhul',
      'dgn_varkhul_heroic',
      'dgn_varkhul_flawless',
      'hid_forgebreaker',
    ],
  },
  {
    id: 'deed-foundations-icons-v045-2026-10-22',
    deeds: [
      'exp_the_last_keep',
      'exp_dawnhold_castle',
      'soc_strongbox_outfitter',
      'soc_four_bags_deep',
      'prog_ready_for_an_adventure',
    ],
  },
];

describe.each(batches)('integration 45 deed art: $id', (batch) => {
  it('replaces every accepted category fallback with its exact authored crest', () => {
    const record = JSON.parse(
      readFileSync(`docs/achievements/${batch.id}/accepted-art.json`, 'utf8'),
    );
    expect(record.assets.map((a: { id: string }) => a.id).sort()).toEqual([...batch.deeds].sort());
    const hashes = new Set<string>();
    for (const id of batch.deeds) {
      expect(DEED_IMAGE_IDS.has(id), id).toBe(true);
      expect(DEED_ART_PENDING.has(id), id).toBe(false);
      const crest = deedCrestId(id, DEEDS[id].category);
      expect(crest, id).toBe(`deed_${id}`);
      const url = `/ui/deeds/${id}.webp`;
      expect(deedImageUrl(crest), id).toBe(url);
      expect(iconDataUrl('crest', crest), id).toBe(url);
      const bytes = readFileSync(`public${url}`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const asset = record.assets.find((a: { id: string }) => a.id === id);
      expect(hash, id).toBe(asset.acceptedSha256);
      expect(bytes.length, id).toBe(asset.acceptedBytes);
      expect(bytes.length, id).toBeLessThanOrEqual(15 * 1024);
      expect(asset.generation.prompt, id).toContain(id);
      expect(asset.generation.transparentBackground, id).toBe(true);
      hashes.add(hash);
    }
    expect(hashes.size).toBe(batch.deeds.length);
  });
});
