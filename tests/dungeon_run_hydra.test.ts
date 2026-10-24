// The Mere Hydra's row in the dungeon run (src/sim/instances/dungeon_run.ts):
// one boss of three placed bodies (FinderEncounter.otherBodyIds in
// src/sim/content/dungeon_finder.ts), so one row, done only while all three
// heads lie dead in the claim. The heads grow back while another lives and a
// wipe stands every fallen one up again (encounters/drowned_temple/
// hydra_regrowth.ts), so the row must never read done on one or two fallen
// heads, and it is a live read, never a latch.
//
// Driven through a real claimed Temple and a real pull (tests/helpers/
// temple_fight.ts), the way the Hydra's own suites drive it.
import { describe, expect, it } from 'vitest';
import {
  HYDRA_CENTER_ID,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  HYDRA_TUNING,
  POOL,
} from '../src/sim/encounters/drowned_temple';
import { regrowHead } from '../src/sim/encounters/drowned_temple/hydra_regrowth';
import { dungeonRunForPlayer } from '../src/sim/instances/dungeon_run';
import type { Entity, HydraFightState } from '../src/sim/types';
import { boss, engage, type Fight, fight, put, run } from './helpers/temple_fight';

const T = HYDRA_TUNING;
const HYDRA_ROW = 1;

function hydraFight(difficulty: 'normal' | 'heroic' = 'normal'): { f: Fight; heads: Entity[] } {
  const f = fight(difficulty);
  const heads = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID].map((id) => boss(f, id));
  hold(f)();
  for (const h of heads) engage(f, h);
  return { f, heads };
}

/** Everyone back at their marks each tick (a shove would scatter the party). */
function hold(f: Fight): () => void {
  return () => {
    put(f, f.tank, POOL.x, POOL.z - 2);
    put(f, f.others[0], POOL.x - 12, POOL.z - 12);
    put(f, f.others[1], POOL.x + 12, POOL.z - 12);
  };
}

function state(heads: Entity[]): HydraFightState {
  const st = heads.find((h) => h.templeFight?.kind === 'hydra')?.templeFight;
  if (st?.kind !== 'hydra') throw new Error('no hydra fight');
  return st;
}

/** Skip a fallen head's regrowth clock ahead: it is due `left` seconds on. */
function regrowIn(heads: Entity[], i: number, left: number): void {
  const st = state(heads);
  st.diedAt[i] = (st.diedAt[i] ?? 0) - (T.regrowAfter - left);
}

const rows = (f: Fight) => f.sim.dungeonRun?.bosses.map((b) => [b.mobId, b.defeated]);
const hydraDone = (f: Fight) => f.sim.dungeonRun?.bosses[HYDRA_ROW].defeated;

/** Tick `seconds`, asserting the Hydra's row reads `done` on every tick. */
function holds(f: Fight, seconds: number, done: boolean, when: string): void {
  for (let t = 0; t < seconds; t += 0.05) {
    hold(f)();
    f.sim.tick();
    for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
    expect(hydraDone(f), `${when}, ${t.toFixed(2)} s`).toBe(done);
  }
}

describe.each(['normal', 'heroic'] as const)('the Mere Hydra row on %s', (difficulty) => {
  it('is one row, second on the route, open with all three heads standing', () => {
    const { f } = hydraFight(difficulty);
    expect(f.sim.dungeonRun?.difficulty).toBe(difficulty);
    expect(rows(f)).toEqual([
      ['choirmother_selthe', false],
      ['mere_hydra_head_center', false],
      ['tideglass_colossus', false],
      ['ysolei', false],
    ]);
  });

  it('stays open with one head dead and with two, and closes the instant the third falls', () => {
    const { f, heads } = hydraFight(difficulty);
    run(f, 0.2, hold(f));
    const standing = f.sim.dungeonRun;

    f.sim.ctx.handleDeath(heads[0], f.tank);
    expect(hydraDone(f), 'one head dead, before any tick').toBe(false);
    holds(f, 1, false, 'one head dead');
    // Nothing a consumer paints changed: the view is still the same object.
    expect(f.sim.dungeonRun).toBe(standing);

    // The centre head is the row's own id: its death alone must not close it.
    f.sim.ctx.handleDeath(heads[1], f.tank);
    expect(hydraDone(f), 'two heads dead, before any tick').toBe(false);
    holds(f, 1, false, 'two heads dead');
    expect(f.sim.dungeonRun).toBe(standing);

    f.sim.ctx.handleDeath(heads[2], f.tank);
    // No tick in between: the read is derived from the corpses.
    expect(hydraDone(f), 'all three dead').toBe(true);
    expect(f.sim.dungeonRun).not.toBe(standing);
    expect(rows(f)).toEqual([
      ['choirmother_selthe', false],
      ['mere_hydra_head_center', true],
      ['tideglass_colossus', false],
      ['ysolei', false],
    ]);
    // The old view was not mutated.
    expect(standing?.bosses[HYDRA_ROW].defeated).toBe(false);
  });

  it('closes whichever head falls last, the centre one included', () => {
    for (const order of [
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
    ]) {
      const { f, heads } = hydraFight(difficulty);
      run(f, 0.2, hold(f));
      order.forEach((i, n) => {
        expect(hydraDone(f), `${order.join('')}: before kill ${n + 1}`).toBe(false);
        f.sim.ctx.handleDeath(heads[i], f.tank);
      });
      expect(hydraDone(f), `${order.join('')}: all dead`).toBe(true);
    }
  });

  it('stays done for good once the last head falls: nothing grows back', () => {
    const { f, heads } = hydraFight(difficulty);
    run(f, 0.2, hold(f));
    for (const h of heads) f.sim.ctx.handleDeath(h, f.tank);
    const done = f.sim.dungeonRun;
    expect(hydraDone(f)).toBe(true);
    // The fight is over and its clocks are gone, so even a regrowth that was
    // long overdue has nothing to run it (the thirty-second version of this
    // wait is tests/drowned_temple_hydra_elements.test.ts).
    holds(f, 4, true, 'after the kill');
    expect(heads.every((h) => h.templeFight === undefined)).toBe(true);
    expect(heads.map((h) => h.dead)).toEqual([true, true, true]);
    expect(f.sim.dungeonRun).toBe(done);
  });
});

describe('the Mere Hydra row and the regrowth', () => {
  it('never flickers while a fallen head lies and then grows back in the same fight', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    const standing = f.sim.dungeonRun;
    f.sim.ctx.handleDeath(heads[2], f.tank);
    holds(f, 0.2, false, 'right head dead');
    regrowIn(heads, 2, 1);
    holds(f, 2, false, 'through the regrowth');
    expect(heads[2].dead).toBe(false);
    expect(heads[2].regrown).toBe(true);
    // Three heads up again, and the run never said otherwise.
    expect(f.sim.dungeonRun).toBe(standing);
  });

  it('two heads down, one grows back, and only the full kill closes the row', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    f.sim.ctx.handleDeath(heads[0], f.tank);
    holds(f, 0.2, false, 'left dead');
    f.sim.ctx.handleDeath(heads[1], f.tank);
    holds(f, 0.2, false, 'left and centre dead');
    // The left head is due back; the centre one lies on.
    regrowIn(heads, 0, 0);
    holds(f, 0.3, false, 'left grown back');
    expect(heads.map((h) => h.dead)).toEqual([false, true, false]);
    // The kill: the right head, then the regrown left one LAST.
    f.sim.ctx.handleDeath(heads[2], f.tank);
    expect(hydraDone(f)).toBe(false);
    f.sim.ctx.handleDeath(heads[0], f.tank);
    expect(hydraDone(f)).toBe(true);
    holds(f, 5, true, 'after a kill that ended on a regrown head');
  });

  it('a wipe with two heads down stands them up again, and the row was never done', () => {
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    const standing = f.sim.dungeonRun;
    f.sim.ctx.handleDeath(heads[0], f.tank);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    run(f, 0.2, hold(f));
    expect(hydraDone(f)).toBe(false);
    // The wipe: the party is gone and the last head drops the fight.
    for (const p of [f.tank, ...f.others]) put(f, p, 0, -230);
    heads[2].inCombat = false;
    heads[2].aggroTargetId = null;
    heads[2].aiState = 'evade';
    for (let t = 0; t < 1; t += 0.05) {
      f.sim.tick();
      expect(dungeonRunForPlayer(f.sim.ctx, f.tank.id)?.bosses[HYDRA_ROW].defeated).toBe(false);
    }
    expect(heads.map((h) => h.dead)).toEqual([false, false, false]);
    expect(heads.map((h) => h.hp === h.maxHp)).toEqual([true, true, true]);
    expect(f.sim.dungeonRun).toBe(standing);

    // The next attempt kills it: the regrown heads count like any other.
    hold(f)();
    for (const h of heads) engage(f, h);
    run(f, 0.2, hold(f));
    for (const h of heads) f.sim.ctx.handleDeath(h, f.tank);
    expect(hydraDone(f)).toBe(true);
  });

  it('is a live read, never a latch: a head standing again reopens the row', () => {
    // Nothing in the fight regrows a head after the kill (pinned above), but
    // the row answers for the bodies as they are, so if one ever stood again
    // the tracker would say so rather than keep a stale tick.
    const { f, heads } = hydraFight();
    run(f, 0.2, hold(f));
    for (const h of heads) f.sim.ctx.handleDeath(h, f.tank);
    expect(hydraDone(f)).toBe(true);
    const done = f.sim.dungeonRun;
    regrowHead(f.sim.ctx, heads[1], 1);
    expect(hydraDone(f)).toBe(false);
    expect(f.sim.dungeonRun).not.toBe(done);
    f.sim.ctx.handleDeath(heads[1], f.tank);
    expect(hydraDone(f)).toBe(true);
  });

  it('reads the same for every member inside, and draws no rng', () => {
    const play = (read: boolean): string => {
      const { f, heads } = hydraFight();
      const draws: number[] = [];
      f.sim.ctx.rng.setObserver((value) => draws.push(value));
      for (let i = 0; i < 80; i++) {
        if (i === 10) f.sim.ctx.handleDeath(heads[0], f.tank);
        if (i === 30) f.sim.ctx.handleDeath(heads[1], f.tank);
        if (i === 50) f.sim.ctx.handleDeath(heads[2], f.tank);
        if (read) {
          const mine = dungeonRunForPlayer(f.sim.ctx, f.tank.id);
          for (const other of f.others) expect(dungeonRunForPlayer(f.sim.ctx, other.id)).toBe(mine);
          expect(mine?.bosses[HYDRA_ROW].defeated).toBe(i >= 50);
        }
        hold(f)();
        f.sim.tick();
      }
      return JSON.stringify(draws);
    };
    expect(play(true)).toBe(play(false));
  });
});
