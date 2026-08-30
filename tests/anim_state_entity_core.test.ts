import { describe, expect, it } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import {
  type AnimOverrideFacts,
  applyEntityAnimOverrides,
} from '../src/render/characters/anim_state_entity_core';

// The renderer's per-entity sync loop derives an AnimState from DISPLAYED motion;
// these overrides then apply facts about the entity itself. Extracted out of the
// 13.5k-line renderer coordinator, so this is the first direct coverage the
// ice-slide suppression has ever had.

const state = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  falling: false,
  backwards: false,
  reverseBackpedal: false,
  dead: false,
  casting: false,
  spinning: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});
const facts = (over: Partial<AnimOverrideFacts> = {}): AnimOverrideFacts => ({
  aggroTargetId: null,
  riftSliding: false,
  ...over,
});

describe('applyEntityAnimOverrides: battle-stance engagement', () => {
  it('flags a mob that holds a live aggro target as engaged', () => {
    const st = state();
    applyEntityAnimOverrides(st, facts({ aggroTargetId: 7 }), false);
    expect(st.combat).toBe(true);
  });

  it('leaves an unengaged body relaxed', () => {
    const st = state();
    applyEntityAnimOverrides(st, facts(), false);
    expect(st.combat).toBe(false);
  });

  it('treats target id 0 as a real target, not as absent', () => {
    // aggroTargetId is a numeric entity id and the sim's own player pid can be 0,
    // so a truthiness test here would have left a mob fighting entity 0 relaxed.
    const st = state();
    applyEntityAnimOverrides(st, facts({ aggroTargetId: 0 }), false);
    expect(st.combat).toBe(true);
  });

  it('stands a corpse down even while its aggro target is still set', () => {
    // The kill does not clear the hate table on the same frame the body dies, and
    // a corpse braced in a fighting stance would be visibly wrong.
    const st = state();
    applyEntityAnimOverrides(st, facts({ aggroTargetId: 7 }), true);
    expect(st.combat).toBe(false);
  });
});

describe('applyEntityAnimOverrides: ice-slide suppression', () => {
  it('reads a sliding body as frozen rather than sprinting', () => {
    const st = state({ moving: true, running: true, airborne: true, speed: 9 });
    applyEntityAnimOverrides(st, facts({ riftSliding: true }), false);
    expect(st.moving).toBe(false);
    expect(st.running).toBe(false);
    expect(st.airborne).toBe(false);
    // The speed itself is deliberately untouched: the slide still reads as fast
    // travel to anything measuring it, only the POSE selection is suppressed.
    expect(st.speed).toBe(9);
  });

  it('leaves a dead body locomotion alone while it slides', () => {
    const st = state({ moving: true, running: true, airborne: true });
    applyEntityAnimOverrides(st, facts({ riftSliding: true }), true);
    expect(st.moving).toBe(true);
    expect(st.running).toBe(true);
    expect(st.airborne).toBe(true);
  });

  it('does not touch locomotion for a body that is not sliding', () => {
    const st = state({ moving: true, running: true, airborne: true });
    applyEntityAnimOverrides(st, facts(), false);
    expect(st.moving).toBe(true);
    expect(st.running).toBe(true);
    expect(st.airborne).toBe(true);
  });

  it('slides stiff rather than sliding in a fighting stance', () => {
    // Order matters: the slide is applied after the engagement flag, so a mob
    // shoved onto the ice mid-fight reads as frozen, not as braced-and-gliding.
    const st = state();
    applyEntityAnimOverrides(st, facts({ aggroTargetId: 7, riftSliding: true }), false);
    expect(st.combat).toBe(false);
  });

  it('treats an absent riftSliding the same as false', () => {
    // Entity only sets the field on a sliding player, so most callers pass
    // undefined and must not be read as sliding.
    const st = state({ moving: true });
    applyEntityAnimOverrides(st, { aggroTargetId: null }, false);
    expect(st.moving).toBe(true);
    expect(st.combat).toBe(false);
  });
});
