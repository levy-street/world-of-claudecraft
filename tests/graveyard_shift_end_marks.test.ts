// The marks a shift's ending leaves for the client: the Defeated aura draws a
// living Morthen in the death pose (no stun stars), the Staff Exit carries its
// own label, and the player frame reads Morthen's name and the boss "??".
import { describe, expect, it } from 'vitest';
import { wornCcBand } from '../src/render/ability_vfx_core';
import {
  CHARACTER_EFFECT_IMPALED,
  characterEffectFlags,
  hasCharacterEffect,
} from '../src/render/character_effects_core';
import type { AnimState } from '../src/render/characters/anim_state';
import { applyEntityAnimOverrides } from '../src/render/characters/anim_state_entity_core';
import { objectDisplayName } from '../src/render/entity_labels';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { defeatedAura } from '../src/sim/graveyard_shift/outro';
import {
  DEFEATED_AURA_ID,
  isGraveyardShiftDefeated,
  isGraveyardShiftStaffExit,
  STAFF_EXIT_NAME,
} from '../src/sim/graveyard_shift/shift_end_marks';
import type { Aura, Entity } from '../src/sim/types';
import {
  BOSS_LEVEL_TEXT,
  graveyardShiftAuraName,
  playerFrameLevelText,
  playerFrameName,
} from '../src/ui/graveyard_shift_text_core';
import { setLanguage } from '../src/ui/i18n';

const DEFEATED = defeatedAura(1);

describe('the Defeated aura on the client', () => {
  it('poses the living body dead, keyed on the aura id', () => {
    expect(DEFEATED.id).toBe(DEFEATED_AURA_ID);
    const flags = characterEffectFlags([DEFEATED]);
    expect(hasCharacterEffect(flags, CHARACTER_EFFECT_IMPALED)).toBe(true);
    const st = { dead: false, moving: true, running: true, airborne: false } as AnimState;
    applyEntityAnimOverrides(st, { aggroTargetId: null, riftSliding: false }, false, flags);
    expect(st.dead).toBe(true);
    expect(st.moving).toBe(false);
  });

  it('draws no stun band, though a stun of any other id still does', () => {
    expect(wornCcBand([DEFEATED])).toBeNull();
    expect(wornCcBand([{ id: 'hammer', kind: 'stun', remaining: 3 }])?.type).toBe('stun');
    expect(isGraveyardShiftDefeated({ auras: [DEFEATED] as Aura[] })).toBe(true);
    expect(isGraveyardShiftDefeated({ auras: [] })).toBe(false);
  });

  it('names the aura through the catalog', () => {
    setLanguage('en');
    expect(graveyardShiftAuraName(DEFEATED.name)).toBe('Defeated');
  });
});

describe('the Staff Exit label', () => {
  it('reads its own name, while any other dungeon exit keeps the dungeon label', () => {
    setLanguage('en');
    const exit = (name: string) =>
      ({ templateId: 'dungeon_exit', name, dungeonId: 'hollow_crypt' }) as unknown as Entity;
    expect(isGraveyardShiftStaffExit(exit(STAFF_EXIT_NAME))).toBe(true);
    expect(objectDisplayName(exit(STAFF_EXIT_NAME))).toBe('Staff Exit');
    expect(isGraveyardShiftStaffExit(exit('Hollow Crypt Exit'))).toBe(false);
    expect(objectDisplayName(exit('Hollow Crypt Exit'))).not.toBe('Staff Exit');
  });
});

describe("the player's own frame while Morthen", () => {
  it("reads Morthen's name and the boss skull, and the player's own off shift", () => {
    setLanguage('en');
    const off = { auras: [] as Aura[], level: 14, name: 'Mat' } as unknown as Entity;
    const on = {
      auras: [morthenIdentityAura(1)],
      level: 10,
      name: 'Mat',
    } as unknown as Entity;
    expect(playerFrameLevelText(off)).toBe('14');
    expect(playerFrameName(off)).toBe('Mat');
    expect(playerFrameLevelText(on)).toBe(BOSS_LEVEL_TEXT);
    expect(BOSS_LEVEL_TEXT).toBe('??');
    expect(playerFrameName(on)).toBe('Morthen the Gravecaller');
  });
});
