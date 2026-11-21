// The Masterless Strength raid bots (scripts/lib/heart_raid_final.mjs) read the
// fight's CURRENT mechanics off the wire the way the server sends them: the
// Hardening Frost ring (final_strike.ts, from Biting Frost's fifth stack) is a
// hazard every bot steps out of once it has noticed it (the reaction model,
// scripts/lib/heart_raid_reaction.mjs), the fight's counters see the rings and
// the freezes, and Heart Unbound's stacks are counted. A fake world stands in
// for the observer's snapshot; the template ids are the sim's own.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HEART_QUARTERS, heartQuarterSpot } from '../src/sim/content/smith_heart_quarters';
import {
  ELEMENT_AURAS,
  ELEMENT_OBJECTS,
  ELEMENT_TUNING,
  rimeTemplate,
  STRIKE_AURAS,
} from '../src/sim/encounters/smith_heart/final_elements_ids';
import {
  FINAL_AURAS,
  FINAL_OBJECTS,
  FINAL_TUNING,
  FINAL_ZONE_CODES,
  finalBladeTemplate,
  finalPillarTemplate,
  finalTimed,
} from '../src/sim/encounters/smith_heart/final_ids';

type Final = {
  read(world: unknown): void;
  track(world: unknown, st: Record<string, unknown>): void;
  duty(world: unknown, st: Record<string, unknown>, b: unknown, me: unknown): unknown;
  bad(world: unknown, st: Record<string, unknown>, at: { x: number; z: number }): boolean;
  summary(world: unknown, st: Record<string, unknown>): Record<string, unknown>;
  roleSpot(
    world: unknown,
    st: Record<string, unknown>,
    b: unknown,
  ): { x: number; z: number } | null;
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

describe('Masterless Strength bots: Crossing Blade', () => {
  it('leads the line through a pillar it can reach before the lock, not a charged one across the room', () => {
    vi.useFakeTimers({ now: 3_000_000 });
    const { world, tank } = heatFight({ rime: false });
    // A damage dealer marked for the blade, standing 10 yd off the quarter spot.
    const me = {
      pid: 2,
      name: 'Ivaline',
      x: tank.x + 10,
      z: tank.z,
      auras: [{ id: FINAL_AURAS.bladeMark, value: 1 }],
      tank: false,
    };
    const bot = { pid: 2, name: 'Ivaline', spec: { key: 'mage', role: 'dps' } };
    world.players.set(2, me);
    world.living = () => [tank, me];
    world.bots.push(bot as never);
    const ents = world.obs.ents;
    const r = FINAL_TUNING.pillarR;
    // A plain pillar 6 yd from the mark, a charged one 40 yd away.
    ents.set(910, {
      k: 'object',
      id: 910,
      tid: finalPillarTemplate('plain'),
      x: me.x,
      z: me.z + 6,
      sc: r,
    });
    // The charged one on the same ring round the room's centre, 85 degrees on.
    const c = world.center;
    const R = Math.hypot(me.x - c.x, me.z - c.z);
    const a0 = Math.atan2(me.x - c.x, me.z - c.z) + (85 * Math.PI) / 180;
    const far = { x: c.x + Math.sin(a0) * R, z: c.z + Math.cos(a0) * R };
    expect(Math.hypot(far.x - me.x, far.z - me.z)).toBeGreaterThan(30);
    ents.set(911, {
      k: 'object',
      id: 911,
      tid: finalPillarTemplate('charged'),
      x: far.x,
      z: far.z,
      sc: r,
    });
    ents.set(912, {
      k: 'object',
      id: 912,
      tid: finalBladeTemplate('aim'),
      x: me.x,
      z: me.z - 20,
      sc: 1,
    });
    final.read(world);
    const d = final.duty(world, {}, bot, me) as { goal: { x: number; z: number }; duty: string };
    expect(d.duty).toBe('blade: pillar');
    // On the plain pillar's ray from the blade, within a few yards of it.
    expect(Math.abs(d.goal.x - me.x)).toBeLessThan(0.5);
    expect(Math.hypot(d.goal.x - me.x, d.goal.z - (me.z + 6))).toBeLessThan(r + 5);
  });
});

describe('Masterless Strength bots: Weight of the Anvil', () => {
  /** A soak in flight: the Anvil's circle on a marked damage dealer 12 yd
   *  off the tank, and a second damage dealer free to soak. */
  function anvilFight(carrierAuras: object[], soakerAuras: object[] = []) {
    vi.useFakeTimers({ now: 4_000_000 });
    const f = heatFight({ rime: false });
    const carrier = {
      pid: 2,
      name: 'Morvane',
      x: f.tank.x + 12,
      z: f.tank.z,
      auras: [{ id: FINAL_AURAS.anvilMark }, ...carrierAuras],
      tank: false,
    };
    const soaker = {
      pid: 3,
      name: 'Kesrin',
      x: f.tank.x + 4,
      z: f.tank.z + 8,
      auras: soakerAuras,
      tank: false,
    };
    const cb = { pid: 2, name: 'Morvane', spec: { key: 'lock', role: 'dps' } };
    const sb = { pid: 3, name: 'Kesrin', spec: { key: 'rogue', role: 'dps' } };
    f.world.players.set(2, carrier);
    f.world.players.set(3, soaker);
    f.world.living = () => [f.tank, carrier, soaker];
    f.world.bots.push(cb as never, sb as never);
    f.world.obs.ents.set(920, {
      k: 'object',
      id: 920,
      tid: finalTimed(FINAL_OBJECTS.anvilPrefix, 6),
      x: carrier.x,
      z: carrier.z,
      sc: FINAL_TUNING.anvilR,
    });
    final.read(f.world);
    return { ...f, carrier, soaker, cb, sb };
  }
  type Duty = { goal: { x: number; z: number }; duty: string } | null;

  it('the marked player holds still even when a Magma Rift also marks them', () => {
    const f = anvilFight([{ id: ELEMENT_AURAS.magmaMark }]);
    const d = final.duty(f.world, {}, f.cb, f.carrier) as Duty;
    expect(d?.duty).toBe('anvil (marked)');
    expect(Math.hypot(d!.goal.x - f.carrier.x, d!.goal.z - f.carrier.z)).toBeLessThan(0.01);
  });

  it("the raid soaks inside the Anvil but outside the carrier's rift", () => {
    const f = anvilFight([{ id: ELEMENT_AURAS.magmaMark }]);
    const st = {};
    final.duty(f.world, st, f.sb, f.soaker);
    vi.setSystemTime(4_000_000 + 3000);
    const d = final.duty(f.world, st, f.sb, f.soaker) as Duty;
    expect(d?.duty).toBe('anvil');
    const r = Math.hypot(d!.goal.x - f.carrier.x, d!.goal.z - f.carrier.z);
    expect(r).toBeLessThan(FINAL_TUNING.anvilR);
    expect(r).toBeGreaterThan(ELEMENT_TUNING.magmaR);
  });

  it('the marked player standing in a lava pool steps off it first, and the raid soaks clear of it', () => {
    const f = anvilFight([]);
    f.world.obs.ents.set(930, {
      k: 'object',
      id: 930,
      tid: ELEMENT_OBJECTS.lava,
      x: f.carrier.x,
      z: f.carrier.z,
      sc: 2,
    });
    final.read(f.world);
    const st = {};
    final.duty(f.world, st, f.cb, f.carrier);
    final.duty(f.world, st, f.sb, f.soaker);
    vi.setSystemTime(4_000_000 + 3000);
    const d = final.duty(f.world, st, f.cb, f.carrier) as Duty;
    expect(d?.duty).toBe('anvil (marked): off the hazard');
    expect(Math.hypot(d!.goal.x - f.carrier.x, d!.goal.z - f.carrier.z)).toBeGreaterThan(3);
    const s = final.duty(f.world, st, f.sb, f.soaker) as Duty;
    expect(s?.duty).toBe('anvil');
    expect(final.bad(f.world, st, s!.goal)).toBe(false);
  });

  it('a tank whose Static Charge arcs stays out of the soak', () => {
    const f = anvilFight([], [{ id: STRIKE_AURAS.breath, stacks: ELEMENT_TUNING.arcFrom }]);
    const st = {};
    final.duty(f.world, st, f.sb, f.soaker);
    vi.setSystemTime(4_000_000 + 3000);
    expect((final.duty(f.world, st, f.sb, f.soaker) as Duty)?.duty).not.toBe('anvil');
  });

  it('a Drawn Lightning carrier stays out of the soak, a free raider joins it', () => {
    const f = anvilFight([], [{ id: FINAL_AURAS.drawn }]);
    const st = {};
    final.duty(f.world, st, f.sb, f.soaker);
    vi.setSystemTime(4_000_000 + 3000);
    const drawn = final.duty(f.world, st, f.sb, f.soaker) as Duty;
    expect(drawn?.duty).not.toBe('anvil');
    f.soaker.auras = [];
    // Free again, it notices the circle a reaction later and joins.
    final.duty(f.world, st, f.sb, f.soaker);
    vi.setSystemTime(4_000_000 + 6000);
    const free = final.duty(f.world, st, f.sb, f.soaker) as Duty;
    expect(free?.duty).toBe('anvil');
  });
});

describe('Masterless Strength bots: the ranged spot', () => {
  it('fans the casters round the boss on its outer side, clear of the ring', () => {
    const { world, boss } = heatFight({ rime: false });
    const keys = ['mage', 'hunter', 'lock', 'ele'];
    const bots = keys.map((key, i) => ({ pid: 10 + i, name: key, spec: { key, role: 'dps' } }));
    world.bots.push(...(bots as never[]));
    final.read(world);
    const c = world.center;
    for (const b of bots.slice(2)) {
      const at = final.roleSpot(world, {}, b);
      expect(at).not.toBeNull();
      // Outside the central ring, within casting reach of the boss, and no
      // nearer the room's centre than the boss is by more than a few yards.
      expect(Math.hypot(at!.x - c.x, at!.z - c.z)).toBeGreaterThan(HEART_QUARTERS.ringR + 4);
      expect(Math.hypot(at!.x - boss.x, at!.z - boss.z)).toBeLessThan(25);
    }
    const a = final.roleSpot(world, {}, bots[2])!;
    const d = final.roleSpot(world, {}, bots[3])!;
    expect(Math.hypot(a.x - d.x, a.z - d.z)).toBeGreaterThan(3);
  });
});
