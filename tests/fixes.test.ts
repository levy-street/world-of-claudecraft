// Shard 1 of the fixes suite (world/terrain/dungeon-shape fixes). Shared
// fixtures live in tests/fixes_shared.ts; the loot/quest-npc/combat shard is
// tests/fixes_loot_npcs.test.ts.
import { describe, expect, it } from 'vitest';
import { isBlocked, resolvePosition } from '../src/sim/colliders';
import {
  CRYPT_DOOR_POS,
  DUNGEON_LIST,
  DUNGEON_X_THRESHOLD,
  ITEMS,
  LAKE,
  MOBS,
  PROPS,
  zoneAt,
  zoneWelcomeText,
} from '../src/sim/data';
import { EASTBROOK_BUILDINGS_BY_ID, localToWorld } from '../src/sim/eastbrook_layout';
import { createMob } from '../src/sim/entity';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type LootEntry, type SimEvent } from '../src/sim/types';
import {
  DECORATION_MAX_SLOPE,
  generateDecorationsInBounds,
  groundHeight,
  terrainSteepness,
  terrainSteepnessAt,
  terrainWallStandoff,
  WATER_LEVEL,
} from '../src/sim/world';

import { decorations, formRaid, makeLootSim, makeSim, SEED, teleportTo } from './fixes_shared';
import { expectDefined } from './helpers/defined';
import { wallFootFixture } from './helpers/wall_foot';

interface SimPrivateHarness {
  moveToward(e: Entity, target: { x: number; y: number; z: number }, speed: number): void;
  applyAura(target: Entity, aura: Entity['auras'][number]): void;
  handleDeath(target: Entity, source: Entity | null): void;
  rollLoot(
    mob: Entity,
    killer: ReturnType<Sim['meta']>,
    eligible?: ReturnType<Sim['meta']>[],
  ): void;
}

function asHarness(sim: Sim): SimPrivateHarness {
  return sim as unknown as SimPrivateHarness;
}

describe('quest lifecycle', () => {
  it('stops showing the Redbrook starter hint after the first quest is accepted', () => {
    const sim = makeSim();
    const starterZone = zoneAt(sim.player.pos.x, sim.player.pos.z);

    expect(zoneWelcomeText(starterZone, (questId) => sim.questState(questId))).toBe(
      'Find Marshal Redbrook in town - he has work for you.',
    );

    const redbrook = expectDefined(
      [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook'),
    );
    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.acceptQuest('q_wolves');
    expect(zoneWelcomeText(starterZone, (questId) => sim.questState(questId))).toBeNull();

    const qp = expectDefined(sim.questLog.get('q_wolves'));
    qp.counts[0] = 8;
    qp.state = 'ready';

    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.turnInQuest('q_wolves');

    expect(sim.questState('q_wolves')).toBe('done');
    expect(zoneWelcomeText(starterZone, (questId) => sim.questState(questId))).toBeNull();
  });

  it('accepting a quest directly requires standing near the giver', () => {
    const sim = makeSim();
    teleportTo(sim, 0, -40);

    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('available');
    expect(sim.questLog.has('q_wolves')).toBe(false);

    const redbrook = expectDefined(
      [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook'),
    );
    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z);
    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('active');
  });

  it('a turned-in quest cannot be accepted again', () => {
    const sim = makeSim();
    const redbrook = expectDefined(
      [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook'),
    );
    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('active');

    const qp = expectDefined(sim.questLog.get('q_wolves'));
    qp.counts[0] = 8;
    qp.state = 'ready';

    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.turnInQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('done');
    expect(sim.questLog.has('q_wolves')).toBe(false);

    // attempting to take it again must be rejected
    sim.acceptQuest('q_wolves');
    expect(sim.questLog.has('q_wolves')).toBe(false);
    expect(sim.questState('q_wolves')).toBe('done');
  });
});

describe('collision & terrain', () => {
  it('players cannot walk through town buildings', () => {
    const sim = makeSim();
    const p = sim.player;
    const bank = EASTBROOK_BUILDINGS_BY_ID.eastbrook_bank;
    const approach = localToWorld(
      bank.position,
      bank.rotation,
      0,
      bank.nativeDimensions.depth / 2 + 3,
    );
    teleportTo(sim, approach.x, approach.z);
    p.facing = bank.rotation + Math.PI;
    sim.moveInput.forward = true;
    for (let i = 0; i < 120; i++) sim.tick();
    // blocked at the wall: never reaches the interior
    expect(dist2d(p.pos, { ...bank.position, y: 0 })).toBeGreaterThan(2.2);
  });

  it('the open shore is sea with the fatigue turnback, not a wall', () => {
    // The vale's east rim range became coastline (the Farshore's strait):
    // walking east now wades into open water, and the sea itself guards
    // the border: the swimmer takes the fatigue warning and damage long
    // before the far shore. This walk happens to run near the Ferrywalk, so
    // the walker can legitimately catch the sandbar partway: the pins are
    // that the shore ENTERED open water (swimming happened) and the sea
    // warned, and that no invisible wall pinned the walker at the old vale
    // coast cutoff (a final-tick "still swimming" check used to pass only
    // because the x = 178 window cliff trapped the swimmer against it).
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 150, 0);
    p.facing = Math.PI / 2; // +x, into the strait
    sim.moveInput.forward = true;
    let warned = false;
    let swam = false;
    for (let i = 0; i < 400; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'log' && ev.text.includes('open sea')) warned = true;
      }
      if (p.pos.y < WATER_LEVEL + 0.6) swam = true;
    }
    expect(swam).toBe(true); // the shore is water, not a rim range
    expect(warned).toBe(true); // the sea is doing the guarding
    expect(p.pos.x).toBeGreaterThan(190); // ...and no invisible wall pins the swimmer
    // (the escalating fatigue damage itself is pinned by the open-sea test
    // in tests/veiled_hollow.test.ts)
  });

  it('NPCs spawn on dry land outside buildings', () => {
    const sim = makeSim();
    for (const e of sim.entities.values()) {
      if (e.kind !== 'npc') continue;
      expect(groundHeight(e.pos.x, e.pos.z, SEED), `${e.name} underwater`).toBeGreaterThan(
        WATER_LEVEL + 0.5,
      );
      expect(isBlocked(SEED, e.pos.x, e.pos.z, 0.4), `${e.name} inside a prop`).toBe(false);
    }
  });

  it('mobs spawn out of deep water (murlocs may wade)', () => {
    const sim = makeSim();
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob') continue;
      const h = groundHeight(e.pos.x, e.pos.z, SEED);
      const canWade = MOBS[e.templateId].family === 'mudfin' || MOBS[e.templateId].canSwim;
      const min = canWade ? WATER_LEVEL - 0.55 : WATER_LEVEL + 0.35;
      expect(h, `${e.name} at ${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}`).toBeGreaterThan(min);
    }
  });

  it('resolvePosition pushes points out of colliders', () => {
    const center = EASTBROOK_BUILDINGS_BY_ID.eastbrook_bank.position;
    const inside = resolvePosition(SEED, center.x, center.z, 0.5);
    expect(Math.abs(inside.x - center.x) + Math.abs(inside.z - center.z)).toBeGreaterThan(0.5);
    const open = resolvePosition(SEED, 0, -40, 0.5); // open road
    expect(open.x).toBe(0);
    expect(open.z).toBe(-40);
  });

  it('keeps the Fenbridge south approach clear of generated rock blockers', () => {
    expect(isBlocked(SEED, 2, 212, 0.5)).toBe(false);
  });

  it('keeps campfire bases solid for movement', () => {
    const [x, z] = PROPS.campfires[0];
    const blocked = resolvePosition(SEED, x, z, 0.5);
    expect(Math.abs(blocked.x - x) + Math.abs(blocked.z - z)).toBeGreaterThan(0.5);
  });

  it('keeps generated tree trunks solid for movement', () => {
    const tree = decorations().find((decoration) => decoration.kind !== 'rock');
    expect(tree).toBeDefined();
    if (!tree) throw new Error('expected a generated tree');
    const blocked = resolvePosition(SEED, tree.x, tree.z, 0.5);
    expect(Math.abs(blocked.x - tree.x) + Math.abs(blocked.z - tree.z)).toBeGreaterThan(0.5);
  });

  it('bounded decoration queries exactly match filtering the full deterministic field', () => {
    const all = decorations();
    const bounds = [
      { minX: -64, maxX: 73, minZ: -80, maxZ: 230 },
      { minX: -540, maxX: -180, minZ: 900, maxZ: 1900 },
      { minX: 180, maxX: 540, minZ: 900, maxZ: 1900 },
      { minX: 15.9, maxX: 16.1, minZ: 1023.9, maxZ: 1024.1 },
    ];
    for (const box of bounds) {
      expect(generateDecorationsInBounds(SEED, box)).toEqual(
        all.filter((d) => d.x >= box.minX && d.x <= box.maxX && d.z >= box.minZ && d.z <= box.maxZ),
      );
    }
    expect(generateDecorationsInBounds(SEED, { minX: 1, maxX: 0, minZ: 0, maxZ: 1 })).toEqual([]);
  });

  it('does not scatter trees or rocks onto cliff faces', () => {
    // A prop on a wall steeper than the climb limit floats off the face and
    // (for large rocks / trunks) plants an invisible collider there.
    expect(DECORATION_MAX_SLOPE).toBe(1.5);
    const onCliffs = decorations()
      .filter((d) => terrainSteepness(d.x, d.z, SEED) > DECORATION_MAX_SLOPE)
      .map((d) => `${d.kind}@${d.x.toFixed(0)},${d.z.toFixed(0)}`);
    expect(onCliffs).toEqual([]);
  });
});

describe('terrain wall standoff', () => {
  const R = PLAYER_BODY_RADIUS;
  const SLOPE = PLAYER_MAX_CLIMB_SLOPE;

  it('leaves open ground untouched', () => {
    // the Eastbrook hub plateau: flat, no wall within a body radius
    const s = terrainWallStandoff(0, 0, SEED, R, SLOPE);
    expect(s).toEqual({ x: 0, z: 0 });
  });

  it('eases a body off a terrain wall, bounded by one body radius', () => {
    // Sweep the neighbourhood of a pinned, validated REAL wall rather than the
    // strip world's western rim (which the grid world replaced; the old literals
    // sat on open ground and the "it pushes" assertion could never fire).
    const foot = wallFootFixture(SEED, R, SLOPE);
    let pushed = 0;
    let maxMove = 0;
    for (let x = foot.x - 6; x <= foot.x + 6; x += 0.5) {
      for (let z = foot.z - 6; z <= foot.z + 6; z += 0.5) {
        // only positions a player could actually stand on
        if (terrainSteepness(x, z, SEED) > SLOPE) continue;
        const s = terrainWallStandoff(x, z, SEED, R, SLOPE);
        const moved = Math.hypot(s.x - x, s.z - z);
        if (moved === 0) continue;
        pushed++;
        maxMove = Math.max(maxMove, moved);
      }
    }
    expect(pushed).toBeGreaterThan(0); // the standoff actually engages along the wall
    expect(maxMove).toBeLessThanOrEqual(R + 1e-9); // never more than a body radius
  });

  it('keeps the Abandoned Crypt door reachable (door trigger 2.0yd)', () => {
    // the crypt door sits in the west rim at (-152, 610); the standoff must not
    // fence the player out of its 2.0yd trigger.
    const door = { x: -152, z: 610 };
    let closest = Infinity;
    for (let x = -156; x <= -148; x += 0.5) {
      for (let z = 606; z <= 614; z += 0.5) {
        if (terrainSteepness(x, z, SEED) > SLOPE) continue;
        const s = terrainWallStandoff(x, z, SEED, R, SLOPE);
        if (terrainSteepness(s.x, s.z, SEED) > SLOPE) continue;
        closest = Math.min(closest, Math.hypot(s.x - door.x, s.z - door.z));
      }
    }
    expect(closest).toBeLessThan(2.0);
  });

  it('keeps the Abandoned Crypt door clear of the mine-mound collider (door trigger 2.0yd)', () => {
    // The crypt entrance reuses the "mine entrance" prop (rock mound + timber
    // portal) for its visual, sharing the door's exact (x, z). The mound's
    // collider circle must not swallow the door tile itself: a ghost can only
    // ever re-enter through the walk-in proximity trigger (interact() refuses
    // it while dead), so if the full collider stack (not just terrain) pushes
    // every approach outside the 2.0yd trigger, no released spirit can ever
    // get back in.
    const door = { x: -152, z: 610 };
    expect(isBlocked(SEED, door.x, door.z, PLAYER_BODY_RADIUS)).toBe(false);
    let closest = Infinity;
    for (let x = -156; x <= -148; x += 0.25) {
      for (let z = 606; z <= 614; z += 0.25) {
        if (isBlocked(SEED, x, z, PLAYER_BODY_RADIUS)) continue;
        const s = resolvePosition(SEED, x, z, PLAYER_BODY_RADIUS);
        if (isBlocked(SEED, s.x, s.z, PLAYER_BODY_RADIUS)) continue;
        closest = Math.min(closest, Math.hypot(s.x - door.x, s.z - door.z));
      }
    }
    expect(closest).toBeLessThan(2.0);
    // Upper bound: the door-clear fix must not become an excuse to push the
    // mound arbitrarily far back. The forward rock anchors nearest the portal
    // (src/render/props.ts abandonedCrypt mound, local (1.75, -1.2) r 1.1 and
    // (-1.7, -1.25) r 1.15) must stay solid, so a future offset bump can't
    // silently turn the visible rubble into walk-through air.
    expect(isBlocked(SEED, -153.2, 608.25, PLAYER_BODY_RADIUS)).toBe(true);
    expect(isBlocked(SEED, -153.25, 611.7, PLAYER_BODY_RADIUS)).toBe(true);
  });

  it('keeps the OTHER mine mounds on the generic 3.4/5 default (moundOffset/moundRadius fallback)', () => {
    // Only the Abandoned Crypt entry overrides moundOffset/moundRadius; this
    // pins the `?? 3.4` / `?? 5` fallback arm of src/sim/colliders.ts so an
    // edit to either default (or to the mound's rotY math) regresses these
    // two entries silently while the crypt-only assertions above stay green.
    const mineMoundFar = (x: number, z: number, rot: number) => ({
      x: x - 15 * Math.sin(rot),
      z: z - 15 * Math.cos(rot),
    });
    // Deeprock Burrows (88, 612, rot -2.0):
    expect(isBlocked(SEED, 91.09, 613.41, PLAYER_BODY_RADIUS)).toBe(true); // mound center
    const deeprockFar = mineMoundFar(88, 612, -2.0);
    expect(isBlocked(SEED, deeprockFar.x, deeprockFar.z, PLAYER_BODY_RADIUS)).toBe(false); // far past the 5yd mound radius
    // zone1 mine (-88, -68, rot 0.8):
    expect(isBlocked(SEED, -90.44, -70.37, PLAYER_BODY_RADIUS)).toBe(true); // mound center
    const zone1Far = mineMoundFar(-88, -68, 0.8);
    expect(isBlocked(SEED, zone1Far.x, zone1Far.z, PLAYER_BODY_RADIUS)).toBe(false); // far past the 5yd mound radius
  });

  it('keeps the Abandoned Crypt mound collider matched to its visible rock pile', () => {
    // Follow-up to the door-clear fix above: the mound circle must clear the
    // door trigger WITHOUT drifting so far back that it disagrees with the
    // rendered pile (src/render/props.ts), which would open a collision gap
    // under the flanking boulders and wall off open ground behind them that
    // no player ever needed to cross.
    const door = { x: -152, z: 610 };
    // A point inside the rendered flanking boulder (local (2.65, -2.3), r 1.75;
    // world (-154.5, 607.5), rot PI/2) stays blocked under the tightened mound.
    expect(isBlocked(SEED, -154.5, 607.5, PLAYER_BODY_RADIUS)).toBe(true);
    // Open ground well behind the pile's rendered extent (local z < -8, past
    // the farthest rock at z -4.15, r 2.35) is not swallowed by the collider.
    expect(isBlocked(SEED, door.x - 9, door.z, PLAYER_BODY_RADIUS)).toBe(false);
  });

  it('eases a player parked at a rim wall foot off it, end to end through the Sim', () => {
    // A cell the Sim itself treats as FLAT footing (terrainSteepnessAt well under
    // the limit, so no downhill slide and no move gate fires) that still has a
    // wall within a body radius. A no-input grounded tick therefore moves the
    // player ONLY via the standoff in the shared movement kernel, isolating it
    // from the slide: without the standoff the player would not move at all.
    const cell = wallFootFixture(SEED, R, SLOPE);
    expect(terrainSteepnessAt(cell.x, cell.z, SEED)).toBeLessThan(1.0); // flat footing: no slide
    const sim = makeSim();
    teleportTo(sim, cell.x, cell.z);
    sim.player.onGround = true;
    sim.player.vx = 0;
    sim.player.vz = 0;
    sim.player.vy = 0;
    sim.tick();
    const moved = Math.hypot(sim.player.pos.x - cell.x, sim.player.pos.z - cell.z);
    expect(moved).toBeGreaterThan(0.1); // the standoff engaged in the live Sim
    // terrainWallStandoff iterates up to 3 passes, each capped at one body
    // radius, so a single grounded tick can move up to 3x the body radius
    // (1.5yd here), not just one body radius; bound it at the real max.
    expect(moved).toBeLessThanOrEqual(3 * R + 1e-6);
    // and it did not shove the player onto a wall to slide back off
    expect(terrainSteepnessAt(sim.player.pos.x, sim.player.pos.z, SEED)).toBeLessThanOrEqual(
      SLOPE + 1e-6,
    );
  });

  it('does not sawtooth when holding forward into a terrain wall', () => {
    // Hold forward straight into a real wall: the standoff must settle the body at
    // the wall foot, not bounce it in and out every tick.
    const foot = wallFootFixture(SEED, R, SLOPE);
    const sim = makeSim();
    teleportTo(sim, foot.x, foot.z);
    sim.player.facing = foot.facingIntoWall;
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('missing player meta');
    meta.moveInput.forward = true;

    sim.tick(); // allow the body-width standoff to clear the initial wall overlap
    // Sawtooth is oscillation ALONG THE WALL NORMAL (shoved out, walks back in, shoved
    // out again). Sliding sideways along a wall whose normal is not axis-aligned is
    // correct behaviour, so measure only the into-wall component.
    let totalJitter = 0;
    let largestStep = 0;
    for (let i = 0; i < 60; i++) {
      const beforeX = sim.player.pos.x;
      const beforeZ = sim.player.pos.z;
      sim.tick();
      const dInto =
        (sim.player.pos.x - beforeX) * foot.intoWallX +
        (sim.player.pos.z - beforeZ) * foot.intoWallZ;
      totalJitter += Math.abs(dInto);
      largestStep = Math.max(largestStep, Math.abs(dInto));
    }

    expect(largestStep).toBeLessThan(0.02);
    expect(totalJitter).toBeLessThan(0.05);
  });

  it('still preserves tangential wall slide when pushing into the western wall at an angle', () => {
    // Push into the wall at a slight angle: the body must not climb it, and must
    // still slide ALONG it instead of sticking.
    const foot = wallFootFixture(SEED, R, SLOPE);
    const sim = makeSim();
    teleportTo(sim, foot.x, foot.z);
    sim.player.facing = foot.facingIntoWall - 0.2;
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('missing player meta');
    meta.moveInput.forward = true;

    for (let i = 0; i < 20; i++) sim.tick();

    // Never shoved onto the wall itself (it would slide straight back off).
    expect(terrainSteepnessAt(sim.player.pos.x, sim.player.pos.z, SEED)).toBeLessThanOrEqual(
      SLOPE + 1e-6,
    );
    // Progress is TANGENTIAL: it travelled along the wall, not into it.
    const dx = sim.player.pos.x - foot.x;
    const dz = sim.player.pos.z - foot.z;
    const intoWall = dx * foot.intoWallX + dz * foot.intoWallZ;
    const along = Math.hypot(dx - intoWall * foot.intoWallX, dz - intoWall * foot.intoWallZ);
    expect(along, 'slid along the wall').toBeGreaterThan(0.5);
    expect(intoWall, 'never pushed into the wall').toBeLessThan(0.1);
  });
});

describe('swimming', () => {
  it('players float at the surface over deep water', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, LAKE.x, LAKE.z);
    expect(groundHeight(LAKE.x, LAKE.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    // The water overhaul made buoyancy physical: a body dropped over deep
    // water RISES to the float band over a few ticks (measured: surfaced at
    // tick 9 from the lakebed) instead of snapping there in one. The
    // guarantee this pins is reaching the band promptly and STAYING in it.
    let surfacedAt = -1;
    for (let i = 0; i < 40 && surfacedAt < 0; i++) {
      sim.tick();
      if (p.pos.y > WATER_LEVEL - 1.0) surfacedAt = i + 1;
    }
    expect(surfacedAt, 'reaches the float band within 2s').toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(p.pos.y).toBeGreaterThan(WATER_LEVEL - 1.0);
    expect(p.pos.y).toBeLessThan(WATER_LEVEL);
    expect(sim.isSwimming(p)).toBe(true);
  });

  it('ordinary mobs chase into deep water and keep dealing melee damage', () => {
    const sim = makeSim();
    const wolf = expectDefined(
      [...sim.entities.values()].find((e) => e.templateId === 'forest_wolf'),
    );
    // park a chase target in the middle of the lake
    const p = sim.player;
    teleportTo(sim, LAKE.x, LAKE.z);
    wolf.aiState = 'chase';
    wolf.aggroTargetId = p.id;
    wolf.pos = { ...sim.groundPos(LAKE.x + 24, LAKE.z + 24) };
    wolf.spawnPos = { ...wolf.pos };
    wolf.prevPos = { ...wolf.pos };
    const hpBefore = p.hp;
    // 12s of chase, not 8s: the swim-out is the same but the run to the water
    // now detours around the town furniture and gather nodes that sit between
    // the wolf's camp and the shore, so the first swing lands around tick 190.
    // The claim under test is that it arrives and keeps swinging, not how fast.
    for (let i = 0; i < 240; i++) sim.tick();
    expect(groundHeight(wolf.pos.x, wolf.pos.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    expect(wolf.pos.y).toBeGreaterThan(WATER_LEVEL - 1.0);
    expect(p.hp).toBeLessThan(hpBefore);
  });

  it('rare swimmers can chase into deep water', () => {
    const sim = makeSim();
    const rare = createMob(
      990001,
      MOBS.mirejaw_the_ravenous,
      10,
      sim.groundPos(LAKE.x + 24, LAKE.z + 24),
    );
    for (let i = 0; i < 120; i++) {
      asHarness(sim).moveToward(rare, { x: LAKE.x, y: 0, z: LAKE.z }, rare.moveSpeed);
    }
    expect(groundHeight(rare.pos.x, rare.pos.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    expect(rare.pos.y).toBeGreaterThan(WATER_LEVEL - 1.0);
  });
});

describe('rare spawn rules', () => {
  it('rare spawns are elite, control immune, swimmers with configured respawns', () => {
    for (const id of [
      'mirejaw_the_ravenous',
      'sister_nhalia',
      'ironvein_foreman',
      'marrowlord_varkas',
    ]) {
      expect(MOBS[id], id).toMatchObject({
        rare: true,
        elite: true,
        canSwim: true,
        ccImmune: true,
      });
      if (id === 'mirejaw_the_ravenous' || id === 'sister_nhalia')
        expect(MOBS[id].respawnMult).toBe(648);
      // Ironvein Foreman + Marrowlord Varkas rise hourly (144 * 25s base) so
      // their epic T1 boots/legs are farmable on a predictable cadence.
      else expect(MOBS[id].respawnMult).toBe(144);
    }
    expect(MOBS.mogger).toMatchObject({
      rare: true,
      elite: true,
      canSwim: true,
      ccImmune: true,
      respawnMult: 4,
    });
  });

  it('control auras do not stick to control-immune rares', () => {
    const sim = makeSim();
    const rare = createMob(990002, MOBS.mirejaw_the_ravenous, 10, { x: 0, y: 0, z: 0 });

    asHarness(sim).applyAura(rare, {
      id: 'test_root',
      name: 'Test Root',
      kind: 'root',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: sim.playerId,
      school: 'physical',
    });
    expect(rare.auras.some((a) => a.kind === 'root')).toBe(false);

    asHarness(sim).applyAura(rare, {
      id: 'test_slow',
      name: 'Test Slow',
      kind: 'slow',
      remaining: 5,
      duration: 5,
      value: 0.5,
      sourceId: sim.playerId,
      school: 'physical',
    });
    expect(rare.auras.some((a) => a.kind === 'slow')).toBe(true);
  });

  it('rare respawn timers use their configured multiplier', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', respawnSeconds: 2 });
    const rare = createMob(990003, MOBS.mirejaw_the_ravenous, 10, { x: 0, y: 0, z: 0 });
    asHarness(sim).handleDeath(rare, null);
    expect(rare.respawnTimer).toBe(1296);
  });

  it('quest-related named rares respawn after 3 minutes', () => {
    const ids = ['old_cragmaw'] as const;
    for (const id of ids) {
      const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
      const mob = createMob(990004, MOBS[id], MOBS[id].maxLevel, { x: 0, y: 0, z: 0 });
      asHarness(sim).handleDeath(mob, null);
      expect(mob.respawnTimer, id).toBe(180);
    }
  });

  it('Mogger respawns on a quest-boss timer instead of a long rare-spawn timer', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', respawnSeconds: 2 });
    const mogger = expectDefined(
      [...sim.entities.values()].find((e) => e.kind === 'mob' && e.templateId === 'mogger'),
    );

    asHarness(sim).handleDeath(mogger, null);

    expect(mogger.respawnTimer).toBe(8);
  });

  it('outdoor rare spawns have 3-player mechanics and no-loot summoned helpers', () => {
    const rareIds = [
      'mogger',
      'mirejaw_the_ravenous',
      'sister_nhalia',
      'ironvein_foreman',
      'marrowlord_varkas',
    ];

    for (const id of rareIds) {
      const rare = MOBS[id];
      expect(rare.elite, id).toBe(true);
      expect(rare.ccImmune, id).toBe(true);
      expect(
        !!rare.aoePulse || !!rare.summonAdds || !!rare.enrage,
        `${id} should have at least one mechanic`,
      ).toBe(true);
      if (rare.summonAdds) {
        expect(MOBS[rare.summonAdds.mobId], `${id} summon target`).toBeTruthy();
        expect(MOBS[rare.summonAdds.mobId].loot, `${id} summon loot`).toEqual([]);
      }
    }

    expect(MOBS.mogger.summonAdds).toEqual({ mobId: 'mogger_lackey', count: 2, atHpPct: [0.7] });
    expect(MOBS.mogger.enrage).toEqual({ belowHpPct: 0.3, dmgMult: 1.6, hasteMult: 1.3 });
  });
});

describe('the Hollow Crypt doors', () => {
  it('walking into the door teleports you inside; walking into the exit brings you back', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1.2);
    sim.tick();
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);

    // the exit portal sits 6yd behind the entry point — walk into it
    const exit = expectDefined(
      [...sim.entities.values()].find((e) => e.templateId === 'dungeon_exit'),
    );
    p.pos.x = exit.pos.x;
    p.pos.z = exit.pos.z + 1.2;
    p.facing = Math.PI;
    sim.tick();
    expect(p.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(dist2d(p.pos, { x: CRYPT_DOOR_POS.x, y: 0, z: CRYPT_DOOR_POS.z }) < 8).toBe(true);
  });

  it('party members who walk in share one instance', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.partyOf(a)?.members).toContain(b);

    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, a);
    sim.tick();
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, b);
    sim.tick();

    const ea = expectDefined(sim.entities.get(a));
    const eb = expectDefined(sim.entities.get(b));
    expect(ea.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(eb.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const slotA = sim.instanceSlotAt(ea.pos);
    const slotB = sim.instanceSlotAt(eb.pos);
    const infoA = sim.instanceInfoAt(ea.pos);
    const infoB = sim.instanceInfoAt(eb.pos);
    expect(slotA).not.toBeNull();
    expect(slotA).toBe(slotB);
    expect(infoA).toEqual({ slot: slotA, dungeonId: 'hollow_crypt' });
    expect(infoB).toEqual(infoA);
  });

  it('solo players from different groups get different instances', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, a);
    sim.tick();
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, b);
    sim.tick();
    const slotA = sim.instanceSlotAt(expectDefined(sim.entities.get(a)).pos);
    const slotB = sim.instanceSlotAt(expectDefined(sim.entities.get(b)).pos);
    expect(slotA).not.toBeNull();
    expect(slotB).not.toBeNull();
    expect(slotA).not.toBe(slotB);
  });
});

describe('dungeon instance placement and targetability', () => {
  it('places every dungeon entry and mob spawn on unblocked instance ground', () => {
    for (const dungeon of DUNGEON_LIST) {
      const sim = makeSim();
      if (dungeon.id === 'nythraxis_boss_arena') {
        sim.players.get(sim.playerId)?.questsDone.add('q_nythraxis_bound_guardian');
        formRaid(sim);
      }
      sim.enterDungeon(dungeon.id);
      const p = sim.player;
      expect(p.pos.x, `${dungeon.id} entry is not inside an instance`).toBeGreaterThan(
        DUNGEON_X_THRESHOLD,
      );
      expect(
        isBlocked(SEED, p.pos.x, p.pos.z, 0.5),
        `${dungeon.id} entry spawned in geometry`,
      ).toBe(false);

      const mobs = [...sim.entities.values()].filter(
        (e) => e.kind === 'mob' && e.spawnPos.x > DUNGEON_X_THRESHOLD,
      );
      const objects = [...sim.entities.values()].filter(
        (e) =>
          e.kind === 'object' &&
          (e.objectItemId || e.templateId === 'dungeon_door') &&
          e.pos.x > DUNGEON_X_THRESHOLD,
      );
      expect(
        mobs.length + objects.length,
        `${dungeon.id} spawned no instance encounters`,
      ).toBeGreaterThan(0);
      for (const mob of mobs) {
        expect(mob.hostile, `${dungeon.id} ${mob.name} is not hostile`).toBe(true);
        expect(
          sim.isHostileTo(sim.player, mob),
          `${dungeon.id} ${mob.name} is not targetable`,
        ).toBe(true);
        expect(
          isBlocked(SEED, mob.pos.x, mob.pos.z, 0.5),
          `${dungeon.id} ${mob.name} spawned in geometry`,
        ).toBe(false);
      }
      for (const obj of objects) {
        expect(obj.lootable, `${dungeon.id} ${obj.name} is not interactable`).toBe(true);
        expect(
          isBlocked(SEED, obj.pos.x, obj.pos.z, 0.5),
          `${dungeon.id} ${obj.name} spawned in geometry`,
        ).toBe(false);
      }
    }
  });
});

describe('mob stat scaling', () => {
  it('scales armor from level 1 like hp and damage, not one level ahead', () => {
    const template = MOBS.gray_wolf ?? Object.values(MOBS)[0];
    const lvl1 = createMob(910001, template, 1, { x: 0, y: 0, z: 0 });
    const lvl10 = createMob(910010, template, 10, { x: 0, y: 0, z: 0 });
    // A level-1 mob has no level-scaled armor (no armorBase in the template).
    expect(lvl1.stats.armor).toBe(0);
    // Each level adds exactly armorPerLevel, matching the (level - 1) convention.
    expect(lvl10.stats.armor).toBe(Math.round(template.armorPerLevel * 9));
  });
});
describe('boss loot and encounter resets', () => {
  it('boss roll groups drop at most one item from each exclusive table', () => {
    const sim = makeLootSim();
    const meta = expectDefined(sim.meta(sim.playerId));
    for (const [bossId, groupId, exactlyOne] of [
      ['morthen', 'morthen_guaranteed_uncommon', true],
      ['morthen', 'morthen_bonus', false],
      ['knight_commander_olen', 'olen_guaranteed_uncommon', true],
      ['knight_commander_olen', 'olen_bonus', false],
      ['vael_the_mistcaller', 'vael_guaranteed_uncommon', true],
      ['vael_the_mistcaller', 'vael_bonus', false],
      ['korgath_the_bound', 'korgath_guaranteed_uncommon', true],
      ['korgath_the_bound', 'korgath_bonus', false],
      ['grand_necromancer_velkhar', 'velkhar_guaranteed_uncommon', true],
      ['grand_necromancer_velkhar', 'velkhar_bonus', false],
      ['korzul_the_gravewyrm', 'korzul_guaranteed_uncommon', true],
      ['korzul_the_gravewyrm', 'korzul_bonus', false],
    ] as const) {
      const template = MOBS[bossId];
      const groupItems = template.loot
        .filter((l) => l.rollGroup === groupId)
        .map((l) => expectDefined(l.itemId));
      expect(groupItems.length).toBeGreaterThan(0);
      const mob = createMob(900000, template, 20, { x: 0, y: 0, z: 0 });
      // accessor defeats TS narrowing (mob.loot is assigned null in the loop)
      const lootOf = (m: Entity) => m.loot;
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        mob.loot = null;
        asHarness(sim).rollLoot(mob, meta);
        const dropped = (lootOf(mob)?.items ?? []).filter((s) => groupItems.includes(s.itemId));
        if (exactlyOne) {
          expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeGreaterThanOrEqual(1);
          expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeLessThanOrEqual(2);
        } else expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeLessThanOrEqual(1);
        if (dropped[0]) seen.add(dropped[0].itemId);
      }
      if (exactlyOne) expect([...seen].sort()).toEqual([...groupItems].sort()); // all three reachable
    }
  });

  it('dungeon bosses always drop gear but cap bonus quality drops', () => {
    const sim = makeLootSim();
    const meta = expectDefined(sim.meta(sim.playerId));
    const lootOf = (m: Entity) => m.loot;
    for (const bossId of [
      'morthen',
      'knight_commander_olen',
      'vael_the_mistcaller',
      'korgath_the_bound',
      'grand_necromancer_velkhar',
      'korzul_the_gravewyrm',
    ]) {
      const template = MOBS[bossId];
      const mob = createMob(900010, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      for (let i = 0; i < 300; i++) {
        mob.loot = null;
        asHarness(sim).rollLoot(mob, meta);
        // Gear only: a collectible mount reins (kind 'mount') rides its own
        // independent drop and is exempt from the bonus-gear caps.
        const gear = (lootOf(mob)?.items ?? []).filter((s) => {
          const def = ITEMS[s.itemId];
          if (def?.kind === 'mount') return false;
          const q = def?.quality;
          return q === 'uncommon' || q === 'rare' || q === 'epic';
        });
        const uncommon = gear.filter((s) => ITEMS[s.itemId]?.quality === 'uncommon');
        const premium = gear.filter((s) => {
          const q = ITEMS[s.itemId]?.quality;
          return q === 'rare' || q === 'epic';
        });
        expect(gear.length, bossId).toBeGreaterThanOrEqual(1);
        expect(gear.length, bossId).toBeLessThanOrEqual(2);
        expect(uncommon.length, bossId).toBeGreaterThanOrEqual(1);
        expect(uncommon.length, bossId).toBeLessThanOrEqual(2);
        expect(premium.length, bossId).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fair-splits corpse copper among nearby party members, including the in-range fallen', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    const c = sim.addPlayer('rogue', 'Cyra');
    const d = sim.addPlayer('priest', 'Dara');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    sim.partyInvite(d, a);
    sim.partyAccept(d);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    teleportTo(sim, 20, 21, c);
    teleportTo(sim, 160, 160, d);
    // Cyra was downed during the fight; her corpse is still on the mob. Classic
    // group rules keep a fallen-but-in-range member in the split (the old bug
    // erased her share for dying). Only Dara, who is far away, is excluded.
    expectDefined(sim.entities.get(c)).dead = true;
    const mob = createMob(990099, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 12, items: [] };
    sim.entities.set(mob.id, mob);

    sim.lootCorpse(mob.id, b);

    const gains = [a, b, c, d].map((pid) => sim.meta(pid)?.copper ?? 0);
    expect(gains[0] + gains[1] + gains[2]).toBe(12); // a, b, and the fallen c share it
    expect(gains[0]).toBeGreaterThan(0);
    expect(gains[1]).toBeGreaterThan(0);
    expect(gains[2]).toBeGreaterThan(0);
    expect(gains[3]).toBe(0); // Dara is out of range
    expect(mob.loot).toBeNull();
  });

  it('poor and common corpse drops are awarded directly (round-robin) without need-greed rolls', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990098, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = {
      copper: 0,
      items: [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'raw_mirror_trout', count: 1 },
      ],
    };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    // Both drops are auto-awarded (no roll), but the default common-item
    // strategy is round-robin, not looter-takes-all: the cursor advances once
    // per item, so the two drops spread across the party rather than both
    // landing on the looter.
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(sim.countItem('raw_mirror_trout', b)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(0);
    expect(sim.countItem('raw_mirror_trout', a)).toBe(0);
    const prompts = sim.events.filter((e) => e.type === 'lootRoll');
    expect(prompts).toHaveLength(0);
    expect(mob.loot).toBeNull();
  });

  it('uncommon and better corpse drops open need-greed rolls among nearby party members', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990100, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    expect(sim.countItem('greyjaw_hide_boots', a) + sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    const prompts = sim.events.filter((e) => e.type === 'lootRoll');
    expect(prompts).toHaveLength(2);
    expect(prompts.every((e) => e.itemId === 'greyjaw_hide_boots')).toBe(true);
    expect(mob.loot).toBeNull();
  });

  it('opens a need-greed roll instead of auto-awarding grouped item drops', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990102, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    const prompts = sim.events.filter((e) => e.type === 'lootRoll');
    expect(prompts).toHaveLength(2);
    expect(prompts.every((e) => e.itemId === 'greyjaw_hide_boots')).toBe(true);
    expect(mob.loot).toBeNull();
  });

  it('awards need over greed regardless of the greed roll number', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990103, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    const rng = sim.rng;
    const realInt = rng.int.bind(rng);
    const rolls = [1, 100];
    rng.int = (min: number, max: number) =>
      min === 1 && max === 100 ? expectDefined(rolls.shift()) : realInt(min, max);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'need', a);
    sim.submitLootRoll(rollId, 'greed', b);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(1);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(
      sim.events.some((e) => e.type === 'loot' && e.text.includes('wins [[i:greyjaw_hide_boots]]')),
    ).toBe(true);
  });

  it('excludes players who pass on a need-greed roll', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990104, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'pass', a);
    sim.submitLootRoll(rollId, 'greed', b);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(1);
  });

  it('treats unanswered need-greed rolls as pass at timeout', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990105, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const events: SimEvent[] = [];
    for (let i = 0; i < 61 * 20; i++) events.push(...sim.tick());

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(
      events.some(
        (e) => e.type === 'loot' && e.text === 'Everyone passed on [[i:greyjaw_hide_boots]].',
      ),
    ).toBe(true);
  }, 90_000);

  it('returns all-passed need-greed loot to the corpse as open loot', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990106, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'pass', a);
    sim.submitLootRoll(rollId, 'pass', b);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(mob.lootable).toBe(true);
    expect(mob.loot?.items).toEqual([{ itemId: 'greyjaw_hide_boots', count: 1, openToAll: true }]);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, b);

    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(1);
    expect(mob.loot).toBeNull();
    expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(false);
  });

  it('lets any player loot an all-passed need-greed item without starting another roll', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    const c = sim.addPlayer('rogue', 'Cyra');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    teleportTo(sim, 22, 20, c);
    const mob = createMob(990107, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'pass', a);
    sim.submitLootRoll(rollId, 'pass', b);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, c);

    expect(sim.countItem('greyjaw_hide_boots', c)).toBe(1);
    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(sim.events.some((e) => e.type === 'error' && e.text.includes('permission'))).toBe(false);
    expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(false);
  });

  it('returns timed-out need-greed loot to the corpse for whoever loots next', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990108, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    for (let i = 0; i < 61 * 20; i++) sim.tick();

    expect(mob.loot?.items).toEqual([{ itemId: 'greyjaw_hide_boots', count: 1, openToAll: true }]);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(1);
    expect(mob.loot).toBeNull();
    expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(false);
  });

  it('quest drops stay on the corpse as personal loot for every eligible nearby party member', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    for (const pid of [a, b]) {
      sim.meta(pid)?.questLog.set('q_boars', { questId: 'q_boars', counts: [0], state: 'active' });
    }
    const mob = createMob(990101, MOBS.wild_boar, 3, { x: 20, y: 0, z: 22 });
    const boarHide = expectDefined(
      MOBS.wild_boar.loot.find((entry) => entry.itemId === 'boar_hide'),
    );
    const oldChance = boarHide.chance;
    boarHide.chance = 1;
    try {
      asHarness(sim).rollLoot(mob, expectDefined(sim.meta(a)), [
        expectDefined(sim.meta(a)),
        expectDefined(sim.meta(b)),
      ]);
    } finally {
      boarHide.chance = oldChance;
    }
    if (mob.loot) {
      mob.loot.copper = 0;
      mob.loot.items = mob.loot.items.filter((item) => item.itemId === 'boar_hide');
    }

    expect(sim.countItem('boar_hide', a)).toBe(0);
    expect(sim.countItem('boar_hide', b)).toBe(0);
    expect(mob.loot?.items).toContainEqual({ itemId: 'boar_hide', count: 1, personalFor: [a, b] });

    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    sim.entities.set(mob.id, mob);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);

    sim.lootCorpse(mob.id, a);
    expect(sim.countItem('boar_hide', a)).toBe(1);
    expect(sim.countItem('boar_hide', b)).toBe(0);
    expect(mob.lootable).toBe(true);
    expect(mob.loot?.items).toContainEqual({ itemId: 'boar_hide', count: 1, personalFor: [b] });

    sim.partyLeave(b);
    sim.lootCorpse(mob.id, b);
    expect(sim.countItem('boar_hide', b)).toBe(1);
    expect(mob.loot).toBeNull();
    // The emptied boar corpse stays lootable through its
    // unclaimed-harvest grace window instead of collapsing immediately.
    expect(mob.lootable).toBe(true);
  });

  it('personal loot remains claimable after party rights are gone without granting shared loot', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    const mob = createMob(990103, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = {
      copper: 88,
      items: [
        { itemId: 'boar_hide', count: 1, personalFor: [b] },
        { itemId: 'wolf_fang', count: 1 },
      ],
    };
    sim.entities.set(mob.id, mob);
    teleportTo(sim, 20, 20, b);

    const beforeCopper = sim.meta(b)?.copper;
    sim.lootCorpse(mob.id, b);

    expect(sim.countItem('boar_hide', b)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(0);
    expect(sim.meta(b)?.copper).toBe(beforeCopper);
    expect(mob.loot?.copper).toBe(88);
    expect(mob.loot?.items).toContainEqual({ itemId: 'wolf_fang', count: 1 });
  });

  it('does not drop a quest-gated item whose quest has no matching collect objective', () => {
    const sim = makeLootSim();
    const a = sim.playerId;
    // q_boars only collects boar_hide; it has no collect objective for greyjaw_fang.
    sim.meta(a)?.questLog.set('q_boars', { questId: 'q_boars', counts: [0], state: 'active' });
    const mob = createMob(990102, MOBS.wild_boar, 3, { x: 20, y: 0, z: 22 });
    // Inject a (mis)configured drop gated on q_boars but for an item the quest
    // does not collect. It must never drop, even at chance 1.
    const bogus: LootEntry = { itemId: 'greyjaw_fang', chance: 1, questId: 'q_boars' };
    MOBS.wild_boar.loot.push(bogus);
    try {
      asHarness(sim).rollLoot(mob, expectDefined(sim.meta(a)), [expectDefined(sim.meta(a))]);
    } finally {
      MOBS.wild_boar.loot.pop();
    }
    const dropped = (mob.loot?.items ?? []).some((slot) => slot.itemId === 'greyjaw_fang');
    expect(dropped).toBe(false);
  });

  it('boss adds despawn on encounter reset instead of stacking across pulls', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 45, 515 - 1.2); // walk into the Sunken Bastion door
    sim.tick();
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const vael = expectDefined(
      [...sim.entities.values()].find((e) => e.templateId === 'vael_the_mistcaller'),
    );
    const thralls = () =>
      [...sim.entities.values()].filter((e) => e.templateId === 'drowned_thrall').length;
    // pull to 50%: the 60% summon threshold fires one wave of 2 thralls
    vael.inCombat = true;
    vael.hp = Math.floor(vael.maxHp * 0.5);
    const events = sim.tick();
    expect(thralls()).toBe(2);
    // the "calls for aid!" log is anchored to the boss so it routes by radius
    const aid = events.find((e) => e.type === 'log' && e.text.includes('calls for aid'));
    expect(aid && 'entityId' in aid ? aid.entityId : undefined).toBe(vael.id);
    // wipe-style reset: boss evades home -> wave despawns, thresholds re-arm
    vael.aiState = 'evade';
    vael.aggroTargetId = null;
    vael.pos = { ...vael.spawnPos };
    sim.tick();
    expect(vael.aiState).toBe('idle');
    expect(vael.firedSummons).toBe(0);
    expect(thralls()).toBe(0);
  });

  it('does not summon more Varkas Boneguards after Marrowlord Varkas dies', () => {
    const sim = makeSim();
    const internals = sim as unknown as {
      addEntity(e: Entity): void;
      dealDamage(
        source: Entity,
        target: Entity,
        amount: number,
        crit: boolean,
        school: string,
        ability: string | null,
        kind: 'hit',
        noRage?: boolean,
      ): void;
      updateBossMechanics(mob: Entity): void;
    };
    const varkas = createMob(990103, MOBS.marrowlord_varkas, 19, { x: 0, y: 0, z: 0 });
    internals.addEntity(varkas);
    teleportTo(sim, 2, 0);
    sim.player.maxHp = 100000;
    sim.player.hp = sim.player.maxHp;
    varkas.inCombat = true;
    varkas.aggroTargetId = sim.player.id;
    varkas.hp = Math.floor(varkas.maxHp * 0.65);
    internals.updateBossMechanics(varkas);

    const boneguards = () =>
      [...sim.entities.values()].filter((e) => e.templateId === 'varkas_boneguard');
    expect(boneguards()).toHaveLength(2);
    expect(varkas.firedSummons).toBe(1);

    internals.dealDamage(
      sim.player,
      varkas,
      varkas.hp + 1,
      false,
      'physical',
      'Test Strike',
      'hit',
      true,
    );
    expect(varkas.dead).toBe(true);

    internals.updateBossMechanics(varkas);
    for (let i = 0; i < 5; i++) sim.tick();

    expect(boneguards()).toHaveLength(2);
    expect(varkas.firedSummons).toBe(1);
  });

  it('leaveDungeon outdoors is a no-op (no crypt-door fallback teleport)', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 0, -40);
    sim.leaveDungeon();
    expect(p.pos.x).toBe(0);
    expect(p.pos.z).toBe(-40);
  });

  it('selling requires a vendor within interact range', () => {
    const sim = makeSim();
    sim.addItem('wolf_fang', 1);
    teleportTo(sim, 0, -40); // open road, far from every vendor
    const copperBefore = sim.copper;
    sim.sellItem('wolf_fang');
    expect(sim.countItem('wolf_fang')).toBe(1);
    expect(sim.copper).toBe(copperBefore);
  });
});
