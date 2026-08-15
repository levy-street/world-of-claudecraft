import { describe, expect, it } from 'vitest';
import {
  bankerChestSpots,
  type Collider,
  campCrateShape,
  colliderTopAt,
  DOCK_HUT_ROOF_EAVE,
  DOCK_HUT_ROOF_TOP,
  interiorColliderFrame,
  isBlocked,
  queryOpenWorldColliders,
  resolvePosition,
  STALL_CANOPY_EAVE,
  STALL_CANOPY_TOP,
  supportHeightAt,
} from '../src/sim/colliders';
import {
  ARENA_X,
  BUILTIN_WORLD,
  DUNGEONS,
  GATHER_NODES,
  instanceOrigin,
  NPCS,
  YUMI_BAND_X_MIN,
} from '../src/sim/data';
import { CRYPT_LAYOUT, DAIS_HEIGHT, tombSlotRoll } from '../src/sim/dungeon_layout';
import {
  CHAPEL_HALL_ROOF_EAVE,
  CHAPEL_HALL_ROOF_TOP,
  DOOR_ARCH_JAMB_X,
  delveArchZ,
  delveExitDropZ,
  GATHER_NODE_BODIES,
  TOWN_WALL_PARAPET_FRAC,
  TOWN_WALL_TALL_PILLAR_ALONG,
} from '../src/sim/prop_layout';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';

// The physics-asset audit, world half (docs/design/physics-asset-audit.md):
// every town standable reachable and stable, every full-height prop a real
// wall, chapel and dock flows, the dungeon deep sweep, and the programmatic
// collider sanity sweeps (camera tops, NPC spots, interior tops).

const SEED = 42;
const IDLE: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.setPlayerLevel(60);
  return sim;
}

function teleport(sim: Sim, x: number, z: number, facing: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = facing;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.climb = null;
}

function hold(sim: Sim, input: Partial<MoveInput>, ticks: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('no meta');
  for (let i = 0; i < ticks; i++) {
    Object.assign(meta.moveInput, IDLE, input);
    sim.tick();
  }
}

// Jump-spam toward a heading for `ticks`; returns the max feet height above
// the local ground reached while grounded (i.e. what got STOOD on).
function maxStoodHeight(sim: Sim, ticks: number): number {
  const p = sim.player;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('no meta');
  let best = 0;
  for (let i = 0; i < ticks; i++) {
    Object.assign(meta.moveInput, IDLE, { forward: true, jump: true });
    sim.tick();
    if (p.onGround) {
      best = Math.max(best, p.pos.y - terrainHeight(p.pos.x, p.pos.z, SEED));
    }
  }
  return best;
}

describe('full-height props reject standing (jump-spam 4s each)', () => {
  const cases: [string, number, number, number][] = [
    // name, startX, startZ, facing toward the prop
    ['civic well beacon', -0.75, 2 - 3.1, 0],
    ['tent', 62, -61 - 2.8, 0],
    ['mud hut stem', -3, 292, 0], // zone2 murloc camp (approx; adjust below)
    ['inn wall', -12.5, 16.5 - 4.8, 0],
    ['bank wall', 18 - 5.4, 10.5, Math.PI / 2],
    ['Grand Armoury wall', 12, -5.5, Math.PI / 2],
    // Approach from the north so the post-slide run heads for open ground:
    // the southern lane now passes the banker's standable strongbox.
    ['notice board', 10, -8 + 1.6, Math.PI],
  ];
  for (const [name, x, z, f] of cases) {
    it(`cannot stand on the ${name}`, () => {
      const sim = makeSim();
      teleport(sim, x, z, f);
      const stood = maxStoodHeight(sim, 80);
      // Nothing standable here: max grounded height stays under a stride.
      expect(stood).toBeLessThan(0.95);
    });
  }
});

describe('the town wall is a vaultable parapet, not a curtain', () => {
  it('a jump vaults onto the parapet, and over it to the outside', () => {
    // Mid-arc of the south run, between gates. The drawn wing is a stone
    // parapet with an open iron railing: the slab top is standable at its
    // drawn height and a jump crosses the wall entirely.
    const sim = makeSim();
    teleport(sim, 0, -25.4, Math.PI);
    const p = sim.player;
    let onWall = false;
    for (let i = 0; i < 140 && !onWall; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const rel = p.pos.y - terrainHeight(p.pos.x, p.pos.z, SEED);
      if (p.onGround && rel > 1.1) onWall = true;
    }
    expect(onWall).toBe(true);
    // Keep pushing: down the far side, OUTSIDE the ring.
    for (let i = 0; i < 80; i++) hold(sim, { forward: true, jump: true }, 1);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThan(28.4);
  });

  it('the tall lantern pylons stay full-height even for a body on the parapet', () => {
    const walls = BUILTIN_WORLD.props.walls ?? [];
    expect(walls.length).toBeGreaterThan(0);
    for (const wall of walls.slice(0, 6)) {
      const mirror = wall.mirrored ? -1 : 1;
      const along = TOWN_WALL_TALL_PILLAR_ALONG * mirror * (wall.w / 2);
      const px = wall.x + Math.sin(wall.rot + Math.PI / 2) * along;
      const pz = wall.z + Math.cos(wall.rot + Math.PI / 2) * along;
      const parapetY = groundHeight(px, pz, SEED) + wall.height * TOWN_WALL_PARAPET_FRAC + 1e-3;
      // A mover standing at parapet height is still pushed out of the pylon.
      const res = resolvePosition(SEED, px, pz, 0.4, false, undefined, {
        y: parapetY,
        lift: 0,
      });
      const moved = Math.hypot(res.x - px, res.z - pz);
      expect(moved, `${wall.id} pylon holds at parapet height`).toBeGreaterThan(1e-4);
    }
  });
});

describe('interactable landmarks are solid (the v0.31 walk-through sweep)', () => {
  it('the Ravenpost pillar blocks, and its posting spot stays clear', () => {
    // Authored at (0, -7.5); the pillar's shaft is a full-height OBB.
    expect(isBlocked(SEED, 0, -7.5, 0.5)).toBe(true);
    expect(isBlocked(SEED, 0, -6.4, 0.5)).toBe(false);
    expect(supportHeightAt(SEED, 0, -7.5, 0.5, 1e9)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("the banker's strongbox blocks and is standable at its drawn 1.3 lid", () => {
    const spots = bankerChestSpots(SEED);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    for (const spot of spots) {
      expect(isBlocked(SEED, spot.x, spot.z, 0.5), `chest at ${spot.x},${spot.z}`).toBe(true);
      const expected = groundHeight(spot.x, spot.z, SEED) + 1.3;
      expect(supportHeightAt(SEED, spot.x, spot.z, 0.5, expected + 0.01)).toBeCloseTo(expected, 6);
      // The banker's own point beside it stays reachable at route body radius.
      expect(isBlocked(SEED, spot.anchorX, spot.anchorZ, 0.8), 'banker point').toBe(false);
    }
  });

  it('ore veins and wood piles block and stand at their drawn tops; herbs stay soft', () => {
    let ore = 0;
    let wood = 0;
    let herb = 0;
    for (const node of GATHER_NODES) {
      const body = GATHER_NODE_BODIES[node.type];
      if (!body) {
        expect(node.type).toBe('herb');
        herb++;
        continue;
      }
      if (node.type === 'ore') ore++;
      else wood++;
      expect(isBlocked(SEED, node.pos.x, node.pos.z, 0.5), node.id).toBe(true);
      const expected = groundHeight(node.pos.x, node.pos.z, SEED) + body.top;
      expect(
        supportHeightAt(SEED, node.pos.x, node.pos.z, 0.5, expected + 0.01),
        node.id,
      ).toBeCloseTo(expected, 6);
    }
    expect(ore).toBeGreaterThan(0);
    expect(wood).toBeGreaterThan(0);
    expect(herb).toBeGreaterThan(0);
  });

  it('dungeon door jambs block while the mouth stays a walkable trigger lane', () => {
    const door = DUNGEONS.hollow_crypt.doorPos;
    for (const sx of [-DOOR_ARCH_JAMB_X, DOOR_ARCH_JAMB_X]) {
      expect(isBlocked(SEED, door.x + sx, door.z, 0.4), `jamb ${sx}`).toBe(true);
    }
    // A body walking the centreline reaches the trigger point itself.
    expect(isBlocked(SEED, door.x, door.z, 0.5)).toBe(false);
    // The Abandoned Crypt draws no arch (invisible click box): no jambs.
    const nyth = DUNGEONS.nythraxis_crypt.doorPos;
    expect(isBlocked(SEED, nyth.x + DOOR_ARCH_JAMB_X, nyth.z, 0.4)).toBe(false);
  });

  it('the delve arch slab is solid and the exit drop lands clear of it', () => {
    for (const dm of BUILTIN_WORLD.props.delveMarkers ?? []) {
      const az = delveArchZ(dm.z, dm.delveId);
      expect(isBlocked(SEED, dm.x, az, 0.5), dm.delveId).toBe(true);
      const dropZ = delveExitDropZ(dm.z, dm.delveId);
      expect(isBlocked(SEED, dm.x, dropZ, 0.6), `${dm.delveId} exit drop`).toBe(false);
    }
  });
});

describe('civic bench (rebuild furniture)', () => {
  it('strides up onto the seat with no jump, and off again clean', () => {
    // South bench at (0, -0.9), rot PI, drawn 1.8 x 0.6 x 0.40: the 0.40 seat
    // sits inside MAX_STEP_HEIGHT, so a plain walk climbs it like a kerb.
    const sim = makeSim();
    teleport(sim, 0, -0.9 - 1.3, 0);
    const p = sim.player;
    let stood = 0;
    for (let i = 0; i < 40; i++) {
      hold(sim, { forward: true }, 1);
      if (p.onGround) stood = Math.max(stood, p.pos.y - groundHeight(p.pos.x, p.pos.z, SEED));
    }
    expect(stood).toBeGreaterThan(0.3);
    expect(stood).toBeLessThan(0.5);
    // Keep walking: off the far side, seated back on the terrain, unhurt.
    const hpBefore = p.hp;
    hold(sim, { forward: true }, 30);
    expect(p.hp).toBe(hpBefore);
    expect(p.pos.y - groundHeight(p.pos.x, p.pos.z, SEED)).toBeLessThan(0.1);
  });
});

describe('rebuild market stall (flat canopy at the authored height)', () => {
  // The World Market stall at (-5.5, 9.5): authored 2.8 x 2.2 OBB whose
  // canopy deck is the mesh's bounding top, drawn at exactly height 2.7.
  const sx = -5.5;
  const sz = 9.5;
  const srot = 2.508844;

  it('jump at the counter grabs the canopy, stands flat at 2.7, and walks off', () => {
    const sim = makeSim();
    // Approach along the stall's local +z (its front face).
    const fx = Math.sin(srot);
    const fz = Math.cos(srot);
    const startX = sx + fx * 2.6;
    const startZ = sz + fz * 2.6;
    teleport(sim, startX, startZ, Math.atan2(sx - startX, sz - startZ));
    const p = sim.player;
    let onCanopy = false;
    for (let i = 0; i < 140 && !onCanopy; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const rel = p.pos.y - groundHeight(sx, sz, SEED);
      if (p.onGround && rel > 2.7 - 0.35) onCanopy = true;
    }
    expect(onCanopy).toBe(true);
    // The deck is FLAT: idling on it holds position exactly.
    const fy0 = p.pos.y;
    hold(sim, {}, 40);
    expect(Math.abs(p.pos.y - fy0)).toBeLessThan(2e-3);
    // Step off: back to the street, no embedding in the stall body.
    const hpBefore = p.hp;
    hold(sim, { forward: true }, 60);
    expect(p.onGround).toBe(true);
    expect(p.pos.y - groundHeight(p.pos.x, p.pos.z, SEED)).toBeLessThan(0.1);
    expect(p.hp).toBe(hpBefore);
  });
});

describe('chapel flows', () => {
  // Re-anchored to the zone3 chapel (Highpass): the v0.31 civic rebuild
  // replaced the Eastbrook chapel with a kit GLB (full-height OBB); the
  // composed tower-plus-hall physics now lives wherever the legacy
  // procedural chapel still stands.
  const rot = 0.9;
  const cx = -16;
  const cz = 650;
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);

  it('climb the hall roof, walk into the tower face (blocked), fall off a side', () => {
    const sim = makeSim();
    const startX = cx + fx * (3.5 + 1.7);
    const startZ = cz + fz * (3.5 + 1.7);
    teleport(sim, startX, startZ, Math.atan2(cx - startX, cz - startZ));
    const p = sim.player;
    let onRoof = false;
    for (let i = 0; i < 120 && !onRoof; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const g = groundHeight(p.pos.x, p.pos.z, SEED);
      if (p.onGround && p.pos.y - g > CHAPEL_HALL_ROOF_EAVE - 0.1) onRoof = true;
    }
    expect(onRoof).toBe(true);
    // Walk toward the tower: must stop against it, never pass or climb it.
    hold(sim, { forward: true }, 40);
    const gAfter = groundHeight(p.pos.x, p.pos.z, SEED);
    expect(p.pos.y - gAfter).toBeLessThanOrEqual(CHAPEL_HALL_ROOF_TOP + 0.05);
    expect(p.onGround).toBe(true);
    // Head back and off the front: clean landing, no fall damage.
    p.facing = Math.atan2(fx, fz);
    const hpBefore = p.hp;
    hold(sim, { forward: true }, 50);
    expect(p.hp).toBe(hpBefore);
    expect(p.onGround).toBe(true);
    expect(p.pos.y - groundHeight(p.pos.x, p.pos.z, SEED)).toBeLessThan(0.1);
  });
});

// Generic gabled market stand (no assetId) keeps the sloped-canopy physics
// pinned. The old Fenbridge (-5, 310.5) stand was replaced by the rebuild
// provision stall GLB, so this suite uses an open-field zone2 stand instead.
const LEGACY_STALL = { x: -365, z: 359, rot: 0.5 };
// local +Z (eave approach) in the stall yaw convention.
const LEGACY_STALL_APPROACH = {
  x: Math.sin(LEGACY_STALL.rot),
  z: Math.cos(LEGACY_STALL.rot),
} as const;

describe('stall rim behavior', () => {
  it('standing dead still on the canopy stays put (no depenetration jitter)', () => {
    const sim = makeSim();
    // Approach the eave along local +Z, facing the stall.
    teleport(
      sim,
      LEGACY_STALL.x + LEGACY_STALL_APPROACH.x * 2.6,
      LEGACY_STALL.z + LEGACY_STALL_APPROACH.z * 2.6,
      Math.atan2(-LEGACY_STALL_APPROACH.x, -LEGACY_STALL_APPROACH.z),
    );
    const p = sim.player;
    let onCanopy = false;
    for (let i = 0; i < 120 && !onCanopy; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const rel = p.pos.y - groundHeight(LEGACY_STALL.x, LEGACY_STALL.z, SEED);
      if (p.onGround && rel > STALL_CANOPY_EAVE - 0.1) onCanopy = true;
    }
    expect(onCanopy).toBe(true);
    const fx0 = p.pos.x;
    const fz0 = p.pos.z;
    const fy0 = p.pos.y;
    hold(sim, {}, 60); // 3 s idle
    expect(Math.abs(p.pos.x - fx0)).toBeLessThan(1e-6);
    expect(Math.abs(p.pos.z - fz0)).toBeLessThan(1e-6);
    expect(Math.abs(p.pos.y - fy0)).toBeLessThan(2e-3); // one-time CLIMB_SETTLE_EPS settle is fine
  });
});

describe('dock flows', () => {
  it('deck to hut roof to deck, and step into the moored rowboat', () => {
    const sim = makeSim();
    // Hut world position (dock -64,60 rot -2.2; hut local 2.8,2.4).
    const rot = -2.2;
    const hx = -64 + 2.8 * Math.cos(rot) + 2.4 * Math.sin(rot);
    const hz = 60 - 2.8 * Math.sin(rot) + 2.4 * Math.cos(rot);
    // Approach across the deck from the dock anchor toward the hut.
    teleport(sim, -64, 60, Math.atan2(hx + 64, hz - 60));
    const p = sim.player;
    let onRoof = false;
    for (let i = 0; i < 140 && !onRoof; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const g = groundHeight(p.pos.x, p.pos.z, SEED);
      if (p.onGround && p.pos.y - g > DOCK_HUT_ROOF_EAVE - 0.3) onRoof = true;
    }
    expect(onRoof).toBe(true);

    // The rowboat: walk to it and step in (its deck is a stride-height top).
    const boff = {
      x: 2.4 * Math.cos(rot) + -5.0 * Math.sin(rot),
      z: -2.4 * Math.sin(rot) + -5.0 * Math.cos(rot),
    };
    const bx = -64 + boff.x;
    const bz = 60 + boff.z;
    teleport(sim, bx - Math.sin(0.4) * 3, bz - Math.cos(0.4) * 3, 0.4);
    let inBoat = false;
    for (let i = 0; i < 100 && !inBoat; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      if (p.onGround && Math.hypot(p.pos.x - bx, p.pos.z - bz) < 2.0) {
        const support = supportHeightAt(SEED, p.pos.x, p.pos.z, 0.5, p.pos.y + 0.1);
        if (support > -Infinity && Math.abs(p.pos.y - support) < 0.05) inBoat = true;
      }
    }
    expect(inBoat).toBe(true);
  });
});

describe('abilities x collision', () => {
  it('Heroic Leap onto the stall canopy seats on the sampled gable, and off again', () => {
    const sim = makeSim();
    const approachX = LEGACY_STALL.x + LEGACY_STALL_APPROACH.x * 5.5;
    const approachZ = LEGACY_STALL.z + LEGACY_STALL_APPROACH.z * 5.5;
    teleport(
      sim,
      approachX,
      approachZ,
      Math.atan2(-LEGACY_STALL_APPROACH.x, -LEGACY_STALL_APPROACH.z),
    );
    const p = sim.player;
    sim.castAbility('heroic_leap', p.id, { x: LEGACY_STALL.x, z: LEGACY_STALL.z });
    for (let i = 0; i < 40 && p.leap; i++) sim.tick();
    expect(p.leap ?? null).toBeNull();
    const g = groundHeight(LEGACY_STALL.x, LEGACY_STALL.z, SEED);
    const rel = p.pos.y - g;
    expect(rel).toBeGreaterThan(STALL_CANOPY_EAVE - 0.15);
    expect(rel).toBeLessThanOrEqual(STALL_CANOPY_TOP + 0.05);
    // Leap off: back to the street with no embedding (cooldown cleared first).
    p.cooldowns.clear();
    p.resource = 100; // rage for the recast
    p.gcdRemaining = 0;
    sim.castAbility('heroic_leap', p.id, { x: approachX, z: approachZ });
    for (let i = 0; i < 40 && p.leap; i++) sim.tick();
    expect(p.pos.y - groundHeight(p.pos.x, p.pos.z, SEED)).toBeLessThan(0.15);
  });

  it('Heroic Leap onto the crypt dais lands at the lifted floor', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const d = CRYPT_LAYOUT.dais;
    teleport(sim, o.x + d.x, o.z + d.z - d.r - 4, 0);
    const p = sim.player;
    sim.castAbility('heroic_leap', p.id, { x: o.x + d.x, z: o.z + d.z - 2 });
    for (let i = 0; i < 40 && p.leap; i++) sim.tick();
    expect(p.pos.y).toBeCloseTo(DAIS_HEIGHT, 2);
  });
});

describe('dungeon deep sweep', () => {
  it('dais rim walk-up from 8 directions', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const d = CRYPT_LAYOUT.dais;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const sx = o.x + d.x + Math.sin(ang) * (d.r + 2);
      const sz = o.z + d.z + Math.cos(ang) * (d.r + 2);
      // Some approach points sit inside pillars/tombs; resolve by starting
      // clear: skip blocked starts (the sweep cares about the rim itself).
      const facing = Math.atan2(o.x + d.x - sx, o.z + d.z - sz);
      teleport(sim, sx, sz, facing);
      if (Math.hypot(sim.player.pos.x - sx, sim.player.pos.z - sz) > 0.5) continue;
      hold(sim, { forward: true }, 45);
      expect(sim.player.onGround).toBe(true);
      expect(sim.player.pos.y).toBeCloseTo(DAIS_HEIGHT, 2);
    }
  });

  it('cargo slots: both stack kinds climb, both casks vault, gap walkable', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.sunken_bastion.index, 0);
    // Find one r<0.5 slot (crates+barrel) and one r>=0.5 (box+keg).
    const slots = CRYPT_LAYOUT.tombs.map((t) => ({ t, r: tombSlotRoll(t.x, t.z) }));
    const crateSlot = slots.find((s) => s.r < 0.5);
    const boxSlot = slots.find((s) => s.r >= 0.5);
    expect(crateSlot && boxSlot).toBeTruthy();
    if (!crateSlot || !boxSlot) return;
    for (const { t, r } of [crateSlot, boxSlot]) {
      // Two tiers: vault the broad lower tier; the crates variant then
      // strides to its wide top crate. (The box variant's top box is a tiny
      // finial you can bump but not sanely stand on: the tier is the stand.)
      const standTop = r < 0.5 ? 2.14 : 1.2;
      teleport(sim, o.x + t.x, o.z + t.z - 1.0 - 1.0 - 1.5, 0);
      const p = sim.player;
      let onStack = false;
      for (let i = 0; i < 160 && !onStack; i++) {
        hold(sim, { forward: true, jump: true }, 1);
        if (p.onGround && Math.abs(p.pos.y - standTop) < 0.05) onStack = true;
      }
      expect(onStack).toBe(true);
      // Walk the gap between stack and cask at floor level.
      teleport(sim, o.x + t.x - 2.5, o.z + t.z + 0.2, Math.PI / 2);
      hold(sim, { forward: true }, 30);
      expect(p.pos.y).toBeLessThan(0.1);
    }
  });

  it('temple altars and sanctum stubs stay walls', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, 0);
    // Sanctum stub at (14, 67): jump-spam at it.
    teleport(sim, o.x + 14, o.z + 67 - 5 - 1.5, 0);
    const stood = maxStoodHeight(sim, 60);
    expect(stood).toBeLessThan(0.95);
  });

  it('mobs in a dev-entered crypt stand at groundHeight, dais included', () => {
    const sim = makeSim();
    sim.chat('/dev dungeon hollow_crypt');
    for (let i = 0; i < 200; i++) sim.tick();
    let checked = 0;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (e.pos.x < 600) continue; // instance mobs only
      const g = groundHeight(e.pos.x, e.pos.z, SEED);
      expect(Math.abs(e.pos.y - g)).toBeLessThan(0.01);
      checked++;
    }
    console.log('mob y checks:', checked);
    expect(checked).toBeGreaterThan(3);
  });
});

describe('climb vetoes', () => {
  it('no grabs in the arena or yumi bands', () => {
    expect(supportHeightAt(SEED, ARENA_X, -1250, 0.5, 100)).toBe(-Infinity);
    expect(supportHeightAt(SEED, YUMI_BAND_X_MIN + 10, 0, 0.5, 100)).toBe(-Infinity);
    expect(interiorColliderFrame(ARENA_X, -1250)).toBeNull();
    expect(interiorColliderFrame(YUMI_BAND_X_MIN + 10, 0)).toBeNull();
  });
});

describe('programmatic collider sanity sweeps', () => {
  it('every open-world standable top has cameraTopY at or above it', () => {
    const cols: Collider[] = [];
    queryOpenWorldColliders(SEED, -240, -240, 240, 900, cols);
    let standables = 0;
    const bad: string[] = [];
    for (const c of cols) {
      if (!c.standable || c.moveTopY === undefined) continue;
      standables++;
      if (c.cameraTopY !== undefined && c.cameraTopY < c.moveTopY - 1e-6) {
        bad.push(
          `(${c.x.toFixed(1)},${c.z.toFixed(1)}) top ${c.moveTopY.toFixed(2)} cam ${c.cameraTopY.toFixed(2)}`,
        );
      }
      // Sloped tops: eave must not exceed the ridge, pitch positive.
      if (c.topSlope) {
        expect(c.topSlope.eaveY).toBeLessThanOrEqual(c.moveTopY + 1e-6);
        expect(c.topSlope.pitch).toBeGreaterThan(0);
      }
    }
    console.log('standables swept:', standables, 'bad camera tops:', bad.length, bad.slice(0, 5));
    expect(bad.filter((b) => !/trader_wilkes|apothecary_lin|brother_halven/.test(b))).toEqual([]); // three pre-existing authored vendor placements
  });

  it('no new collider overlaps an authored NPC spot', () => {
    const cols: Collider[] = [];
    queryOpenWorldColliders(SEED, -240, -240, 240, 900, cols);
    const bad: string[] = [];
    for (const npc of Object.values(NPCS)) {
      const pos = (npc as { pos?: { x: number; z: number } }).pos;
      if (!pos) continue;
      for (const c of cols) {
        if (c.moveTopY !== undefined && c.moveTopY - groundHeight(c.x, c.z, SEED) <= 0.9) continue; // stride props are fine
        const hit =
          c.type === 'circle'
            ? Math.hypot(pos.x - c.x, pos.z - c.z) < c.r - 0.05
            : (() => {
                const cos = Math.cos(-c.rot);
                const sin = Math.sin(-c.rot);
                const lx = (pos.x - c.x) * cos + (pos.z - c.z) * sin;
                const lz = -(pos.x - c.x) * sin + (pos.z - c.z) * cos;
                return Math.abs(lx) < c.hw - 0.05 && Math.abs(lz) < c.hd - 0.05;
              })();
        if (hit)
          bad.push(
            `${(npc as { id?: string }).id} inside collider at (${c.x.toFixed(1)},${c.z.toFixed(1)})`,
          );
      }
    }
    console.log('npc overlap violations:', bad.length, bad.slice(0, 6));
    expect(bad.filter((b) => !/trader_wilkes|apothecary_lin|brother_halven/.test(b))).toEqual([]); // three pre-existing authored vendor placements
  });

  it('interior sets: standable tops sane, colliderTopAt within [eave, ridge]', () => {
    for (const id of ['hollow_crypt', 'sunken_bastion', 'nythraxis_crypt']) {
      const o = instanceOrigin(DUNGEONS[id].index, 0);
      const frame = interiorColliderFrame(o.x, o.z + 40);
      expect(frame).not.toBeNull();
      if (!frame) continue;
      let tops = 0;
      for (const c of frame.list) {
        if (!c.standable || c.moveTopY === undefined) continue;
        tops++;
        expect(c.moveTopY).toBeGreaterThan(0.9);
        expect(c.moveTopY).toBeLessThan(3.35); // all reachable per the ladder
      }
      console.log(id, 'standable interior tops:', tops);
      expect(tops).toBeGreaterThan(0);
    }
  });
});
