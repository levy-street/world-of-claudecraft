// Grief of the Stone (src/sim/encounters/smith_heart/council_grief.ts, the
// owner's ask of 2026-11-19): the Hammer Council's first fall heals the
// survivor, enrages it (faster, harder blows and stone) and hands it one more
// of the fallen one's moves, on every tier, once the fallen one's strength has
// streamed across to it. Over REAL Sim claims: the heal and its timing, the
// enrage's numbers in the swing and the mechanics' factors (never the lethal
// punishments), the new moves (the Guardian's rock, the Singer's Hammer's
// Weight), the survivor killed in time, a wipe giving everything back, a tier
// switch mid-fight, the tooltip against the live numbers, and determinism.

import { describe, expect, it } from 'vitest';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_DIFFICULTY,
  COUNCIL_ROLES,
  type CouncilFightState,
  type CouncilRole,
  councilScopeForDev,
  enragedSwing,
  griefHealAmount,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { damageMult, punishMult } from '../src/sim/encounters/smith_heart/council_scope';
import { rockCaster } from '../src/sim/encounters/smith_heart/council_stone';
import { weightCaster } from '../src/sim/encounters/smith_heart/council_wrath';
import type { Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { type CouncilFight, councilFight } from './helpers/council_fight';

type Tier = 'normal' | 'heroic' | 'mythic';
const TIERS: readonly Tier[] = ['normal', 'heroic', 'mythic'];
/** The stream's flight in ticks. */
const FLOW = Math.round(T.griefFlow * 20);

type HealEvent = Extract<SimEvent, { type: 'heal' }>;
const healsOn = (ev: readonly SimEvent[], id: number): number[] =>
  ev.filter((e): e is HealEvent => e.type === 'heal' && e.targetId === id).map((e) => e.amount);

/** Park every council clock so one mechanic can be watched alone. */
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

/** The council pulled on `tier` (set before the pull, so its pools and
 *  swings are the tier's), its clocks parked. */
function pulled(tier: Tier, n = 6, seed = 17): CouncilFight & { st: CouncilFightState } {
  const f = councilFight(n, seed);
  if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  quiet(st);
  return { ...f, st };
}

const other = (r: CouncilRole): CouncilRole => (r === 'guardian' ? 'singer' : 'guardian');

/** Fell `role` now; the tick after reads its fall (its strength sets out). */
function kill(f: CouncilFight, role: CouncilRole): SimEvent[] {
  f.sim.ctx.handleDeath(f.bodies()[role] as Entity, f.players[0]);
  return f.tick();
}

const scope = (f: CouncilFight) => {
  const s = councilScopeForDev(f.sim.ctx, f.inst);
  if (!s) throw new Error('no council');
  return s;
};

const enragedAura = (e: Entity) => e.auras.find((a) => a.id === COUNCIL_AURAS.enraged);

describe('Grief of the Stone: the heal and the enrage land with the stream', () => {
  for (const tier of TIERS) {
    for (const fallen of COUNCIL_ROLES) {
      it(`${tier}, the ${fallen} first: healed a ${COUNCIL_DIFFICULTY[tier].griefHeal * 100} percent share and enraged as the stream lands`, () => {
        const f = pulled(tier);
        const rules = COUNCIL_DIFFICULTY[tier];
        const s = f.bodies()[other(fallen)] as Entity;
        s.hp = Math.round(s.maxHp * 0.5);
        const hp0 = s.hp;
        const weapon0 = { min: s.weapon.min, max: s.weapon.max };
        expect(f.sim.ctx.swingIntervalMult(s)).toBe(1);
        const flight = [...kill(f, fallen), ...f.tick(FLOW - 2)];
        // In flight: the stream is on its way, nothing has changed yet.
        expect(flight.some((e) => e.type === 'spellfx' && e.ability === COUNCIL_CUES.inherit)).toBe(
          true,
        );
        expect(healsOn(flight, s.id)).toEqual([]);
        expect(s.hp).toBe(hp0);
        expect(enragedAura(s)).toBeUndefined();
        expect({ min: s.weapon.min, max: s.weapon.max }).toEqual(weapon0);
        expect(f.st.grief?.landed).toBe(false);
        // It lands: the heal, the enrage, the cue and the log line.
        const landing = f.tick(2);
        const heal = griefHealAmount(s.maxHp, hp0, rules.griefHeal);
        expect(heal).toBe(Math.round(s.maxHp * rules.griefHeal));
        expect(healsOn(landing, s.id)).toEqual([heal]);
        expect(s.hp).toBe(hp0 + heal);
        const aura = enragedAura(s);
        expect(aura?.name).toBe('Enraged');
        expect(aura?.kind).toBe('buff_haste');
        expect(aura?.value).toBeCloseTo(1 + rules.enrageHaste, 9);
        expect(aura?.value2).toBe(rules.enrageDamage);
        expect(aura?.undispellable).toBe(true);
        expect({ min: s.weapon.min, max: s.weapon.max }).toEqual(
          enragedSwing(weapon0, rules.enrageDamage),
        );
        expect(f.sim.ctx.swingIntervalMult(s)).toBeCloseTo(1 / (1 + rules.enrageHaste), 9);
        expect(
          landing.some(
            (e) => e.type === 'spellfx' && e.ability === COUNCIL_CUES.grief && e.targetId === s.id,
          ),
        ).toBe(true);
        expect(
          landing.some((e) => e.type === 'log' && e.text === `${s.name} becomes enraged!`),
        ).toBe(true);
        // Its ordinary mechanics strike harder; the lethal punishments keep
        // their calibrated numbers.
        expect(damageMult(scope(f), s)).toBeCloseTo(rules.damageMult * (1 + rules.enrageDamage), 9);
        expect(punishMult(scope(f), s)).toBeCloseTo(rules.punishMult, 9);
        // The enrage holds for the rest of the pull.
        f.tick(20 * 10);
        expect(enragedAura(s)?.value).toBeCloseTo(1 + rules.enrageHaste, 9);
        expect({ min: s.weapon.min, max: s.weapon.max }).toEqual(
          enragedSwing(weapon0, rules.enrageDamage),
        );
      });
    }
  }

  it('the heal never runs past the pool', () => {
    expect(griefHealAmount(1000, 950, 0.2)).toBe(50);
    expect(griefHealAmount(1000, 1000, 0.3)).toBe(0);
    expect(griefHealAmount(1000, 100, 0.25)).toBe(250);
  });

  it('a survivor killed before the stream lands is never healed nor enraged', () => {
    const f = pulled('normal');
    const s = f.bodies().singer as Entity;
    const ev = [...kill(f, 'guardian'), ...f.tick(FLOW - 6)];
    ev.push(...kill(f, 'singer'), ...f.tick(FLOW));
    expect(healsOn(ev, s.id)).toEqual([]);
    expect(ev.some((e) => e.type === 'spellfx' && e.ability === COUNCIL_CUES.grief)).toBe(false);
    expect(f.state()?.finished).toBe(true);
    expect(f.state()?.grief).toBeUndefined();
  });

  it('both falling on the same tick leaves nothing to grieve', () => {
    const f = pulled('heroic');
    const b = f.bodies();
    f.sim.ctx.handleDeath(b.guardian as Entity, f.players[0]);
    f.sim.ctx.handleDeath(b.singer as Entity, f.players[0]);
    const ev = f.tick(FLOW + 4);
    expect(healsOn(ev, (b.guardian as Entity).id)).toEqual([]);
    expect(healsOn(ev, (b.singer as Entity).id)).toEqual([]);
    expect(ev.some((e) => e.type === 'spellfx' && e.ability === COUNCIL_CUES.grief)).toBe(false);
    expect(f.state()?.finished).toBe(true);
  });

  it('a pull that begins with one already down enrages the survivor on its first tick', () => {
    const f = councilFight(6);
    // Out of the fight and home (the helper's raid pulls it as it stands up),
    // then the Singer killed before anyone pulls again.
    f.dev('/dev heart council reset');
    expect(f.state()).toBeNull();
    f.sim.ctx.handleDeath(f.bodies().singer as Entity, f.players[0]);
    f.dev('/dev heart council pull');
    const ev = f.tick();
    const g = f.bodies().guardian as Entity;
    expect(f.state()?.fallen).toEqual(['singer']);
    expect(enragedAura(g)?.value).toBeCloseTo(1 + COUNCIL_DIFFICULTY.normal.enrageHaste, 9);
    // Already whole: nothing to heal.
    expect(healsOn(ev, g.id)).toEqual([]);
  });
});

describe("Grief of the Stone: the survivor takes up one more of the fallen one's moves", () => {
  for (const tier of TIERS) {
    it(`${tier}: the enraged Guardian hurls the Singer's Falling Rock`, () => {
      const f = pulled(tier);
      const g = f.bodies().guardian as Entity;
      kill(f, 'singer');
      // Before her strength lands only mythic's rock outlives her.
      expect(rockCaster(scope(f))).toBe(tier === 'mythic' ? 'guardian' : null);
      f.tick(FLOW);
      expect(rockCaster(scope(f))).toBe('guardian');
      if (tier === 'mythic') return;
      // Its first a beat after the grief, then on the rock's own cadence.
      expect(f.st.rockTimer).toBeLessThanOrEqual(T.griefRockFirst);
      expect(f.st.rockTimer).toBeGreaterThan(T.griefRockFirst - 0.5);
      let cast = false;
      for (let i = 0; i < 20 * (T.griefRockFirst + T.floorGap + 2) && !cast; i++) {
        f.tick();
        cast = g.castingAbility === COUNCIL_CASTS.rock;
      }
      expect(cast).toBe(true);
      f.tick(Math.ceil(T.rockCast * 20) + 2);
      const marked = f.players.find((p) => p.auras.some((a) => a.id === COUNCIL_AURAS.rockMark));
      expect(marked).toBeDefined();
      expect(f.st.rockTimer).toBeGreaterThan(T.rockEvery - T.rockCast - 1);
    });

    it(`${tier}: the enraged Singer brings down Hammer's Weight on her tank`, () => {
      const f = pulled(tier);
      const c = f.bodies().singer as Entity;
      kill(f, 'guardian');
      // Before his strength lands it died with him.
      expect(weightCaster(scope(f))).toBeNull();
      f.dev('/dev heart council weight');
      expect(c.castingAbility).not.toBe(COUNCIL_CASTS.weight);
      f.tick(FLOW);
      expect(weightCaster(scope(f))).toBe('singer');
      expect(f.st.weightTimer).toBeLessThanOrEqual(T.griefWeightFirst);
      let cast = false;
      for (let i = 0; i < 20 * (T.griefWeightFirst + 2) && !cast; i++) {
        f.tick();
        cast = c.castingAbility === COUNCIL_CASTS.weight;
      }
      expect(cast).toBe(true);
      const tank = f.sim.ctx.entities.get(c.castTargetId as number) as Entity;
      expect(f.players).toContain(tank);
      // The tank within her reach as the bar lands: it wears her Weight.
      const at = f.local(c);
      f.put(tank, at.x + 2, at.z);
      f.tick(Math.ceil(T.weightCast * 20) + 2);
      const weight = tank.auras.find((a) => a.id === COUNCIL_AURAS.weight);
      expect(weight?.sourceId).toBe(c.id);
      expect(f.st.weightTimer).toBeGreaterThan(T.weightEvery - T.weightCast - 1);
    });
  }
});

describe('Grief of the Stone: what ends it', () => {
  for (const tier of ['normal', 'heroic'] as const) {
    it(`${tier}: a wipe lifts the enrage and gives the survivor its own swing back`, () => {
      const f = councilFight(2);
      const g = f.bodies().guardian as Entity;
      if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
      f.dev('/dev heart council pull');
      f.tick();
      const st = f.state() as CouncilFightState;
      quiet(st);
      // The swing it had before the pull's tier raise (tier_swing.ts).
      const template = st.baseSwings?.guardian ?? { min: g.weapon.min, max: g.weapon.max };
      kill(f, 'singer');
      f.tick(FLOW);
      expect(enragedAura(g)).toBeDefined();
      expect(g.weapon.max).toBeGreaterThan(template.max);
      for (const p of f.players) f.sim.ctx.handleDeath(p, null);
      for (let i = 0; i < 20 * 60 && f.state(); i++) f.sim.tick();
      expect(f.state()).toBeNull();
      expect(enragedAura(g)).toBeUndefined();
      expect({ min: g.weapon.min, max: g.weapon.max }).toEqual(template);
    });
  }

  it('the kill gives the survivor its own swing back too', () => {
    const f = pulled('normal');
    const c = f.bodies().singer as Entity;
    kill(f, 'guardian');
    const before = { min: c.weapon.min, max: c.weapon.max };
    f.tick(FLOW);
    expect(c.weapon.max).toBeGreaterThan(before.max);
    kill(f, 'singer');
    expect(f.state()?.finished).toBe(true);
    expect({ min: c.weapon.min, max: c.weapon.max }).toEqual(before);
    expect(enragedAura(c)).toBeUndefined();
  });

  it('a tier switch mid-fight takes the new row', () => {
    const f = pulled('normal');
    const g = f.bodies().guardian as Entity;
    kill(f, 'singer');
    f.tick(FLOW);
    const base = f.st.grief?.baseSwing;
    expect(base).toBeDefined();
    f.dev('/dev heart council heroic on');
    f.tick();
    const h = COUNCIL_DIFFICULTY.heroic;
    expect(enragedAura(g)?.value).toBeCloseTo(1 + h.enrageHaste, 9);
    expect(enragedAura(g)?.value2).toBe(h.enrageDamage);
    expect({ min: g.weapon.min, max: g.weapon.max }).toEqual(
      enragedSwing(base as { min: number; max: number }, h.enrageDamage),
    );
  });
});

describe('Grief of the Stone: the tooltip and the tiers', () => {
  it('each tier is stronger than the last, and carries its own damage share', () => {
    const rows = TIERS.map((tier) => COUNCIL_DIFFICULTY[tier]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].griefHeal).toBeGreaterThan(rows[i - 1].griefHeal);
      expect(rows[i].enrageHaste).toBeGreaterThan(rows[i - 1].enrageHaste);
      expect(rows[i].enrageDamage).toBeGreaterThan(rows[i - 1].enrageDamage);
    }
    // The tooltip reads the tier (and its heal) off the aura's damage share.
    expect(new Set(rows.map((r) => r.enrageDamage)).size).toBe(rows.length);
  });

  for (const tier of TIERS) {
    it(`${tier}: the Enraged tooltip names the heal, the haste and the damage the fight uses`, () => {
      const r = COUNCIL_DIFFICULTY[tier];
      const d = auraEffectDescriptor({
        id: COUNCIL_AURAS.enraged,
        kind: 'buff_haste',
        value: 1 + r.enrageHaste,
        value2: r.enrageDamage,
      });
      expect(d?.key).toBe('hudChrome.auraEffect.council.enraged');
      const text = t(d?.key as never, d?.nums as never);
      expect(text).toContain(
        `healed this one for ${Math.round(r.griefHeal * 100)}% of its maximum health`,
      );
      expect(text).toContain(`attacks ${Math.round(r.enrageHaste * 100)}% faster`);
      expect(text).toContain(`deal ${Math.round(r.enrageDamage * 100)}% more damage`);
      expect(text).toContain("except Mountain's Wrath, Falling Rock and Rockfall Tremor");
    });
  }
});

describe('Grief of the Stone: determinism', () => {
  it('the same pull plays out the same', () => {
    const run = () => {
      const f = councilFight(6, 29);
      f.dev('/dev heart council heroic on');
      f.dev('/dev heart council pull');
      f.tick(20 * 8);
      const c = f.bodies().singer as Entity;
      c.hp = Math.round(c.maxHp * 0.4);
      const ev = [...kill(f, 'guardian'), ...f.tick(20 * 25)];
      const dealt: Record<string, number> = {};
      for (const e of ev) {
        if (e.type !== 'damage') continue;
        const k = String((e as { ability?: string | null }).ability ?? 'swing');
        dealt[k] = (dealt[k] ?? 0) + e.amount;
      }
      return {
        hp: c.hp,
        weapon: { ...c.weapon },
        aura: enragedAura(c)?.value,
        heals: healsOn(ev, c.id),
        dealt,
      };
    };
    expect(run()).toEqual(run());
  });
});
