// Issue #1803: a mastery/talent damage/heal percent (global meleeDmgPct/
// spellDmgPct/healPct/dotDmgPct/hotHealPct/absorbPct, or a per-ability dmgPct
// like Frost's +25%) must scale the WHOLE hit (authored base plus the runtime
// weapon/AP/SP rider), not just the authored base. Before the fix, scaleEffect
// (src/sim/content/classes.ts) baked the percent into an ability's base min/
// max/total at precompute time, and the SP/AP/weapon rider was added afterward
// at the damage/heal site (spell_scaling.ts riders, meleeSwing) with no
// multiplier applied at all, so the advertised percentage under-delivered and
// the shortfall grew with gear (more SP/AP meant a larger un-multiplied share
// of the hit).
//
// These tests exercise the fix two ways:
//  - a pure math check (directDamage) proving the resolved rider now scales by
//    the same multiplier as the base, matching the "Frost ability-scoped
//    mastery" example from the issue body;
//  - real Sim end-to-end casts for DoT, HoT, and absorb (all rng-free: none of
//    these effect kinds roll a crit or a hit-table on application, only a
//    deterministic snapshot), proving classes.ts's precompute bake and
//    effect_dispatch.ts's runtime rider now agree end to end.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  accumulateTalentEffect,
  emptyModifiers,
  type TalentModifiers,
} from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { directHealBonus, directHitBonus } from '../src/sim/spell_scaling';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { AbilityEffect, Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function directDamageEffect(effects: AbilityEffect[]) {
  const found = effects.find((e) => e.type === 'directDamage');
  if (found?.type !== 'directDamage') throw new Error('missing directDamage effect');
  return found;
}

function chainDamageEffect(effects: AbilityEffect[]) {
  const found = effects.find((e) => e.type === 'chainDamage');
  if (found?.type !== 'chainDamage') throw new Error('missing chainDamage effect');
  return found;
}

function metaOf(sim: Sim, pid = sim.playerId) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error('missing player meta');
  return meta;
}

// Installs a synthetic TalentModifiers on a fresh Sim's single player, driving
// BOTH the precompute bake (meta.known, via abilitiesKnownAt, same as a real
// respec) and the runtime rider (meta.talentMods, read by ctx.playerMods in
// effect_dispatch.ts) from the SAME object, exactly like a real talent spend.
function installMods(sim: Sim, mods: TalentModifiers): void {
  const meta = metaOf(sim);
  meta.talentMods = mods;
  meta.known = abilitiesKnownAt(meta.cls, 20, mods) as typeof meta.known;
}

function addTargetDummy(sim: Sim, id: number): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 3,
  });
  target.hostile = true;
  target.maxHp = target.hp = 1_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(target);
  sim.targetEntity(target.id);
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
  return target;
}

describe('mastery/talent damage percent scales the whole hit, not just the base (#1803)', () => {
  it('a directDamage ability with an ability-scoped +25% (the Frost mastery shape) scales base AND the Spell Power rider by the same 1.25', () => {
    const dmgPct = 0.25;
    const baseline = emptyModifiers();
    const boosted = emptyModifiers();
    accumulateTalentEffect(boosted, { ability: [{ ability: 'frostbolt', dmgPct }] });

    const baseAbility = abilitiesKnownAt('mage', 20, baseline).find(
      (a) => a.def.id === 'frostbolt',
    );
    const boostedAbility = abilitiesKnownAt('mage', 20, boosted).find(
      (a) => a.def.id === 'frostbolt',
    );
    if (!baseAbility || !boostedAbility) throw new Error('missing frostbolt');
    const baseEff = directDamageEffect(baseAbility.effects);
    const boostedEff = directDamageEffect(boostedAbility.effects);

    // The authored base already scaled before this fix (unchanged behavior).
    expect(boostedEff.min).toBe(Math.round(baseEff.min * (1 + dmgPct)));

    // Large relative to the authored base, so an un-multiplied rider would
    // visibly under-deliver the advertised 25% (the exact shortfall #1803
    // reports growing with gear).
    const spellPower = 900;
    const castTime = boostedAbility.castTime;
    const { dmgMult } = resolveTalentHitMult(boostedAbility.def, boosted);
    expect(dmgMult).toBeCloseTo(1 + dmgPct, 10);

    const baselineRider = directHitBonus(spellPower, baseAbility.def, castTime);
    const fixedRider = directHitBonus(spellPower, boostedAbility.def, castTime, false, dmgMult);
    const unfixedRider = directHitBonus(spellPower, boostedAbility.def, castTime); // mult defaults to 1

    const baselineHit = baseEff.min + baselineRider;
    const fixedHit = boostedEff.min + fixedRider;
    const unfixedHit = boostedEff.min + unfixedRider;

    // The fix: the whole hit (base + SP) now carries the advertised 25%.
    expect(fixedHit / baselineHit).toBeCloseTo(1 + dmgPct, 2);
    // The bug this reproduces: leaving the rider unscaled falls short of 1.25
    // once SP is a meaningful share of the hit.
    expect(unfixedHit / baselineHit).toBeLessThan(1 + dmgPct);
  });

  it('a DoT (Corruption) with a +40% ability-scoped talent applies the full 40% to base + Spell Power together, at both low and high Spell Power', () => {
    const dmgPct = 0.4;
    const boosted = emptyModifiers();
    accumulateTalentEffect(boosted, { ability: [{ ability: 'corruption', dmgPct }] });
    const baseline = emptyModifiers();

    const tickValue = (mods: TalentModifiers, spellPower: number): number => {
      const sim = new Sim({
        seed: 11,
        playerClass: 'warlock',
        autoEquip: true,
        world: EMPTY_TEST_WORLD,
      });
      sim.setPlayerLevel(20);
      installMods(sim, mods);
      sim.player.spellPower = spellPower;
      sim.player.resource = sim.player.maxResource;
      const target = addTargetDummy(sim, 9301);
      sim.castAbility('corruption');
      // 2s cast time plus projectile travel to a target 3yd away; no rng draw
      // applies the DoT snapshot on impact, so this stays deterministic.
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      const dot = target.auras.find((a) => a.kind === 'dot' && a.id === 'corruption');
      if (!dot) throw new Error('corruption did not land');
      return dot.value;
    };

    for (const spellPower of [0, 1200]) {
      const baseTick = tickValue(baseline, spellPower);
      const boostedTick = tickValue(boosted, spellPower);
      expect(boostedTick / baseTick).toBeCloseTo(1 + dmgPct, 1);
    }
  });

  it('a HoT (Renew) with a +50% ability-scoped talent applies the full 50% to base + Spell Power together', () => {
    const dmgPct = 0.5;
    const boosted = emptyModifiers();
    accumulateTalentEffect(boosted, { ability: [{ ability: 'renew', dmgPct }] });
    const baseline = emptyModifiers();

    const tickValue = (mods: TalentModifiers, spellPower: number): number => {
      const sim = new Sim({
        seed: 21,
        playerClass: 'priest',
        autoEquip: true,
        world: EMPTY_TEST_WORLD,
      });
      sim.setPlayerLevel(20);
      installMods(sim, mods);
      sim.player.spellPower = spellPower;
      sim.player.resource = sim.player.maxResource;
      sim.targetEntity(sim.player.id); // Renew is friendly-targeted; heal self
      sim.castAbility('renew');
      for (let i = 0; i < 20; i++) sim.tick(); // instant cast, resolves within a tick
      const hot = sim.player.auras.find((a) => a.kind === 'hot' && a.id === 'renew');
      if (!hot) throw new Error('renew did not land');
      return hot.value;
    };

    for (const spellPower of [0, 1200]) {
      const baseTick = tickValue(baseline, spellPower);
      const boostedTick = tickValue(boosted, spellPower);
      expect(boostedTick / baseTick).toBeCloseTo(1 + dmgPct, 1);
    }
  });

  it('an absorb shield (Frostveil) with a +25% ability-scoped talent applies the full 25% to base + Spell Power together', () => {
    const dmgPct = 0.25;
    const boosted = emptyModifiers();
    accumulateTalentEffect(boosted, { ability: [{ ability: 'ice_barrier', dmgPct }] });
    const baseline = emptyModifiers();

    const shieldValue = (mods: TalentModifiers, spellPower: number): number => {
      const modsWithSpec: TalentModifiers = { ...mods, spec: 'frost' }; // ice_barrier is frost-spec-gated
      const sim = new Sim({
        seed: 31,
        playerClass: 'mage',
        autoEquip: true,
        world: EMPTY_TEST_WORLD,
      });
      sim.setPlayerLevel(20);
      installMods(sim, modsWithSpec);
      sim.player.spellPower = spellPower;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('ice_barrier'); // requiresTarget: false, instant
      for (let i = 0; i < 20; i++) sim.tick();
      const shield = sim.player.auras.find((a) => a.kind === 'absorb' && a.id === 'ice_barrier');
      if (!shield) throw new Error('ice_barrier did not land');
      return shield.value;
    };

    for (const spellPower of [0, 1200]) {
      const baseShield = shieldValue(baseline, spellPower);
      const boostedShield = shieldValue(boosted, spellPower);
      expect(boostedShield / baseShield).toBeCloseTo(1 + dmgPct, 1);
    }
  });

  // Reviewer finding on PR #2757 (Rubsey/OSSBrain): chainDamage (Aura Surge /
  // the paladin bounce ability, and Holy Shield's chained rider) had no
  // scaleEffect case, and its SP/AP rider skipped talentDmgMult, so an
  // ability-scoped or global spell-damage percent scaled the primary
  // directDamage hit but silently dropped every bounce. Fixed by giving
  // chainDamage the same scaleEffect min/max treatment as aoeDamage/
  // directDamage, and passing talentDmgMult into its directHitBonus rider.
  it('a chainDamage ability with an ability-scoped +30% scales base AND the Spell Power rider by the same 1.3 (pure math)', () => {
    const dmgPct = 0.3;
    const baseline = emptyModifiers();
    const boosted = emptyModifiers();
    // Aura Surge is talent-granted (talent_abilities_v2_a.ts), not part of the
    // paladin base kit, so both variants need the grant to know it at all.
    accumulateTalentEffect(baseline, { grant: { ability: 'aura_surge' } });
    accumulateTalentEffect(boosted, { grant: { ability: 'aura_surge' } });
    accumulateTalentEffect(boosted, { ability: [{ ability: 'aura_surge', dmgPct }] });

    const baseAbility = abilitiesKnownAt('paladin', 20, baseline).find(
      (a) => a.def.id === 'aura_surge',
    );
    const boostedAbility = abilitiesKnownAt('paladin', 20, boosted).find(
      (a) => a.def.id === 'aura_surge',
    );
    if (!baseAbility || !boostedAbility) throw new Error('missing aura_surge');
    const baseEff = chainDamageEffect(baseAbility.effects);
    const boostedEff = chainDamageEffect(boostedAbility.effects);

    // Before the fix, chainDamage had no scaleEffect case, so this bake was a
    // no-op and boostedEff.min === baseEff.min.
    expect(boostedEff.min).toBe(Math.round(baseEff.min * (1 + dmgPct)));

    const spellPower = 900;
    const castTime = boostedAbility.castTime;
    const { dmgMult } = resolveTalentHitMult(boostedAbility.def, boosted);
    expect(dmgMult).toBeCloseTo(1 + dmgPct, 10);

    const baselineRider = directHitBonus(spellPower, baseAbility.def, castTime, true);
    const fixedRider = directHitBonus(spellPower, boostedAbility.def, castTime, true, dmgMult);
    const unfixedRider = directHitBonus(spellPower, boostedAbility.def, castTime, true); // mult defaults to 1

    const baselineHit = baseEff.min + baselineRider;
    const fixedHit = boostedEff.min + fixedRider;
    const unfixedHit = boostedEff.min + unfixedRider;

    expect(fixedHit / baselineHit).toBeCloseTo(1 + dmgPct, 2);
    expect(unfixedHit / baselineHit).toBeLessThan(1 + dmgPct);
  });

  it('Aura Surge bounce hits (chainDamage) scale under a global spellDmgPct, matching the primary hit, end to end', () => {
    const dmgPct = 0.3;

    // Casts Hallowed Wall / holy_shield (directDamage primary + a chainDamage
    // rider: 2 jumps, no falloff) against three hostile dummies laid out so
    // hop selection (nearest distance, then lowest id) is deterministic, and
    // returns the three resulting damage amounts: primary, then the two
    // chainDamage bounces. `boost` layers a global spellDmgPct (the shape a
    // mastery like Earthen Fury advertises) on top of the spec commit that
    // grants holy_shield as the Protection signature, rather than replacing
    // meta.talentMods wholesale, so the grant survives.
    const castHits = (boost: boolean): number[] => {
      const sim = new Sim({
        seed: 41,
        playerClass: 'paladin',
        autoEquip: true,
        world: EMPTY_TEST_WORLD,
      });
      sim.setPlayerLevel(20);
      // holy_shield (Hallowed Wall) is granted as the Protection signature
      // ability (talents.ts: spec.signature), not base kit by def alone.
      if (!sim.setSpec('protection')) throw new Error('failed to set protection spec');
      const meta = sim.meta(sim.playerId);
      if (!meta) throw new Error('missing player meta');
      const mods: TalentModifiers = { ...meta.talentMods };
      if (boost) accumulateTalentEffect(mods, { global: { spellDmgPct: dmgPct } });
      meta.talentMods = mods;
      meta.known = abilitiesKnownAt(meta.cls, 20, mods) as typeof meta.known;
      sim.player.spellPower = 400;
      sim.player.resource = sim.player.maxResource;

      const spawn = (id: number, dz: number): Entity => {
        const m = createMob(id, MOBS.forest_wolf, 20, {
          x: sim.player.pos.x,
          y: sim.player.pos.y,
          z: sim.player.pos.z + dz,
        });
        m.hostile = true;
        m.maxHp = m.hp = 1_000_000;
        (sim as unknown as { addEntity(e: Entity): void }).addEntity(m);
        return m;
      };
      const primary = spawn(9401, 3);
      spawn(9402, 5); // nearest to primary: first bounce
      spawn(9403, 8); // nearest to the first bounce: second bounce

      sim.targetEntity(primary.id);
      sim.player.facing = Math.atan2(
        primary.pos.x - sim.player.pos.x,
        primary.pos.z - sim.player.pos.z,
      );
      sim.drainEvents();
      sim.castAbility('holy_shield');
      // tick() itself drains and returns the events queued so far (including
      // the ones the instant cast above just emitted), so collect from its
      // return value rather than a trailing drainEvents() call. Filter to the
      // cast's OWN damage events (by ability name), since the same ticks also
      // resolve the dummies' retaliation swings on the player.
      const ticked: import('../src/sim/types').SimEvent[] = [];
      for (let i = 0; i < 5; i++) ticked.push(...sim.tick());
      const hits = ticked
        .filter(
          (e) => e.type === 'damage' && (e as { ability?: string }).ability === 'Hallowed Wall',
        )
        .map((e) => (e as unknown as { amount: number }).amount);
      expect(hits).toHaveLength(3); // directDamage primary + 2 chainDamage bounces
      return hits;
    };

    const baseHits = castHits(false);
    const boostedHits = castHits(true);
    expect(boostedHits).toHaveLength(baseHits.length);
    for (let i = 0; i < baseHits.length; i++) {
      // Before the fix, every bounce (i > 0) stayed at the unscaled baseline
      // amount while only the primary hit (i === 0) moved.
      expect(boostedHits[i] / baseHits[i]).toBeCloseTo(1 + dmgPct, 1);
    }
  });

  // Reviewer finding on PR #2757 (Rubsey/OSSBrain): Temporal Cascade
  // (massTemporalEcho) had no scaleEffect case, and its initial-heal SP rider
  // skipped talentHealMult, so Chronoweave's advertised "all healing" mastery
  // bonus never reached the group heal at all. Fixed by giving massTemporalEcho
  // the same scaleEffect heal.min/max treatment as heal/chainHeal, and passing
  // talentHealMult into its directHealBonus rider in effect_dispatch.ts.
  it('a massTemporalEcho ability (Temporal Cascade) with an ability-scoped +20% scales base AND the Spell Power rider by the same 1.2 (pure math)', () => {
    // AbilityModEffect has no separate healPct field: resolveTalentHitMult
    // reuses the same ability-scoped dmgPct for healMult (see talent_hit_mult.ts),
    // matching the pattern the Renew HoT test above uses.
    const dmgPct = 0.2;
    // temporal_cascade is gated to the arcane (Chronomancy) spec (specs: ['arcane']).
    const baseline: TalentModifiers = { ...emptyModifiers(), spec: 'arcane' };
    const boosted: TalentModifiers = { ...emptyModifiers(), spec: 'arcane' };
    accumulateTalentEffect(boosted, { ability: [{ ability: 'temporal_cascade', dmgPct }] });

    const baseAbility = abilitiesKnownAt('mage', 20, baseline).find(
      (a) => a.def.id === 'temporal_cascade',
    );
    const boostedAbility = abilitiesKnownAt('mage', 20, boosted).find(
      (a) => a.def.id === 'temporal_cascade',
    );
    if (!baseAbility || !boostedAbility) throw new Error('missing temporal_cascade');
    const massTemporalEchoEffect = (effects: AbilityEffect[]) => {
      const found = effects.find((e) => e.type === 'massTemporalEcho');
      if (found?.type !== 'massTemporalEcho') throw new Error('missing massTemporalEcho effect');
      return found;
    };
    const baseEff = massTemporalEchoEffect(baseAbility.effects);
    const boostedEff = massTemporalEchoEffect(boostedAbility.effects);

    // Before the fix, massTemporalEcho had no scaleEffect case, so this bake
    // was a no-op and boostedEff.heal.min === baseEff.heal.min.
    expect(boostedEff.heal.min).toBe(Math.round(baseEff.heal.min * (1 + dmgPct)));

    const spellPower = 900;
    const castTime = boostedAbility.castTime;
    const { healMult } = resolveTalentHitMult(boostedAbility.def, boosted);
    expect(healMult).toBeCloseTo(1 + dmgPct, 10);

    const baselineRider = directHealBonus(spellPower, castTime);
    const fixedRider = directHealBonus(spellPower, castTime, false, healMult);
    const unfixedRider = directHealBonus(spellPower, castTime); // mult defaults to 1

    const baselineHit = baseEff.heal.min + baselineRider;
    const fixedHit = boostedEff.heal.min + fixedRider;
    const unfixedHit = boostedEff.heal.min + unfixedRider;

    expect(fixedHit / baselineHit).toBeCloseTo(1 + dmgPct, 2);
    expect(unfixedHit / baselineHit).toBeLessThan(1 + dmgPct);
  });

  it('Temporal Cascade initial heals scale under a global healPct (Chronoweave shape), end to end', () => {
    const healPct = 0.2;

    const castInitialHeals = (boost: boolean): number[] => {
      const sim = new Sim({
        seed: 51,
        playerClass: 'mage',
        autoEquip: true,
        world: EMPTY_TEST_WORLD,
      });
      sim.setPlayerLevel(20);
      if (!sim.setSpec('arcane')) throw new Error('failed to set arcane spec');
      const meta = sim.meta(sim.playerId);
      if (!meta) throw new Error('missing player meta');
      const mods: TalentModifiers = { ...meta.talentMods };
      if (boost) accumulateTalentEffect(mods, { global: { healPct } });
      meta.talentMods = mods;
      meta.known = abilitiesKnownAt(meta.cls, 20, mods) as typeof meta.known;
      sim.player.spellPower = 400;
      sim.player.resource = sim.player.maxResource;
      // A big HP pool with a deep deficit so the initial heal never clips an
      // overheal cap: an overheal-clamped amount would read identical whether
      // boosted or not and hide the bug this test targets.
      sim.player.maxHp = 100_000;
      sim.player.hp = 1;

      // partyOnlyTarget only allows the caster or a group/raid member, so
      // target self here rather than standing up a party.
      sim.targetEntity(sim.player.id);
      sim.castAbility('temporal_cascade');
      const ticked: import('../src/sim/types').SimEvent[] = [];
      // 2s cast time: give it a full 3s of ticks (60 at DT=1/20) to resolve.
      for (let i = 0; i < 60; i++) ticked.push(...sim.tick());
      const heals = ticked
        .filter(
          (e) => e.type === 'heal2' && (e as { targetId?: number }).targetId === sim.player.id,
        )
        .map((e) => (e as unknown as { amount: number }).amount);
      expect(heals.length).toBeGreaterThan(0);
      return heals;
    };

    const baseHeals = castInitialHeals(false);
    const boostedHeals = castInitialHeals(true);
    expect(boostedHeals.length).toBe(baseHeals.length);
    for (let i = 0; i < baseHeals.length; i++) {
      // Before the fix, the initial heal stayed at the unscaled baseline
      // amount regardless of Chronoweave's global healPct.
      expect(boostedHeals[i] / baseHeals[i]).toBeCloseTo(1 + healPct, 1);
    }
  });
});
