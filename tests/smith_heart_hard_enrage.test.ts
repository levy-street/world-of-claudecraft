// Forge-Fury, the Smith's Heart's hard enrage (src/sim/encounters/smith_heart/
// hard_enrage.ts, its rules hard_enrage_ids.ts; design doc section 7, "The hard
// enrage"): Normal never enrages; Heroic and Mythic warn 30 s before and then
// burn the raid away, on all five bosses at their own timers; a wipe's reset
// clears it; it never lands while the boss cannot be harmed; it is
// deterministic; and its tooltips say the live numbers.

import { describe, expect, it } from 'vitest';
import { heatScopeForDev } from '../src/sim/encounters/smith_heart';
import { hardEnrageOf } from '../src/sim/encounters/smith_heart/hard_enrage';
import {
  HARD_ENRAGE_AURAS as A,
  HARD_ENRAGE_LOGS,
  HARD_ENRAGE_NAMES,
  HARD_ENRAGE_SECONDS,
  type HeartEnrageBoss,
  HARD_ENRAGE_TUNING as T,
} from '../src/sim/encounters/smith_heart/hard_enrage_ids';
import { beginOverflow } from '../src/sim/encounters/smith_heart/heat';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { hardEnrageAuraEffectDescriptor } from '../src/ui/hard_enrage_aura_effect';
import { breathFight } from './helpers/breath_fight';
import { councilFight } from './helpers/council_fight';
import { finalFight } from './helpers/final_fight';
import { heatFight } from './helpers/heat_fight';
import { quenchFight } from './helpers/quench_fight';

type Tier = 'normal' | 'heroic' | 'mythic';
const ticks = (seconds: number) => Math.round(seconds / DT);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);

interface Pulled {
  bosses: () => Entity[];
  players: Entity[];
  state: () => { enrage?: unknown; difficulty: Tier } | null;
  /** `keep`: hold the raid's health up (the fight's own mechanics are not
   *  what is measured; never through the fury's burns). */
  tick: (n: number, keep?: boolean) => SimEvent[];
  reset: () => void;
}

/** One boss pulled on `tier`, its raid kept alive by nothing but itself. */
function pull(boss: HeartEnrageBoss, tier: Tier): Pulled {
  switch (boss) {
    case 'council': {
      const f = councilFight(4);
      if (tier !== 'normal') f.dev(`/dev heart council ${tier}`);
      f.dev('/dev heart council pull');
      f.tick();
      const b = () => [f.bodies().guardian, f.bodies().singer].filter((e): e is Entity => !!e);
      return {
        bosses: b,
        players: f.players,
        state: f.state,
        tick: (n) => f.tick(n),
        reset: () => f.dev('/dev heart council reset'),
      };
    }
    case 'breath': {
      const f = breathFight(4);
      if (tier !== 'normal') f.dev(`/dev heart breath ${tier}`);
      f.dev('/dev heart breath pull');
      f.tick(2, true);
      return {
        bosses: () => [f.boss()],
        players: f.players,
        state: f.state,
        tick: (n, keep = false) => f.tick(n, keep),
        reset: () => f.dev('/dev heart breath reset'),
      };
    }
    case 'quench': {
      const f = quenchFight(4);
      if (tier !== 'normal') f.dev(`/dev heart quench ${tier}`);
      f.dev('/dev heart quench pull');
      f.tick(2, true);
      return {
        bosses: () => [f.boss()],
        players: f.players,
        state: f.state,
        tick: (n, keep = false) => f.tick(n, keep),
        reset: () => f.dev('/dev heart quench reset'),
      };
    }
    case 'heat': {
      const f = heatFight(4);
      if (tier !== 'normal') f.dev(`/dev heart heat ${tier}`);
      f.dev('/dev heart heat pull');
      f.tick(2, true);
      return {
        bosses: () => [f.boss()],
        players: f.players,
        state: f.state,
        tick: (n, keep = false) => f.tick(n, keep),
        reset: () => f.dev('/dev heart heat reset'),
      };
    }
    case 'final': {
      const f = finalFight(4);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('heat');
      f.tick(2, true);
      return {
        bosses: () => [f.boss()],
        players: f.players,
        state: f.state,
        tick: (n, keep = false) => f.tick(n, keep),
        reset: () => f.dev('/dev heart final reset'),
      };
    }
  }
}

/** The fight's hard enrage, its clock moved to `left` seconds before the
 *  timer (the other mechanics are not what these tests measure). */
function leave(p: Pulled, left: number, seconds: number): void {
  const st = p.state();
  if (!st) throw new Error('no fight');
  hardEnrageOf(st as Parameters<typeof hardEnrageOf>[0]).elapsed = seconds - left;
}

const BOSSES: readonly HeartEnrageBoss[] = ['council', 'breath', 'quench', 'heat', 'final'];

describe('Forge-Fury: the timers', () => {
  it('Normal has none; Heroic is the approved timer and Mythic a minute more', () => {
    expect(HARD_ENRAGE_SECONDS).toEqual({
      council: { normal: null, heroic: 480, mythic: 540 },
      breath: { normal: null, heroic: 540, mythic: 600 },
      heat: { normal: null, heroic: 480, mythic: 540 },
      quench: { normal: null, heroic: 480, mythic: 540 },
      final: { normal: null, heroic: 600, mythic: 660 },
    });
    expect(T.warnLead).toBe(30);
    expect(HARD_ENRAGE_LOGS.warn).toContain(`${T.warnLead} seconds`);
  });
});

describe.each(BOSSES)('Forge-Fury on the %s', (boss) => {
  it('never comes on Normal, however long the fight runs', () => {
    const p = pull(boss, 'normal');
    expect(p.state()?.difficulty).toBe('normal');
    // Far past every other tier's timer.
    leave(p, -120, 600);
    p.tick(ticks(3), true);
    for (const b of p.bosses()) {
      expect(aura(b, A.gathering)).toBeUndefined();
      expect(aura(b, A.fury)).toBeUndefined();
    }
    expect(p.players.some((x) => x.dead)).toBe(false);
  });

  it.each(['heroic', 'mythic'] as const)(
    'on %s: warns 30 s out, then burns the whole raid away within seconds',
    (tier) => {
      const p = pull(boss, tier);
      const seconds = HARD_ENRAGE_SECONDS[boss][tier] as number;
      expect(p.state()?.difficulty).toBe(tier);
      // Just before the warning: nothing yet.
      leave(p, T.warnLead + 1, seconds);
      p.tick(ticks(0.5), true);
      for (const b of p.bosses()) expect(aura(b, A.gathering)).toBeUndefined();
      const warned = p.tick(ticks(1), true);
      const lines = warned.filter((e) => e.type === 'log' && e.text === HARD_ENRAGE_LOGS.warn);
      expect(lines.length).toBeGreaterThan(0);
      for (const b of p.bosses()) {
        const g = aura(b, A.gathering);
        expect(g?.value).toBe(seconds);
        expect(g?.remaining).toBeGreaterThan(T.warnLead - 1);
        expect(g?.remaining).toBeLessThanOrEqual(T.warnLead);
      }
      // Not a moment early.
      leave(p, 0.5, seconds);
      p.tick(ticks(0.4), true);
      for (const b of p.bosses()) expect(aura(b, A.fury)).toBeUndefined();
      expect(p.players.every((x) => !x.dead)).toBe(true);
      // The timer: the fury, and nobody standing a few seconds later.
      const ev = p.tick(ticks(0.2));
      expect(ev.some((e) => e.type === 'log' && e.text === HARD_ENRAGE_LOGS.fury)).toBe(true);
      for (const b of p.bosses()) {
        expect(aura(b, A.fury)?.permanent).toBe(true);
        expect(aura(b, A.gathering)).toBeUndefined();
      }
      p.tick(ticks(T.pulseEvery * T.killPulse + 0.5));
      expect(p.players.every((x) => x.dead)).toBe(true);
    },
  );

  it('a wipe or a reset clears it, and the next pull starts the clock again', () => {
    const p = pull(boss, 'heroic');
    const seconds = HARD_ENRAGE_SECONDS[boss].heroic as number;
    leave(p, 0.1, seconds);
    p.tick(ticks(0.5));
    for (const b of p.bosses()) expect(aura(b, A.fury)).toBeDefined();
    p.reset();
    p.tick(2);
    for (const b of p.bosses()) {
      expect(aura(b, A.fury)).toBeUndefined();
      expect(aura(b, A.gathering)).toBeUndefined();
    }
    const st = p.state();
    if (st) expect(hardEnrageOf(st as Parameters<typeof hardEnrageOf>[0]).fury).toBe(false);
  });
});

describe('Forge-Fury is fair', () => {
  it('never lands while the boss cannot be harmed (the Heat sunk in an overflow), then at once', () => {
    const f = heatFight(4);
    f.dev('/dev heart heat heroic');
    f.dev('/dev heart heat pull');
    f.tick(2, true);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const s = heatScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no scope');
    beginOverflow(s, 1);
    // Sink it fully, then run the timer out while it is under.
    let n = 0;
    while (!f.boss().damageImmune && n++ < ticks(20)) f.tick(1, true);
    expect(f.boss().damageImmune).toBe(true);
    hardEnrageOf(st).elapsed = 480 + 5;
    f.tick(ticks(1), true);
    expect(aura(f.boss(), A.fury)).toBeUndefined();
    expect(hardEnrageOf(st).fury).toBe(false);
    // Out of its downtime: the fury lands the first tick it can be struck.
    n = 0;
    while (f.boss().damageImmune && n++ < ticks(120)) f.tick(1, true);
    expect(f.boss().damageImmune).toBe(false);
    f.tick(1, true);
    expect(aura(f.boss(), A.fury)).toBeDefined();
  });

  it('is deterministic: the same seed burns the same numbers', () => {
    const run = () => {
      const p = pull('quench', 'heroic');
      leave(p, 0.1, 480);
      const ev = p.tick(ticks(T.pulseEvery * 2 + 0.3));
      return ev
        .filter((e) => e.type === 'damage' && e.ability === HARD_ENRAGE_NAMES.fury)
        .map((e) => (e.type === 'damage' ? [e.targetId, e.amount] : null));
    };
    const a = run();
    expect(a.length).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  });
});

describe('Forge-Fury tooltips', () => {
  it('say the tier timer and the live burn', () => {
    const g = hardEnrageAuraEffectDescriptor({ id: A.gathering, kind: 'internal_cd', value: 480 });
    expect(g).toEqual({
      key: 'hudChrome.auraEffect.forgeFury.gathering',
      nums: { minutes: 8, share: 40, share2: 80, every: 1 },
    });
    const f = hardEnrageAuraEffectDescriptor({ id: A.fury, kind: 'internal_cd', value: 660 });
    expect(f?.key).toBe('hudChrome.auraEffect.forgeFury.fury');
    expect(f?.nums?.minutes).toBe(11);
    expect(
      hardEnrageAuraEffectDescriptor({ id: 'heart_final_fury', kind: 'buff_haste', value: 0 }),
    ).toBe(null);
  });
});
