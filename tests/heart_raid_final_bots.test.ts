// The Masterless Strength raid bots (scripts/lib/heart_raid_final.mjs) read the
// fight's CURRENT mechanics off the wire the way the server sends them: the
// Hardening Frost ring (final_strike.ts, from Biting Frost's fifth stack) is a
// hazard every bot steps out of once it has noticed it (the reaction model,
// scripts/lib/heart_raid_reaction.mjs), the fight's counters see the rings and
// the freezes, and Heart Unbound's stacks are counted. A fake world stands in
// for the observer's snapshot; the template ids are the sim's own.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { heartQuarterSpot } from '../src/sim/content/smith_heart_quarters';
import {
  ELEMENT_AURAS,
  ELEMENT_TUNING,
  rimeTemplate,
} from '../src/sim/encounters/smith_heart/final_elements_ids';
import { FINAL_AURAS, FINAL_ZONE_CODES } from '../src/sim/encounters/smith_heart/final_ids';

type Final = {
  read(world: unknown): void;
  track(world: unknown, st: Record<string, unknown>): void;
  duty(world: unknown, st: Record<string, unknown>, b: unknown, me: unknown): unknown;
  bad(world: unknown, st: Record<string, unknown>, at: { x: number; z: number }): boolean;
  summary(world: unknown, st: Record<string, unknown>): Record<string, unknown>;
};
let final: Final;

beforeAll(async () => {
  vi.stubEnv('SEED', '20261121');
  final = (await import('../scripts/lib/heart_raid_final.mjs')).default as Final;
});
afterEach(() => {
  vi.useRealTimers();
});

/** A fight in the Heat quarter: the tank holding the boss, a Hardening Frost
 *  ring at the tank's feet, and the observer's snapshot of it. */
function heatFight(opts: { rime?: boolean; unbound?: number } = {}) {
  const spot = heartQuarterSpot('heat');
  const tank = {
    pid: 1,
    name: 'Brannock',
    x: spot.x,
    z: spot.z,
    auras: [] as object[],
    tank: true,
  };
  const bot = { pid: 1, name: 'Brannock', spec: { key: 'mt', role: 'tank' } };
  const bossAuras: object[] = [{ id: FINAL_AURAS.state, value: FINAL_ZONE_CODES.heat }];
  if (opts.unbound) bossAuras.push({ id: FINAL_AURAS.unbound, value: opts.unbound });
  const boss = {
    id: 50,
    x: spot.x + 3,
    z: spot.z,
    hp: 100000,
    mhp: 100000,
    aggro: 1,
    auras: bossAuras,
  };
  const ents = new Map<number, object>();
  if (opts.rime !== false)
    ents.set(900, {
      k: 'object',
      id: 900,
      tid: rimeTemplate(ELEMENT_TUNING.rimeWarn),
      x: spot.x,
      z: spot.z,
      sc: ELEMENT_TUNING.rimeR,
    });
  const world = {
    origin: { x: 0, z: 0 },
    center: { x: 188, z: 172 },
    obs: { ents },
    mobs: { boss },
    adds: [] as object[],
    bots: [bot],
    players: new Map([[1, tank]]),
    living: () => [tank],
  };
  return { world, tank, bot, boss };
}

describe('Masterless Strength bots: Hardening Frost', () => {
  it('reads the ring as a hazard of the rime radius', () => {
    const { world, tank } = heatFight();
    final.read(world);
    const o = (world as unknown as { o: { rimes: { r: number }[] } }).o;
    expect(o.rimes).toHaveLength(1);
    expect(o.rimes[0].r).toBe(ELEMENT_TUNING.rimeR);
    // Before any bot looks (no viewer yet) the spot is bad outright.
    expect(final.bad(world, {}, tank)).toBe(true);
  });

  it('the tank steps out of the ring once it has noticed it, in time for the close', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { world, tank, bot } = heatFight();
    const st: Record<string, unknown> = {};
    final.read(world);
    // The first look: not noticed yet (a human's reaction time).
    expect(final.duty(world, st, bot, tank)).toBeNull();
    // Within the competent band plus the worst slip (0.65 + 1.8 s), well
    // inside the ring's 3 s warning.
    vi.setSystemTime(1_000_000 + 2500);
    const d = final.duty(world, st, bot, tank) as { goal: { x: number; z: number }; duty: string };
    expect(d).not.toBeNull();
    expect(d.duty).toBe('dodge');
    const out = Math.hypot(d.goal.x - tank.x, d.goal.z - tank.z);
    expect(out).toBeGreaterThan(ELEMENT_TUNING.rimeR);
  });

  it('a fight without the ring leaves the tank where it stands', () => {
    vi.useFakeTimers({ now: 2_000_000 });
    const { world, tank, bot } = heatFight({ rime: false });
    final.read(world);
    vi.setSystemTime(2_000_000 + 5000);
    expect(final.duty(world, {}, bot, tank)).toBeNull();
  });

  it('counts the rings, the freezes and Heart Unbound in the summary', () => {
    const { world, tank } = heatFight({ unbound: 3 });
    const st: Record<string, unknown> = {};
    final.read(world);
    final.track(world, st);
    tank.auras = [{ id: ELEMENT_AURAS.frozen }];
    final.track(world, st);
    final.track(world, st);
    const sum = final.summary(world, st);
    expect(sum.rimes).toBe(1);
    expect(sum.freezes).toBe(1);
    expect(sum.unboundMax).toBe(3);
  });
});
