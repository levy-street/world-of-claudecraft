import { afterEach, describe, expect, it } from 'vitest';
import { type Collider, FENCE_HALF_DEPTH } from '../src/sim/colliders';
import {
  ARENA_SLOT_COUNT,
  arenaOrigin,
  BUILTIN_WORLD,
  MOBS,
  setActiveWorldContent,
} from '../src/sim/data';
import { DUNGEON_WALL_HW, DUNGEON_WALL_X } from '../src/sim/dungeon_layout';
import { createMob } from '../src/sim/entity';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import {
  type CharacterMoveParams,
  type CharacterMoveResult,
  MAX_STEP_HEIGHT,
  moveCharacter,
  SKIN_WIDTH,
  sweepCollider,
} from '../src/sim/physics';
import { Sim } from '../src/sim/sim';
import { FISHING_CAST_ID, type WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });
const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('Knockback on-hit affix (Crushing Sweep)', () => {
  it('a landed marrowlord_varkas swing hurls the player straight away from the mob', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true; // an L19 elite would otherwise grind the warrior down mid-loop
    // flat starting ground (the harbor-town plat) so the shove isn't
    // terrain-clamped. Re-staged 2026-08-18 for the Eastbrook harbor move
    // (d19aa33f76): the vacated town ground at (0,0) is no longer
    // street-flattened and its slope clamped the 6yd shove at 4.14yd.
    // Re-staged again for the Realm Builder monument: the civic centrepiece at
    // (-14.75, -102) carries a 3.19yd collider, so the old z = -100 lane ran
    // straight into it and the shove stopped 1yd out. Same flat plat, 10yd
    // south, clear of the square.
    p.pos.x = -18;
    p.pos.z = -110;
    p.pos.y = 0;
    const tmpl = MOBS.marrowlord_varkas;
    const saved = tmpl.knockback!.chance;
    tmpl.knockback!.chance = 1; // force the proc; misses/dodges still possible
    try {
      // spawn at the player's level for an even hit table, on top of the player
      const mob = createMob(900700, tmpl, p.level, { x: -20, y: 0, z: -110 });
      const startGap = dist2d(p.pos, mob.pos);
      let moved = false;
      for (let i = 0; i < 80 && !moved; i++) {
        (sim as any).mobSwing(mob, p);
        moved = dist2d(p.pos, mob.pos) > startGap + 1;
      }
      expect(moved).toBe(true);
      // pushed outward along the +x line it started on (away, not toward, the mob)
      expect(p.pos.x).toBeGreaterThan(-18);
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

  it('a fully absorbed knockback swing cancels a fishing session AND still displaces', () => {
    // The hit counts both ways: the shield soaks every point (no hp loss),
    // the session ends, and the shove lands exactly as it always did. There
    // is no absorb-conditional physics branch anywhere in the chain.
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    // NOT gm: the gm gate would skip dealDamage entirely and this pin is
    // about the absorb path INSIDE it. The shield keeps the warrior alive.
    p.pos.x = 2;
    p.pos.z = 0;
    p.pos.y = 0;
    p.castingAbility = FISHING_CAST_ID;
    p.castTotal = 15;
    p.castRemaining = 15;
    p.fishBiteAtTick = 100;
    p.fishCastZoneId = 'eastbrook_vale';
    p.auras.push({
      id: 'test_absorb',
      name: 'Test Barrier',
      kind: 'absorb',
      value: 1_000_000,
      remaining: 300,
      duration: 300,
      sourceId: p.id,
      school: 'arcane',
    } as (typeof p.auras)[number]);
    const hpBefore = p.hp;
    const tmpl = MOBS.marrowlord_varkas;
    const saved = tmpl.knockback!.chance;
    tmpl.knockback!.chance = 1;
    try {
      const mob = createMob(900710, tmpl, p.level, { x: 0, y: 0, z: 0 });
      const startGap = dist2d(p.pos, mob.pos);
      let moved = false;
      for (let i = 0; i < 80 && !moved; i++) {
        (sim as any).mobSwing(mob, p);
        moved = dist2d(p.pos, mob.pos) > startGap + 1;
      }
      expect(moved).toBe(true);
      expect(p.hp).toBe(hpBefore);
      expect(p.castingAbility).toBeNull();
      expect(p.fishBiteAtTick).toBe(0);
      expect(p.fishCastZoneId).toBe('');
    } finally {
      tmpl.knockback!.chance = saved;
    }
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

// A knockback shove that settles the victim at EXACT zero clearance against a
// static collider used to freeze every subsequent move attempt solid,
// including straight away from the obstacle: only /unstuck (and its Unstuck
// Sickness debuff) could free them. Reported against Thunzharr's Tectonic
// Heave near village structures (a house, the well); reproduced here with
// synthetic colliders standing in for both shapes the report named.
describe('a knockback shove never leaves the target frozen against a collider', () => {
  afterEach(() => setActiveWorldContent(null));

  function world(props: Partial<WorldContent['props']>): WorldContent {
    return { ...BUILTIN_WORLD, props: { ...BUILTIN_WORLD.props, ...props } };
  }

  function findFlatSpot(): { x: number; z: number } {
    for (let x = -120; x <= 120; x += 3) {
      for (let z = -120; z <= 120; z += 3) {
        const h = terrainHeight(x, z, SEED);
        if (h < WATER_LEVEL + 1.5) continue;
        let ok = true;
        for (let dz = -3; dz <= 20 && ok; dz += 1) {
          if (Math.abs(terrainHeight(x, z + dz, SEED) - h) > 0.4) ok = false;
        }
        if (ok) return { x, z };
      }
    }
    throw new Error('no flat spot found');
  }

  // Can the body make real progress in ANY direction? A frozen body reports
  // `blocked` and near-zero net motion in every one of these; a merely
  // stopped-at-the-wall body still moves freely along at least one heading.
  function canWalkAway(seed: number, x: number, y: number, z: number): boolean {
    const params: CharacterMoveParams = {
      seed,
      radius: PLAYER_BODY_RADIUS,
      stepHeight: MAX_STEP_HEIGHT,
      maxSlope: 0.75,
      grounded: true,
      swimming: false,
      ignoreFences: false,
    };
    const out: CharacterMoveResult = { x: 0, y: 0, z: 0, blocked: false, stepped: 0 };
    for (let dir = 0; dir < 8; dir++) {
      const ang = (dir / 8) * Math.PI * 2;
      moveCharacter(params, x, y, z, Math.cos(ang) * 0.3, Math.sin(ang) * 0.3, out);
      if (Math.hypot(out.x - x, out.z - z) > 0.1) return true;
    }
    return false;
  }

  it('repeated hits against a circle collider (e.g. the well) never freeze the target', () => {
    const spot = findFlatSpot();
    const wx = spot.x;
    const wz = spot.z + 10;
    setActiveWorldContent({
      ...world({}),
      placements: [{ x: wx, z: wz, collideRadius: 2 }],
    } as WorldContent);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    const g = groundHeight(wx, wz - 6, SEED);
    p.pos.x = wx;
    p.pos.z = wz - 6;
    p.pos.y = g;
    p.prevPos = { ...p.pos };
    const mob = createMob(900720, MOBS.marrowlord_varkas, 1, { x: wx, y: g, z: wz - 12 });
    for (let i = 0; i < 12; i++) (sim as any).applyKnockback(mob, p, 7);
    expect(canWalkAway(SEED, p.pos.x, p.pos.y, p.pos.z)).toBe(true);
  });

  it('repeated hits against a flat wall face (e.g. a house) always leave a clearance margin', () => {
    // canWalkAway is not decisive here: moveCharacter's OWN depenetration
    // pass (a SKIN_WIDTH push on anything it finds overlapping) can mask an
    // exact-boundary landing depending on which side of the boundary float
    // rounding happens to land the resolve on, the same "at some point"
    // intermittency the report described. The clearance margin itself is
    // the decisive, deterministic guarantee: pre-fix, pushOut's OBB branch
    // places the body at EXACTLY the wall's inflated face (zero margin);
    // post-fix the resolve radius is padded by SKIN_WIDTH, so the body
    // always keeps real room between its edge and the wall.
    const spot = findFlatSpot();
    const wx = spot.x;
    const wz = spot.z + 10;
    setActiveWorldContent({
      ...world({}),
      blockers: [{ x1: wx - 6, z1: wz, x2: wx + 6, z2: wz }],
    } as WorldContent);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    const g = groundHeight(wx, wz - 6, SEED);
    p.pos.x = wx;
    p.pos.z = wz - 6;
    p.pos.y = g;
    p.prevPos = { ...p.pos };
    const mob = createMob(900721, MOBS.marrowlord_varkas, 1, { x: wx, y: g, z: wz - 12 });
    for (let i = 0; i < 12; i++) (sim as any).applyKnockback(mob, p, 7);
    const edgeClearance = Math.abs(p.pos.z - wz) - FENCE_HALF_DEPTH - PLAYER_BODY_RADIUS;
    expect(edgeClearance).toBeGreaterThanOrEqual(SKIN_WIDTH - 1e-9);
  });

  it('the shared sweep test: a body exactly tangent to a circle can still sweep away from it', () => {
    // Direct pin of the physics/sweep.ts fix, independent of how a caller
    // reaches exact tangency: sweepPointCircle used to report a t=0 hit
    // regardless of direction whenever the start sat exactly on the
    // boundary (c <= 0), so even motion straight away came back blocked.
    const collider: Collider = { type: 'circle', x: 0, z: 0, r: 2 };
    const r = PLAYER_BODY_RADIUS;
    const R = collider.r + r; // the Minkowski-summed radius sweepCollider tests against
    const hit = { t: 0, nx: 0, nz: 0 };
    // Body center placed EXACTLY on the inflated boundary, moving straight away.
    const away = sweepCollider(collider, R, 0, 1, 0, r, hit);
    expect(away).toBe(false);
  });
});
