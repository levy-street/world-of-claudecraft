import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import mapping from '../public/ui/skills/warrior/mapping.json';
import { abilityImageUrl } from '../src/ui/icons';

const AUTHORED_ICONS = {
  double_charge: {
    sourcePack: 'custom-user',
    sourceFile: 'C:/Users/joseg/Desktop/Doble carga.png',
    output: 'double_charge.webp',
    blob: '335e3c113f7bb729caec313b14b586d3c9ba0d30',
  },
  crushing_charge: {
    sourcePack: 'custom-user',
    sourceFile: 'C:/Users/joseg/Desktop/el otro cargar.png',
    output: 'crushing_charge.webp',
    blob: '3f0f9c858635c054f59c950e8259833699f8b47c',
  },
  combat_mastery: {
    sourcePack: 'custom-user',
    sourceFile: 'C:/Users/joseg/Desktop/Nuevo talento.png',
    output: 'combat_mastery.webp',
    blob: '756978b7da595ec543be28cec98b03da79a60d9b',
  },
} as const;

const WINNING_SOURCE_BLOBS = {
  'public/ui/skills/warrior/anger_management.webp': 'a8af761b3afdbea5927a80acaa0e51b3e3f092ae',
  'public/ui/skills/warrior/attack.webp': '8238b1d88a0930109c89dc7dd99d19a6465f4d4e',
  'public/ui/skills/warrior/avatar.webp': 'c1173c98da0887dce28435ad335dd7604192e1c9',
  'public/ui/skills/warrior/battle_rhythm.webp': 'f9df92bd13fe74881af7bbde486cb8bb941a1e34',
  'public/ui/skills/warrior/battle_shout.webp': '8ccf66702df0f369845315ffd487ce9443d0b7b6',
  'public/ui/skills/warrior/battle_stance.webp': 'dbd2095adf74c9521d413c626ae2bbd3c1c8c9f6',
  'public/ui/skills/warrior/berserker_stance.webp': '22269cc49a7053421c972eddea5d8f0ea38fbd12',
  'public/ui/skills/warrior/bladestorm.webp': '0a0d09034b0db08fb7874ac3f4c14822c9c39db9',
  'public/ui/skills/warrior/bloodbath.webp': '9bb82cb84466d5c4a4775272b1afe819a205a0f5',
  'public/ui/skills/warrior/breachmaker.webp': 'd0b00f9c6acfd15c483622175067d999538a849d',
  'public/ui/skills/warrior/colossal_might.webp': 'afd7878be2e8f3b07cf9fd3bbe0df5c671856baf',
  'public/ui/skills/warrior/defensive_stance.webp': '7ac24c726fad900a094bb1bf2f37fc72f778ada0',
  'public/ui/skills/warrior/defiant_bellow.webp': '9ddaa0bd24b78e277cf776e9fec055698e495aa4',
  'public/ui/skills/warrior/die_by_sword.webp': '7e0799549a267e4bbed3fda1dc7fc5194bf15c65',
  'public/ui/skills/warrior/emboldening_roar.webp': '3dbb5a69701cf3c942aea8b9d7cebc4543f8b4e5',
  'public/ui/skills/warrior/execute.webp': '34adc223d5804846a94d3ae05030dcd30b57109d',
  'public/ui/skills/warrior/faultline.webp': 'c6ed4bf17aa949f6bf03dcfd0459a3df12267c1c',
  'public/ui/skills/warrior/furious_mending.webp': '350110d7b6fa584d2b2e65e00e2bfcc116ca8a8f',
  'public/ui/skills/warrior/heroic_leap.webp': 'b827316f089d91e943df83c90e037138645b31c3',
  'public/ui/skills/warrior/intimidating_shout.webp': '5a04146435a2beb76684c48609a0367ca4c7c750',
  'public/ui/skills/warrior/iron_resolve.webp': '3d436f94a7bdab0d6a8735cd423b38be81cd72ef',
  'public/ui/skills/warrior/lingering_dread.webp': '5e4ec68286ad9a358f849f97909a43358736b157',
  'public/ui/skills/warrior/piercing_howl.webp': '8547f93b33161df618277ab8c12447b4f309fd1f',
  'public/ui/skills/warrior/pummel.webp': '3de9df62e42e4fecbe994939aedd5794527da694',
  'public/ui/skills/warrior/pursuit.webp': '8326f00b81d754f278e4e47ecae069538d5bde7d',
  'public/ui/skills/warrior/raging_gale.webp': '2778570e7876ca3face1d1c2a630338583b4fcab',
  'public/ui/skills/warrior/raised_guard.webp': '0c12d7df4de2232a3787e25d4888bfee32d24aeb',
  'public/ui/skills/warrior/rallying_cry.webp': 'ab8c0bd240bc1546717353571b25acd79823f33f',
  'public/ui/skills/warrior/recklessness.webp': '22eef87df0a2776c4744423e8fcc7da9fb12affd',
  'public/ui/skills/warrior/red_harvest.webp': '0785fbd8be079ddac00fbff750ca5bf2898f1107',
  'public/ui/skills/warrior/revenge.webp': '12f73c21a160c7fec076c69257ed0f186578eca2',
  'public/ui/skills/warrior/sanguine_aura.webp': '6991f0a2b45f8aed13bef643df69a70d249e5b41',
  'public/ui/skills/warrior/second_wind.webp': '5ef9acaccb24bb3a878b496499eda6fac519d5fa',
  'public/ui/skills/warrior/storm_bolt.webp': '7f3680b3b1d0a3c4b5dad92b338b2fb81a1c9623',
  'public/ui/skills/warrior/sweeping_strikes.webp': 'a2781312abe6200415238695813929cc4b2bb164',
  'public/ui/skills/warrior/victory_rush.webp': '10046c54c16aac0a32a4046ac467b987f6113392',
  'public/ui/specs/warrior/arms.webp': 'f79913ae20de769179edf4fef5e22dca20a8cbf4',
  'public/ui/specs/warrior/fury.webp': '7784c05bd91f438f1f3fa05421a9149a4f9e15e8',
  'public/ui/specs/warrior/prot.webp': '0e4dd551bf3ea51036264b3cc5fb74a890627d31',
} as const;

function gitBlobHash(path: string): string | null {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

describe('winning Warrior authored talent icons', () => {
  it('preserves the exact source provenance mapping', () => {
    const byId = new Map(mapping.abilities.map((entry) => [entry.abilityId, entry]));
    for (const [abilityId, expected] of Object.entries(AUTHORED_ICONS)) {
      expect(byId.get(abilityId)).toEqual({
        abilityId,
        sourcePack: expected.sourcePack,
        sourceFile: expected.sourceFile,
        output: expected.output,
      });
    }
  });

  it('routes modifier-only row icons through the Warrior image directory', () => {
    for (const abilityId of Object.keys(AUTHORED_ICONS)) {
      expect(abilityImageUrl(abilityId)).toBe(`/ui/skills/warrior/${abilityId}.webp`);
    }
  });

  it('preserves every retained authored skill and spec blob from the winning source', () => {
    for (const [path, blob] of Object.entries(WINNING_SOURCE_BLOBS)) {
      expect(gitBlobHash(resolve(path)), path).toBe(blob);
    }
  });

  it('uses the exact painted blobs from the winning source commit', () => {
    for (const expected of Object.values(AUTHORED_ICONS)) {
      const path = resolve('public/ui/skills/warrior', expected.output);
      expect(gitBlobHash(path), expected.output).toBe(expected.blob);
    }
  });
});
