import { beforeEach, describe, expect, it } from 'vitest';
import { TAVERN_ORIGIN, TAVERN_TOWER, tavernToWorld } from '../src/sim/content/mirefen_tavern';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { MAX_WANDER_RADIUS } from '../src/sim/mob/aggro_ranges';
import { proximityAggroSees } from '../src/sim/mob/aggro_sight';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Proximity aggro needs a line of sight in the open world (src/sim/mob/aggro_sight.ts,
// consumed by the idle scan in src/sim/mob/locomotion.ts): a hostile never acquires a
// player it cannot see, so a wall stands between a marsh mob and a player resting in the
// Mirefen tavern. The bug this pins: the Fen Troll camp west of the tavern wanders to
// within a few yards of the kitchen wing and the round tower, and the idle scan (distance
// only) pulled players sitting in the tower's nook straight through the stone.
//
// Every scenario runs the real Sim tick: the real troll from its real camp, the player on
// the tavern's real floor, and the walls' real colliders between them. Each blocked case
// has a control at the same distance with nothing in between, so a pass is never a mob
// that simply could not reach.

const S = WORLD_SEED;
const PLAYER_LEVEL = 10;

let sim: Sim;

/** The Fen Troll whose camp spawn sits nearest the tavern. */
function nearestTroll(): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.templateId !== 'fen_troll') continue;
    const d = Math.hypot(e.spawnPos.x - TAVERN_ORIGIN.x, e.spawnPos.z - TAVERN_ORIGIN.z);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (!best) throw new Error('no fen troll in the built-in world');
  return best;
}

/** Stand a body at world (x, z) on the walk surface (the tavern's floor inside it). */
function standAt(e: Entity, x: number, z: number): void {
  e.pos = { x, y: groundHeight(x, z, S), z };
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
}

/** Hold an idle hostile where it stands (no wander step this test). */
function holdIdle(mob: Entity, x: number, z: number): void {
  standAt(mob, x, z);
  mob.aiState = 'idle';
  mob.inCombat = false;
  mob.aggroTargetId = null;
  mob.wanderTarget = null;
  mob.wanderTimer = 1e9;
}

/** Run the world a second and a half; whether `mob` pulled the player. */
function pulls(mob: Entity): boolean {
  const pid = sim.player.id;
  for (let i = 0; i < 30; i++) {
    sim.tick();
    if (mob.aggroTargetId === pid || mob.threat.has(pid)) return true;
  }
  return false;
}

/** The effective aggro radius the idle scan gives this troll against the player. */
function aggroRadius(mob: Entity): number {
  return Math.min(20, 11 + (mob.level - PLAYER_LEVEL) * 1.5);
}

const local = (lx: number, lz: number) => tavernToWorld(lx, lz);

beforeEach(() => {
  sim = new Sim({ seed: S, playerClass: 'warrior' });
  sim.setPlayerLevel(PLAYER_LEVEL);
});

describe('proximity aggro needs a line of sight: the Mirefen tavern', () => {
  it('the troll camp west of the tavern wanders within pulling range of the tower nook', () => {
    // The geometry behind the report: the troll's wander ring reaches the tavern's west
    // side, close enough to the nook's floor for a plain distance check to pull.
    const troll = nearestTroll();
    const T = TAVERN_TOWER;
    const nook = local(T.x, T.z - T.rIn + 1.2);
    const toward = Math.atan2(nook.x - troll.spawnPos.x, nook.z - troll.spawnPos.z);
    const edge = {
      x: troll.spawnPos.x + Math.sin(toward) * MAX_WANDER_RADIUS,
      z: troll.spawnPos.z + Math.cos(toward) * MAX_WANDER_RADIUS,
    };
    const d = Math.hypot(nook.x - edge.x, nook.z - edge.z);
    expect(d).toBeLessThan(aggroRadius(troll));
  });

  it('a troll at the edge of its wander ring does not pull a player in the tower nook', () => {
    const troll = nearestTroll();
    const T = TAVERN_TOWER;
    const nook = local(T.x, T.z - T.rIn + 1.2);
    const toward = Math.atan2(nook.x - troll.spawnPos.x, nook.z - troll.spawnPos.z);
    holdIdle(
      troll,
      troll.spawnPos.x + Math.sin(toward) * MAX_WANDER_RADIUS,
      troll.spawnPos.z + Math.cos(toward) * MAX_WANDER_RADIUS,
    );
    standAt(sim.player, nook.x, nook.z);
    expect(pulls(troll)).toBe(false);
  });

  // A hostile just outside the nearest wall, and the player at each place a guest stays:
  // the hearth, the bar, a booth, the tower nook and just inside the door. [player local,
  // hostile local]; every hostile stands within its aggro radius of the player.
  const SPOTS: readonly (readonly [
    string,
    readonly [number, number],
    readonly [number, number],
  ])[] = [
    ['the hearth', [5.5, 2.4], [18.0, 2.4]],
    ['the bar', [8.5, -8.0], [18.5, -8.0]],
    ['the booth by the door', [-9.0, 11.75], [-18.5, 11.75]],
    ['the tower nook', [TAVERN_TOWER.x, TAVERN_TOWER.z - 3], [TAVERN_TOWER.x, -29]],
    ['just inside the door', [1.0, 12.5], [-12.0, 17.5]],
  ];

  for (const [name, at, from] of SPOTS) {
    it(`a hostile outside the wall does not pull a player at ${name}`, () => {
      const troll = nearestTroll();
      const p = local(at[0], at[1]);
      const m = local(from[0], from[1]);
      expect(Math.hypot(p.x - m.x, p.z - m.z)).toBeLessThan(aggroRadius(troll));
      holdIdle(troll, m.x, m.z);
      standAt(sim.player, p.x, p.z);
      expect(pulls(troll)).toBe(false);
    });
  }

  it('control: the same hostile pulls a player at the same distance with nothing between', () => {
    // due west of the tavern, out in the open marsh: the scan itself still works
    const troll = nearestTroll();
    const m = { x: TAVERN_ORIGIN.x - 50, z: TAVERN_ORIGIN.z - 20 };
    holdIdle(troll, m.x, m.z);
    standAt(sim.player, m.x + 8, m.z);
    expect(pulls(troll)).toBe(true);
  });

  it('control: a hostile that sees the player through the open door still pulls', () => {
    const troll = nearestTroll();
    const p = local(0, 10);
    const m = local(0, 21);
    holdIdle(troll, m.x, m.z);
    standAt(sim.player, p.x, p.z);
    expect(pulls(troll)).toBe(true);
  });

  it('a deliberate pull still starts the fight: the sight rule gates only the idle scan', () => {
    // aggroMob is the one entry every player-started fight (an attack, a taunt) goes
    // through; it carries no sight rule, so normal combat applies inside
    const troll = nearestTroll();
    const p = local(0, 12.5);
    const m = local(-12.0, 17.5);
    holdIdle(troll, m.x, m.z);
    standAt(sim.player, p.x, p.z);
    expect(pulls(troll)).toBe(false);
    expect(sim.aggroMob(troll, sim.player, false)).toBe(true);
    expect(troll.aggroTargetId).toBe(sim.player.id);
  });
});

describe('proximityAggroSees', () => {
  it('traces the sight line in the open world, and leaves instanced pulls to their layouts', () => {
    const calls: number[] = [];
    const ctx = {
      hasLineOfSight: (m: Entity) => {
        calls.push(m.id);
        return false;
      },
    };
    const mob = { id: 1, pos: { x: 0, y: 0, z: 0 } } as Entity;
    const target = { id: 2, pos: { x: 5, y: 0, z: 0 } } as Entity;
    expect(proximityAggroSees(ctx, mob, target)).toBe(false);
    expect(calls).toEqual([1]);
    mob.pos = { x: DUNGEON_X_THRESHOLD + 50, y: 0, z: 0 };
    expect(proximityAggroSees(ctx, mob, target)).toBe(true);
    expect(calls).toEqual([1]);
  });
});
