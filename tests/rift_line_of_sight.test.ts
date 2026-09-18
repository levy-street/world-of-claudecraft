import { describe, expect, it } from 'vitest';
import { allocRiftCollisionToken, lineOfSightClear, setRiftRegion } from '../src/sim/colliders';
import { MOBS, riftInstanceOrigin } from '../src/sim/data';
import { layoutColliders } from '../src/sim/dungeon_layout';
import { createMob } from '../src/sim/entity';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Rift floor generation scatters a handful of "clutter" circles (small
// ground-debris props, see dungeon_layout.ts layoutColliders) across the
// walkable floor. Unlike every other prop family with a known height (open
// world crates/campfires/rocks; the SIGHT_HEIGHT comment in colliders.ts), a
// clutter piece carries no cameraTopY, so sightBlockedAt's rift branch (which
// always skips the low-obstacle allowance for rift positions) treats it as an
// obstruction as tall as a wall: a caster with a dead-clear, wide-open line to
// their target gets "Line of sight." refused because a piece of floor rubble
// happens to sit on the ray.
describe('rift floor clutter never blocks casting', () => {
  it('keeps line of sight clear across a floor-clutter piece (raw collision seam)', () => {
    // Seed 8, floor 1: a clutter piece at instance-local (7.7, 6.9) sits on a
    // dead-straight 12yd line with nothing else (no wall, no pillar, no other
    // clutter) anywhere along it.
    const seed = 8;
    const floorIndex = 1;
    const floor = generateRiftFloor(seed, 20, floorIndex);
    const clutter = floor.layout.clutter?.find((c) => c.x === 7.7 && c.z === 6.9);
    expect(clutter, 'fixture floor must still carry the pinned clutter piece').toBeDefined();

    const token = allocRiftCollisionToken();
    const origin = riftInstanceOrigin(0, floorIndex);
    setRiftRegion(token, origin.x, origin.z, layoutColliders(floor.layout));

    const from = { x: origin.x + 1.7, z: origin.z + 6.9 };
    const to = { x: origin.x + 13.7, z: origin.z + 6.9 };

    expect(lineOfSightClear(seed, from, to, 0.05, undefined, token)).toBe(true);
  });

  it('lets a hostile ranged spell complete past a rift floor-clutter piece', () => {
    const seed = 15;
    const baseLevel = 20;
    const sim = new Sim({ seed, playerClass: 'mage', noPlayer: true });
    const casterId = sim.addPlayer('mage', 'Caster');
    const caster = sim.entities.get(casterId);
    if (!caster) throw new Error('missing caster');

    sim.enterRift(seed, baseLevel, casterId);
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    if (!inst) throw new Error('missing rift instance');
    expect(inst.floorIndex).toBe(0);

    const floor = generateRiftFloor(seed, baseLevel, 0);
    const clutter = floor.layout.clutter?.find((c) => c.x === 7.7 && c.z === 6.9);
    expect(clutter, 'fixture floor must still carry the pinned clutter piece').toBeDefined();
    const origin = riftInstanceOrigin(0, 0);

    caster.pos = { x: origin.x + 1.7, y: 0, z: origin.z + 6.9 };
    caster.prevPos = { ...caster.pos };

    const wolf: Entity = createMob(990_800_001, MOBS.forest_wolf, 1, {
      x: origin.x + 13.7,
      y: 0,
      z: origin.z + 6.9,
    });
    sim.entities.set(wolf.id, wolf);
    sim.rebucket(wolf);

    caster.facing = Math.atan2(wolf.pos.x - caster.pos.x, wolf.pos.z - caster.pos.z);
    sim.targetEntity(wolf.id, casterId);
    sim.castAbility('fireball', casterId);
    const events = sim.drainEvents();

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'castStart', entityId: casterId, ability: 'fireball' }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'error', text: 'Line of sight.' }),
    );
  });
});
