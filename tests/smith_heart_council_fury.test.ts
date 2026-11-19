// Grieving Fury (src/sim/encounters/smith_heart/council_fury.ts), the Hammer
// Council's answer to "kill one, then cruise" (the owner's option B of
// 2026-11-18) over a REAL Sim claim: for each kill order on each tier the
// survivor's soul flight, its mend, its fury (Memory of Stone and the haste on
// its swings, bars and clocks), the fallen one's kit at full strength, the
// window that spares a near-together kill, the wipe lifting it all, and
// determinism. The client's look is pinned at the end (the pure core).

import { describe, expect, it } from 'vitest';
import { FURY_LOOK, furyLook } from '../src/render/smith_heart_fx/council_mechanic_look_core';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_DIFFICULTY,
  type CouncilDifficulty,
  type CouncilFightState,
  type CouncilRole,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { furyFallenOf, furyRoleCode } from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { type CouncilFight, councilFight } from './helpers/council_fight';

const ARRIVE_TICKS = Math.ceil(T.furyArrive * 20);

function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.songDue = null;
  st.energy = 0;
}

function pulled(tier: CouncilDifficulty, n = 6, seed = 17) {
  const f = councilFight(n, seed);
  if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  quiet(st);
  return { ...f, st };
}

function kill(f: CouncilFight, role: CouncilRole): SimEvent[] {
  f.sim.ctx.handleDeath(f.bodies()[role] as Entity, f.players[0]);
  return f.tick();
}

const other = (r: CouncilRole): CouncilRole => (r === 'guardian' ? 'singer' : 'guardian');
const cues = (ev: SimEvent[], ability: string) =>
  ev.filter((e) => e.type === 'spellfx' && (e as { ability?: string }).ability === ability);

const TIERS: CouncilDifficulty[] = ['normal', 'heroic', 'mythic'];
const ORDERS: CouncilRole[] = ['guardian', 'singer'];

describe('Grieving Fury: the rows', () => {
  it('Normal gentle, Heroic hard, Mythic at least Heroic', () => {
    const n = COUNCIL_DIFFICULTY.normal;
    const h = COUNCIL_DIFFICULTY.heroic;
    const m = COUNCIL_DIFFICULTY.mythic;
    for (const k of ['furyHealPct', 'furyDamage', 'furyHaste'] as const) {
      expect(h[k], k).toBeGreaterThan(n[k]);
      expect(m[k], k).toBeGreaterThanOrEqual(h[k]);
    }
    expect(h.furyHealPct).toBe(0.25);
    expect(n.inheritSecond).toBe(false);
    expect(h.inheritSecond && m.inheritSecond).toBe(true);
    // The aura's colour code round-trips.
    for (const r of ORDERS) expect(furyFallenOf(furyRoleCode(r))).toBe(r);
  });
});

for (const tier of TIERS) {
  for (const first of ORDERS) {
    const survivor = other(first);
    describe(`Grieving Fury on ${tier}: the ${first} falls first`, () => {
      it('the soul flies, then the survivor mends its share and wears the fury', () => {
        const f = pulled(tier);
        const rules = COUNCIL_DIFFICULTY[tier];
        const s = f.bodies()[survivor] as Entity;
        s.hp = Math.round(s.maxHp * 0.4);
        const ev = kill(f, first);
        // The soul sets out: its stream, from the fallen to the survivor.
        const beam = cues(ev, COUNCIL_CUES.inherit);
        expect(beam.length).toBe(1);
        expect((beam[0] as { targetId: number }).targetId).toBe(s.id);
        expect(f.st.fury?.survivor).toBe(survivor);
        expect(f.st.fury?.arrived).toBe(false);
        // Nothing changes in flight.
        const hp0 = s.hp;
        f.tick(ARRIVE_TICKS - 3);
        expect(s.hp).toBe(hp0);
        expect(s.auras.some((a) => a.id === COUNCIL_AURAS.fury)).toBe(false);
        expect(s.auras.some((a) => a.id === COUNCIL_AURAS.memory)).toBe(false);
        // It lands: the wake, the two auras, the mend over its seconds.
        const land = f.tick(4);
        expect(cues(land, COUNCIL_CUES.furyWake).length).toBe(1);
        const fury = s.auras.find((a) => a.id === COUNCIL_AURAS.fury);
        expect(fury?.kind).toBe('buff_haste');
        expect(fury?.value).toBeCloseTo(1 + rules.furyHaste);
        expect(furyFallenOf(fury?.value2)).toBe(first);
        const mem = s.auras.find((a) => a.id === COUNCIL_AURAS.memory);
        expect(mem?.kind).toBe('buff_dmg_done');
        expect(mem?.value).toBeCloseTo(rules.furyDamage);
        const mends = cues(
          f.tick(Math.ceil(rules.furyHealSeconds * 20) + 2),
          COUNCIL_CUES.furyMend,
        );
        expect(mends.length + cues(land, COUNCIL_CUES.furyMend).length).toBe(
          Math.round(rules.furyHealSeconds / T.furyMendEvery),
        );
        const healed = s.hp - hp0;
        // Its swing may have nothing to do with its own health: the mend is
        // the tier's share (rounded up a beat at most).
        expect(healed).toBeGreaterThanOrEqual(Math.round(s.maxHp * rules.furyHealPct) - 1);
        expect(healed).toBeLessThanOrEqual(Math.round(s.maxHp * rules.furyHealPct) + 5);
        // And no more after.
        const after = s.hp;
        f.tick(40);
        expect(s.hp).toBe(after);
      });

      it("takes up the fallen one's kit at full strength, hastened", () => {
        const f = pulled(tier);
        const rules = COUNCIL_DIFFICULTY[tier];
        const haste = 1 + rules.furyHaste;
        kill(f, first);
        f.tick(ARRIVE_TICKS + 1);
        quiet(f.st);
        const s = f.bodies()[survivor] as Entity;
        if (first === 'guardian') {
          // His Wrath: the full bar, hastened.
          expect(f.dev('/dev heart council wrath')).toBe(true);
          expect(s.castingAbility).toBe(COUNCIL_CASTS.wrath);
          expect(s.castTotal).toBeCloseTo(T.wrathCast / haste, 5);
          f.tick(Math.ceil((T.wrathCast / haste) * 20) + 2);
          // His Weight only where the tier hands on a second job.
          quiet(f.st);
          f.tick(30);
          f.dev('/dev heart council weight');
          expect(s.castingAbility === COUNCIL_CASTS.weight).toBe(rules.inheritSecond);
          // The Rush never passes on.
          f.dev('/dev heart council rush');
          expect(f.st.rush).toBeNull();
        } else {
          // Her Wake and her song, kickable, on him.
          expect(f.dev('/dev heart council wake')).toBe(true);
          expect(s.castingAbility).toBe(COUNCIL_CASTS.wake);
          expect(s.castTotal).toBeCloseTo(T.wakeCast / haste, 5);
          expect(f.st.kickable).toBe(COUNCIL_CASTS.wake);
          f.tick(Math.ceil((T.wakeCast / haste) * 20) + 2);
          // (As many as the pillar cap leaves room for, up to the tier's count.)
          expect(f.st.wakeMarks.length).toBeGreaterThan(0);
          expect(f.st.wakeMarks.length).toBeLessThanOrEqual(rules.wakeMarks);
          quiet(f.st);
          f.tick(30);
          expect(f.dev('/dev heart council song')).toBe(true);
          expect(s.castingAbility).toBe(COUNCIL_CASTS.song);
          expect(f.st.kickable).toBe(COUNCIL_CASTS.song);
          f.tick(Math.ceil((T.songCast / haste) * 20) + 2);
          expect(f.st.resonance.length).toBeGreaterThan(0);
          // Her bolt only where the tier hands on a second job.
          quiet(f.st);
          f.tick(30);
          f.dev('/dev heart council bolt');
          expect(s.castingAbility === COUNCIL_CASTS.bolt).toBe(rules.inheritSecond);
        }
      });

      it('runs the clocks and the fill faster, and swings faster', () => {
        const f = pulled(tier);
        const rules = COUNCIL_DIFFICULTY[tier];
        kill(f, first);
        f.tick(ARRIVE_TICKS + 1);
        quiet(f.st);
        f.st.rockTimer = 100;
        f.tick(20 * 10);
        expect(f.st.rockTimer).toBeCloseTo(100 - 10 * (1 + rules.furyHaste), 3);
        if (first === 'guardian') {
          // The Wrath's fill: 10 s of a 55 s fill, hastened.
          expect(f.st.energy).toBeCloseTo(
            (10 / T.energyFillSeconds) * 100 * (1 + rules.furyHaste),
            0,
          );
        }
        const s = f.bodies()[survivor] as Entity;
        expect(f.sim.ctx.swingIntervalMult(s)).toBeCloseTo(1 / (1 + rules.furyHaste), 5);
      });
    });
  }

  describe(`Grieving Fury on ${tier}: the window`, () => {
    it('a second kill inside the soul’s flight costs nothing: no mend, no fury', () => {
      const f = pulled(tier);
      kill(f, 'guardian');
      f.tick(ARRIVE_TICKS - 10);
      const s = f.bodies().singer as Entity;
      expect(s.auras.some((a) => a.id === COUNCIL_AURAS.fury)).toBe(false);
      const ev = kill(f, 'singer');
      expect(f.state()?.finished).toBe(true);
      expect(cues(ev, COUNCIL_CUES.furyWake).length).toBe(0);
    });

    it('one inside the mend costs only part of it', () => {
      const f = pulled(tier);
      const rules = COUNCIL_DIFFICULTY[tier];
      const s = f.bodies().singer as Entity;
      s.hp = Math.round(s.maxHp * 0.3);
      kill(f, 'guardian');
      const hp0 = s.hp;
      f.tick(ARRIVE_TICKS + 1 + 20 * 2);
      const part = s.hp - hp0;
      expect(part).toBeGreaterThan(0);
      expect(part).toBeLessThan(Math.round(s.maxHp * rules.furyHealPct) * 0.6);
    });
  });
}

describe('Grieving Fury: the wipe, the readout, the text', () => {
  it('a wipe lifts the fury and the survivor stands up plain', () => {
    const f = pulled('heroic', 2);
    kill(f, 'singer');
    f.tick(ARRIVE_TICKS + 2);
    const g = f.bodies().guardian as Entity;
    expect(g.auras.some((a) => a.id === COUNCIL_AURAS.fury)).toBe(true);
    for (const p of f.players) f.sim.ctx.handleDeath(p, null);
    for (let i = 0; i < 20 * 60 && f.state(); i++) f.sim.tick();
    expect(f.state()).toBeNull();
    for (const b of [f.bodies().guardian, f.bodies().singer]) {
      expect(b?.auras.some((a) => a.id === COUNCIL_AURAS.fury)).toBe(false);
      expect(b?.auras.some((a) => a.id === COUNCIL_AURAS.memory)).toBe(false);
    }
  });

  it('the readout and the dev health line', () => {
    const f = pulled('normal');
    expect(f.dev('/dev heart council hp both 5')).toBe(true);
    const b = f.bodies();
    for (const r of ORDERS) {
      const e = b[r] as Entity;
      expect(e.hp).toBe(Math.round(e.maxHp * 0.05));
    }
  });

  it('the tooltips read the live numbers', () => {
    const fury = auraEffectDescriptor({
      id: COUNCIL_AURAS.fury,
      kind: 'buff_haste',
      value: 1 + COUNCIL_DIFFICULTY.heroic.furyHaste,
    });
    const text = t(fury?.key as never, fury?.nums as never);
    expect(text).toContain(`${Math.round(COUNCIL_DIFFICULTY.heroic.furyHaste * 100)}% faster`);
    expect(text).toContain('full strength');
    const mem = auraEffectDescriptor({
      id: COUNCIL_AURAS.memory,
      kind: 'buff_dmg_done',
      value: COUNCIL_DIFFICULTY.normal.furyDamage,
    });
    expect(t(mem?.key as never, mem?.nums as never)).toContain(
      `${Math.round(COUNCIL_DIFFICULTY.normal.furyDamage * 100)}% more damage`,
    );
  });
});

describe('Grieving Fury: determinism', () => {
  it('the same seed and the same kills fight the same fury', () => {
    const run = () => {
      const f = pulled('heroic', 6, 29);
      f.tick(20 * 5);
      kill(f, 'guardian');
      f.tick(20 * 25);
      const s = f.bodies().singer as Entity;
      return {
        hp: s.hp,
        energy: Math.round(f.st.energy * 1000),
        casts: f.st.casts,
        players: f.players.map((p) => p.hp),
      };
    };
    expect(run()).toEqual(run());
  });
});

describe('Grieving Fury: the look (pure)', () => {
  it('swells to its size with a breath of overshoot, flashes at the wake, throbs', () => {
    expect(furyLook(-1).swell).toBe(1);
    expect(furyLook(-1).glow).toBe(0);
    expect(furyLook(0).swell).toBeCloseTo(1, 5);
    const peak = Math.max(
      ...Array.from({ length: 40 }, (_, i) => furyLook((i / 40) * FURY_LOOK.grow).swell),
    );
    expect(peak).toBeGreaterThan(T.furySwell);
    expect(furyLook(5).swell).toBeCloseTo(T.furySwell, 5);
    expect(furyLook(0).flash).toBe(1);
    expect(furyLook(FURY_LOOK.wake + 0.1).flash).toBe(0);
    const beats = Array.from({ length: 50 }, (_, i) => furyLook(5 + i * 0.02).beat);
    expect(Math.max(...beats)).toBeGreaterThan(0.8);
    expect(Math.min(...beats)).toBeLessThan(0.05);
  });
});
