import { describe, expect, it } from 'vitest';
import { PET_SIGNATURE_ATTACK_IDS } from '../src/render/ability_vfx/painter';
import { VISUALS } from '../src/render/characters/manifest';
import { WARLOCK_PET_MOBS } from '../src/sim/content/warlock_pets';

// Drift guard for the painter's mob-throw id exception (review 3050): the
// PET_SIGNATURE_ATTACK_IDS allowlist must track the sim pet roster's declared
// signature abilities, and every allowlisted id must have a creature rig
// authoring an attackByAbility clip for it. A new pet with a signature
// ability, or a pet rig gaining a clip, reds here instead of silently losing
// its attack read.

function petSignatureAbilityIds(): string[] {
  const ids: string[] = [];
  for (const pet of Object.values(WARLOCK_PET_MOBS)) {
    if (pet.petRanged?.ability) ids.push(pet.petRanged.ability);
    if (pet.petChainPull?.ability) ids.push(pet.petChainPull.ability);
  }
  return ids.sort();
}

describe('PET_SIGNATURE_ATTACK_IDS', () => {
  it('matches the sim pet roster exactly', () => {
    expect([...PET_SIGNATURE_ATTACK_IDS].sort()).toEqual(petSignatureAbilityIds());
  });

  it('pins the allowlisted ids to literals', () => {
    expect([...PET_SIGNATURE_ATTACK_IDS].sort()).toEqual([
      'emberkin_felbolt',
      'gloomshade_abyssal_chain',
    ]);
  });

  it('has a manifest attackByAbility clip backing every allowlisted id', () => {
    const authoredIds = new Set<string>();
    for (const visual of Object.values(VISUALS)) {
      for (const id of Object.keys(visual.clips.attackByAbility ?? {})) authoredIds.add(id);
    }
    for (const id of PET_SIGNATURE_ATTACK_IDS) {
      expect(authoredIds.has(id), `no rig authors an attackByAbility clip for ${id}`).toBe(true);
    }
  });
});
