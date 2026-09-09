import { describe, expect, it, vi } from 'vitest';
import {
  cancelCorpseHarvestCastOnDisconnect,
  harvestCorpseCommandOutcome,
  validHarvestCorpseCommand,
} from '../../server/corpse_harvest_commands';
import { CORPSE_HARVEST_CAST_ID, type Entity } from '../../src/sim/types';

describe('validHarvestCorpseCommand', () => {
  it('accepts a positive safe integer id with components absent', () => {
    expect(validHarvestCorpseCommand({ id: 7 })).toBe(true);
  });

  it.each([
    ['id missing', {}],
    ['id zero', { id: 0 }],
    ['id negative', { id: -1 }],
    ['id non-integer', { id: 1.5 }],
    ['id not a safe integer', { id: Number.MAX_SAFE_INTEGER + 1 }],
    ['id a string', { id: '7' }],
    ['components empty array', { id: 7, components: [] }],
    ['components null', { id: 7, components: null }],
    ['components a populated array', { id: 7, components: ['hide'] }],
    // An own `components: undefined` property must refuse exactly like every
    // other shape: `Object.hasOwn` sees the key regardless of its value, so
    // this is NOT the same as the key being absent entirely.
    ['components own key set to undefined', { id: 7, components: undefined }],
  ])('refuses %s', (_label, msg) => {
    expect(validHarvestCorpseCommand(msg)).toBe(false);
  });
});

describe('harvestCorpseCommandOutcome', () => {
  it('calls sim.harvestCorpse with the session pid, never a payload one, on a valid frame', () => {
    const harvestCorpse = vi.fn(() => true);
    const outcome = harvestCorpseCommandOutcome({ harvestCorpse }, { id: 42 }, 9);
    expect(outcome).toBe(true);
    expect(harvestCorpse).toHaveBeenCalledTimes(1);
    expect(harvestCorpse).toHaveBeenCalledWith(42, 9);
  });

  it('never calls sim.harvestCorpse on an invalid frame', () => {
    const harvestCorpse = vi.fn(() => true);
    const outcome = harvestCorpseCommandOutcome({ harvestCorpse }, { id: 42, components: [] }, 9);
    expect(outcome).toBe(false);
    expect(harvestCorpse).not.toHaveBeenCalled();
  });
});

describe('cancelCorpseHarvestCastOnDisconnect', () => {
  it('cancels a live corpse-harvest cast for the dropped pid', () => {
    const actor = { castingAbility: CORPSE_HARVEST_CAST_ID } as Entity;
    const cancelCast = vi.fn();
    const sim = { entities: new Map([[9, actor]]), ctx: { cancelCast } };
    cancelCorpseHarvestCastOnDisconnect(sim, 9);
    expect(cancelCast).toHaveBeenCalledTimes(1);
    expect(cancelCast).toHaveBeenCalledWith(actor);
  });

  it('is a no-op for any other cast', () => {
    const actor = { castingAbility: 'fireball' } as Entity;
    const cancelCast = vi.fn();
    const sim = { entities: new Map([[9, actor]]), ctx: { cancelCast } };
    cancelCorpseHarvestCastOnDisconnect(sim, 9);
    expect(cancelCast).not.toHaveBeenCalled();
  });

  it('is a no-op for a pid with no live entity', () => {
    const cancelCast = vi.fn();
    const sim = { entities: new Map<number, Entity>(), ctx: { cancelCast } };
    cancelCorpseHarvestCastOnDisconnect(sim, 9);
    expect(cancelCast).not.toHaveBeenCalled();
  });
});
