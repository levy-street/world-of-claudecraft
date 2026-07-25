import { describe, expect, it } from 'vitest';
import { ARENA_SLOT_COUNT, arenaOrigin, MOBS } from '../src/sim/data';
import { DUNGEON_WALL_HW, DUNGEON_WALL_X } from '../src/sim/dungeon_layout';
import { createMob } from '../src/sim/entity';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });
const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('Knockback on-hit affix (Crushing Sweep)', () => {
  it('a landed marrowlord_varkas swing hurls the player straight away from the mob', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true; // an L19 elite would otherwise grind the warrior down mid-loop
    // flat starting ground (Eastbrook town) so the shove isn't terrain-clamped
    p.pos.x = 2;
    p.pos.z = 0;
    p.pos.y = 0;
    const tmpl = MOBS.marrowlord_varkas;
    const saved = tmpl.knockback!.chance;
    tmpl.knockback!.chance = 1; // force the proc; misses/dodges still possible
    try {
      // spawn at the player's level for an even hit table, on top of the player
      const mob = createMob(900700, tmpl, p.level, { x: 0, y: 0, z: 0 });
      const startGap = dist2d(p.pos, mob.pos);
      let moved = false;
      for (let i = 0; i < 80 && !moved; i++) {
        (sim as any).mobSwing(mob, p);
        moved = dist2d(p.pos, mob.pos) > startGap + 1;
      }
      expect(moved).toBe(true);
      // pushed outward along the +x line it started on (away, not toward, the mob)
      expect(p.pos.x).toBeGreaterThan(2);
      expect(dist2d(p.pos, mob.pos)).toBeGreaterThan(startGap + 3);
    } finally {
      tmpl.knockback!.chance = saved;
    }
  });

  it('applyKnockback shoves the exact distance over open ground and reports it', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.pos.x = 2;
    p.pos.z = 0;
    p.pos.y = 0;
    const mob = createMob(900701, MOBS.marrowlord_varkas, p.level, { x: 0, y: 0, z: 0 });
    const moved = (sim as any).applyKnockback(mob, p, 6);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(6);
    expect(p.pos.x).toBeGreaterThan(2); // displaced along the mob→player axis
  });

  it('a friendly pet swing (hostile=false) never knocks its target back', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    p.pos.x = 2;
    p.pos.z = 0;
    p.pos.y = 0;
    const tmpl = MOBS.marrowlord_varkas;
    const saved = tmpl.knockback!.chance;
    tmpl.knockback!.chance = 1;
    try {
      const pet = createMob(900702, tmpl, p.level, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      const startGap = dist2d(p.pos, pet.pos);
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(dist2d(p.pos, pet.pos)).toBeLessThan(startGap + 1);
    } finally {
      tmpl.knockback!.chance = saved;
    }
  });

  it.each(
    Array.from({ length: ARENA_SLOT_COUNT }, (_, slot) =>
      [-1, 1].map((side) => ({ side, slot })),
    ).flat(),
  )('a knockback cannot tunnel through side $side in arena slot $slot', ({ side, slot }) => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    const o = arenaOrigin(slot);
    const insideLimit = DUNGEON_WALL_X - DUNGEON_WALL_HW - PLAYER_BODY_RADIUS;
    const startDistance = insideLimit - 0.1;

    p.pos.x = o.x + side * startDistance;
    p.pos.z = o.z;
    p.pos.y = 0;
    // Put the mob toward the arena centre so the shove points directly at
    // the chosen side wall. The large displacement exercises the swept
    // knockback path, including the west-wall routing boundary.
    const mob = createMob(900704 + slot * 2 + (side > 0 ? 1 : 0), MOBS.marrowlord_varkas, p.level, {
      x: o.x + side * (startDistance - 5),
      y: 0,
      z: o.z,
    });

    (sim as any).applyKnockback(mob, p, 8);

    const finalDistance = side * (p.pos.x - o.x);
    expect(finalDistance).toBeGreaterThanOrEqual(startDistance - 1e-6);
    expect(finalDistance).toBeLessThanOrEqual(insideLimit + 1e-6);
  });

  it('a mob without knockback never displaces the player', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    p.pos.x = 2;
    p.pos.z = 0;
    p.pos.y = 0;
    const mob = createMob(900703, MOBS.forest_wolf, p.level, { x: 0, y: 0, z: 0 });
    const startGap = dist2d(p.pos, mob.pos);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(dist2d(p.pos, mob.pos)).toBeLessThan(startGap + 1);
  });
});
