import { describe, expect, it } from 'vitest';
import { createRiftInstance } from '../src/sim/rift/instance_state';

describe('rift instance pool state', () => {
  it('starts an unused slot without a hoard, event, reward or live floor', () => {
    expect(createRiftInstance(3)).toMatchObject({
      slot: 3,
      instanceId: 0,
      eventId: null,
      partyKey: null,
      outcome: 'abandoned',
      floorCount: 0,
      tier: null,
      portalId: null,
      vault: null,
      rewarded: false,
      progressed: false,
      seqResetAt: -Infinity,
    });
  });

  it('never shares mutable collections or positions between slots or worlds', () => {
    const first = createRiftInstance(0);
    const other = createRiftInstance(0);
    for (const key of Object.keys(first) as (keyof typeof first)[]) {
      const value = first[key];
      if (value !== null && typeof value === 'object') expect(value).not.toBe(other[key]);
    }
    first.memberIds.add(42);
    first.litPylons.add(8);
    first.mobIds.push(19);
    first.returnPos.x = 50;
    expect(other.memberIds.size).toBe(0);
    expect(other.litPylons.size).toBe(0);
    expect(other.mobIds).toEqual([]);
    expect(other.returnPos).toEqual({ x: 0, z: 0 });
  });
});
