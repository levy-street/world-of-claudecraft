// The Hammer Council's cover guard (src/sim/encounters/smith_heart/
// council_cover.ts; the team's playtest of 2026-11-25: "after the melee boss
// died, the giant AoE once in a while came with no pillars") and the
// arena-wide Wrath (design doc 7.1: a pillar's shelter is the only escape).
// Claim tests over a REAL Sim: every Wrath after the first waits for a Wake
// to land and its pillars to rise, a bare Quarry gets one more Wake, a kicked
// Wake is the raid's choice, the wait is bounded, and the pull's war cry
// fires as the fight begins.

import { describe, expect, it } from 'vitest';
import { HAMMER_PIT } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  type CouncilDifficulty,
  councilScopeForDev,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import {
  shelterPillars,
  wakeInFlight,
  wrathWaitsForCover,
} from '../src/sim/encounters/smith_heart/council_cover';
import { collapsePillar } from '../src/sim/encounters/smith_heart/council_pillars';
import { COUNCIL_ARENA_R } from '../src/sim/encounters/smith_heart/council_scope';
import type { Entity } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';

function pulled(tier: CouncilDifficulty = 'normal', n = 6): CouncilFight {
  const f = councilFight(n, 17);
  if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
  f.dev('/dev heart council pull');
  f.tick();
  if (!f.state()) throw new Error('the council did not pull');
  return f;
}

/** Every shelter pillar down (a rock or a Rush took them). */
function bare(f: CouncilFight): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  for (const p of f.pillars()) {
    if (p.cursed || p.soul !== null) continue;
    collapsePillar(f.sim.ctx, f.inst, st, p, false);
  }
}

const wrathBar = (f: CouncilFight) =>
  (['guardian', 'singer'] as const).some((r) => f.state()?.bars[r]?.castId === COUNCIL_CASTS.wrath);

/** Tick until a Wrath bar begins (or `limit` seconds), the seconds it took. */
function untilWrathBar(f: CouncilFight, limit: number): number {
  for (let i = 0; i < limit * 20; i++) {
    if (wrathBar(f)) return i / 20;
    f.tick();
  }
  return Number.POSITIVE_INFINITY;
}

describe('the cover guard: a Wrath after the first waits for a Wake', () => {
  for (const tier of ['normal', 'heroic'] as CouncilDifficulty[]) {
    for (const first of ['none', 'guardian', 'singer'] as const) {
      it(`${tier}, ${first === 'none' ? 'both standing' : `the ${first} fallen`}: no bare Wrath`, () => {
        const f = pulled(tier);
        const st = f.state();
        if (!st) throw new Error('no fight');
        if (first !== 'none') {
          f.sim.ctx.handleDeath(f.bodies()[first] as Entity, f.players[0]);
          // The soul lands in the survivor (council_fury.ts).
          f.tick(20 * (T.furyArrive + 1));
        }
        // A Wrath has landed (the debt), the Quarry bare, the energy full and
        // the Wake's own clock far off: the very playtest's corner.
        st.wraths = 1;
        st.coverOwed = true;
        st.coverKicked = false;
        st.coverHeld = 0;
        st.wakeTimer = 25;
        st.lastFloorAt = null;
        bare(f);
        st.energy = T.energyMax;
        const s = councilScopeForDev(f.sim.ctx, f.inst);
        if (!s) throw new Error('no scope');
        expect(shelterPillars(s)).toBe(0);
        expect(wrathWaitsForCover(s)).toBe(true);
        const waited = untilWrathBar(f, T.coverHoldMax + 10);
        // The Wake came first and its pillars stood when the bar began.
        expect(waited, `${tier} ${first}: the Wrath never began`).toBeLessThan(T.coverHoldMax);
        expect(wakeInFlight(s)).toBe(false);
        expect(shelterPillars(s), `${tier} ${first}: no cover at the bar`).toBeGreaterThanOrEqual(
          1,
        );
        // The cover guard never stalls the fight: it waited a Wake's length.
        expect(waited).toBeGreaterThan(T.wakeMarkSeconds);
      });
    }
  }

  it("a kicked Wake is the raid's choice: the Wrath comes without waiting for another", () => {
    const f = pulled('normal');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.wraths = 1;
    st.coverOwed = true;
    st.wakeTimer = 0;
    st.lastFloorAt = null;
    bare(f);
    st.energy = T.energyMax;
    // The forced Wake begins; the raid kicks it.
    let kicked = false;
    for (let i = 0; i < 20 * 6 && !kicked; i++) {
      f.tick();
      const singer = f.bodies().singer as Entity;
      if (singer.castingAbility === COUNCIL_CASTS.wake) {
        f.tick(5);
        f.sim.ctx.cancelCast(singer);
        f.tick();
        kicked = true;
      }
    }
    expect(kicked).toBe(true);
    expect(st.coverKicked).toBe(true);
    const s = councilScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no scope');
    expect(wrathWaitsForCover(s)).toBe(false);
    // The kick's silence and the floor gap, no more.
    expect(untilWrathBar(f, 10)).toBeLessThan(T.floorGap + T.barGap + 1);
    expect(shelterPillars(s)).toBe(0);
  });

  it('the wait is bounded: a Singer silenced past it lets the Wrath through', () => {
    const f = pulled('normal');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.wraths = 1;
    st.coverOwed = true;
    st.lastFloorAt = null;
    bare(f);
    st.energy = T.energyMax;
    // Her kick's silence held for the whole wait: no Wake can start.
    let waited = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20 * (T.coverHoldMax + 8); i++) {
      st.quiet = 5;
      if (wrathBar(f)) {
        waited = i / 20;
        break;
      }
      f.tick();
    }
    expect(waited).toBeGreaterThanOrEqual(T.coverHoldMax - 0.1);
    expect(waited).toBeLessThan(T.coverHoldMax + 2);
  });

  it('the first Wrath owes nothing: the carved columns stand', () => {
    const f = pulled('normal');
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.coverOwed).toBe(false);
    const s = councilScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no scope');
    st.energy = T.energyMax;
    expect(wrathWaitsForCover(s)).toBe(false);
  });

  it('a Wrath landing owes the next one its Wake', () => {
    const f = pulled('normal');
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(f.dev('/dev heart council wrath')).toBe(true);
    f.tick(20 * (T.wrathCast + 0.5));
    expect(st.wraths).toBe(1);
    expect(st.coverOwed).toBe(true);
    expect(st.coverHeld).toBe(0);
  });
});

describe("Mountain's Wrath is arena-wide", () => {
  it('strikes an unhidden raider on the far rim, wherever the caster stands', () => {
    const f = pulled('normal');
    const g = f.bodies().guardian as Entity;
    const far = f.players[1];
    // The Guardian on one side of the floor, the raider on the far rim,
    // further from him than the old 45 yd reach.
    const gl = f.local(g);
    const ang = Math.atan2(gl.x - HAMMER_PIT.x, gl.z - HAMMER_PIT.z) + Math.PI;
    const rim = COUNCIL_ARENA_R - 3;
    f.put(far, HAMMER_PIT.x + Math.sin(ang) * rim, HAMMER_PIT.z + Math.cos(ang) * rim);
    bare(f);
    const fl = f.local(far);
    expect(Math.hypot(fl.x - gl.x, fl.z - gl.z)).toBeGreaterThan(45);
    expect(f.dev('/dev heart council wrath')).toBe(true);
    const ev = f.tick(20 * (T.wrathCast + 0.5));
    expect(hitsOf(ev, COUNCIL_NAMES.wrath, far.id).length).toBe(1);
  });

  it('spans the whole floor from any spot on it', () => {
    expect(T.wrathRadius).toBeGreaterThanOrEqual(2 * COUNCIL_ARENA_R);
  });
});

describe("the pull's war cry", () => {
  it('each member cries out as the fight begins, once', () => {
    // The helper's raid stands in reach: the council pulls on its own tick,
    // so a reset sends it home and the next tick is a fresh pull.
    const f = councilFight(6, 17);
    f.dev('/dev heart council reset');
    const ev = f.tick();
    expect(f.state()).not.toBeNull();
    const cries = (e: typeof ev) =>
      e.filter((x) => x.type === 'spellfx' && x.ability === COUNCIL_CUES.pull).length;
    expect(cries(ev)).toBe(2);
    expect(cries(f.tick(40))).toBe(0);
  });
});
