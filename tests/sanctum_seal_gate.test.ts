// The Gravewyrm Sanctum's world entrance, the Smith's Seal Gate
// (src/sim/sanctum_seal_gate.ts, drawn by src/render/sanctum_seal_gate.ts):
// its pylons are the door's jambs and the lane between them is the walk-in
// trigger; a player walks up the road into the door and back out from the
// exit drop; every key shard and sigil moved into the gate plaza is walked to
// and picked up; every footing of the Blender model sits on the sim's own
// ground (no gap, no sinking); and nothing around the door is blocked.
import { describe, expect, it } from 'vitest';
import { isBlocked, queryOpenWorldColliders } from '../src/sim/colliders';
import {
  CAMPS,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  GATHER_NODES,
  GROUND_OBJECTS,
  NPCS,
  PROPS,
} from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import {
  SANCTUM_SEAL_GATE_COLLIDERS,
  SANCTUM_SEAL_GATE_FOOTINGS,
  SANCTUM_SEAL_GATE_LANE_HALF_WIDTH,
  SANCTUM_SEAL_GATE_PLAZA,
  sanctumSealGateColliders,
} from '../src/sim/sanctum_seal_gate';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const DOOR = DUNGEONS.gravewyrm_sanctum.doorPos;
// The walk-in trigger (instances/dungeons.ts DOOR_TRIGGER_RADIUS): a shipped
// constant the module does not export, pinned here as the literal it is.
const DOOR_TRIGGER_RADIUS = 2;
const EXIT_DROP = { x: DOOR.x, z: DOOR.z - 4 };
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

function place(sim: Sim, x: number, z: number, facing: number): void {
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
  sim.rebucket(p);
}

/** Walk toward a point, re-aiming every tick (so a small prop is skirted). */
function walkTo(sim: Sim, x: number, z: number, reach: number, maxTicks: number): boolean {
  const p = sim.player;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('no meta');
  for (let i = 0; i < maxTicks; i++) {
    if (Math.hypot(p.pos.x - x, p.pos.z - z) <= reach) return true;
    p.facing = Math.atan2(x - p.pos.x, z - p.pos.z);
    Object.assign(meta.moveInput, IDLE, { forward: true });
    sim.tick();
  }
  return Math.hypot(p.pos.x - x, p.pos.z - z) <= reach;
}

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.setPlayerLevel(20);
  sim.player.devNoAggro = true;
  return sim;
}

describe('the Seal Gate stands in for the generic door arch', () => {
  it('the door is still the Sanctum door at (0, 858)', () => {
    expect(DOOR).toEqual({ x: 0, z: 858 });
  });

  it('the pylons block, the generic jambs are gone, and the lane is narrower than the trigger', () => {
    for (const sx of [-1, 1]) {
      // the pylon bodies (plinth |x| 2.0 to 5.3)
      expect(isBlocked(SEED, DOOR.x + sx * 3.6, DOOR.z, 0.4), `pylon ${sx}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x + sx * 5.0, DOOR.z + 2, 0.4), `pylon back ${sx}`).toBe(true);
      // where the generic jamb used to stand is open lane now
      expect(isBlocked(SEED, DOOR.x + sx * 1.5, DOOR.z, 0.4), `old jamb ${sx}`).toBe(false);
    }
    // a body crossing the gate line inside the lane is always inside the trigger
    expect(SANCTUM_SEAL_GATE_LANE_HALF_WIDTH - PLAYER_BODY_RADIUS).toBeLessThan(
      DOOR_TRIGGER_RADIUS,
    );
    for (const lz of [-2.2, -1, 0, 1, 2.6]) {
      for (const lx of [-1.4, 0, 1.4]) {
        expect(isBlocked(SEED, DOOR.x + lx, DOOR.z + lz, PLAYER_BODY_RADIUS), `${lx},${lz}`).toBe(
          false,
        );
      }
      // and a body wider than the lane is walled at its edge
      expect(isBlocked(SEED, DOOR.x + 1.7, DOOR.z + lz, PLAYER_BODY_RADIUS)).toBe(true);
      expect(isBlocked(SEED, DOOR.x - 1.7, DOOR.z + lz, PLAYER_BODY_RADIUS)).toBe(true);
    }
  });

  it('the rock spur walls the tunnel, and its dark end is closed', () => {
    for (const lz of [6, 12, 20, 26]) {
      expect(isBlocked(SEED, DOOR.x + 4.6, DOOR.z + lz, 0.4), `west wall ${lz}`).toBe(true);
      expect(isBlocked(SEED, DOOR.x - 4.6, DOOR.z + lz, 0.4), `east wall ${lz}`).toBe(true);
    }
    expect(isBlocked(SEED, DOOR.x, DOOR.z + 28.6, 0.4)).toBe(true);
    // the ice tongue on the ridge is render only: nothing collides past the rock's back
    expect(Math.max(...SANCTUM_SEAL_GATE_COLLIDERS.map((c) => c.lz))).toBeLessThan(40);
  });
});

describe('a player walks the road into the Seal Gate and back out', () => {
  it('road to trigger, then the exit drop and back down the road', () => {
    const sim = makeSim();
    const p = sim.player;
    // The nearest road stretch outside the set piece: the Sanctum Approach
    // road (x 0) where it reaches the gate plaza's south edge.
    place(sim, DOOR.x, DOOR.z - 26, 0);
    // aim past the gate line: the walk ends the moment the trigger takes it
    walkTo(sim, DOOR.x, DOOR.z + 6, 0.5, 400);
    expect(p.pos.x, 'walked through the gate into the instance').toBeGreaterThan(
      DUNGEON_X_THRESHOLD,
    );
    const exit = [...sim.entities.values()].find((e) => e.templateId === 'dungeon_exit');
    expect(exit).toBeDefined();
    if (!exit) return;
    place(sim, exit.pos.x, exit.pos.z + 1.2, Math.PI);
    sim.tick();
    expect(p.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(Math.hypot(p.pos.x - EXIT_DROP.x, p.pos.z - EXIT_DROP.z)).toBeLessThan(1.5);
    expect(isBlocked(SEED, p.pos.x, p.pos.z, PLAYER_BODY_RADIUS)).toBe(false);
    // and back down to the road with nothing in the way
    expect(walkTo(sim, DOOR.x, DOOR.z - 26, 0.6, 400)).toBe(true);
  });

  it('every road point up to the plaza is open ground', () => {
    for (let z = DOOR.z - 30; z <= DOOR.z - 3; z += 0.5) {
      expect(isBlocked(SEED, DOOR.x, z, PLAYER_BODY_RADIUS), `road z ${z}`).toBe(false);
    }
    expect(isBlocked(SEED, EXIT_DROP.x, EXIT_DROP.z, 0.9)).toBe(false);
  });
});

const MOVED = new Set(['sanctum_key_shard', 'gravewyrm_sigil']);

describe('the key shards and sigils lie in the gate plaza, within reach', () => {
  it('every shard and sigil stands in the plaza on open, walkable, near-level ground', () => {
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    for (const def of GROUND_OBJECTS.filter((g) => MOVED.has(g.itemId))) {
      expect(def.positions.length).toBe(4);
      for (const pos of def.positions) {
        const lx = pos.x - DOOR.x;
        const lz = pos.z - DOOR.z;
        const at = `${def.itemId} at ${pos.x},${pos.z}`;
        // the plaza: z 842 to 856, in front of the gate
        expect(lz, at).toBeGreaterThanOrEqual(SANCTUM_SEAL_GATE_PLAZA.z0);
        expect(lz, at).toBeLessThanOrEqual(SANCTUM_SEAL_GATE_PLAZA.z1);
        expect(Math.abs(lx), at).toBeLessThanOrEqual(SANCTUM_SEAL_GATE_PLAZA.x1);
        expect(isBlocked(SEED, pos.x, pos.z, PLAYER_BODY_RADIUS), at).toBe(false);
        expect(groundHeight(pos.x, pos.z, SEED) - terrainHeight(pos.x, pos.z, SEED)).toBeLessThan(
          0.01,
        );
        // the plaza is the door's flat calm pad: within half a yard of the door
        expect(Math.abs(terrainHeight(pos.x, pos.z, SEED) - base), at).toBeLessThan(0.5);
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const rise = Math.abs(
            groundHeight(pos.x + dx, pos.z + dz, SEED) - groundHeight(pos.x, pos.z, SEED),
          );
          expect(rise, at).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
        }
      }
    }
  });

  it('a player walks from the road to every one of them and the quests take them', () => {
    const sim = makeSim();
    const meta = sim.ctx.resolve(undefined)?.meta;
    if (!meta) throw new Error('no meta');
    meta.questsDone.add('q_necromancers');
    meta.questsDone.add('q_voice_below');
    const aldric = [...sim.entities.values()].find(
      (e) => e.templateId === 'brother_aldric_highwatch',
    ) as Entity;
    expect(aldric).toBeDefined();
    place(sim, aldric.pos.x, aldric.pos.z, 0);
    sim.acceptQuest('q_wyrm_sigils');
    sim.acceptQuest('q_sanctum_gate');
    expect(meta.questLog.get('q_wyrm_sigils')?.state).toBe('active');
    expect(meta.questLog.get('q_sanctum_gate')?.state).toBe('active');
    const objects = [...sim.entities.values()].filter(
      (e) => e.kind === 'object' && typeof e.objectItemId === 'string' && MOVED.has(e.objectItemId),
    );
    expect(objects.length).toBe(8);
    const taken = new Map<string, number>();
    for (const obj of objects) {
      // start on the road at the object's own row, then walk over to it
      place(sim, DOOR.x, obj.pos.z, 0);
      expect(walkTo(sim, obj.pos.x, obj.pos.z, 1.2, 300), `reach ${obj.pos.x},${obj.pos.z}`).toBe(
        true,
      );
      const item = obj.objectItemId ?? '';
      if ((taken.get(item) ?? 0) < 3) {
        expect(sim.pickUpObject(obj.id), `pick up ${obj.pos.x},${obj.pos.z}`).toBe(true);
        taken.set(item, (taken.get(item) ?? 0) + 1);
      }
    }
    expect(meta.questLog.get('q_wyrm_sigils')?.counts[0]).toBe(3);
    expect(meta.questLog.get('q_sanctum_gate')?.counts[0]).toBe(3);
  });
});

describe('the Seal Gate sits on the real slope', () => {
  // The GLBs are seated at terrainHeight(door): the model was cut against
  // this exact height, so a terrain change that moves it reddens here first.
  it('the door ground the model was built on', () => {
    expect(terrainHeight(DOOR.x, DOOR.z, SEED)).toBeCloseTo(-2.9347, 3);
  });

  // Each footing's design burial under its LOWEST ground (build_sanctum_entrance.py):
  // the plinths 0.55, the rock skirt 0.9 under its own vertex (less at a
  // footprint corner on a cross slope), headstones 0.35, the cairn 0.3, the
  // brazier 0.18 and the low heap and sledge a few centimetres.
  const DESIGN_BURY: readonly [string, number][] = [
    ['plinth_', 0.55],
    ['outcrop_', 0.9],
    ['headstone_', 0.35],
    ['cairn', 0.3],
    ['toppled_brazier', 0.18],
    ['chain_heap', 0.05],
    ['sledge', 0.07],
  ];
  const BURY_TOLERANCE = 0.1;

  it('every footing is below the ground at all of its corners, and never deeper than its design burial', () => {
    const base = terrainHeight(DOOR.x, DOOR.z, SEED);
    expect(SANCTUM_SEAL_GATE_FOOTINGS.length).toBeGreaterThan(30);
    for (const f of SANCTUM_SEAL_GATE_FOOTINGS) {
      const design = DESIGN_BURY.find(([prefix]) => f.name.startsWith(prefix));
      expect(design, `${f.name} has a design burial`).toBeDefined();
      const c = Math.cos(f.rot);
      const s = Math.sin(f.rot);
      let lowest = Infinity;
      for (const [u, v] of [
        [0, 0],
        [-f.hw, -f.hd],
        [f.hw, -f.hd],
        [f.hw, f.hd],
        [-f.hw, f.hd],
      ]) {
        // three.js rotation.y, the colliders' own convention
        const x = DOOR.x + f.lx + u * c + v * s;
        const z = DOOR.z + f.lz - u * s + v * c;
        const ground = groundHeight(x, z, SEED) - base;
        // natural ground under every footing (no walkable lift field)
        expect(groundHeight(x, z, SEED) - terrainHeight(x, z, SEED)).toBeLessThan(0.01);
        // no gap: the underside never floats above the ground (0.05 tolerance
        // for the probe grid's bilinear sampling)
        expect(
          f.bottom - ground,
          `${f.name} floats at ${x.toFixed(1)},${z.toFixed(1)}`,
        ).toBeLessThan(0.05);
        lowest = Math.min(lowest, ground);
      }
      // no sinking: at its lowest corner the footing is cut no deeper than designed
      expect(lowest - f.bottom, `${f.name} is sunk`).toBeLessThanOrEqual(
        (design?.[1] ?? 0) + BURY_TOLERANCE,
      );
    }
  });
});

const near = (x: number, z: number) => Math.hypot(x - DOOR.x, z - DOOR.z) < 80;

/** Circle-vs-shape overlap against the Seal Gate's own solids only. */
function gateHits(x: number, z: number, r: number): boolean {
  return sanctumSealGateColliders(SEED, DOOR).some((c) => {
    if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) < c.r + r;
    const dx = x - c.x;
    const dz = z - c.z;
    const cs = Math.cos(c.rot);
    const sn = Math.sin(c.rot);
    const u = dx * cs - dz * sn;
    const v = dx * sn + dz * cs;
    const qx = Math.max(Math.abs(u) - c.hw, 0);
    const qz = Math.max(Math.abs(v) - c.hd, 0);
    return Math.hypot(qx, qz) < r;
  });
}

describe('the Seal Gate blocks nothing around the door', () => {
  it('no NPC, gather node, camp centre or ruin column is inside a Seal Gate collider', () => {
    for (const npc of Object.values(NPCS)) {
      if (!near(npc.pos.x, npc.pos.z)) continue;
      expect(gateHits(npc.pos.x, npc.pos.z, 0.6), npc.id).toBe(false);
    }
    let nodes = 0;
    for (const node of GATHER_NODES) {
      if (!near(node.pos.x, node.pos.z)) continue;
      expect(gateHits(node.pos.x, node.pos.z, 1.5), node.id).toBe(false);
      nodes++;
    }
    // the guards are not vacuous: the door has neighbours to keep clear
    expect(nodes).toBeGreaterThanOrEqual(2);
    // the wood node the design names, at (-34, 850)
    const wood = GATHER_NODES.find((n) => n.pos.x === -34 && n.pos.z === 850);
    expect(wood?.type).toBe('wood');
    expect(gateHits(-34, 850, 3)).toBe(false);
    // the two flanking ruin rings stay: none of their columns or fallen
    // blocks (the world's own colliders on the ring) touches a gate solid
    for (const ring of PROPS.ruinRings.filter((r) => near(r.x, r.z))) {
      const around = queryOpenWorldColliders(
        SEED,
        ring.x - ring.ringR - 1,
        ring.z - ring.ringR - 1,
        ring.x + ring.ringR + 1,
        ring.z + ring.ringR + 1,
        [],
      ).filter(
        (c) =>
          c.type === 'circle' &&
          Math.abs(Math.hypot(c.x - ring.x, c.z - ring.z) - ring.ringR) < 0.05,
      );
      expect(around.length, `ring ${ring.x},${ring.z} columns`).toBe(ring.columns);
      for (const col of around) {
        if (col.type !== 'circle') continue;
        expect(gateHits(col.x, col.z, col.r), `ring column ${col.x},${col.z}`).toBe(false);
      }
    }
  });

  it('the camps the design names stay clear: Broodsworn, Threnos, the Revenant Fields and Varkas', () => {
    const named = [
      'wyrmcult_zealot',
      'wyrmcult_necromancer',
      'threnos_first_voice',
      'boneclad_revenant',
      'marrowlord_varkas',
    ];
    const checked = new Set<string>();
    for (const camp of CAMPS.filter((c) => named.includes(c.mobId))) {
      if (!near(camp.center.x, camp.center.z)) continue;
      // no Seal Gate solid (its full extent, not its centre) reaches into a
      // spawn disc of any of them
      expect(gateHits(camp.center.x, camp.center.z, camp.radius), camp.mobId).toBe(false);
      checked.add(camp.mobId);
    }
    expect([...checked].sort()).toEqual([...named].sort());
  });
});
