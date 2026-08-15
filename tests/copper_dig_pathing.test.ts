// Copper Dig pathing: can a Deeprock Digger still reach a player standing in the
// vein field, now that gather nodes are SOLID bodies?
//
// Ore and wood nodes gained real colliders this packet (GATHER_NODE_BODIES in
// prop_layout.ts, built into circles by colliders.ts staticWorldColliders). Six
// copper veins ring the Copper Dig, which is also the Deeprock kobold camp's
// ground, so the starting zone's first-quest field is now a field of obstacles a
// pursuing mob has to round. Nothing asserted that it still can: the re-recorded
// combat goldens only show that pathing did not change in the scenarios they
// happen to cover, which is an inference rather than a check. Two arms make it
// an assertion.
//
//   1. Reachability, driven through the REAL sim loop (sim.tick), with a
//      DISCRIMINATING fixture: the straight line from the mob's start to the
//      player runs through two vein bodies, and the far one sits outside the
//      player's melee ring, so a mob that pins on a solid node instead of
//      rounding it stalls on the node's near face, ~1.9yd beyond the range this
//      arm then demands it reach. The stall distance is asserted, not assumed.
//   2. No mob spawn position sits inside a gather-node body anywhere in the
//      overworld, so no camp spawn is born wedged in one.
//
// Every threshold is a shipped constant: the node radius comes from
// GATHER_NODE_BODIES, the body radius from pathfind (mob/locomotion.ts resolves
// mob steps at PLAYER_BODY_RADIUS too), melee reach from types.MELEE_RANGE, and
// the isolation screen from MAX_AGGRO_RADIUS. The seed is the shipped world seed
// and only that one: vein coordinates and camp anchors are hand-authored against
// THIS world, so checking them against any other terrain proves nothing.

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DUNGEON_X_THRESHOLD, GATHER_NODES, MOBS, ZONES } from '../src/sim/data';
import { MAX_AGGRO_RADIUS } from '../src/sim/mob/locomotion';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { GATHER_NODE_BODIES } from '../src/sim/prop_layout';
import { Sim } from '../src/sim/sim';
import { type Entity, MELEE_RANGE } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The ore vein's solid body, as shipped. Herb patches stay soft (null body).
const ORE_BODY = GATHER_NODE_BODIES.ore;
// mob/locomotion.ts and sim.moveToward resolve every mob step at
// `const BODY_RADIUS = PLAYER_BODY_RADIUS`, so a mob body is the same disc.
const MOB_BODY_RADIUS = PLAYER_BODY_RADIUS;

const EASTBROOK_ID = 'eastbrook_vale';
// The landmark q_prof_intro sends a level 1 miner to, read from the live POI
// table so a relocation moves this fixture with it instead of failing it.
const COPPER_DIG = (() => {
  const poi = ZONES.find((z) => z.id === EASTBROOK_ID)?.pois.find((p) => p.id === 'copper_dig');
  if (!poi) throw new Error('the copper_dig POI left the zone table');
  return { x: poi.x, z: poi.z };
})();
// tests/gather_nodes.test.ts holds every Eastbrook vein inside this ring of the
// landmark; reused here only to pin that the six veins found ARE the dig field.
const DIG_RING = 20;

interface Point {
  x: number;
  z: number;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Distance from `p` to the SEGMENT `a`-`b` (clamped projection, not the infinite
 * line): a node whose projection falls off either end reads as its endpoint
 * distance, so a small result also proves the node lies between the endpoints.
 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  if (len2 < 1e-9) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
  return dist(p, { x: a.x + vx * t, z: a.z + vz * t });
}

function eastbrookOreVeins() {
  return GATHER_NODES.filter((n) => n.zoneId === EASTBROOK_ID && n.type === 'ore');
}

/** The two veins whose bodies leave the tightest lane between them. */
function tightestVeinPair(veins: ReturnType<typeof eastbrookOreVeins>) {
  let best: { a: (typeof veins)[number]; b: (typeof veins)[number]; centers: number } | null = null;
  for (let i = 0; i < veins.length; i++) {
    for (let j = i + 1; j < veins.length; j++) {
      const centers = dist(veins[i].pos, veins[j].pos);
      if (!best || centers < best.centers) best = { a: veins[i], b: veins[j], centers };
    }
  }
  if (!best) throw new Error('no vein pair to measure');
  return best;
}

describe('the Copper Dig vein field stays walkable content (solid gather nodes)', () => {
  it('a Deeprock Digger rounds the solid veins and reaches a player standing in the field', () => {
    const veins = eastbrookOreVeins();
    expect(veins).toHaveLength(6);
    expect(ORE_BODY).not.toBeNull();
    // Literal pin: every clearance threshold in this file derives from this
    // body on BOTH sides of its comparison, so shrinking the radius would
    // shrink the thresholds with it and pass trivially. A body change must
    // consciously touch this line.
    expect(ORE_BODY!.r).toBe(0.44);
    expect(ORE_BODY!.top).toBeCloseTo(0.84, 10);
    const nodeR = ORE_BODY!.r;
    // Non-vacuity: these six ARE the dig field, not ore scattered zone-wide.
    for (const v of veins) expect(dist(v.pos, COPPER_DIG)).toBeLessThanOrEqual(DIG_RING);

    // The tightest pocket in the field. The player stands hard against the
    // ANCHOR vein, on the far side from its nearest NEIGHBOUR, at the minimum
    // standoff a body can legally hold: the least clearance a player can take
    // up among the veins, and it puts both bodies on the mob's approach line.
    const { a: anchor, b: neighbour, centers } = tightestVeinPair(veins);
    const lane = centers - 2 * nodeR; // free ground between the two bodies
    expect(lane).toBeGreaterThan(0);

    const ux = (anchor.pos.x - neighbour.pos.x) / centers;
    const uz = (anchor.pos.z - neighbour.pos.z) / centers;
    const standoff = nodeR + PLAYER_BODY_RADIUS + 0.06;
    const stand: Point = { x: anchor.pos.x + ux * standoff, z: anchor.pos.z + uz * standoff };
    // The mob starts beyond the neighbour vein on the same line, so its straight
    // path to the player runs through BOTH bodies.
    const APPROACH = 6;
    const start: Point = {
      x: neighbour.pos.x - ux * APPROACH,
      z: neighbour.pos.z - uz * APPROACH,
    };

    // The fixture is discriminating, asserted rather than assumed.
    // (a) Both vein bodies overlap the straight mob-to-player segment, and the
    //     clamped projection above means overlapping the SEGMENT also puts them
    //     between the two endpoints rather than off one end.
    expect(distToSegment(anchor.pos, start, stand)).toBeLessThan(nodeR + MOB_BODY_RADIUS);
    expect(distToSegment(neighbour.pos, start, stand)).toBeLessThan(nodeR + MOB_BODY_RADIUS);
    // (b) The neighbour body sits outside the player's melee ring and the mob
    //     approaches it from the far side, so a mob that pins on it instead of
    //     rounding it stops on the node's NEAR face, this far from the player:
    const neighbourToStand = dist(neighbour.pos, stand);
    expect(neighbourToStand).toBeGreaterThan(MELEE_RANGE);
    expect(dist(start, neighbour.pos)).toBeLessThan(dist(start, stand));
    const pinnedStall = neighbourToStand + nodeR + MOB_BODY_RADIUS;
    // ... with a full yard of margin, so the arm below fails on a pin rather
    // than splitting hairs with the melee range.
    expect(pinnedStall - MELEE_RANGE).toBeGreaterThan(1);
    // (c) Both endpoints are ground a body can actually hold, so a failure
    //     cannot be blamed on an illegal fixture.
    expect(isBlocked(WORLD_SEED, stand.x, stand.z, PLAYER_BODY_RADIUS)).toBe(false);
    expect(isBlocked(WORLD_SEED, start.x, start.z, MOB_BODY_RADIUS)).toBe(false);
    // (d) The premise itself, in this file: the vein bodies really ARE wired
    //     into the collider set. Without this, deleting the gather-node
    //     collider loop would leave every arm below green (the mob just walks
    //     straight through and reaches melee sooner).
    expect(isBlocked(WORLD_SEED, anchor.pos.x, anchor.pos.z, PLAYER_BODY_RADIUS)).toBe(true);
    expect(isBlocked(WORLD_SEED, neighbour.pos.x, neighbour.pos.z, PLAYER_BODY_RADIUS)).toBe(true);
    // (e) Fixture dependency, named and computed below once the pursuer is
    //     chosen: the mob start must sit inside its EFFECTIVE aggro reach,
    //     not merely the hard ceiling, or the diagnostic fires only after
    //     the ceiling itself moves.

    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const player = sim.entities.get(sim.playerId)!;
    player.pos = { x: stand.x, y: groundHeight(stand.x, stand.z, WORLD_SEED), z: stand.z };
    player.prevPos = { ...player.pos };
    // The player is bait, not a combatant: survive the pull without dying.
    player.maxHp = 100000;
    player.hp = 100000;
    sim.rebucket(player);

    // A real camp mob: one of the nine Deeprock Diggers the tunnel_rat camp
    // spawned, moved to the approach point (and its spawn point with it, so the
    // leash anchors where it stands instead of dragging it home mid-chase).
    const diggers = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === 'tunnel_rat' && !e.dead,
    );
    expect(diggers.length).toBeGreaterThan(0);
    const mob = diggers[0];
    mob.pos = { x: start.x, y: groundHeight(start.x, start.z, WORLD_SEED), z: start.z };
    mob.prevPos = { ...mob.pos };
    mob.spawnPos = { ...mob.pos };
    mob.wanderTarget = null;
    mob.aiState = 'idle';
    sim.rebucket(mob);
    // The (e) fixture bound, against the pursuer's EFFECTIVE reach: the same
    // expression the idle aggro scan evaluates (mob/locomotion.ts), so a
    // content tune that shrinks tunnel_rat's reach below the start distance
    // fails HERE with a fixture message (shorten APPROACH), not at the
    // aggroTick assert below dressed up as a pathing regression.
    const effectiveAggro = Math.max(
      4,
      Math.min(MAX_AGGRO_RADIUS, MOBS.tunnel_rat.aggroRadius + (mob.level - player.level) * 1.5),
    );
    expect(
      dist(start, stand),
      'fixture: start must sit inside the effective aggro reach',
    ).toBeLessThan(effectiveAggro);

    // Everyone else stands down: park every other mob far south of the dig, so
    // the pull under test is exactly one pursuer and the damage asserted below
    // can only have come from it.
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.id === mob.id) continue;
      if (dist(e.pos, stand) > 120) continue;
      const parked = { x: e.pos.x, y: e.pos.y, z: -420 };
      e.pos = { ...parked };
      e.prevPos = { ...parked };
      e.spawnPos = { ...parked };
      e.wanderTarget = null;
      e.aiState = 'idle';
      sim.rebucket(e);
    }
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.id === mob.id) continue;
      expect(dist(e.pos, stand)).toBeGreaterThan(MAX_AGGRO_RADIUS);
    }

    // Drive the real loop: the mob detects the player on its own (the idle
    // aggro scan in mob/locomotion.ts), then closes.
    const MAX_TICKS = 200; // 10s: room for the swing timer and a few misses
    const MELEE_TICK_BUDGET = 60; // 3s; the 8yd run at moveSpeed 7 needs ~1.2s
    let aggroTick = -1;
    let meleeTick = -1;
    let hitTick = -1;
    // Sampled EVERY tick, not just at the end: tunnelling is a mid-path
    // event, and a mob that stepped through a body and came out the other
    // side would look legal in a final-position-only check. The per-tick
    // step (moveSpeed times DT, about 0.35 yd) sits far below the body
    // diameter, so the samples cannot skip the disc entirely.
    let minVeinClearance = Number.POSITIVE_INFINITY;
    for (let tick = 1; tick <= MAX_TICKS; tick++) {
      sim.tick();
      for (const v of veins) {
        minVeinClearance = Math.min(minVeinClearance, dist(mob.pos, v.pos));
      }
      if (aggroTick < 0 && mob.aiState !== 'idle') aggroTick = tick;
      if (meleeTick < 0 && dist(mob.pos, player.pos) <= MELEE_RANGE) meleeTick = tick;
      if (hitTick < 0 && player.hp < player.maxHp) hitTick = tick;
      if (meleeTick > 0 && hitTick > 0) break;
    }

    expect(aggroTick).toBeGreaterThan(0); // it saw the player through the field
    expect(meleeTick).toBeGreaterThan(0); // and closed to melee: the arm's point
    expect(meleeTick).toBeLessThanOrEqual(MELEE_TICK_BUDGET);
    expect(mob.aiState).toBe('attack');
    expect(mob.aggroTargetId).toBe(player.id);
    expect(dist(mob.pos, player.pos)).toBeLessThanOrEqual(MELEE_RANGE);
    expect(hitTick).toBeGreaterThan(0); // swinging, not merely parked in reach
    // It rounded the veins rather than tunnelling through one, at every
    // sampled step of the chase, not just where it ended up. Rounding means
    // sliding in CONTACT with the body, which sits exactly ON the two-radius
    // sum up to float error, so allow an epsilon: a real pass-through samples
    // deep inside the disc, far below it.
    expect(minVeinClearance).toBeGreaterThan(nodeR + MOB_BODY_RADIUS - 1e-9);
    // And the player held the pocket: the solid veins never shoved them out.
    expect(dist(player.pos, stand)).toBeLessThan(0.05);
  });

  it('no overworld mob spawns inside a gather-node body', () => {
    const bodies = GATHER_NODES.filter((n) => GATHER_NODE_BODIES[n.type] !== null);
    expect(bodies.length).toBeGreaterThan(0);
    expect(eastbrookOreVeins()).toHaveLength(6);

    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const eastbrook = ZONES.find((z) => z.id === EASTBROOK_ID)!;
    const spawns: Entity[] = [];
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.ownerId !== null) continue;
      if (e.spawnPos.x > DUNGEON_X_THRESHOLD) continue; // instance interiors, not the overworld
      spawns.push(e);
    }
    // Non-vacuity, both halves: the world really did spawn camp mobs, and the
    // Eastbrook camps (the ones sharing ground with the dig) are among them.
    expect(spawns.length).toBeGreaterThan(0);
    const eastbrookSpawns = spawns.filter(
      (e) => e.spawnPos.z >= eastbrook.zMin && e.spawnPos.z < eastbrook.zMax,
    );
    expect(eastbrookSpawns.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const e of spawns) {
      for (const n of bodies) {
        const clear = GATHER_NODE_BODIES[n.type]!.r + MOB_BODY_RADIUS;
        const d = dist(e.spawnPos, n.pos);
        if (d <= clear) {
          violations.push(
            `${e.templateId} spawn (${e.spawnPos.x.toFixed(2)}, ${e.spawnPos.z.toFixed(2)}) is ${d.toFixed(2)}yd from ${n.id}, needs more than ${clear.toFixed(2)}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
