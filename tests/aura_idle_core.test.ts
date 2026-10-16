// The aura-held idle (src/render/characters/aura_idle_core.ts): Balgath's Blinded loop
// replaces his standing pose while the Blinded aura rides, and only then.
import { describe, expect, it } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { applyEntityAnimOverrides } from '../src/render/characters/anim_state_entity_core';
import { auraIdleClip } from '../src/render/characters/aura_idle_core';
import { VISUALS } from '../src/render/characters/manifest';
import { EYE_WARD_AURA_ID, EYE_WARD_BLINDED_AURA_ID } from '../src/sim/mob/eye_ward';

describe('auraIdleClip', () => {
  const map = { eye_ward_blinded: 'Balgath_BlindedLoop', stunned: 'Dazed' };

  it('is the rig idle (null) with no map, no auras, or no matching aura', () => {
    expect(auraIdleClip(undefined, [{ id: 'eye_ward_blinded' }])).toBeNull();
    expect(auraIdleClip(map, undefined)).toBeNull();
    expect(auraIdleClip(map, [])).toBeNull();
    expect(auraIdleClip(map, [{ id: 'eye_ward' }, { id: 'buff_x' }])).toBeNull();
  });

  it('returns the loop for a carried aura, the first map row winning a tie', () => {
    expect(auraIdleClip(map, [{ id: 'x' }, { id: 'eye_ward_blinded' }])).toBe(
      'Balgath_BlindedLoop',
    );
    expect(auraIdleClip(map, [{ id: 'stunned' }, { id: 'eye_ward_blinded' }])).toBe(
      'Balgath_BlindedLoop',
    );
    expect(auraIdleClip(map, [{ id: 'stunned' }])).toBe('Dazed');
  });

  it("holds Balgath's groping loop for the sim's own Blinded aura, never for the ward", () => {
    const clips = VISUALS.mob_balgath_cyclops.clips;
    expect(auraIdleClip(clips.idleByAura, [{ id: EYE_WARD_BLINDED_AURA_ID }])).toBe(
      'Balgath_BlindedLoop',
    );
    expect(auraIdleClip(clips.idleByAura, [{ id: EYE_WARD_AURA_ID }])).toBeNull();
  });

  it('reaches the rig through the entity overrides by reference, never a copy', () => {
    const auras = [{ id: EYE_WARD_BLINDED_AURA_ID }];
    const st = { speed: 0, moving: false, running: false } as unknown as AnimState;
    applyEntityAnimOverrides(st, { aggroTargetId: 3, auras }, false);
    expect(st.auras).toBe(auras);
  });
});
