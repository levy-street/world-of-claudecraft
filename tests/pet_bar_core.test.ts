import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { primaryOwnedPet } from '../src/ui/hud/pet_bar_core';

describe('primaryOwnedPet', () => {
  it('ignores temporary Necromancy servants even when they were inserted first', () => {
    const warrior = createMob(10, MOBS.necromancy_skeletal_warrior, 20, {
      x: 0,
      y: 0,
      z: 0,
    });
    warrior.ownerId = 1;
    const graveguard = createMob(11, MOBS.graveguard, 20, { x: 0, y: 0, z: 0 });
    graveguard.ownerId = 1;

    expect(primaryOwnedPet([warrior, graveguard], 1)?.id).toBe(graveguard.id);
  });

  it('ignores a temporary Pyre Colossus even when it was inserted first', () => {
    const pyre = createMob(12, MOBS.pyre_colossus, 20, { x: 0, y: 0, z: 0 });
    pyre.ownerId = 1;
    pyre.auras.push({
      id: 'pyre_guardian',
      name: 'Pyre Guardian',
      kind: 'pyre_guardian',
      remaining: 20,
      duration: 20,
      value: 1,
      sourceId: 1,
      school: 'fire',
    });
    const graveguard = createMob(13, MOBS.graveguard, 20, { x: 0, y: 0, z: 0 });
    graveguard.ownerId = 1;

    expect(primaryOwnedPet([pyre, graveguard], 1)?.id).toBe(graveguard.id);
  });
});
