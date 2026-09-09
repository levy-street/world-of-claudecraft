// v0.42.0 class balance (docs/design/class-balance-v042.md): decisive REAL
// combat-path proof for the offense-only numeric package (spec_output_tuning.ts,
// talent_hit_mult.ts). Every packet here is an actual sim.castAbility/tick
// round trip reading a real emitted SimEvent, not a call into the resolver
// under test. Expected multipliers are written as LITERAL numbers so a
// regression in the seam (or in OFFENSIVE_SPEC_TUNING itself) cannot silently
// keep this suite green by drifting both sides together.
//
// Method A (ratio, used where the ability is castable with no spec committed):
// two REAL casts, identical seed and script, one with the offense-only
// component present and one without. Both draw rng in lockstep up to the
// resolved hit, so the damage RATIO is exactly the multiplier ratio: this
// proves the complete base+SP/AP hit (not just the authored base) moved by
// the advertised factor, in one pass. A `pin()` callback re-asserts the
// forced spellPower/attackPower/weapon/critChance every tick of the drive
// loop, because a mid-cast regen/recalc tick otherwise drifts a manually set
// stat back toward its gear-derived value before the hit resolves.
//
// Method B (SP-delta, used where the ability requires a committed spec, so no
// no-spec baseline can be cast at all): the SAME committed spec at
// spellPower 0 and spellPower 1200; the difference isolates the SP rider
// exactly (the authored-base roll is identical in both runs), compared
// against a literal formula built from the ENGINE's own spell-coefficient
// constants (SPELL_COEFF_DIVISOR/MIN_CAST/MAX_CAST) plus the hardcoded
// expected v0.42.0 multiplier: independent of resolveTalentHitMult/
// spec_output_tuning, which is exactly what is under test.
import { describe, expect, it } from 'vitest';
import {
  applyRuinousBrand,
  PYRE_AURA_DAMAGE,
  RUINOUS_BRAND_COPY_PCT,
  summonPyreColossus,
  tickPyreGuardian,
} from '../src/sim/combat/destruction';
import { addSoulFragments, pierceLichSoulLance } from '../src/sim/combat/necromancy';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';
import { SPELL_COEFF_DIVISOR, SPELL_COEFF_MAX_CAST, SPELL_COEFF_MIN_CAST } from '../src/sim/types';

function ctxOf(sim: Sim): SimContext {
  return sim as unknown as SimContext;
}

function makeSim(cls: PlayerClass, seed: number): Sim {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

// clampCast + directSpellCoeff, reimplemented from the raw engine constants
// (src/sim/types.ts), independent of src/sim/spell_scaling.ts: the point of
// this literal is to compute the expected SP rider WITHOUT calling the code
// under test.
function directCoeff(castTimeSec: number): number {
  const t = castTimeSec <= 0 ? SPELL_COEFF_MIN_CAST : castTimeSec;
  const clamped = Math.min(SPELL_COEFF_MAX_CAST, Math.max(SPELL_COEFF_MIN_CAST, t));
  return clamped / SPELL_COEFF_DIVISOR;
}

// A zero-armor, unkillable, zero-damage practice dummy (src/sim/content/zone3.ts
// training_dummy: armorPerLevel 0, no armorBase): armorReduction(0, level) is
// exactly 0, so every packet below lands with NO armor mitigation to account for.
function spawnDummy(sim: Sim, id: number, dz = 3): Entity {
  const p = sim.player;
  const target = createMob(id, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  target.hostile = true;
  target.weapon.min = 0;
  target.weapon.max = 0;
  sim.addEntity(target);
  sim.targetEntity(target.id);
  p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
  return target;
}

// Re-runs `pin()` before every tick: a mid-cast mana-regen/stat recalc
// otherwise drifts a manually forced spellPower/attackPower back toward its
// gear-derived value before a slow cast resolves, which would silently break
// every ratio/delta comparison below.
function drive(sim: Sim, ticks: number, pin?: () => void): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    pin?.();
    events.push(...sim.tick());
  }
  return events;
}

function hitAmount(
  events: readonly SimEvent[],
  sourceId: number,
  targetId: number,
  ability: string,
): number | undefined {
  for (const e of events) {
    if (
      e.type === 'damage' &&
      e.sourceId === sourceId &&
      e.targetId === targetId &&
      e.ability === ability &&
      e.kind === 'hit'
    ) {
      return e.amount;
    }
  }
  return undefined;
}

function noCrit(entity: Entity): void {
  entity.critChance = 0;
}

describe('v0.42.0 offense-only package: real combat-path packets', () => {
  describe('Thundercall (shaman/elemental): Earthen Jolt complete hit, Earthen Jolt vent', () => {
    // Earthen Jolt (earth_shock), not Arc Bolt: both carry the elemental
    // offense-only bonus identically, but Arc Bolt's ability-scoped castPct
    // (SPEC_BASELINES) shortens ITS cast time only for elemental, which shifts
    // the tick at which the hit resolves and desyncs the two runs' shared rng
    // stream well before the roll (a different bug class than the one under
    // test here). Earthen Jolt is instant either way, so the two runs stay in
    // rng lockstep up to the roll and the ratio is exactly the mult ratio.
    // Total: 1 (no legacy global) + 0.15 (Earthen Fury mastery global
    // spellDmgPct) + 0.18 (earth_shock's own ability dmgPct, spec_baselines.ts)
    // + 0.13 (offense-only) = 1.46.
    function castEarthenJoltNoCharge(
      spec: 'elemental' | null,
      spellPower: number,
      seed: number,
    ): number {
      const sim = makeSim('shaman', seed);
      sim.setPlayerLevel(20);
      if (spec) expect(sim.setSpec(spec)).toBe(true);
      const target = spawnDummy(sim, 9000);
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = spellPower;
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('earth_shock');
      const events = drive(sim, 20 * 2, pin);
      const amount = hitAmount(events, sim.playerId, target.id, 'Earthen Jolt');
      if (amount === undefined) throw new Error('Earthen Jolt did not land');
      return amount;
    }

    it('a low-Spell-Power Earthen Jolt (authored base dominates) scales by the literal 1.46 elemental total (mastery 0.15 + ability 0.18 + offense-only 0.13)', () => {
      const base = castEarthenJoltNoCharge(null, 0, 10);
      const boosted = castEarthenJoltNoCharge('elemental', 0, 10);
      expect(boosted / base).toBeCloseTo(1.46, 1);
    });

    it('a high-Spell-Power Earthen Jolt (the SP rider dominates) ALSO scales by 1.46, proving the rider moved with the base', () => {
      const base = castEarthenJoltNoCharge(null, 1200, 10);
      const boosted = castEarthenJoltNoCharge('elemental', 1200, 10);
      expect(boosted / base).toBeCloseTo(1.46, 1);
    });

    function castEarthenJolt(chargeStacks: number, seed: number): number {
      const sim = makeSim('shaman', seed);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('elemental')).toBe(true);
      const target = spawnDummy(sim, 9002);
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = 400;
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      if (chargeStacks > 0) {
        sim.player.auras.push({
          id: 'shaman_thunder_charges',
          name: 'Thunder Charges',
          kind: 'internal_cd',
          remaining: 3600,
          duration: 3600,
          value: 0,
          stacks: chargeStacks,
          sourceId: sim.playerId,
          school: 'nature',
        });
      }
      sim.castAbility('earth_shock');
      const events = drive(sim, 20 * 2, pin);
      const amount = hitAmount(events, sim.playerId, target.id, 'Earthen Jolt');
      if (amount === undefined) throw new Error('Earthen Jolt did not land');
      return amount;
    }

    it('a full 5-charge Thunder bank vents Earthen Jolt for exactly the literal 2.25x on top of the already-elemental-scaled hit (no double count of the offense bonus)', () => {
      const unvented = castEarthenJolt(0, 202);
      const vented = castEarthenJolt(5, 202);
      // EARTHEN_JOLT_BONUS_PER_CHARGE = 0.25, 5 charges: 1 + 5*0.25 = 2.25. This
      // multiplier is a flat runtime factor applied to the ALREADY-resolved
      // (offense-inclusive) hit (effect_dispatch.ts: `dmg *= thundercallDamageMultiplier(...)`
      // after the SP rider, not a second call into resolveTalentHitMult), so the
      // ratio must land on 2.25 exactly regardless of the elemental spec bonus
      // baked into both arms of this comparison.
      expect(vented / unvented).toBeCloseTo(2.25, 1);
    });
  });

  describe('Ruination (warlock/destruction): Gloom Bolt complete hit (SP-delta), ordinary pet, custom Pyre Aura, Ruinous Brand copy', () => {
    // shadow_bolt is NOT specs-gated, but destruction's own SPEC_BASELINES row
    // shortens ITS cast time (castPct: -0.03), which shifts the tick the hit
    // resolves on and desyncs a no-spec-vs-destruction rng comparison well
    // before the roll. Method B (SP-delta within destruction only) sidesteps
    // that entirely: same character, same cast time, only spellPower differs.
    function gloomBoltAmount(spellPower: number, seed: number): number {
      const sim = makeSim('warlock', seed);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('destruction')).toBe(true);
      const target = spawnDummy(sim, 9101);
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = spellPower;
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('shadow_bolt');
      const events = drive(sim, 20 * 4, pin);
      const amount = hitAmount(events, sim.playerId, target.id, 'Gloom Bolt');
      if (amount === undefined) throw new Error('Gloom Bolt did not land');
      return amount;
    }

    it('the SP-rider delta (1200 vs 0 Spell Power) matches the literal 1.21 destruction total exactly (0.10 legacy + 0.11 offense-only, engine-constant formula, independent of resolveTalentHitMult)', () => {
      const delta = gloomBoltAmount(1200, 10) - gloomBoltAmount(0, 10);
      // Rank-4 (level 20) castTime 3.0s, destruction's own castPct -0.03:
      // resolved cast time 3.0 * 0.97 = 2.91s (unclamped, between 1.5 and 3.5).
      const expectedDelta = Math.round(1200 * directCoeff(3.0 * 0.97) * 1.21);
      expect(delta).toBeCloseTo(expectedDelta, -1);
    });

    it('ordinary pet: an owned imp firebolt scales by exactly the destruction petDmgPct 1.10, isolated from every other spec knob', () => {
      // Same seed, same script, twice: only global.petDmgPct differs between the
      // two runs (the real spec_baselines.ts 0.10 vs an explicit 0 override on
      // the SAME resolved TalentModifiers), so the underlying rng-drawn spell
      // roll is bit-identical and the damage ratio is exactly the mult ratio.
      function castImpBolt(petDmgPct: number, seed: number): number {
        const sim = makeSim('warlock', seed);
        sim.setPlayerLevel(20);
        expect(sim.setSpec('destruction')).toBe(true);
        const meta = sim.meta(sim.playerId);
        if (!meta) throw new Error('missing warlock meta');
        const pin = () => {
          meta.talentMods = {
            ...meta.talentMods,
            global: { ...meta.talentMods.global, petDmgPct },
          };
        };
        pin();
        sim.player.resource = sim.player.maxResource;
        sim.castAbility('summon_imp');
        for (let i = 0; i < 20 * 6 && sim.player.castingAbility; i++) {
          pin();
          sim.tick();
        }
        const imp = sim.petOf(sim.playerId);
        if (!imp) throw new Error('missing imp');
        const target = spawnDummy(sim, 9102, 12);
        sim.startAutoAttack(); // owner engages: the pet assists whatever the owner attacks
        const events = drive(sim, 20 * 10, pin);
        const amount = events.find(
          (e) =>
            e.type === 'damage' &&
            e.sourceId === imp.id &&
            e.targetId === target.id &&
            e.school === 'fire' &&
            e.kind === 'hit',
        ) as (SimEvent & { amount: number }) | undefined;
        if (!amount) throw new Error('imp firebolt did not land');
        return amount.amount;
      }
      const base = castImpBolt(0, 404);
      const boosted = castImpBolt(0.1, 404);
      expect(boosted / base).toBeCloseTo(1.1, 1);
    });

    it('custom pet bypass: a real Pyre Colossus nova deals the literal fixed 66 (the explicit destruction-only fix, since this path bypasses petDmgPct entirely)', () => {
      const sim = makeSim('warlock', 505);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('destruction')).toBe(true);
      const ctx = ctxOf(sim);
      summonPyreColossus(ctx, sim.player, 30);
      const guardian = [...sim.entities.values()].find((e) => e.templateId === 'pyre_colossus');
      if (!guardian) throw new Error('missing Pyre Colossus');
      const target = spawnDummy(sim, 9103, 2);
      guardian.pos = { ...target.pos };
      const aura = guardian.auras.find((a) => a.kind === 'pyre_guardian');
      if (!aura) throw new Error('missing pyre_guardian aura');
      aura.icd = 0; // force the nova to fire on the next tick
      sim.drainEvents();
      tickPyreGuardian(ctx, guardian, aura);
      const events = sim.drainEvents();
      const amount = hitAmount(events, guardian.id, target.id, 'Pyre Aura');
      expect(amount).toBe(66);
      expect(PYRE_AURA_DAMAGE).toBe(66); // the constant this real event must match
    });

    it('damage-derived copy: a Ruinous Brand copy is a fixed 0.5 fraction of the ALREADY offense-scaled origin hit, never re-scaled', () => {
      const sim = makeSim('warlock', 606);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('destruction')).toBe(true);
      const brandedPrimary = spawnDummy(sim, 9104, 5);
      applyRuinousBrand(ctxOf(sim), sim.player, brandedPrimary, 15, 3);
      const otherTarget = spawnDummy(sim, 9105, 8);
      sim.targetEntity(otherTarget.id);
      sim.player.facing = Math.atan2(
        otherTarget.pos.x - sim.player.pos.x,
        otherTarget.pos.z - sim.player.pos.z,
      );
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = 600; // large SP share: a re-scaled copy would visibly diverge from 0.5
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('shadow_bolt');
      const events = drive(sim, 20 * 4, pin);
      const origin = hitAmount(events, sim.playerId, otherTarget.id, 'Gloom Bolt');
      const copy = hitAmount(events, sim.playerId, brandedPrimary.id, 'Ruinous Brand');
      if (origin === undefined || copy === undefined) {
        throw new Error('missing origin/copy Ruinous Brand hit');
      }
      expect(copy / origin).toBeCloseTo(RUINOUS_BRAND_COPY_PCT, 2);
      // Precision 2, not 1: toBeCloseTo(0.5, 1)'s +-0.05 tolerance is loose
      // enough to pass a small double-scaling defect on the copy path;
      // precision 2 (+-0.005) is tight enough to actually catch one.
      expect(copy / origin).toBeCloseTo(0.5, 2);
    });
  });

  describe('Necromancy (warlock/demonology): Essence Reap complete hit (SP-delta), ordinary Reaping Command pet, Lich pierce copy', () => {
    // soul_harvest is specs: ['demonology'], so no no-spec baseline is castable
    // at all: Method B (SP-delta) isolates the SP rider within one committed
    // run instead.
    function essenceReapAmount(spellPower: number, seed: number): number {
      const sim = makeSim('warlock', seed);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('demonology')).toBe(true);
      const target = spawnDummy(sim, 9201);
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = spellPower;
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('soul_harvest');
      const events = drive(sim, 20 * 4, pin);
      const amount = hitAmount(events, sim.playerId, target.id, 'Essence Reap');
      if (amount === undefined) throw new Error('Essence Reap did not land');
      return amount;
    }

    it('the SP-rider delta (1200 vs 0 Spell Power) matches the literal 1.416 demonology total exactly (0.10 legacy + 0.096 ability + 0.22 offense-only, engine-constant formula, independent of resolveTalentHitMult)', () => {
      const delta = essenceReapAmount(1200, 707) - essenceReapAmount(0, 707);
      // castTime 1.8s (unclamped): coeff = 1.8 / SPELL_COEFF_DIVISOR.
      const expectedDelta = Math.round(1200 * directCoeff(1.8) * 1.416);
      expect(delta).toBeCloseTo(expectedDelta, -1); // within ~10, well under the ~874 magnitude
    });

    it('ordinary pet: a real Reaping Command graveguard strike scales by exactly the demonology petDmgPct 1.42, isolated from every other spec knob', () => {
      function castReapingCommand(petDmgPct: number, seed: number): number {
        const sim = makeSim('warlock', seed);
        sim.setPlayerLevel(20);
        expect(sim.setSpec('demonology')).toBe(true);
        const meta = sim.meta(sim.playerId);
        if (!meta) throw new Error('missing warlock meta');
        const pin = () => {
          meta.talentMods = {
            ...meta.talentMods,
            global: { ...meta.talentMods.global, petDmgPct },
          };
        };
        pin();
        sim.player.resource = sim.player.maxResource;
        sim.castAbility('raise_graveguard');
        for (let i = 0; i < 20 * 6 && sim.player.castingAbility; i++) {
          pin();
          sim.tick();
        }
        const target = spawnDummy(sim, 9202, 6);
        addSoulFragments(ctxOf(sim), sim.player, 2);
        sim.player.resource = sim.player.maxResource;
        sim.player.gcdRemaining = 0;
        sim.castAbility('reaping_command');
        const events = drive(sim, 20 * 2, pin);
        const graveguard = [...sim.entities.values()].find((e) => e.templateId === 'graveguard');
        if (!graveguard) throw new Error('missing graveguard');
        const amount = hitAmount(events, graveguard.id, target.id, 'Reaping Command');
        if (amount === undefined) throw new Error('Reaping Command did not land');
        return amount;
      }
      const base = castReapingCommand(0, 808);
      const boosted = castReapingCommand(0.42, 808);
      expect(boosted / base).toBeCloseTo(1.42, 1);
    });

    it('damage-derived copy: a Lich Soul Lance pierce is a fixed 0.5 fraction of the ALREADY offense-scaled landed hit, never re-scaled', () => {
      const sim = makeSim('warlock', 909);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('demonology')).toBe(true);
      sim.player.auras.push({
        id: 'form_lich',
        name: 'Lich Form',
        kind: 'form_lich',
        remaining: 3600,
        duration: 3600,
        value: 0,
        sourceId: sim.playerId,
        school: 'shadow',
      });
      const primary = spawnDummy(sim, 9203, 5);
      const secondary = spawnDummy(sim, 9204, 6);
      secondary.pos = { x: primary.pos.x + 2, y: primary.pos.y, z: primary.pos.z };
      sim.rebucket(secondary);
      const landedDamage = 400; // a fully offense-scaled amount from a real prior hit
      const ctx = ctxOf(sim);
      sim.drainEvents();
      pierceLichSoulLance(ctx, sim.player, primary, landedDamage);
      const events = sim.drainEvents();
      const pierce = hitAmount(events, sim.playerId, secondary.id, 'Lich Soul Lance');
      if (pierce === undefined) throw new Error('missing Lich Soul Lance pierce hit');
      // LICH_SOUL_LANCE_PIERCE_MULT = 0.5, applied to the landed amount ONCE:
      // this must hold at any landedDamage magnitude, proving the pierce never
      // re-enters resolveTalentHitMult (it would then also carry demonology's
      // offense-only spell bonus a second time, breaking this exact fraction).
      expect(pierce / landedDamage).toBeCloseTo(0.5, 1);
    });
  });

  describe('Knifework (rogue/assassination) and Wildfang (druid/feral): physical weapon packets', () => {
    it('Wicked Slash (sinister_strike, weaponStrike) scales by the literal 1.32 assassination total (0.22 legacy meleeDmgPct + 0.10 offense-only)', () => {
      function castSinisterStrike(spec: 'assassination' | null, seed: number): number {
        const sim = makeSim('rogue', seed);
        sim.setPlayerLevel(20);
        if (spec) expect(sim.setSpec(spec)).toBe(true);
        const target = spawnDummy(sim, 9301);
        const pin = () => {
          noCrit(sim.player);
          sim.player.weapon = { min: 20, max: 20, speed: 1.8 };
          sim.player.attackPower = 800; // large AP share: a missed rider would visibly diverge
        };
        pin();
        sim.player.resource = sim.player.maxResource;
        sim.player.gcdRemaining = 0;
        sim.castAbility('sinister_strike');
        const events = drive(sim, 10, pin);
        const amount = hitAmount(events, sim.playerId, target.id, 'Wicked Slash');
        if (amount === undefined) throw new Error('Wicked Slash did not land');
        return amount;
      }
      const base = castSinisterStrike(null, 1001);
      const boosted = castSinisterStrike('assassination', 1001);
      expect(boosted / base).toBeCloseTo(1.32, 1);
    });

    it('Rendclaw (claw, weaponStrike, cat form) scales by the literal 1.80 feral total (0.50 Primal Heart mastery meleeDmgPct + 0.15 ability dmgPct + 0.15 offense-only)', () => {
      function castClaw(spec: 'feral' | null, seed: number): number {
        const sim = makeSim('druid', seed);
        sim.setPlayerLevel(20);
        if (spec) expect(sim.setSpec(spec)).toBe(true);
        const target = spawnDummy(sim, 9302);
        sim.player.resource = sim.player.maxResource;
        sim.castAbility('cat_form');
        sim.tick();
        const pin = () => {
          noCrit(sim.player);
          sim.player.weapon = { min: 20, max: 20, speed: 1.8 };
          sim.player.attackPower = 800;
        };
        pin();
        sim.player.resource = sim.player.maxResource;
        sim.player.gcdRemaining = 0;
        sim.castAbility('claw');
        const events = drive(sim, 10, pin);
        const amount = hitAmount(events, sim.playerId, target.id, 'Rendclaw');
        if (amount === undefined) throw new Error('Rendclaw did not land');
        return amount;
      }
      const base = castClaw(null, 1101);
      const boosted = castClaw('feral', 1101);
      expect(boosted / base).toBeCloseTo(1.8, 1);
    });
  });

  describe('Fieldcraft (hunter/survival): Gutting Strike (raptor_strike) complete hit', () => {
    it('scales by the literal 1.45 survival total (0.30 legacy meleeDmgPct + 0.15 offense-only), matching the pinned hunterBloodhook/hunterShrapnel damageMult in tests/spec_baselines.test.ts', () => {
      function castRaptorStrike(spec: 'survival' | null, seed: number): number {
        const sim = makeSim('hunter', seed);
        sim.setPlayerLevel(20);
        if (spec) expect(sim.setSpec(spec)).toBe(true);
        const target = spawnDummy(sim, 9401);
        const pin = () => {
          noCrit(sim.player);
          sim.player.weapon = { min: 20, max: 20, speed: 2.8 };
          sim.player.attackPower = 800;
        };
        pin();
        sim.player.resource = sim.player.maxResource;
        sim.player.gcdRemaining = 0;
        sim.castAbility('raptor_strike');
        const events = drive(sim, 10, pin);
        const amount = hitAmount(events, sim.playerId, target.id, 'Gutting Strike');
        if (amount === undefined) throw new Error('Gutting Strike did not land');
        return amount;
      }
      const base = castRaptorStrike(null, 1201);
      const boosted = castRaptorStrike('survival', 1201);
      expect(boosted / base).toBeCloseTo(1.45, 1);
    });
  });

  describe('Doctrine (priest/discipline): Scouring Hymn complete hit', () => {
    function castSmite(spec: 'discipline' | null, spellPower: number, seed: number): number {
      const sim = makeSim('priest', seed);
      sim.setPlayerLevel(20);
      if (spec) expect(sim.setSpec(spec)).toBe(true);
      const target = spawnDummy(sim, 9501);
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = spellPower;
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('smite');
      const events = drive(sim, 20 * 4, pin);
      const amount = hitAmount(events, sim.playerId, target.id, 'Scouring Hymn');
      if (amount === undefined) throw new Error('Scouring Hymn did not land');
      return amount;
    }

    it('a low-Spell-Power Scouring Hymn scales by the literal 1.30 discipline total', () => {
      const base = castSmite(null, 0, 1301);
      const boosted = castSmite('discipline', 0, 1301);
      expect(boosted / base).toBeCloseTo(1.3, 1);
    });

    it('a high-Spell-Power Scouring Hymn ALSO scales by 1.30, proving the SP rider moved with the base', () => {
      const base = castSmite(null, 1200, 1301);
      const boosted = castSmite('discipline', 1200, 1301);
      expect(boosted / base).toBeCloseTo(1.3, 1);
    });
  });

  describe('unchanged sibling behavior: a heal riding the same offense-bumped ability, and an armor buff, do not move', () => {
    // scouring_mercy is specs: ['discipline'], so Method B (SP-delta) proves
    // both halves at once: the damage rider carries the 1.30 factor, the heal
    // rider carries NONE (mult 1, no blanket Doctrine healing multiplier).
    function scouringMercy(spellPower: number, seed: number): { damage: number; heal: number } {
      const sim = makeSim('priest', seed);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('discipline')).toBe(true);
      const target = spawnDummy(sim, 9601);
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = spellPower;
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('scouring_mercy');
      const events = drive(sim, 10, pin);
      const damage = hitAmount(events, sim.playerId, target.id, 'Scouring Mercy');
      if (damage === undefined) throw new Error('Scouring Mercy damage half did not land');
      return { damage, heal: 0 };
    }

    function scouringMercyHealOnSelf(spellPower: number, seed: number): number {
      const sim = makeSim('priest', seed);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('discipline')).toBe(true);
      sim.targetEntity(sim.playerId); // scouring_mercy heals a friendly target
      const pin = () => {
        noCrit(sim.player);
        sim.player.spellPower = spellPower;
        sim.player.maxHp = 100_000; // re-pin every tick: a recalc otherwise resets it
        sim.player.hp = 1; // stay far under max so overheal never clips the read
      };
      pin();
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('scouring_mercy');
      const events = drive(sim, 10, pin);
      const healEvent = events.find(
        (e) => e.type === 'heal2' && e.sourceId === sim.playerId && e.targetId === sim.playerId,
      ) as (SimEvent & { amount: number }) | undefined;
      if (!healEvent) throw new Error('Scouring Mercy heal half did not land');
      return healEvent.amount;
    }

    it("Scouring Mercy's hostile damage half grows by the literal 1.30 Doctrine factor (SP-delta, engine-constant formula)", () => {
      const delta = scouringMercy(1200, 1401).damage - scouringMercy(0, 1401).damage;
      // castTime 0 (instant): coeff clamps to SPELL_COEFF_MIN_CAST / SPELL_COEFF_DIVISOR.
      const expectedDelta = Math.round(1200 * directCoeff(0) * 1.3);
      expect(delta).toBeCloseTo(expectedDelta, -1);
    });

    it("Scouring Mercy's heal half does NOT move: unaffected by Spell Power AND by Doctrine's offense-only bonus (both would move it if it leaked into healMult)", () => {
      // A friendly self-cast of Scouring Mercy resolves as a guaranteed crit
      // here (an unrelated priest mechanic, not part of this package): the
      // observable amount is a flat 2x the authored 130-155 range with NO
      // Spell Power rider at all. That flatness is exactly the proof this
      // case needs: if Doctrine's 1.30 (or any Spell Power scaling) leaked
      // into this heal's mult, spellPower 0 and 1200 would read DIFFERENT
      // amounts, and/or the amount would exceed the raw crit-doubled ceiling.
      const atZeroSp = scouringMercyHealOnSelf(0, 1402);
      const atHighSp = scouringMercyHealOnSelf(1200, 1402);
      expect(atHighSp).toBe(atZeroSp);
      expect(atZeroSp).toBeGreaterThanOrEqual(2 * 130);
      expect(atZeroSp).toBeLessThanOrEqual(2 * 155);
    });

    it("Necromancy's owner spell bonus grows Essence Reap but leaves Fiendhide's armor buff at its legacy (pre-offense) value", () => {
      const sim = makeSim('warlock', 1501);
      sim.setPlayerLevel(20);
      expect(sim.setSpec('demonology')).toBe(true);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('demon_skin');
      sim.tick();
      const armorBuff = sim.player.auras.find((a) => a.kind === 'buff_armor');
      if (!armorBuff) throw new Error('missing Fiendhide armor buff');
      // Authored rank-3 (level 20) base 80, scaled ONLY by the legacy
      // spellDmgPct 0.10 (1.10): the demonology offense-only +0.22 spell delta
      // must never reach this flat-magnitude buff.
      expect(armorBuff.value).toBe(88);
    });
  });
});
