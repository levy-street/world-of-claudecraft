// The Guardian of the Heat's tank pressure through its quiet stretches (the
// owner's call of 2026-11-27; docs/design/raid/smith_heart.md 7.4), over a
// REAL Sim:
//  - Cinder Grip HELD while the guardian is hidden (sunk, under, rising): no
//    burn, no time lost, the same stacks, and it runs again once it rises
//    (encounters/smith_heart/heat_grip.ts holdGrip);
//  - Wellspring Brand (heat_brand.ts): on its own clock while the guardian is
//    present, told to the tank by the tank buster marker, landing its Fire and
//    its mark, also through Basalt Fist's bar and with the tank out of reach;
//    never while it is hidden; each tier's own row;
//  - the HUD's tank swap and tank buster alerts count it, and its tooltip
//    states the resolved numbers.

import { describe, expect, it } from 'vitest';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { BRAND_AFTER_RISE, landBrand } from '../src/sim/encounters/smith_heart/heat_brand';
import { holdGripOn } from '../src/sim/encounters/smith_heart/heat_grip';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_NAMES,
  type HeatDifficulty,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import {
  heartTankBusterByCode,
  TANK_BUSTER_AURA,
} from '../src/sim/encounters/smith_heart/tank_buster_ids';
import { HEART_TANK_SWAPS, heartTankSwapOf } from '../src/sim/encounters/smith_heart/tank_swap_ids';
import { type Aura, DT, type Entity, type SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { tierValue } from '../src/ui/heart_tier_damage';
import {
  buildTankBusterAlertView,
  buildTankSwapAlertView,
  type TankSwapBody,
} from '../src/ui/hud/dungeon/tank_swap_alert_view';
import { setLanguage, t } from '../src/ui/i18n';
import { type HeatFight, heatFight } from './helpers/heat_fight';

setLanguage('en');

const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const ticks = (s: number) => Math.round(s / DT);
const TIERS: readonly HeatDifficulty[] = ['normal', 'heroic', 'mythic'];

/** Every one of the fight's own clocks held but the brand's. */
function hold(f: HeatFight): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.fistTimer = 999;
  st.flareTimer = 999;
  st.seedTimer = 999;
  st.zoneTimer = 999;
  st.wheelTimer = 999;
  st.cinderTimer = 999;
  st.coalTimer = 999;
}

/** A pulled fight on `tier`, the first player its tank at the lip. */
function pulled(tier: HeatDifficulty = 'normal', n = 3): HeatFight {
  const f = heatFight(n, 31);
  if (tier !== 'normal') f.dev(`/dev heart heat ${tier}`);
  expect(f.dev('/dev heart heat pull')).toBe(true);
  f.boss().threat.set(f.players[0].id, 1e6);
  f.tick(2);
  hold(f);
  f.put(f.players[0], HEARTH_WELL.x + HEARTH_WELL.r + 0.5, 0);
  f.tick(1);
  return f;
}

const brandHits = (ev: readonly SimEvent[], targetId?: number) =>
  ev.filter(
    (e) =>
      e.type === 'damage' &&
      e.ability === HEAT_NAMES.brand &&
      (targetId === undefined || e.targetId === targetId),
  );
const gripHits = (ev: readonly SimEvent[], targetId: number) =>
  ev.filter((e) => e.type === 'damage' && e.ability === HEAT_NAMES.grip && e.targetId === targetId);
const cues = (ev: readonly SimEvent[], ability: string) =>
  ev.filter((e) => e.type === 'spellfx' && e.ability === ability);

/** Tick until the guardian is back in its fight (an overflow's end). */
function untilRisen(f: HeatFight, cap = 60): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks(cap) && f.state()?.stage !== 'fight'; i++) {
    hold(f);
    out.push(...f.tick());
  }
  expect(f.state()?.stage).toBe('fight');
  return out;
}

describe('Cinder Grip while the guardian is hidden', () => {
  it('stands still through an overflow: no burn, no time lost, the same stacks; then runs again', () => {
    const f = pulled();
    const tank = f.players[0];
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.brandTimer = 999;
    f.tick(ticks(8));
    const before = aura(tank, HEAT_AURAS.grip);
    expect(before?.stacks ?? 0).toBeGreaterThanOrEqual(2);
    expect(f.dev('/dev heart heat overflow')).toBe(true);
    // The tick the guardian sank in: from here on every tick is hidden.
    const grip = aura(tank, HEAT_AURAS.grip) as Aura;
    const stacks = grip.stacks;
    const remaining = grip.remaining;
    const tickTimer = grip.tickTimer as number;
    const hidden: SimEvent[] = [];
    for (let i = 0; i < ticks(12); i++) {
      hold(f);
      hidden.push(...f.tick());
      expect(f.state()?.stage).not.toBe('fight');
      const now = aura(tank, HEAT_AURAS.grip) as Aura;
      expect(now).toBeDefined();
      expect(now.stacks).toBe(stacks);
      // At most the one tick the hold clamps away (a grip at its whole).
      expect(now.remaining).toBeGreaterThanOrEqual(remaining - DT - 1e-9);
      expect(now.remaining).toBeLessThanOrEqual(remaining + 1e-9);
      expect(now.tickTimer as number).toBeGreaterThanOrEqual(tickTimer - DT - 1e-9);
    }
    // 12 s is near the grip's whole 15 s: unheld, it would have burned a dozen
    // times and nearly run out.
    expect(gripHits(hidden, tank.id)).toHaveLength(0);
    expect(f.boss().hostile).toBe(false);
    untilRisen(f);
    const back = aura(tank, HEAT_AURAS.grip) as Aura;
    expect(back.stacks).toBe(stacks);
    const r0 = back.remaining;
    // Present again: it burns once a second and its time runs down.
    f.put(tank, HEARTH_WELL.x + 30, 0); // out of the swing's reach: no fresh stack
    const after = f.tick(ticks(2.05));
    expect(gripHits(after, tank.id).length).toBeGreaterThanOrEqual(2);
    expect((aura(tank, HEAT_AURAS.grip) as Aura).remaining).toBeCloseTo(r0 - 2.05, 1);
  });

  it('on the real threshold path (health past 70 percent) the grip stands exactly still from the sink tick to the rise', () => {
    const f = pulled();
    const tank = f.players[0];
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.brandTimer = 999;
    f.tick(ticks(6));
    expect(aura(tank, HEAT_AURAS.grip)).toBeDefined();
    // Out of the swing's reach first: no stack lands on the sink tick, so
    // the hold's clamp never trims a freshly refreshed grip.
    f.put(tank, HEARTH_WELL.x + 30, 0);
    f.tick(ticks(0.5));
    const b = f.boss();
    b.damageFloorHp = undefined;
    b.hp = Math.floor(b.maxHp * T.overflowOneAt) - 1;
    // The sink tick: watchThresholds begins the overflow inside the pass.
    f.tick();
    expect(st.stage).toBe('sinking');
    const g = aura(tank, HEAT_AURAS.grip) as Aura;
    const r0 = g.remaining;
    const t0 = g.tickTimer as number;
    const hidden: SimEvent[] = [];
    while (st.stage !== 'fight') {
      hold(f);
      hidden.push(...f.tick());
      const now = aura(tank, HEAT_AURAS.grip) as Aura;
      if ((st.stage as string) === 'fight') break;
      expect(Math.abs(now.remaining - r0)).toBeLessThan(1e-9);
      expect(Math.abs((now.tickTimer as number) - t0)).toBeLessThan(1e-9);
    }
    expect(gripHits(hidden, tank.id)).toHaveLength(0);
    // Read between ticks a held grip shows the tick the next aging takes
    // back; the rise tick ages it once with no hold after, so it reads its
    // true time, the very time every hidden tick's aging left it at.
    const risen = aura(tank, HEAT_AURAS.grip) as Aura;
    expect(Math.abs(risen.remaining - (r0 - DT))).toBeLessThan(1e-9);
    // And the next tick ages it again.
    f.tick();
    expect(Math.abs((aura(tank, HEAT_AURAS.grip) as Aura).remaining - (r0 - 2 * DT))).toBeLessThan(
      1e-9,
    );
  });

  it('the hold gives back exactly the tick the next aging takes, clamped to the whole', () => {
    const grip: Aura = {
      id: HEAT_AURAS.grip,
      name: HEAT_NAMES.grip,
      kind: 'dot',
      remaining: 7,
      duration: T.gripSeconds,
      value: 30,
      tickInterval: 1,
      tickTimer: 0.4,
      stacks: 2,
      sourceId: 1,
      school: 'fire',
    };
    const e = { auras: [grip] } as unknown as Entity;
    holdGripOn(e);
    expect(grip.remaining).toBeCloseTo(7 + DT, 9);
    expect(grip.tickTimer).toBeCloseTo(0.4 + DT, 9);
    grip.remaining = T.gripSeconds;
    grip.tickTimer = 1;
    holdGripOn(e);
    expect(grip.remaining).toBe(T.gripSeconds);
    expect(grip.tickTimer).toBe(1);
  });
});

describe('Wellspring Brand while the guardian is present', () => {
  it('tells its tank, then lands its Fire and its mark on the tier clock', () => {
    const f = pulled();
    const tank = f.players[0];
    const st = f.state();
    if (!st) throw new Error('no fight');
    const rule = HEAT_DIFFICULTY.normal.brand;
    st.brandTimer = rule.lead + 0.5;
    const pre = f.tick(ticks(0.5) + 1);
    // The tell: the tank buster marker on the tank alone, the gathering cue.
    const mark = aura(tank, TANK_BUSTER_AURA);
    expect(heartTankBusterByCode(mark?.value)?.key).toBe('brand');
    expect(mark?.remaining).toBeGreaterThan(rule.lead - 0.2);
    for (const p of f.players.slice(1)) expect(aura(p, TANK_BUSTER_AURA)).toBeUndefined();
    expect(cues(pre, HEAT_CUES.brandGather)).toHaveLength(1);
    expect(brandHits(pre)).toHaveLength(0);
    const land = f.tick(ticks(rule.lead) + 1);
    const hits = brandHits(land);
    expect(hits).toHaveLength(1);
    expect(hits[0].type === 'damage' && hits[0].targetId).toBe(tank.id);
    expect(cues(land, HEAT_CUES.brand)).toHaveLength(1);
    const b = aura(tank, HEAT_AURAS.brand);
    expect(b?.kind).toBe('spellvuln');
    expect(b?.value).toBe(rule.taken);
    expect(b?.value2).toBe(rule.every);
    expect(b?.value3).toBe(T.brandSwap);
    expect(b?.duration).toBe(rule.seconds);
    expect(b?.undispellable).toBe(true);
    expect(aura(tank, TANK_BUSTER_AURA)).toBeUndefined();
    // The next one, `every` later, and none before it.
    expect(st.brandTimer).toBeGreaterThan(rule.every - 0.2);
    const gap = f.tick(ticks(rule.every - rule.lead - 0.5));
    expect(brandHits(gap)).toHaveLength(0);
    const next = f.tick(ticks(rule.lead + 1));
    expect(brandHits(next)).toHaveLength(1);
    expect(st.brands).toBe(2);
  });

  it('lands through Basalt Fist bar and on a tank standing out of reach', () => {
    const f = pulled('normal', 3);
    const [tank, marked] = f.players;
    const st = f.state();
    if (!st) throw new Error('no fight');
    // Out of the swing's reach (no melee lands), still the guardian's target.
    f.put(tank, HEARTH_WELL.x + 20, -6);
    f.put(marked, HEARTH_WELL.x + 16, 6);
    expect(f.dev('/dev heart heat fist', marked.id)).toBe(true);
    expect(f.boss().castingAbility).toBe(HEAT_CASTS.fist);
    st.brandTimer = 1;
    let during = 0;
    for (let i = 0; i < ticks(1.2); i++) {
      const ev = f.tick();
      if (brandHits(ev, tank.id).length > 0) {
        during++;
        expect(f.boss().castingAbility).toBe(HEAT_CASTS.fist);
      }
    }
    expect(during).toBe(1);
    expect(aura(tank, HEAT_AURAS.brand)).toBeDefined();
  });

  it('the mark doubles the Fire its bearer takes: the next brand hits about twice as hard', () => {
    const f = pulled();
    const tank = f.players[0];
    const s = f.state();
    if (!s) throw new Error('no fight');
    s.brandTimer = 999;
    const scope = {
      ctx: f.sim.ctx,
      inst: f.inst,
      st: s,
      boss: f.boss(),
      players: f.players,
      rules: HEAT_DIFFICULTY.normal,
    };
    // The hits as the combat log sees them (before any pool clamps them).
    f.sim.drainEvents();
    const amounts: number[] = [];
    for (let i = 0; i < 2; i++) {
      tank.hp = tank.maxHp = 50000;
      landBrand(scope, tank);
      const hit = brandHits(f.sim.drainEvents(), tank.id)[0];
      amounts.push(hit?.type === 'damage' ? hit.amount : 0);
    }
    const lo = tierValue(T.brandMin, HEAT_DIFFICULTY.normal.damageMult);
    const hi = tierValue(T.brandMax, HEAT_DIFFICULTY.normal.damageMult);
    expect(amounts[0]).toBeGreaterThan(0);
    expect(amounts[0]).toBeLessThanOrEqual(hi + 1);
    expect(amounts[1]).toBeGreaterThan(amounts[0] * 1.6);
    expect(amounts[1]).toBeLessThanOrEqual(2 * hi + 2);
    expect(lo).toBeLessThan(hi);
  });

  it('a taunt during the tell moves the warning to the new tank, who takes the brand', () => {
    const f = pulled('normal', 3);
    const [first, second] = f.players;
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.put(second, HEARTH_WELL.x + HEARTH_WELL.r + 0.5, 4);
    st.brandTimer = HEAT_DIFFICULTY.normal.brand.lead - 0.5;
    f.tick();
    expect(aura(first, TANK_BUSTER_AURA)).toBeDefined();
    f.boss().threat.set(second.id, 1e9);
    f.boss().aggroTargetId = second.id;
    f.tick();
    expect(aura(first, TANK_BUSTER_AURA)).toBeUndefined();
    expect(aura(second, TANK_BUSTER_AURA)).toBeDefined();
    const ev = f.tick(ticks(2));
    expect(brandHits(ev, second.id)).toHaveLength(1);
    expect(brandHits(ev, first.id)).toHaveLength(0);
    expect(cues(ev, HEAT_CUES.brandGather)).toHaveLength(0);
  });
});

describe('Wellspring Brand never while the guardian is hidden', () => {
  it('its clock stands still through the overflow, a tell under way is taken back, it comes after the rise', () => {
    const f = pulled();
    const tank = f.players[0];
    const st = f.state();
    if (!st) throw new Error('no fight');
    const rule = HEAT_DIFFICULTY.normal.brand;
    st.brandTimer = rule.lead - 0.5;
    f.tick();
    expect(aura(tank, TANK_BUSTER_AURA)).toBeDefined();
    expect(f.dev('/dev heart heat overflow')).toBe(true);
    const hidden = untilRisen(f);
    expect(brandHits(hidden)).toHaveLength(0);
    expect(cues(hidden, HEAT_CUES.brand)).toHaveLength(0);
    expect(aura(tank, TANK_BUSTER_AURA)).toBeUndefined();
    // Held through the hidden stretch (the rise's own tick is present again).
    expect(st.brandTimer).toBeGreaterThanOrEqual(rule.lead + BRAND_AFTER_RISE - DT - 1e-9);
    expect(st.brandTimer).toBeLessThanOrEqual(rule.lead + BRAND_AFTER_RISE + 1e-9);
    // Back up: told again after BRAND_AFTER_RISE, landing `lead` later.
    const back = f.tick(ticks(BRAND_AFTER_RISE + rule.lead) + 2);
    expect(cues(back, HEAT_CUES.brandGather)).toHaveLength(1);
    expect(brandHits(back, tank.id)).toHaveLength(1);
  });

  it('a clock due during the overflow waits for the rise', () => {
    const f = pulled();
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.brandTimer = 5;
    expect(f.dev('/dev heart heat overflow')).toBe(true);
    const hidden = untilRisen(f);
    expect(brandHits(hidden)).toHaveLength(0);
    expect(st.brandTimer).toBeGreaterThanOrEqual(5 - DT - 1e-9);
    expect(st.brandTimer).toBeLessThanOrEqual(5 + 1e-9);
  });
});

describe('Wellspring Brand per tier', () => {
  it('each tier has its own row: the mark outlasts the gap, quicker on the harder tiers', () => {
    for (const tier of TIERS) {
      const b = HEAT_DIFFICULTY[tier].brand;
      expect(b.seconds).toBeGreaterThan(b.every);
      expect(b.lead).toBeGreaterThan(0);
      expect(b.lead).toBeLessThan(b.every);
      expect(b.taken).toBe(1);
      // The tooltip reads one length for every tier.
      expect(b.seconds).toBe(HEAT_DIFFICULTY.normal.brand.seconds);
    }
    const every = TIERS.map((x) => HEAT_DIFFICULTY[x].brand.every);
    expect(every).toEqual([25, 22, 20]);
    expect(HEAT_DIFFICULTY.mythic.brand.lead).toBeLessThan(HEAT_DIFFICULTY.normal.brand.lead);
  });

  it("each tier's fight brands on its own clock and hits for its own damage", () => {
    for (const tier of TIERS) {
      const f = pulled(tier);
      const st = f.state();
      if (!st) throw new Error('no fight');
      expect(st.difficulty).toBe(tier);
      const rule = HEAT_DIFFICULTY[tier].brand;
      st.brandTimer = rule.lead + 0.1;
      const ev = f.tick(ticks(rule.lead + 0.2));
      expect(brandHits(ev)).toHaveLength(1);
      expect(aura(f.players[0], HEAT_AURAS.brand)?.value2).toBe(rule.every);
      expect(st.brandTimer).toBeCloseTo(rule.every, 0);
    }
  });

  it('the fight starts with the tier row first brand', () => {
    for (const tier of TIERS) {
      const f = heatFight(2, 31);
      if (tier !== 'normal') f.dev(`/dev heart heat ${tier}`);
      // A fresh pull on the tier (the helper's raid pulled it on Normal).
      expect(f.dev('/dev heart heat reset')).toBe(true);
      expect(f.dev('/dev heart heat pull')).toBe(true);
      f.tick(1);
      expect(f.state()?.difficulty).toBe(tier);
      expect(f.state()?.brandTimer).toBeCloseTo(HEAT_DIFFICULTY[tier].brand.first - DT, 5);
    }
  });
});

describe('Wellspring Brand on the HUD', () => {
  const body = (e: Entity) => e as unknown as TankSwapBody;

  it('the tank swap alert counts one brand as the swap; the tank buster alert names it', () => {
    expect(heartTankSwapOf(HEAT_AURAS.brand)?.swapAt).toBe(1);
    expect(HEART_TANK_SWAPS.filter((s) => s.boss === 'heat')).toHaveLength(2);
    const f = pulled();
    const tank = f.players[0];
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.brandTimer = HEAT_DIFFICULTY.normal.brand.lead - 0.4;
    f.tick();
    const entity = (id: number) => f.sim.ctx.entities.get(id) as unknown as TankSwapBody;
    const buster = buildTankBusterAlertView({ self: body(tank), entity });
    expect(buster.visible && buster.title).toBe('Wellspring Brand');
    expect(buster.visible && buster.line).toBe(t('hudChrome.tankBuster.onYou'));
    expect(buildTankBusterAlertView({ self: body(f.players[1]), entity }).visible).toBe(false);
    f.tick(ticks(2));
    expect(aura(tank, HEAT_AURAS.brand)).toBeDefined();
    // Swap: one brand is the count, while the guardian is still on them.
    const swap = buildTankSwapAlertView({ self: body(tank), entity });
    expect(swap.visible).toBe(true);
    f.boss().aggroTargetId = f.players[1].id;
    expect(buildTankSwapAlertView({ self: body(tank), entity }).visible).toBe(false);
  });

  it('its tooltip states the resolved numbers of the live mark', () => {
    const rule = HEAT_DIFFICULTY.normal.brand;
    const d = auraEffectDescriptor({
      id: HEAT_AURAS.brand,
      kind: 'spellvuln',
      value: rule.taken,
      value2: rule.every,
    });
    expect(d?.key).toBe('hudChrome.auraEffect.heatGuardian.brand');
    const nm = HEAT_DIFFICULTY.normal.damageMult;
    const hm = HEAT_DIFFICULTY.heroic.damageMult;
    expect(d?.nums).toEqual({
      pct: 100,
      seconds: rule.seconds,
      every: rule.every,
      min: tierValue(T.brandMin, nm),
      max: tierValue(T.brandMax, nm),
      heroicMin: tierValue(T.brandMin, hm),
      heroicMax: tierValue(T.brandMax, hm),
    });
    // Heroic's every rides the live aura.
    const h = auraEffectDescriptor({
      id: HEAT_AURAS.brand,
      kind: 'spellvuln',
      value: 1,
      value2: HEAT_DIFFICULTY.heroic.brand.every,
    });
    expect(h?.nums?.every).toBe(22);
    const text = t('hudChrome.auraEffect.heatGuardian.brand', d?.nums as Record<string, number>);
    for (const n of ['100%', '30 sec', 'Every 25 sec', '572', '650', '633', '719'])
      expect(text).toContain(n);
  });
});
