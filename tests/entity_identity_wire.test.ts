import { describe, expect, it } from 'vitest';
import { identityFields } from '../server/entity_identity_wire';
import { Sim } from '../src/sim/sim';

describe('entity identity riding training wire', () => {
  it('carries training while dismounted and preserves cosmetic selection', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    sim.player.ridingTier = 2;
    sim.player.mountSkinId = 'mech_bird';
    const wire = identityFields(sim.player);
    expect(wire.mntTier).toBe(2);
    expect(wire.msk).toBe('mech_bird');
    expect(wire).not.toHaveProperty('mnt');
  });
});
