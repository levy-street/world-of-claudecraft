// The object views a template swap leaves standing (render/gate_objects.ts
// isStableObjectTransition): the renderer rebuilds an object's view when its
// template changes, except across these pairs. And the trash kit's death
// burst ring is an empty encounter anchor: its floor ring is drawn from the
// world (render/death_burst_fx.ts), never a default object mesh.

import { describe, expect, it } from 'vitest';
import { gateObjectPlan, isStableObjectTransition } from '../src/render/gate_objects';
import { DEATH_BURST_RING } from '../src/sim/mob/trash_kit/death_burst';

describe('stable object template transitions', () => {
  it('still answers for the Ignivar conduit pairs', () => {
    expect(
      isStableObjectTransition('ignivar_water_conduit_ready', 'ignivar_water_conduit_active'),
    ).toBe(true);
    expect(isStableObjectTransition('ignivar_water_conduit_ready', 'mailbox')).toBe(false);
  });

  it('a death burst ring is no stable pair with anything', () => {
    expect(isStableObjectTransition(DEATH_BURST_RING, 'mailbox')).toBe(false);
    expect(isStableObjectTransition('mailbox', DEATH_BURST_RING)).toBe(false);
  });
});

describe('the death burst ring view', () => {
  it('is an empty encounter anchor wherever it lies', () => {
    const at = { dungeonId: 'gravewyrm_sanctum', pos: { x: 0, z: 0 } };
    expect(gateObjectPlan({ ...at, templateId: DEATH_BURST_RING })).toEqual({
      encounterAnchor: true,
      height: 2,
    });
    expect(gateObjectPlan({ ...at, dungeonId: null, templateId: DEATH_BURST_RING })).toEqual({
      encounterAnchor: true,
      height: 2,
    });
  });
});
