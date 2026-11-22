// Boss-dropped hazard pools as presentation rows (src/sim/delves/boss_pool_views.ts):
// Sister Nhalia's Blackwater Mark reaches the renderer through
// IWorld.activeHazardPools() (exact ages offline) and the `drun.bossPools` wire
// rows (static per pool, aged locally by src/net/hazard_pool_mirror.ts online).
// Display only: these pins also prove the mark's mechanics are untouched.

import { describe, expect, it } from 'vitest';
import { HazardPoolMirror } from '../src/net/hazard_pool_mirror';
import { BUILTIN_WORLD, DELVES } from '../src/sim/data';
import {
  BLACKWATER_MARK_DURATION,
  BLACKWATER_MARK_RADIUS,
  BLACKWATER_MARK_TICK,
  blackwaterMarkPoolInfos,
  blackwaterMarkPoolView,
  NO_HAZARD_POOLS,
} from '../src/sim/delves/boss_pool_views';
import { Sim } from '../src/sim/sim';
import { type DelveRun, DT, type WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function apseSim(seed = 42): { sim: Sim; run: DelveRun } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: WORLD });
  sim.setPlayerLevel(DELVES.drowned_litany.minLevel);
  const door = DELVES.drowned_litany.doorPos;
  const p = sim.player;
  p.pos = { x: door.x, y: terrainHeight(door.x, door.z, sim.cfg.seed), z: door.z };
  p.prevPos = { ...p.pos };
  sim.enterDelve('drowned_litany', 'normal');
  const run = sim.delveRunForPlayer(sim.playerId)!;
  run.modules = ['litany_apse'];
  run.moduleIndex = 0;
  (sim as any).spawnDelveModule(run);
  return { sim, run };
}

function nhalia(sim: Sim) {
  return [...sim.entities.values()].find((e) => e.templateId === 'sister_nhalia_drowned_canticle')!;
}

/** Drop one mark now and return the run after the casting step. */
function dropMark(sim: Sim, run: DelveRun): void {
  nhalia(sim).inCombat = true;
  run.nhaliaBoss!.markTimer = 0.001;
  (sim as any).updateDelveRuns();
}

describe('Blackwater Mark as a hazard pool row (offline world)', () => {
  it('lists nothing while no mark is down', () => {
    const { sim } = apseSim();
    expect(sim.activeHazardPools()).toBe(NO_HAZARD_POOLS);
    expect(sim.delveRun?.bossPools).toEqual([]);
  });

  it('lists a dropped mark at its spot, radius and authored timing', () => {
    const { sim, run } = apseSim();
    dropMark(sim, run);
    const mark = run.nhaliaBoss!.marks[0]!;
    const pools = sim.activeHazardPools();
    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({
      x: mark.x,
      z: mark.z,
      r: 4,
      style: 'violet',
      armSec: 1,
      lifeSec: 8,
    });
    expect(pools[0].id).toBe(`blackwater_mark:${mark.bornTick}`);
    // Age is exact: the mark's own elapsed clock.
    expect(pools[0].ageSec).toBeCloseTo(BLACKWATER_MARK_DURATION - mark.remaining, 9);
    for (let i = 0; i < 10; i++) (sim as any).updateDelveRuns();
    expect(sim.activeHazardPools()[0].ageSec).toBeCloseTo(
      BLACKWATER_MARK_DURATION - run.nhaliaBoss!.marks[0]!.remaining,
      9,
    );
    expect(sim.activeHazardPools()[0].id).toBe(pools[0].id);
  });

  it('keeps the wire row byte-identical for the whole life of the mark, then drops it', () => {
    const { sim, run } = apseSim();
    dropMark(sim, run);
    const first = JSON.stringify(sim.delveRun?.bossPools);
    expect(JSON.parse(first)).toHaveLength(1);
    // Every tick of its life the row is the same bytes (the self wire is
    // JSON-diffed per tick, so a clock in it would resend every tick).
    let ticks = 0;
    while (run.nhaliaBoss!.marks.length && ticks < 400) {
      expect(JSON.stringify(sim.delveRun?.bossPools)).toBe(first);
      (sim as any).updateDelveRuns();
      ticks++;
    }
    expect(run.nhaliaBoss!.marks).toEqual([]);
    expect(sim.delveRun?.bossPools).toEqual([]);
    expect(sim.activeHazardPools()).toBe(NO_HAZARD_POOLS);
    // It lived its authored 8 s (removed on the tick after the last damage tick).
    expect(ticks * DT).toBeGreaterThan(BLACKWATER_MARK_DURATION - DT);
    expect(ticks * DT).toBeLessThan(BLACKWATER_MARK_DURATION + 3 * DT);
  });

  it('stops listing marks once Sister Nhalia is dead (her frozen marks deal no damage)', () => {
    const { sim, run } = apseSim();
    dropMark(sim, run);
    expect(sim.activeHazardPools()).toHaveLength(1);
    const boss = nhalia(sim);
    boss.dead = true;
    boss.hp = 0;
    expect(sim.activeHazardPools()).toEqual([]);
    expect(sim.delveRun?.bossPools).toEqual([]);
  });

  it('leaves the mark mechanics untouched: same timing, damage and seed path', () => {
    // The display identity is stamped from the tick count; nothing reads it.
    const run1 = apseSim(7);
    dropMark(run1.sim, run1.run);
    const m = run1.run.nhaliaBoss!.marks[0]!;
    expect(m.remaining).toBeCloseTo(BLACKWATER_MARK_DURATION, 9);
    expect(m.tickTimer).toBeCloseTo(BLACKWATER_MARK_TICK, 9);
    expect(typeof m.bornTick).toBe('number');
    const run2 = apseSim(7);
    dropMark(run2.sim, run2.run);
    const m2 = run2.run.nhaliaBoss!.marks[0]!;
    expect([m2.x, m2.z, m2.bornTick]).toEqual([m.x, m.z, m.bornTick]);
  });
});

describe('boss pool wire rows and the online mirror', () => {
  it('builds wire rows with position and identity only', () => {
    const rows = blackwaterMarkPoolInfos([
      { x: 3, z: 4, remaining: 5, tickTimer: 0.5, bornTick: 120 },
    ]);
    expect(rows).toEqual([{ id: 120, x: 3, z: 4, r: BLACKWATER_MARK_RADIUS }]);
  });

  it('ages a pool from first sight, keeps it while listed and forgets it when dropped', () => {
    const mirror = new HazardPoolMirror();
    const row = { id: 77, x: 1, z: 2, r: 4 };
    expect(mirror.views(undefined, 0)).toBe(NO_HAZARD_POOLS);
    const a = mirror.views([row], 1000);
    expect(a).toHaveLength(1);
    expect(a[0]).toEqual(blackwaterMarkPoolView(row, 0));
    expect(mirror.views([row], 1600)[0].ageSec).toBeCloseTo(0.6, 9);
    // Still listed long past its authored life (a late clock): still drawn.
    expect(mirror.views([row], 30_000)).toHaveLength(1);
    // Dropped, then the same id seen again starts fresh.
    expect(mirror.views([], 31_000)).toBe(NO_HAZARD_POOLS);
    expect(mirror.views([row], 40_000)[0].ageSec).toBe(0);
  });

  it('tracks several pools independently', () => {
    const mirror = new HazardPoolMirror();
    mirror.views([{ id: 1, x: 0, z: 0, r: 4 }], 0);
    const both = mirror.views(
      [
        { id: 1, x: 0, z: 0, r: 4 },
        { id: 2, x: 9, z: 9, r: 4 },
      ],
      500,
    );
    expect(both.map((p) => [p.id, p.ageSec])).toEqual([
      ['blackwater_mark:1', 0.5],
      ['blackwater_mark:2', 0],
    ]);
  });
});
