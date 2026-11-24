// The Hammer Council after its first fall (the live playtest of 2026-11-24:
// "we killed the Guardian first; after that the Singer's Mountain's Wrath came
// with no pillar to hide behind"). A claim test over a REAL Sim claim that
// drives the real council with NO kicks, for both kill orders on every tier:
// the raid stands where it stands until a Wrath's bar begins, then every
// player runs behind the nearest pillar (round-robin, so Narrow Shelter never
// crowds) and holds there until the blast lands. Every Wrath the survivor
// casts must find a pillar raised by Wake the Stone standing when its bar
// begins (time to get behind it) and still standing when it lands, every
// player sheltered, and no Falling Rock landing inside the Wrath's bar (a
// soak there either breaks the raid's cover or costs the raid its tremor:
// the floor gap's rule that two floor mechanics never land at once,
// council_floor_gap.ts).

import { describe, expect, it } from 'vitest';
import {
  COUNCIL_CASTS,
  type CouncilDifficulty,
  type CouncilFightState,
  type CouncilRole,
  councilScopeForDev,
  inCouncilShelter,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { clearOfWrath, rockSeconds } from '../src/sim/encounters/smith_heart/council_floor';
import type { Entity } from '../src/sim/types';
import { councilFight } from './helpers/council_fight';

interface WrathRow {
  n: number;
  /** Shelter pillars standing when the bar began / when it landed. */
  atBar: number;
  atLand: number;
  /** Pillars standing from the bar's start to its landing. */
  heldThrough: number;
  unsheltered: number;
  /** A Falling Rock landed while this Wrath's bar ran. */
  rockInBar: boolean;
}

function run(
  tier: CouncilDifficulty,
  first: CouncilRole,
  killAt: number,
  atKill?: (st: CouncilFightState) => void,
): WrathRow[] {
  const f = councilFight(6, 17);
  if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  const shelters = () => f.pillars().filter((p) => !p.cursed && p.soul === null);
  const rows: WrathRow[] = [];
  let killed = false;
  let barIds: Set<number> | null = null;
  let rockInBar = false;
  let wraths = st.wraths;
  const ticks = (killAt + 170) * 20;
  for (let i = 0; i < ticks; i++) {
    if (!killed && i === killAt * 20) {
      atKill?.(st);
      f.sim.ctx.handleDeath(f.bodies()[first] as Entity, f.players[0]);
      killed = true;
    }
    const inBar = (['guardian', 'singer'] as const).some(
      (r) => st.bars[r]?.castId === COUNCIL_CASTS.wrath,
    );
    const cover = shelters();
    if (inBar) {
      if (barIds === null) barIds = new Set(cover.map((p) => p.e.id));
      // Every player behind the nearest-in-turn pillar (round-robin).
      if (cover.length > 0) {
        f.players.forEach((p, k) => {
          if (p.dead) return;
          const pl = cover[k % cover.length];
          const o = f.local(pl.e);
          const a = k * 1.3;
          f.put(p, o.x + Math.sin(a) * (pl.r + 1.2), o.z + Math.cos(a) * (pl.r + 1.2));
        });
      }
    }
    const rockLands = st.rock !== null && st.rock.remaining <= 0.05 + 1e-9;
    if (inBar && rockLands) rockInBar = true;
    // What the blast would meet if it lands this tick.
    const unsheltered = f.players.filter(
      (p) =>
        !p.dead &&
        !cover.some((pl) => inCouncilShelter(pl.e.pos.x, pl.e.pos.z, pl.r, p.pos.x, p.pos.z)),
    ).length;
    f.tick();
    if (st.wraths !== wraths) {
      wraths = st.wraths;
      if (killed) {
        const landIds = new Set(cover.map((p) => p.e.id));
        rows.push({
          n: st.wraths,
          atBar: barIds?.size ?? 0,
          atLand: landIds.size,
          heldThrough: [...(barIds ?? [])].filter((id) => landIds.has(id)).length,
          unsheltered,
          rockInBar,
        });
      }
      barIds = null;
      rockInBar = false;
    }
  }
  return rows;
}

const CASES: { tier: CouncilDifficulty; first: CouncilRole; killAt: number }[] = [];
for (const tier of ['normal', 'heroic', 'mythic'] as CouncilDifficulty[]) {
  // The playtest's order first (the Guardian falls, the Singer inherits the
  // Wrath), before and after the first Wrath; then the other order.
  CASES.push({ tier, first: 'guardian', killAt: 30 });
  CASES.push({ tier, first: 'guardian', killAt: 75 });
  CASES.push({ tier, first: 'singer', killAt: 75 });
}

describe('Hammer Council: every Wrath after the first fall has cover', () => {
  for (const c of CASES) {
    it(`${c.tier}: the ${c.first} falls at ${c.killAt} s, no kicks`, () => {
      const rows = run(c.tier, c.first, c.killAt);
      // Three Wraths at least in the survivor's hands.
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        const tag = `${c.tier} ${c.first}@${c.killAt} Wrath #${r.n}`;
        expect(r.rockInBar, `${tag}: a rock landed inside the bar`).toBe(false);
        expect(r.atBar, `${tag}: no cover when the bar began`).toBeGreaterThanOrEqual(1);
        expect(r.heldThrough, `${tag}: the cover fell during the bar`).toBeGreaterThanOrEqual(1);
        expect(r.unsheltered, `${tag}: players left in the open`).toBe(0);
      }
    }, 60_000);
  }
});

describe('the rock guard: Falling Rock never lands inside a Wrath bar', () => {
  it('the Guardian falls on a full bar: no rock started in the soul flight lands in her Wrath', () => {
    for (const tier of ['normal', 'heroic'] as CouncilDifficulty[]) {
      const rows = run(tier, 'guardian', 40, (st) => {
        // His energy all but full, the rock due, the floor open: the rock
        // would land in the Singer's first Wrath, straight after the soul.
        st.energy = T.energyMax - 1;
        st.rockTimer = 0;
        st.lastFloorAt = null;
      });
      expect(rows.length, tier).toBeGreaterThanOrEqual(1);
      for (const r of rows) expect(r.rockInBar, `${tier} Wrath #${r.n}`).toBe(false);
    }
  }, 60_000);

  it('every tier: the rock waits when it would land within the pad of the bar', () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as CouncilDifficulty[]) {
      const f = councilFight(6, 17);
      if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
      f.dev('/dev heart council pull');
      f.tick();
      const st = f.state();
      const s = councilScopeForDev(f.sim.ctx, f.inst);
      if (!st || !s) throw new Error('the council did not pull');
      const energyFor = (sec: number) => T.energyMax - (sec * T.energyMax) / T.energyFillSeconds;
      st.energy = energyFor(30);
      expect(clearOfWrath(s, rockSeconds(s), true), tier).toBe(true);
      st.energy = energyFor(rockSeconds(s) + T.wrathGuardPad - 0.5);
      expect(clearOfWrath(s, rockSeconds(s), true), tier).toBe(false);
      // The Wake and the Rush keep their tier's rule (heroic lets them overlap).
      expect(clearOfWrath(s, rockSeconds(s)), tier).toBe(tier === 'normal' ? false : true);
    }
  });
});
