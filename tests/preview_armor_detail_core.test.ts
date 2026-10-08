// Which armor detail a body on a character preview draws
// (src/render/characters/preview_armor_detail_core.ts, review N9): the rule per stage, the
// creator's one chosen class and body, and the build options that keep a preview's geometry
// whole while only its armor textures step down.
import { describe, expect, it } from 'vitest';
import {
  type PreviewArmorSurface,
  previewArmorBuildOptions,
  previewArmorDetail,
  previewChosenBody,
} from '../src/render/characters/preview_armor_detail_core';
import { wocArmorTierFor } from '../src/render/characters/woc_armor_core';
import { wocLodLevelFor } from '../src/render/characters/woc_lod_core';

const SURFACES: readonly PreviewArmorSurface[] = ['own', 'inspect', 'creator'];
const TIERS = ['low', 'medium', 'high', 'ultra'] as const;
const WARRIOR = 'player_warrior';
const WARRIOR_F = 'player_warrior_female';
const MAGE = 'player_mage';

describe('previewArmorDetail', () => {
  it("draws the viewer's own character at full detail, chosen or not", () => {
    expect(previewArmorDetail('own', WARRIOR, null)).toBe('full');
    expect(previewArmorDetail('own', WARRIOR, MAGE)).toBe('full');
    expect(previewArmorDetail('own', null, null)).toBe('full');
  });

  it("draws someone else's character at the crowd's detail, whatever was chosen", () => {
    expect(previewArmorDetail('inspect', WARRIOR, null)).toBe('crowd');
    // a choice made on the creator means nothing on the inspect stage
    expect(previewArmorDetail('inspect', WARRIOR, WARRIOR)).toBe('crowd');
  });

  it("draws a class in the creator at the crowd's detail until that class and body is chosen", () => {
    expect(previewArmorDetail('creator', WARRIOR, null)).toBe('crowd');
    expect(previewArmorDetail('creator', WARRIOR, WARRIOR)).toBe('full');
    // the choice is ONE class and ONE body: another class, or the other body of the chosen
    // class, is still being browsed
    expect(previewArmorDetail('creator', MAGE, WARRIOR)).toBe('crowd');
    expect(previewArmorDetail('creator', WARRIOR_F, WARRIOR)).toBe('crowd');
    // nothing on the stage is never chosen
    expect(previewArmorDetail('creator', null, null)).toBe('crowd');
  });
});

describe('previewChosenBody', () => {
  it('chooses the body on the creator stage', () => {
    expect(previewChosenBody('creator', WARRIOR, null)).toBe(WARRIOR);
    // choosing another forgets the first: one class and body at a time
    expect(previewChosenBody('creator', MAGE, WARRIOR)).toBe(MAGE);
  });

  it('keeps the choice when nothing is on the stage', () => {
    expect(previewChosenBody('creator', null, WARRIOR)).toBe(WARRIOR);
    expect(previewChosenBody('creator', null, null)).toBeNull();
  });

  it("chooses nothing off the creator: an editor's pick on a real character is no choice", () => {
    for (const surface of ['own', 'inspect'] as const) {
      expect(previewChosenBody(surface, MAGE, null), surface).toBeNull();
      expect(previewChosenBody(surface, MAGE, WARRIOR), surface).toBe(WARRIOR);
    }
  });

  it('remembers the chosen body while another is flipped to and back', () => {
    const chosen = previewChosenBody('creator', WARRIOR, null);
    // flipping away draws the other class small, and nothing but a choice moves the memory
    expect(previewArmorDetail('creator', MAGE, chosen)).toBe('crowd');
    expect(previewArmorDetail('creator', WARRIOR, chosen)).toBe('full');
  });
});

describe('the preview detail on the low preset and on phones', () => {
  it('changes no file a preview draws: every stage and choice draws the low tier', () => {
    const profiles = [
      { tier: 'low', constrainedMemory: false },
      ...TIERS.map((tier) => ({ tier, constrainedMemory: true })),
    ];
    for (const profile of profiles) {
      for (const surface of SURFACES) {
        for (const chosen of [null, WARRIOR]) {
          const detail = previewArmorDetail(surface, WARRIOR, chosen);
          const label = `${profile.tier}/${profile.constrainedMemory}/${surface}/${chosen}`;
          expect(wocArmorTierFor(profile, detail), label).toBe('low');
          // ...and the geometry level a body built directly has always drawn there
          expect(previewArmorBuildOptions(profile, detail).wocLod, label).toBe('mid');
        }
      }
    }
  });
});

describe('the preview detail on the medium preset and above', () => {
  it('never draws a top file but for the own character and the chosen class on high and above', () => {
    for (const tier of ['high', 'ultra'] as const) {
      const profile = { tier, constrainedMemory: false };
      const tierOf = (surface: PreviewArmorSurface, staged: string, chosen: string | null) =>
        wocArmorTierFor(profile, previewArmorDetail(surface, staged, chosen));
      expect(tierOf('own', WARRIOR, null), tier).toBe('high');
      expect(tierOf('inspect', WARRIOR, null), tier).toBe('medium');
      expect(tierOf('creator', WARRIOR, null), tier).toBe('medium');
      expect(tierOf('creator', WARRIOR, MAGE), tier).toBe('medium');
      expect(tierOf('creator', WARRIOR, WARRIOR), tier).toBe('high');
    }
  });

  it('draws the medium file everywhere on the medium preset (the top levels are a High download)', () => {
    const profile = { tier: 'medium', constrainedMemory: false };
    for (const surface of SURFACES) {
      for (const chosen of [null, WARRIOR]) {
        const detail = previewArmorDetail(surface, WARRIOR, chosen);
        expect(wocArmorTierFor(profile, detail), `${surface}/${chosen}`).toBe('medium');
      }
    }
  });
});

describe('previewArmorBuildOptions', () => {
  it('hands the body its armor detail', () => {
    const profile = { tier: 'high', constrainedMemory: false };
    expect(previewArmorBuildOptions(profile, 'crowd').wocArmorDetail).toBe('crowd');
    expect(previewArmorBuildOptions(profile, 'full').wocArmorDetail).toBe('full');
  });

  it('keeps the full geometry level whatever the armor detail: only the textures step down', () => {
    for (const tier of TIERS) {
      for (const constrainedMemory of [false, true]) {
        const profile = { tier, constrainedMemory };
        const full = wocLodLevelFor(profile, 'full');
        expect(previewArmorBuildOptions(profile, 'full').wocLod, tier).toBe(full);
        expect(previewArmorBuildOptions(profile, 'crowd').wocLod, tier).toBe(full);
      }
    }
    // decisive on the presets where the two details differ: a crowd body of the world draws
    // mid there, a preview at the crowd's ARMOR detail still draws level 0
    const high = { tier: 'high', constrainedMemory: false };
    expect(wocLodLevelFor(high, 'crowd')).toBe('mid');
    expect(previewArmorBuildOptions(high, 'crowd').wocLod).toBe('lod0');
  });
});
