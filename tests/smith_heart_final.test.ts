// The Masterless Strength, part 1 (encounters/smith_heart/final*.ts, design
// doc 7.5) over a REAL Sim: the four quarter rules (Overload, Vein Shock,
// Taking Root, Heart Unbound, the base form), the boss following its tank
// across a ridge, each quarter's kit on Normal, Heroic and Mythic, the
// difficulty gating, the dev verbs, determinism and a headless full-fight
// smoke run on every tier.

import { describe, expect, it } from 'vitest';
import type { SmithHeartVein } from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  heartQuarterAt,
  heartQuarterSpot,
} from '../src/sim/content/smith_heart_quarters';
import {
  anvilShare,
  FINAL_AURAS,
  FINAL_DIFFICULTY,
  FINAL_NAMES,
  FINAL_OBJECTS,
  FINAL_ZONE_CODES,
  finalZoneOf,
  FINAL_OVERLOAD as O,
  overloadAuraId,
  overloadStep,
  pulseScale,
  FINAL_TUNING as T,
} from '../src/sim/encounters/smith_heart/final_ids';
import { HEAT_OBJECTS } from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { WIND_DRIFT_AURA } from '../src/sim/wind_drift';
import { type FinalFight, finalFight } from './helpers/final_fight';

type Damage = Extract<SimEvent, { type: 'damage' }>;
const hits = (ev: SimEvent[], name: string, target?: number): Damage[] =>
  ev.filter(
    (e): e is Damage =>
      e.type === 'damage' && e.ability === name && (target === undefined || e.targetId === target),
  );
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const sec = (s: number) => Math.round(s * 20);

/** Spread the raid far apart round a quarter's spot (no one within 12 yd). */
function spread(f: FinalFight, vein: SmithHeartVein): void {
  const c = heartQuarterSpot(vein);
  f.players.forEach((p, i) => {
    if (i === 0) {
      const b = f.local(f.boss());
      f.put(p, b.x + 2, b.z + 2);
      return;
    }
    const a = (i / f.players.length) * Math.PI * 2;
    f.put(p, c.x + Math.sin(a) * 18, c.z + Math.cos(a) * 18);
  });
}

describe('the pure rules', () => {
  it('a bar fills in 60 s, drains at a third, and pulses harder the fuller it is', () => {
    expect(O.fillSeconds).toBe(60);
    expect(O.drainShare).toBeCloseTo(1 / 3, 9);
    let fill = 0;
    for (let i = 0; i < sec(30); i++) fill = overloadStep(fill, true, 1 / 20);
    expect(fill).toBeCloseTo(0.5, 2);
    let drain = 0.5;
    for (let i = 0; i < sec(30); i++) drain = overloadStep(drain, false, 1 / 20);
    expect(drain).toBeCloseTo(0.5 - 0.5 / 3, 2);
    expect(pulseScale(1)).toBeGreaterThan(pulseScale(0.5));
    expect(pulseScale(0.5)).toBeGreaterThan(pulseScale(0));
  });

  // The pace (FINAL_OVERLOAD): a visit lasts at least the root plus a short
  // drag. Bouncing between two quarters cannot be held; a rotation through
  // three or four is comfortable for a six-minute fight.
  const peakOf = (quarters: number, visit: number, seconds: number) => {
    const bars = new Array(quarters).fill(0);
    let peak = 0;
    for (let i = 0; i < sec(seconds); i++) {
      const active = Math.floor(i / sec(visit)) % quarters;
      for (let q = 0; q < quarters; q++) bars[q] = overloadStep(bars[q], q === active, 1 / 20);
      peak = Math.max(peak, ...bars);
    }
    return peak;
  };
  it('bouncing between two quarters fills a bar to bursting within three minutes', () => {
    for (const visit of [T.rootSeconds + 4, 20]) expect(peakOf(2, visit, 180), `${visit}`).toBe(1);
  });
  it('a rotation through four quarters never passes one visit, through three it stays clear', () => {
    for (const visit of [T.rootSeconds + 4, 20, 25])
      expect(peakOf(4, visit, 360), `4 x ${visit}`).toBeLessThan(visit / O.fillSeconds + 0.01);
    for (const visit of [T.rootSeconds + 4, 20])
      expect(peakOf(3, visit, 360), `3 x ${visit}`).toBeLessThan(0.9);
  });
  it('the burst: survivable with healing on Normal, heavy on Heroic, lethal on Mythic', () => {
    // The level-20 cloth reference: about 1,135 to 1,345 health.
    expect(O.burst.normal.max).toBeLessThan(1135 * 0.75);
    expect(O.burst.heroic.min).toBeGreaterThan(1135 * 0.85);
    expect(O.burst.heroic.max).toBeLessThan(1345);
    expect(O.burst.mythic.min).toBeGreaterThan(1345 * 3);
    expect(FINAL_DIFFICULTY.normal.burstTier).toBe('survivable');
    expect(FINAL_DIFFICULTY.heroic.burstTier).toBe('heavy');
    expect(FINAL_DIFFICULTY.mythic.burstTier).toBe('lethal');
  });

  it('the Anvil splits its blow, harder when too few share it, three times for the Crushed', () => {
    expect(anvilShare(6, false)).toBe(Math.round(T.anvilTotal / 6));
    expect(anvilShare(2, false)).toBe(Math.round((T.anvilTotal / 2) * 1.5));
    expect(anvilShare(6, true)).toBe(Math.round((T.anvilTotal / 6) * T.crushedMult));
  });

  it('every zone code round-trips through the state aura', () => {
    for (const z of [...HEART_QUARTER_ORDER, 'ring'] as const)
      expect(finalZoneOf(FINAL_ZONE_CODES[z])).toBe(z);
  });
});

describe('the quarter rules', () => {
  it('pulls into its first quarter: that is its base form, and it takes root there', () => {
    const f = finalFight(5);
    f.pullIn('quench');
    const st = f.state();
    expect(st?.zone).toBe('quench');
    expect(st?.baseForm).toBe('quench');
    expect(aura(f.boss(), FINAL_AURAS.root)?.kind).toBe('root');
    const state = aura(f.boss(), FINAL_AURAS.state);
    expect(state?.value).toBe(FINAL_ZONE_CODES.quench);
    expect(state?.value2).toBe(FINAL_ZONE_CODES.quench);
  });

  it('the active bar fills and pulses every 4 s, the others stay empty', () => {
    const f = finalFight(5);
    f.pullIn('heat');
    const ev = f.tick(sec(12));
    const st = f.state();
    expect(st?.overload.heat).toBeGreaterThan(0.18);
    expect(st?.overload.quench).toBe(0);
    const pulses = hits(ev, FINAL_NAMES.pulse, f.pids[1]);
    expect(pulses.length).toBe(3);
    // Each pulse harder than the last (the bar fuller).
    expect(pulses[2].amount).toBeGreaterThan(pulses[0].amount);
    const bar = aura(f.boss(), overloadAuraId('heat'));
    expect(bar?.value).toBe(Math.round((st?.overload.heat ?? 0) * 100));
    expect(bar?.value2).toBe(1);
  });

  for (const tier of ['normal', 'heroic', 'mythic'] as const)
    it(`a full bar warns near full, then bursts on the whole raid at ${tier}'s numbers and empties`, () => {
      const f = finalFight(5);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('hammer');
      f.dev('/dev heart final fill hammer 84');
      const near = f.tick(sec(1));
      const warns = near.filter(
        (e) => e.type === 'chat' && e.channel === 'raidWarning' && e.pid === f.pids[0],
      ) as Extract<SimEvent, { type: 'chat' }>[];
      const nearKey = { normal: 'nearFull', heroic: 'nearFullHeavy', mythic: 'nearFullLethal' }[
        tier
      ];
      expect(warns.map((w) => w.textKey)).toContain(`hudChrome.finalBoss.warn.${nearKey}`);
      f.dev('/dev heart final fill hammer 99');
      const ev = f.tick(sec(1));
      const burst = hits(ev, FINAL_NAMES.burst);
      expect(new Set(burst.map((d) => d.targetId)).size).toBe(5);
      for (const b of burst) {
        expect(b.amount).toBeGreaterThanOrEqual(O.burst[tier].min);
        expect(b.amount).toBeLessThanOrEqual(O.burst[tier].max);
      }
      const burstKey = { normal: 'burst', heroic: 'burstHeavy', mythic: 'burstLethal' }[tier];
      const lines = (
        ev.filter(
          (e) => e.type === 'chat' && e.channel === 'raidWarning' && e.pid === f.pids[0],
        ) as Extract<SimEvent, { type: 'chat' }>[]
      ).map((w) => w.textKey);
      expect(lines).toContain(`hudChrome.finalBoss.warn.${burstKey}`);
      expect(f.state()?.overload.hammer).toBeLessThan(0.05);
      expect(f.state()?.bursts).toBe(1);
    });

  it('Mythic: a full bar kills a raid with no defensives', () => {
    const f = finalFight(5);
    f.dev('/dev heart final mythic');
    f.pullIn('hammer');
    // Real level-20 health (the helper's great store taken away).
    for (const p of f.players) {
      p.auras = p.auras.filter((a) => a.id !== 'test_final_vigour');
      p.maxHp = 1345;
      p.hp = 1345;
    }
    f.dev('/dev heart final fill hammer 99');
    f.tick(sec(1), false);
    expect(f.players.every((p) => p.dead)).toBe(true);
  });

  it('roots on entering a quarter, then follows its tank across a ridge', () => {
    const f = finalFight(5);
    f.pullIn('heat');
    const tank = f.players[0];
    const start = f.local(f.boss());
    // The tank walks into the Breath quarter while it is rooted: it holds.
    const breath = heartQuarterSpot('breath');
    f.put(tank, breath.x, breath.z);
    f.tick(sec(5));
    const held = f.local(f.boss());
    expect(Math.hypot(held.x - start.x, held.z - start.z)).toBeLessThan(0.5);
    expect(f.state()?.zone).toBe('heat');
    // The root ends: it follows its tank over the ridge into the Breath.
    let ev: SimEvent[] = [];
    for (let i = 0; i < sec(30) && f.state()?.zone !== 'breath'; i++) {
      f.put(tank, breath.x, breath.z);
      ev = ev.concat(f.tick(1));
    }
    const st = f.state();
    expect(st?.zone).toBe('breath');
    expect(st?.switches).toBe(1);
    expect(st?.baseForm).toBe('heat');
    expect(st?.lastQuarter).toBe('breath');
    expect(aura(f.boss(), FINAL_AURAS.root)).toBeDefined();
    // Normal: no shockwave on the switch.
    expect(hits(ev, FINAL_NAMES.shock).length).toBe(0);
    const warns = ev.filter(
      (e) => e.type === 'chat' && e.channel === 'raidWarning' && e.pid === f.pids[0],
    ) as Extract<SimEvent, { type: 'chat' }>[];
    // The quarter it drinks reads on the Overload panel, not a banner.
    expect(warns.map((w) => w.textKey)).not.toContain('hudChrome.finalBoss.warn.enterBreath');
  });

  it('Heroic: a switch shocks the raid and marks it; a switch while marked hits three times as hard', () => {
    const f = finalFight(5);
    f.dev('/dev heart final heroic');
    f.pullIn('heat');
    f.dev('/dev heart final quarter breath');
    const ev1 = f.tick(2);
    const first = hits(ev1, FINAL_NAMES.shock, f.pids[1]);
    expect(first.length).toBe(1);
    expect(aura(f.players[1], FINAL_AURAS.shaken)).toBeDefined();
    expect(aura(f.boss(), FINAL_AURAS.state)?.value3).toBe(T.shakenSeconds);
    f.dev('/dev heart final quarter quench');
    const ev2 = f.tick(2);
    const second = hits(ev2, FINAL_NAMES.shock, f.pids[1]);
    expect(second.length).toBe(1);
    expect(second[0].amount).toBeGreaterThanOrEqual(T.shockMin * T.shakenMult);
    expect(f.state()?.switches).toBe(2);
  });

  it('in the central ring it grows Heart Unbound, a stack a second, harder each pulse', () => {
    const f = finalFight(5);
    f.pullIn('heat');
    f.dev('/dev heart final quarter ring');
    // The tank holds it in the ring.
    f.gather(188, 172, 4);
    const ev = f.tick(sec(4.1));
    const st = f.state();
    expect(st?.zone).toBe('ring');
    expect(st?.unbound).toBe(4);
    expect(aura(f.boss(), FINAL_AURAS.unbound)?.stacks).toBe(4);
    const pulses = hits(ev, FINAL_NAMES.unbound, f.pids[1]);
    expect(pulses.length).toBe(4);
    expect(pulses[3].amount).toBeGreaterThan(pulses[0].amount * 3);
    // No bar fills there; out of it, the aura goes.
    expect(st?.overload.heat).toBeLessThan(0.1);
    f.dev('/dev heart final quarter hammer');
    f.tick(2);
    expect(aura(f.boss(), FINAL_AURAS.unbound)).toBeUndefined();
  });

  it('the ring is safe in its final phase (15 percent)', () => {
    const f = finalFight(5);
    f.pullIn('heat');
    f.boss().hp = Math.floor(f.boss().maxHp * 0.1);
    f.dev('/dev heart final quarter ring');
    const ev = f.tick(sec(3));
    expect(hits(ev, FINAL_NAMES.unbound).length).toBe(0);
  });
});

describe('the Heat quarter', () => {
  it("Basalt Fist kills on its spot and rolls three Molten Swells (the Heat guardian's objects)", () => {
    const f = finalFight(5);
    f.pullIn('heat');
    const victim = f.players[2];
    const at = f.local(victim);
    f.dev('/dev heart final fist', f.pids[2]);
    expect(f.objects(HEAT_OBJECTS.fistPrefix).length).toBe(1);
    expect(f.objects(HEAT_OBJECTS.lanePrefix).length).toBe(3);
    f.put(victim, at.x, at.z);
    const ev = f.tick(sec(3.2), false);
    const blow = hits(ev, FINAL_NAMES.fist, victim.id);
    expect(blow.length).toBe(1);
    expect(blow[0].amount).toBeGreaterThanOrEqual(T.fistMin);
    f.tick(sec(1));
    expect(f.objects(HEAT_OBJECTS.wave).length).toBe(3);
  });

  it('Fire Whirls rise, run and strike whoever they touch', () => {
    const f = finalFight(5);
    f.pullIn('heat');
    f.dev('/dev heart final whirl');
    const whirls = f.objects(FINAL_OBJECTS.whirlPrefix);
    expect(whirls.length).toBe(3);
    expect(whirls[0].templateId).toBe(`${FINAL_OBJECTS.whirlPrefix}warn`);
    f.tick(sec(T.whirlWarn + 0.1));
    expect(f.objects(FINAL_OBJECTS.whirlPrefix)[0].templateId).toBe(
      `${FINAL_OBJECTS.whirlPrefix}live`,
    );
    // Stand someone on a whirl.
    const w = f.objects(FINAL_OBJECTS.whirlPrefix)[0];
    let struck = 0;
    for (let i = 0; i < sec(2); i++) {
      const at = f.local(w);
      f.put(f.players[3], at.x, at.z);
      struck += hits(f.tick(1), FINAL_NAMES.whirl, f.pids[3]).length;
    }
    expect(struck).toBeGreaterThanOrEqual(2);
    expect(struck).toBeLessThanOrEqual(3);
  });

  it('Heroic: Ember Marks on the ranged drop smouldering pools at their feet', () => {
    const f = finalFight(5);
    f.dev('/dev heart final heroic');
    f.pullIn('heat');
    spread(f, 'heat');
    f.dev('/dev heart final embers');
    const marked = f.players.filter((p) => aura(p, FINAL_AURAS.ember));
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.some((p) => p.id === f.boss().aggroTargetId)).toBe(false);
    f.tick(sec(T.emberSeconds + 0.1));
    expect(f.objects(FINAL_OBJECTS.poolPrefix).length).toBe(marked.length);
    const ev = f.tick(sec(2.1));
    expect(hits(ev, FINAL_NAMES.embers, marked[0].id).length).toBeGreaterThanOrEqual(2);
  });

  it('Mythic: its frontal leaves Forge Fire where it struck', () => {
    const f = finalFight(5);
    f.dev('/dev heart final mythic');
    f.pullIn('heat');
    f.tick(sec(14));
    expect(
      f.objects(FINAL_OBJECTS.poolPrefix).filter((o) => o.templateId.endsWith('forge')).length,
    ).toBeGreaterThan(0);
  });
});

describe('the Quench quarter', () => {
  it('alone you freeze; together the cold falls', () => {
    const f = finalFight(5);
    f.pullIn('quench');
    const c = heartQuarterSpot('quench');
    // Two stand apart, three huddle.
    f.put(f.players[1], c.x + 15, c.z);
    f.put(f.players[2], c.x - 15, c.z);
    f.put(f.players[3], c.x, c.z + 2);
    f.put(f.players[4], c.x + 1, c.z + 2);
    f.put(f.players[0], c.x - 1, c.z + 2);
    const ev = f.tick(sec(T.coldMax / T.coldRise + 0.2));
    expect(aura(f.players[1], FINAL_AURAS.frozen)?.kind).toBe('stun');
    expect(hits(ev, FINAL_NAMES.frozen, f.pids[1]).length).toBe(1);
    expect(aura(f.players[3], FINAL_AURAS.frozen)).toBeUndefined();
    expect(aura(f.players[3], FINAL_AURAS.cold)?.value ?? 0).toBe(0);
  });

  it("the cold is the Quench quarter's: elsewhere nobody grows cold", () => {
    const f = finalFight(5);
    f.pullIn('hammer');
    spread(f, 'hammer');
    f.tick(sec(6));
    for (const p of f.players) expect(aura(p, FINAL_AURAS.frozen)).toBeUndefined();
  });

  it('Heroic: Groaning Ice breaks under the marked; who stays falls Under the Ice', () => {
    const f = finalFight(5);
    f.dev('/dev heart final heroic');
    f.pullIn('quench');
    f.dev('/dev heart final ice');
    const cracks = f.objects(FINAL_OBJECTS.crackPrefix);
    expect(cracks.length).toBe(T.iceMarks);
    const ev = f.tick(sec(T.iceWarn + 0.1));
    expect(hits(ev, FINAL_NAMES.underIce).length).toBeGreaterThan(0);
    expect(f.objects(FINAL_OBJECTS.crackPrefix).length).toBe(0);
  });

  it('Mythic: its frontal numbs those in its arc', () => {
    const f = finalFight(5);
    f.dev('/dev heart final mythic');
    f.pullIn('quench');
    let slowedEver = false;
    for (let i = 0; i < sec(30) && !slowedEver; i++) {
      f.tick(1);
      slowedEver = f.players.some((p) => aura(p, FINAL_AURAS.numbing));
    }
    const slowed = f.players.filter((p) => aura(p, FINAL_AURAS.numbing));
    expect(slowed.length).toBeGreaterThan(0);
    expect(aura(slowed[0], FINAL_AURAS.numbing)?.value).toBe(T.numbingSlow);
  });
});

describe('the Breath quarter', () => {
  it('Bellows Wind blows everyone toward one side, the rim strikes', () => {
    const f = finalFight(5);
    f.pullIn('breath');
    f.dev('/dev heart final wind 90');
    f.tick(sec(T.windWarn + 0.2));
    const w = aura(f.players[1], WIND_DRIFT_AURA);
    expect(w?.value).toBeCloseTo(Math.PI / 2, 5);
    expect(w?.value2).toBe(T.windSpeed);
    // One stands against the rim.
    f.put(f.players[2], 188 + 58, 172);
    const ev = f.tick(sec(2.1));
    expect(hits(ev, FINAL_NAMES.rim, f.pids[2]).length).toBeGreaterThanOrEqual(2);
    f.tick(sec(T.windBlow));
    expect(aura(f.players[1], WIND_DRIFT_AURA)).toBeUndefined();
  });

  it('Leaping Bolt leaps through a stack and spares a spread raid', () => {
    const stacked = finalFight(5);
    stacked.pullIn('breath');
    const c = heartQuarterSpot('breath');
    stacked.gather(c.x, c.z, 2);
    stacked.dev('/dev heart final bolt');
    const ev = stacked.tick(sec(T.boltCast + 0.1));
    const struck = hits(ev, FINAL_NAMES.bolt);
    expect(struck.length).toBe(5);
    const spreadOut = finalFight(5);
    spreadOut.pullIn('breath');
    spread(spreadOut, 'breath');
    spreadOut.dev('/dev heart final bolt');
    const ev2 = spreadOut.tick(sec(T.boltCast + 0.1));
    expect(hits(ev2, FINAL_NAMES.bolt).length).toBe(1);
  });

  it('Heroic: Drawn Lightning arcs to anyone near a marked player', () => {
    const f = finalFight(5);
    f.dev('/dev heart final heroic');
    f.pullIn('breath');
    const c = heartQuarterSpot('breath');
    f.gather(c.x, c.z, 2);
    f.dev('/dev heart final drawn');
    const ev = f.tick(sec(1.1));
    expect(hits(ev, FINAL_NAMES.drawn).length).toBeGreaterThan(0);
  });

  it('Mythic: a Storm Orb taken alone jolts its taker; left alone it bursts on the raid', () => {
    const f = finalFight(5);
    f.dev('/dev heart final mythic');
    f.pullIn('breath');
    spread(f, 'breath');
    f.dev('/dev heart final orbs');
    const orbs = f.objects(FINAL_OBJECTS.orbPrefix);
    expect(orbs.length).toBe(T.orbCount);
    const at = f.local(orbs[0]);
    f.put(f.players[2], at.x, at.z);
    const ev = f.tick(2);
    expect(hits(ev, FINAL_NAMES.orb, f.pids[2]).length).toBe(1);
    const ev2 = f.tick(sec(T.orbLife));
    expect(hits(ev2, FINAL_NAMES.orb, f.pids[3]).length).toBeGreaterThanOrEqual(1);
  });
});

describe('the Hammer quarter', () => {
  it('Tremor Cracks erupt under whoever stays', () => {
    const f = finalFight(5);
    f.pullIn('hammer');
    spread(f, 'hammer');
    f.dev('/dev heart final tremor');
    expect(f.objects(FINAL_OBJECTS.tremorPrefix).length).toBe(FINAL_DIFFICULTY.normal.tremors);
    const ev = f.tick(sec(T.tremorWarn + 0.1));
    expect(hits(ev, FINAL_NAMES.tremor).length).toBe(FINAL_DIFFICULTY.normal.tremors);
  });

  it('Weight of the Anvil splits among those under it; with nobody under it the raid takes it', () => {
    const f = finalFight(5);
    f.pullIn('hammer');
    const c = heartQuarterSpot('hammer');
    f.put(f.players[1], c.x + 10, c.z);
    f.dev('/dev heart final anvil', f.pids[1]);
    f.put(f.players[2], c.x + 10, c.z + 1);
    f.put(f.players[3], c.x + 10, c.z - 1);
    f.put(f.players[4], c.x + 30, c.z);
    const ev = f.tick(sec(T.anvilCast + 0.1));
    const shared = hits(ev, FINAL_NAMES.anvil);
    expect(new Set(shared.map((d) => d.targetId))).toEqual(
      new Set([f.pids[1], f.pids[2], f.pids[3]]),
    );
    expect(shared[0].amount).toBeLessThan(T.anvilTotal / 3 + 200);
    // Nobody under it.
    f.dev('/dev heart final anvil', f.pids[1]);
    f.put(f.players[1], c.x - 20, c.z);
    f.put(f.players[2], c.x - 20, c.z + 3);
    f.put(f.players[3], c.x - 20, c.z - 3);
    const miss = hits(f.tick(sec(T.anvilCast + 0.1)), FINAL_NAMES.anvil);
    expect(miss.length).toBe(5);
  });

  it('Heroic: soakers are Crushed and take the next Anvil three times over; Stone Shell absorbs healing', () => {
    const f = finalFight(5);
    f.dev('/dev heart final heroic');
    f.pullIn('hammer');
    const c = heartQuarterSpot('hammer');
    f.put(f.players[1], c.x + 10, c.z);
    f.dev('/dev heart final anvil', f.pids[1]);
    f.put(f.players[2], c.x + 10, c.z + 1);
    f.put(f.players[3], c.x + 10, c.z - 1);
    const first = hits(f.tick(sec(T.anvilCast + 0.1)), FINAL_NAMES.anvil, f.pids[1]);
    expect(aura(f.players[1], FINAL_AURAS.crushed)).toBeDefined();
    f.dev('/dev heart final anvil', f.pids[1]);
    const second = hits(f.tick(sec(T.anvilCast + 0.1)), FINAL_NAMES.anvil, f.pids[1]);
    expect(second[0].amount).toBeGreaterThan(first[0].amount * 2.5);
    f.dev('/dev heart final shell');
    const shelled = f.players.filter((p) => aura(p, FINAL_AURAS.shell));
    expect(shelled.length).toBeGreaterThanOrEqual(T.shellMarks);
    expect(aura(shelled[0], FINAL_AURAS.shell)?.kind).toBe('heal_absorb');
  });

  it("Mythic: the Anvil's mark turns round the boss through its bar", () => {
    const f = finalFight(5);
    f.dev('/dev heart final mythic');
    f.pullIn('hammer');
    f.dev('/dev heart final anvil', f.pids[1]);
    const mark = f.objects(FINAL_OBJECTS.anvilPrefix)[0];
    const a = f.local(mark);
    f.tick(sec(2));
    const b = f.local(mark);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(3);
    const boss = f.local(f.boss());
    expect(Math.hypot(b.x - boss.x, b.z - boss.z)).toBeCloseTo(T.anvilOrbitR, 0);
  });
});

describe('difficulty gating', () => {
  const run = (tier: string, vein: SmithHeartVein, seconds: number) => {
    const f = finalFight(6);
    if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
    f.pullIn(vein);
    spread(f, vein);
    // The tank holds its ground by the boss (it walks into the gale), so the
    // boss stays in its quarter once its root lets go.
    const ev: SimEvent[] = [];
    const tank = f.players[0];
    for (let i = 0; i < sec(seconds); i++) {
      const at = f.local(f.boss());
      const here = f.local(tank);
      if (Math.hypot(here.x - at.x, here.z - at.z) > 3) f.put(tank, at.x + 2, at.z + 2);
      ev.push(...f.tick(1));
    }
    return { f, ev };
  };

  it('Normal runs none of the Heroic or Mythic additions', () => {
    for (const vein of HEART_QUARTER_ORDER) {
      const { f, ev } = run('normal', vein, 16);
      expect(f.players.some((p) => aura(p, FINAL_AURAS.ember))).toBe(false);
      expect(f.objects(FINAL_OBJECTS.crackPrefix).length).toBe(0);
      expect(hits(ev, FINAL_NAMES.drawn).length).toBe(0);
      expect(f.objects(FINAL_OBJECTS.orbPrefix).length).toBe(0);
      expect(f.players.some((p) => aura(p, FINAL_AURAS.shell))).toBe(false);
      expect(f.objects(FINAL_OBJECTS.poolPrefix).length).toBe(0);
    }
  });

  it("Heroic adds its own, never Mythic's", () => {
    expect(run('heroic', 'heat', 11).f.players.some((p) => aura(p, FINAL_AURAS.ember))).toBe(true);
    expect(run('heroic', 'quench', 8).f.objects(FINAL_OBJECTS.crackPrefix).length).toBe(2);
    expect(run('heroic', 'hammer', 9).f.players.some((p) => aura(p, FINAL_AURAS.shell))).toBe(true);
    expect(run('heroic', 'breath', 16).f.objects(FINAL_OBJECTS.orbPrefix).length).toBe(0);
    expect(FINAL_DIFFICULTY.heroic.rotatingAnvil).toBe(false);
    expect(FINAL_DIFFICULTY.heroic.forgeFire).toBe(false);
  });

  it('Mythic carries every Heroic rule and its own', () => {
    for (const [k, v] of Object.entries(FINAL_DIFFICULTY.heroic))
      if (typeof v === 'boolean' && v)
        expect(FINAL_DIFFICULTY.mythic[k as keyof typeof v], k).toBe(true);
    expect(run('mythic', 'breath', 16).f.objects(FINAL_OBJECTS.orbPrefix).length).toBe(T.orbCount);
  });
});

describe('determinism', () => {
  it('the same seed fights the same fight', () => {
    const trace = () => {
      const f = finalFight(6, 77);
      f.dev('/dev heart final mythic');
      f.pullIn('heat');
      const out: string[] = [];
      for (const vein of ['breath', 'hammer', 'quench'] as const) {
        for (const e of f.tick(sec(20)))
          if (e.type === 'damage') out.push(`${e.ability}:${e.targetId}:${e.amount}`);
        f.dev(`/dev heart final quarter ${vein}`);
      }
      return out;
    };
    const a = trace();
    expect(a.length).toBeGreaterThan(50);
    expect(trace()).toEqual(a);
  });
});

describe('the headless full fight', () => {
  for (const tier of ['normal', 'heroic', 'mythic'] as const)
    it(`a ${tier} raid drags it round all four quarters above 70 percent, kills it, the floor goes clean`, () => {
      const f = finalFight(8, 91);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('heat');
      const tank = f.players[0];
      const seen = new Set<string>();
      const order: SmithHeartVein[] = ['breath', 'quench', 'hammer', 'heat'];
      let next = 0;
      let inZone = 0;
      const names = new Set<string>();
      for (let t = 0; t < sec(180); t++) {
        const st = f.state();
        if (!st) break;
        seen.add(st.zone);
        inZone++;
        // Twenty seconds a quarter, then the tank drags it on.
        if (inZone > sec(20) && st.rootLeft <= 0) {
          const target = heartQuarterSpot(order[next % 4]);
          f.put(tank, target.x, target.z);
          const here = f.local(f.boss());
          if (heartQuarterAt(here.x, here.z) === order[next % 4]) {
            next++;
            inZone = 0;
          }
        }
        // The raid wears it down to just over its first intermission (part
        // 2's full fight, 100 to 0, is tests/smith_heart_final_phase.test.ts).
        f.boss().hp -= Math.round((f.boss().maxHp * 0.28) / sec(170));
        for (const e of f.tick(1)) if (e.type === 'damage' && e.ability) names.add(e.ability);
        if (f.boss().hp <= 0) break;
      }
      for (const v of HEART_QUARTER_ORDER) expect(seen, v).toContain(v);
      expect(f.state()?.switches ?? 0).toBeGreaterThanOrEqual(3);
      expect(names).toContain(FINAL_NAMES.pulse);
      expect(names).toContain(FINAL_NAMES.fist);
      expect(names).toContain(FINAL_NAMES.bolt);
      expect(names).toContain(FINAL_NAMES.anvil);
      if (tier !== 'normal') expect(names).toContain(FINAL_NAMES.shock);
      // The kill: the fight ends and the floor is clean.
      const b = f.boss();
      b.hp = 0;
      f.sim.ctx.dealDamage(f.players[1], b, 10, false, 'physical', 'Strike', 'hit');
      f.tick(sec(1));
      expect(b.dead).toBe(true);
      expect(b.smithHeartFinal?.finished).toBe(true);
      for (const prefix of Object.values(FINAL_OBJECTS))
        expect(f.objects(prefix).length, prefix).toBe(0);
      expect(f.objects(HEAT_OBJECTS.fistPrefix).length).toBe(0);
      for (const p of f.players)
        for (const id of Object.values(FINAL_AURAS))
          if (id !== WIND_DRIFT_AURA) expect(aura(p, id), id).toBeUndefined();
    });

  it('a wipe resets the fight: every footprint, mark and bar gone', () => {
    const f = finalFight(5);
    f.dev('/dev heart final mythic');
    f.pullIn('heat');
    f.dev('/dev heart final whirl');
    f.dev('/dev heart final embers');
    f.tick(sec(3));
    // The raid runs out of the Heart; the boss walks home.
    for (const p of f.players) f.put(p, 125, 110);
    f.dev('/dev heart final reset');
    f.tick(2);
    expect(f.state()).toBeNull();
    for (const prefix of Object.values(FINAL_OBJECTS))
      expect(f.objects(prefix).length, prefix).toBe(0);
    expect(aura(f.boss(), overloadAuraId('heat'))).toBeUndefined();
    expect(aura(f.boss(), FINAL_AURAS.root)).toBeUndefined();
  });
});

describe('the dev verbs', () => {
  it('every verb answers, and the readout reads the fight', () => {
    const f = finalFight(5);
    const logs: string[] = [];
    const say = (line: string) => {
      f.dev(line);
      for (const e of f.tick(1))
        if ((e.type === 'log' || e.type === 'error') && e.pid === f.pids[0]) logs.push(e.text);
    };
    say('/dev heart final mythic');
    say('/dev heart final pull');
    for (const v of [
      'fill heat 50',
      'burst',
      'shock',
      'root',
      'unroot',
      'fist',
      'whirl',
      'embers',
      'freeze',
      'cold 40',
      'ice',
      'wind 45',
      'bolt',
      'drawn',
      'orbs',
      'tremor',
      'anvil',
      'shell',
    ])
      say(`/dev heart final ${v}`);
    say('/dev heart final');
    expect(logs.some((l) => l.includes('mythic'))).toBe(true);
    expect(logs.some((l) => l.includes('Overload'))).toBe(true);
    expect(logs.filter((l) => l.startsWith('[dev] /dev heart')).length).toBe(0);
    say('/dev heart final nonsense');
    expect(logs.some((l) => l.startsWith('[dev] /dev heart'))).toBe(true);
  });
});
