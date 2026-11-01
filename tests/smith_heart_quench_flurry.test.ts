// The Blades Hunt, the Guardian of the Quench's Mythic interphase, over a REAL Sim claim:
// it comes once at a quarter health and only on Mythic; the guardian stands past all harm
// while lines cross the lake at a quickening pace, the tank fair game; the cold, the ice
// and the deepening hold; it ends with the blades down and the guardian open again.

import { describe, expect, it } from 'vitest';
import {
  bladeStateOf,
  QUENCH_CASTS,
  QUENCH_DIFFICULTY,
  QUENCH_NAMES,
  QUENCH_OBJECTS,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT, type SimEvent } from '../src/sim/types';
import { hitsOf } from './helpers/council_fight';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);

/** A fight with all four blades awake and every timer held off. */
function awake(tier?: 'heroic' | 'mythic', n = 4): QuenchFight {
  const f = quenchFight(n, 31);
  f.dev('/dev heart quench pull');
  f.tick(1);
  if (tier) expect(f.dev(`/dev heart quench ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.breathTimer = 999;
  f.dev('/dev heart quench blades');
  st.slashTimer = 999;
  return f;
}

function quarter(f: QuenchFight): void {
  const b = f.boss();
  b.hp = Math.floor(b.maxHp * (T.flurryAt - 0.01));
}

describe('Guardian of the Quench: The Blades Hunt', () => {
  it('is on the Mythic row only', () => {
    expect(QUENCH_DIFFICULTY.normal.flurry).toBe(false);
    expect(QUENCH_DIFFICULTY.heroic.flurry).toBe(false);
    expect(QUENCH_DIFFICULTY.mythic.flurry).toBe(true);
  });

  it('never comes on Heroic, however low the guardian', () => {
    const f = awake('heroic');
    quarter(f);
    f.tick(ticks(3));
    expect(f.state()?.flurry).toBeNull();
    expect(f.boss().castingAbility).not.toBe(QUENCH_CASTS.flurry);
  });

  it('comes at a quarter health, not before, and the guardian cannot be hurt through it', () => {
    const f = awake('mythic');
    f.tick(ticks(3));
    expect(f.state()?.flurry).toBeNull();
    quarter(f);
    f.tick(ticks(2));
    expect(f.state()?.flurry).not.toBeNull();
    expect(f.boss().castingAbility).toBe(QUENCH_CASTS.flurry);
    expect(f.boss().damageImmune).toBe(true);
  });

  it('crosses the lake at a quickening pace and the bar ends it, once', () => {
    const f = awake('mythic');
    quarter(f);
    for (let i = 0; i < 100 && !f.state()?.flurry; i++) f.tick(1);
    // When each line comes into being, by object id.
    const seen = new Map<number, number>();
    let clock = 0;
    const flown = new Set<number>();
    for (let i = 0; i < ticks(T.flurrySeconds) - 2; i++) {
      f.tick(1);
      clock += DT;
      for (const e of f.objects(QUENCH_OBJECTS.lanePrefix)) {
        if (!seen.has(e.id)) seen.set(e.id, clock);
      }
      for (const b of f.objects(QUENCH_OBJECTS.bladePrefix))
        if (bladeStateOf(b.templateId) === 'fly') flown.add(b.id);
    }
    const starts = [...seen.values()];
    expect(starts.length).toBeGreaterThan(12);
    const firstGap = starts[1] - starts[0];
    const lastGap = starts[starts.length - 1] - starts[starts.length - 2];
    expect(firstGap).toBeCloseTo(T.flurryGapStart, 0);
    expect(firstGap - lastGap).toBeGreaterThan(0.3);
    expect(flown.size).toBe(4);

    f.tick(ticks(2));
    const st = f.state();
    expect(st?.flurry).toBeNull();
    expect(f.boss().damageImmune).toBe(false);
    expect(f.objects(QUENCH_OBJECTS.lanePrefix)).toEqual([]);
    for (const b of f.objects(QUENCH_OBJECTS.bladePrefix))
      expect(bladeStateOf(b.templateId)).toBe('float');
    // Still at a quarter: it never comes again, and the rounds of marks take up.
    expect(st?.flurryDone).toBe(true);
    f.tick(ticks(T.slashAfterWake) + 2);
    expect(st?.flurry).toBeNull();
    expect(st?.slash).not.toBeNull();
  });

  it('holds the cold and the ice, and its hits bring no cold', () => {
    const f = awake('mythic', 6);
    const st = f.state();
    if (!st) throw new Error('no fight');
    quarter(f);
    for (let i = 0; i < 100 && !st.flurry; i++) f.tick(1);
    const stacks = st.deepenStacks;
    const spread = 20;
    f.players.forEach((p, i) => {
      f.put(
        p,
        f.local(f.boss()).x + spread * Math.sin(i),
        f.local(f.boss()).z + spread * Math.cos(i),
      );
      st.chill[p.id] = { cold: 30, frozen: 0 };
    });
    const ev: SimEvent[] = [];
    for (let i = 0; i < ticks(T.deepenEvery - 2) && st.flurry; i++) ev.push(...f.tick(1));
    for (const p of f.players) expect(st.chill[p.id].cold).toBe(30);
    expect(f.players.some((p) => hitsOf(ev, QUENCH_NAMES.cross, p.id).length > 0)).toBe(true);
    expect(st.deepenStacks).toBe(stacks);
    expect(st.strain).toEqual([]);
  });

  it('a line is fixed where it is drawn and may go for the tank', () => {
    const f = awake('mythic', 2);
    expect(f.dev('/dev heart quench flurry')).toBe(true);
    const st = f.state();
    if (!st?.flurry) throw new Error('no interphase');
    f.tick(1);
    const line = st.flurry.lines[0];
    const facing = line.facing;
    const tank = f.boss().aggroTargetId;
    const moved = f.players[0];
    f.put(moved, f.local(moved).x + 15, f.local(moved).z - 9);
    f.tick(4);
    expect(line.facing).toBe(facing);
    // Over a whole interphase with two players, both get lines, the tank among them.
    expect(tank).not.toBeNull();
    const targets = new Set<number>();
    for (let i = 0; i < ticks(T.flurrySeconds - 2); i++) {
      for (const l of st.flurry?.lines ?? []) {
        for (const p of f.players) {
          const a = Math.atan2(f.local(p).x - l.from.x, f.local(p).z - l.from.z);
          if (l.phase === 'aim' && Math.abs(a - l.facing) < 1e-6) targets.add(p.id);
        }
      }
      f.tick(1);
    }
    expect(targets.has(tank as number)).toBe(true);
  });

  it('a reset in the middle leaves nothing behind', () => {
    const f = awake('mythic');
    f.dev('/dev heart quench flurry');
    f.tick(ticks(3));
    expect(f.dev('/dev heart quench reset')).toBe(true);
    expect(f.objects(QUENCH_OBJECTS.lanePrefix)).toEqual([]);
    expect(f.boss().damageImmune).toBe(false);
    expect(f.boss().castingAbility).toBeNull();
    for (const b of f.objects(QUENCH_OBJECTS.bladePrefix))
      expect(bladeStateOf(b.templateId)).toBe('sunk');
  });
});
