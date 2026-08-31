// Warlock Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each
// bonus proven at the seam it rides. Hexthread 2pc is a RESOLVED rewrite of
// the afflictionNeedle doom payload in applyTalentMods (7 to 9), the one
// number the dispatch (resolveNeedleOfFate) and the {needleDoom} tooltip
// splice both read; eyeGeneration still multiplies the total (x0.5 secondary
// Eyes with rounding, x2 under Hour of Judgment). Hexthread 4pc refunds 10
// Condemnation at the post-consume site in resolveSentence, additive beside
// Hour of Judgment's once-per-90s charge. Gravebrand 2pc is a resolved
// cooldownFlat row on Reaping Command (8 to 6) with the rider auras and the
// Soul Fragment bank pinned untouched; 4pc multiplies reapingDamage at its
// one caller, so the unison strikes and the derived cleave both carry 1.25x.
// Ruincaller 2pc is a generic bonusCharges row on Conflagrate's native
// 2-charge pool (the {charges} splice reads the same resolved count) with the
// unequip clamp proven mid-fight; 4pc is a dmgPct row on Ruinbolt sized
// DELIVERED (0.22 against the 0.1 spec-baseline spellDmgPct floor, 20 percent
// exactly). Non-wearer rng stays byte-identical everywhere; no warlock bend
// draws rng.
import { describe, expect, it } from 'vitest';
import {
  doomValue,
  gainDoom,
  resolveNeedleOfFate,
  resolveSentence,
} from '../src/sim/combat/affliction';
import { SOUL_FRAGMENT_CAP } from '../src/sim/combat/necromancy';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  GRAVEBRAND_2PC_REAPING_COOLDOWN_CUT_SEC,
  GRAVEBRAND_4PC_UNISON_DAMAGE_MULT,
  HEXTHREAD_2PC_NEEDLE_DOOM_BONUS,
  HEXTHREAD_4PC_SENTENCE_DOOM_REFUND,
  RUINCALLER_2PC_CONFLAGRATE_BONUS_CHARGES,
  RUINCALLER_4PC_CHAOS_BOLT_DMG_PCT,
  setBonusFlag,
} from '../src/sim/content/ignivar_set_bonuses';
import { specBaselineFor } from '../src/sim/content/spec_baselines';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { Entity, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function warlockMods(spec: string, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('warlock', { spec, rows: {} }, 25, equipment);
}

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1);
    sim.equipItem(`${setId}_${slot}`);
  }
}

function liveWarlock(seed: number, spec: 'affliction' | 'demonology' | 'destruction'): Sim {
  const sim = new Sim({ seed, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.hitBonus = 1;
  return sim;
}

function addHostileTarget(sim: Sim, z = 8): Entity {
  const host = sim as Sim & { nextId: number; addEntity(entity: Entity): void };
  const target = createMob(host.nextId++, MOBS.ridge_stalker, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + z,
  });
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.weapon.speed = 1000;
  target.swingTimer = 1000;
  target.moveSpeed = 0;
  target.hostile = true;
  host.addEntity(target);
  return target;
}

function finishCast(sim: Sim, abilityId: string, target?: Entity): SimEvent[] {
  if (target) sim.targetEntity(target.id);
  sim.player.resource = sim.player.maxResource;
  sim.player.gcdRemaining = 0;
  sim.castAbility(abilityId);
  const events: SimEvent[] = [];
  for (let i = 0; i < 20 * 10 && sim.player.castingAbility; i++) events.push(...sim.tick());
  for (let i = 0; i < 40 && sim.player.gcdRemaining > 0; i++) events.push(...sim.tick());
  const host = sim as unknown as { ctx: { pendingProjectiles: unknown[] } };
  for (let i = 0; i < 200 && host.ctx.pendingProjectiles.length > 0; i++)
    events.push(...sim.tick());
  return events;
}

// Conflagrate requires a live Burning Pact on the target (the casting gate in
// casting_lifecycle). Seeding the dot aura directly is the destruction
// suite's idiom; each Conflagrate advances a tick, so re-seed before every
// cast to keep the charge accounting isolated from pact bookkeeping.
function ensurePact(sim: Sim, target: Entity): void {
  if (target.auras.some((aura) => aura.id === 'immolate')) return;
  target.auras.push({
    id: 'immolate',
    name: 'Burning Pact',
    kind: 'dot',
    value: 12,
    remaining: 15,
    duration: 15,
    tickInterval: 3,
    tickTimer: 3,
    sourceId: sim.player.id,
    school: 'fire',
  });
}

function resolvedNeedleDoom(sim: Sim): number {
  const res = expectDefined(sim.resolvedAbility('needle_of_fate'));
  const eff = res.effects.find(
    (candidate): candidate is Extract<(typeof res.effects)[number], { type: 'afflictionNeedle' }> =>
      candidate.type === 'afflictionNeedle',
  );
  return expectDefined(eff).doom;
}

describe('warlock Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['hexthread', 'affliction'],
      ['gravebrand', 'demonology'],
      ['ruincaller', 'destruction'],
    ] as const) {
      const four = warlockMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = warlockMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
    }
  });

  it('all three caster 2pcs carry the pushback rider', () => {
    expect(warlockMods('affliction', worn('hexthread', 2)).global.castPushbackReduction).toBe(1);
    expect(warlockMods('demonology', worn('gravebrand', 2)).global.castPushbackReduction).toBe(1);
    expect(warlockMods('destruction', worn('ruincaller', 2)).global.castPushbackReduction).toBe(1);
    expect(warlockMods('affliction', {}).global.castPushbackReduction).toBe(0);
  });
});

describe('Hexthread 2pc: Needle of Fate grants 2 additional Condemnation', () => {
  it('the resolved payload: 9 for wearers, 7 base, and unequipping re-resolves to 7', () => {
    const entryDoom = (equipment: Partial<Record<string, string>>) => {
      const entry = expectDefined(
        abilitiesKnownAt('warlock', 25, warlockMods('affliction', equipment)).find(
          (known) => known.def.id === 'needle_of_fate',
        ),
      );
      const eff = entry.effects.find(
        (
          candidate,
        ): candidate is Extract<(typeof entry.effects)[number], { type: 'afflictionNeedle' }> =>
          candidate.type === 'afflictionNeedle',
      );
      return expectDefined(eff).doom;
    };
    expect(entryDoom({})).toBe(7);
    expect(entryDoom(worn('hexthread', 2))).toBe(7 + HEXTHREAD_2PC_NEEDLE_DOOM_BONUS);

    // The live recompute: equipping resolves 9, unequipping back to 7.
    const sim = liveWarlock(511, 'affliction');
    equipSet(sim, 'hexthread', 2);
    expect(resolvedNeedleDoom(sim)).toBe(7 + HEXTHREAD_2PC_NEEDLE_DOOM_BONUS);
    sim.unequipItem('helmet');
    expect(resolvedNeedleDoom(sim)).toBe(7);
  });

  it('a landed Needle on the primary Eye generates 9 through the real cast path (control 7)', () => {
    function doomAfterNeedle(wearer: boolean): number {
      const sim = liveWarlock(512, 'affliction');
      if (wearer) equipSet(sim, 'hexthread', 2);
      const target = addHostileTarget(sim);
      finishCast(sim, 'needle_of_fate', target);
      return doomValue(sim.player);
    }
    expect(doomAfterNeedle(true)).toBe(7 + HEXTHREAD_2PC_NEEDLE_DOOM_BONUS);
    expect(doomAfterNeedle(false)).toBe(7);
  });

  it('the secondary Coven Eye x0.5-with-rounding pays +1 (a +1 bonus would pay zero)', () => {
    function doomThroughSecondaryEye(wearer: boolean): number {
      const sim = liveWarlock(513, 'affliction');
      if (wearer) equipSet(sim, 'hexthread', 2);
      const host = sim as unknown as { ctx: Parameters<typeof resolveNeedleOfFate>[0] };
      const target = addHostileTarget(sim);
      host.ctx.applyAura(target, {
        id: 'coven',
        name: 'Coven',
        kind: 'affliction_eye_secondary',
        remaining: 15,
        duration: 15,
        value: 0.5,
        sourceId: sim.player.id,
        school: 'shadow',
      });
      resolveNeedleOfFate(host.ctx, sim.player, target, resolvedNeedleDoom(sim));
      return doomValue(sim.player);
    }
    // Math.round(7 x 0.5) = 4; Math.round(9 x 0.5) = 5: the +2 survives the
    // secondary-Eye rounding as +1, exactly the set doc's disclosure.
    expect(doomThroughSecondaryEye(false)).toBe(4);
    expect(doomThroughSecondaryEye(true)).toBe(5);
  });

  it('Hour of Judgment doubles the whole payload on the primary Eye (18 vs 14)', () => {
    function doomUnderJudgment(wearer: boolean): number {
      const sim = liveWarlock(514, 'affliction');
      if (wearer) equipSet(sim, 'hexthread', 2);
      const host = sim as unknown as { ctx: Parameters<typeof resolveNeedleOfFate>[0] };
      const target = addHostileTarget(sim);
      finishCast(sim, 'evil_eye', target);
      host.ctx.applyAura(sim.player, {
        id: 'hour_of_judgment',
        name: 'Hour of Judgment',
        kind: 'affliction_judgment',
        remaining: 15,
        duration: 15,
        value: 50,
        charges: 1,
        sourceId: sim.player.id,
        school: 'shadow',
      });
      const before = doomValue(sim.player);
      resolveNeedleOfFate(host.ctx, sim.player, target, resolvedNeedleDoom(sim));
      return doomValue(sim.player) - before;
    }
    expect(doomUnderJudgment(false)).toBe(14);
    expect(doomUnderJudgment(true)).toBe(2 * (7 + HEXTHREAD_2PC_NEEDLE_DOOM_BONUS));
  });
});

describe('Hexthread 4pc: Passing Sentence refunds 10 Condemnation', () => {
  function doomAfterSentence(wearer: boolean, withJudgment = false): number {
    const sim = liveWarlock(515, 'affliction');
    if (wearer) equipSet(sim, 'hexthread', 4);
    const host = sim as unknown as { ctx: Parameters<typeof resolveSentence>[0] };
    const target = addHostileTarget(sim);
    finishCast(sim, 'evil_eye', target);
    gainDoom(host.ctx, sim.player, 50);
    if (withJudgment) {
      host.ctx.applyAura(sim.player, {
        id: 'hour_of_judgment',
        name: 'Hour of Judgment',
        kind: 'affliction_judgment',
        remaining: 15,
        duration: 15,
        value: 50,
        charges: 1,
        sourceId: sim.player.id,
        school: 'shadow',
      });
    }
    finishCast(sim, 'sentence', target);
    return doomValue(sim.player);
  }

  it('a resolved Sentence leaves 10 Condemnation for wearers (control 0)', () => {
    expect(doomAfterSentence(true)).toBe(HEXTHREAD_4PC_SENTENCE_DOOM_REFUND);
    expect(doomAfterSentence(false)).toBe(0);
  });

  it("is additive beside Hour of Judgment's once-per-90s 50-refund charge", () => {
    expect(doomAfterSentence(true, true)).toBe(50 + HEXTHREAD_4PC_SENTENCE_DOOM_REFUND);
    expect(doomAfterSentence(false, true)).toBe(50);
  });

  it('pays nothing on a sub-20 Sentence resolve (the early return filters first)', () => {
    const sim = liveWarlock(516, 'affliction');
    equipSet(sim, 'hexthread', 4);
    const host = sim as unknown as { ctx: Parameters<typeof resolveSentence>[0] };
    const target = addHostileTarget(sim);
    finishCast(sim, 'evil_eye', target);
    gainDoom(host.ctx, sim.player, 10);
    resolveSentence(host.ctx, sim.player, target, 'Sentence');
    expect(doomValue(sim.player)).toBe(0);
  });
});

describe("Gravebrand 2pc: Reaping Command's cooldown drops 8 to 6", () => {
  it('the resolved cooldown: 6 for wearers, 8 base, and only that one row moves', () => {
    const entryOf = (equipment: Partial<Record<string, string>>) =>
      expectDefined(
        abilitiesKnownAt('warlock', 25, warlockMods('demonology', equipment)).find(
          (known) => known.def.id === 'reaping_command',
        ),
      );
    expect(entryOf({}).cooldown).toBe(8);
    expect(entryOf(worn('gravebrand', 2)).cooldown).toBe(
      8 - GRAVEBRAND_2PC_REAPING_COOLDOWN_CUT_SEC,
    );
    const mods = warlockMods('demonology', worn('gravebrand', 2));
    expect(mods.abilities.reaping_command?.cooldownFlat).toBe(
      -GRAVEBRAND_2PC_REAPING_COOLDOWN_CUT_SEC,
    );
  });

  it('the Soul Fragment cost and bank stay pinned (the bank never breathes)', () => {
    expect(ABILITIES.reaping_command.soulFragmentCost).toBe(2);
    expect(SOUL_FRAGMENT_CAP).toBe(5);
    const mods = warlockMods('demonology', worn('gravebrand', 4));
    // No set row touches the fragment machinery: the 2pc is the cooldown row
    // and the 4pc is tuning metadata for the reapingDamage bend.
    expect(mods.abilities.reaping_command?.cooldownFlat).toBe(
      -GRAVEBRAND_2PC_REAPING_COOLDOWN_CUT_SEC,
    );
    expect(mods.abilities.reaping_command?.costPct).toBe(0);
  });
});

describe('Gravebrand 4pc: unison strikes deal 25 percent more damage', () => {
  function reapDamage(wearer: boolean): { primary: number; riders: Entity['auras'] } {
    const sim = liveWarlock(517, 'demonology');
    if (wearer) equipSet(sim, 'gravebrand', 4);
    const target = addHostileTarget(sim);
    finishCast(sim, 'raise_graveguard');
    for (let fragment = 0; fragment < 2; fragment++) finishCast(sim, 'soul_harvest', target);
    sim.drainEvents();
    const events = finishCast(sim, 'reaping_command', target);
    const hit = expectDefined(
      events.find(
        (event): event is Extract<SimEvent, { type: 'damage' }> =>
          event.type === 'damage' &&
          event.targetId === target.id &&
          event.ability === 'Reaping Command',
      ),
    );
    const graveguard = expectDefined(
      [...sim.entities.values()].find((entity) => entity.templateId === 'graveguard'),
    );
    return { primary: hit.amount, riders: graveguard.auras };
  }

  it('the command strike lands 1.25x for wearers at the one reapingDamage caller', () => {
    const control = reapDamage(false);
    const bent = reapDamage(true);
    // The multiplier applies before reapingDamage's round, so the wearer hit
    // sits within rounding of exactly 1.25x the control hit.
    expect(
      Math.abs(bent.primary - control.primary * GRAVEBRAND_4PC_UNISON_DAMAGE_MULT),
    ).toBeLessThanOrEqual(1);
    expect(bent.primary).toBeGreaterThan(control.primary);
  });

  it('no cooldown leak: the rider auras keep their base values and durations', () => {
    const { riders } = reapDamage(true);
    expect(riders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'reaping_command_graveguard',
          kind: 'shield_wall',
          value: 0.3,
          duration: 4,
        }),
      ]),
    );
  });

  it('an owner gear swap mid-fight moves the very next command (no pet-side state)', () => {
    const sim = liveWarlock(518, 'demonology');
    const target = addHostileTarget(sim);
    finishCast(sim, 'raise_graveguard');
    for (let fragment = 0; fragment < 4; fragment++) finishCast(sim, 'soul_harvest', target);
    const firstEvents = finishCast(sim, 'reaping_command', target);
    const first = expectDefined(
      firstEvents.find(
        (event): event is Extract<SimEvent, { type: 'damage' }> =>
          event.type === 'damage' &&
          event.targetId === target.id &&
          event.ability === 'Reaping Command',
      ),
    );
    equipSet(sim, 'gravebrand', 4);
    for (let tick = 0; tick < 20 * 9; tick++) sim.tick(); // ride out the cooldown
    const secondEvents = finishCast(sim, 'reaping_command', target);
    const second = expectDefined(
      secondEvents.find(
        (event): event is Extract<SimEvent, { type: 'damage' }> =>
          event.type === 'damage' &&
          event.targetId === target.id &&
          event.ability === 'Reaping Command',
      ),
    );
    expect(
      Math.abs(second.amount - first.amount * GRAVEBRAND_4PC_UNISON_DAMAGE_MULT),
    ).toBeLessThanOrEqual(1);
  });
});

describe('Ruincaller 2pc: Conflagrate holds 3 charges', () => {
  it('the resolved pool: 3 stored uses for wearers, the native 2 base', () => {
    const entryOf = (equipment: Partial<Record<string, string>>) =>
      expectDefined(
        abilitiesKnownAt('warlock', 25, warlockMods('destruction', equipment)).find(
          (known) => known.def.id === 'conflagrate',
        ),
      );
    expect(entryOf({}).charges).toBe(2);
    expect(entryOf(worn('ruincaller', 2)).charges).toBe(
      2 + RUINCALLER_2PC_CONFLAGRATE_BONUS_CHARGES,
    );
  });

  it('a wearer spends three stored uses back to back; the fourth is rejected', () => {
    const sim = liveWarlock(519, 'destruction');
    equipSet(sim, 'ruincaller', 2);
    const target = addHostileTarget(sim);
    sim.targetEntity(target.id);
    for (let use = 0; use < 3; use++) {
      ensurePact(sim, target);
      sim.player.gcdRemaining = 0;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('conflagrate');
      for (let tick = 0; tick < 10; tick++) sim.tick();
    }
    expect(sim.player.abilityCharges?.conflagrate?.maxCharges).toBe(3);
    expect(sim.player.abilityCharges?.conflagrate?.charges).toBe(0);
    ensurePact(sim, target);
    sim.player.gcdRemaining = 0;
    const manaBeforeFourth = sim.player.resource;
    sim.castAbility('conflagrate');
    expect(sim.player.resource).toBe(manaBeforeFourth);
    expect(sim.player.abilityCharges?.conflagrate?.charges).toBe(0);
  });

  it('an unequip mid-fight clamps the pool to 2 and never grants a free charge', () => {
    const sim = liveWarlock(520, 'destruction');
    equipSet(sim, 'ruincaller', 2);
    const target = addHostileTarget(sim);
    sim.targetEntity(target.id);
    ensurePact(sim, target);
    sim.player.gcdRemaining = 0;
    sim.castAbility('conflagrate'); // spend 1 of 3
    for (let tick = 0; tick < 10; tick++) sim.tick();
    expect(sim.player.abilityCharges?.conflagrate?.charges).toBe(2);
    sim.unequipItem('helmet'); // 2 worn pieces -> 1: the tier drops
    // normalizeAbilityCharges keeps the SPENT count: 1 spent of the new cap 2.
    expect(sim.player.abilityCharges?.conflagrate?.maxCharges).toBe(2);
    expect(sim.player.abilityCharges?.conflagrate?.charges).toBe(1);
    // Re-equipping restores the cap without refunding the spent use.
    sim.addItem('ruincaller_helmet', 1);
    sim.equipItem('ruincaller_helmet');
    expect(sim.player.abilityCharges?.conflagrate?.maxCharges).toBe(3);
    expect(sim.player.abilityCharges?.conflagrate?.charges).toBe(2);
  });
});

describe('Ruincaller 4pc: Ruinbolt strikes 20 percent harder, delivered', () => {
  it('the accumulator: 1.32 for wearers against the 1.1 spec-baseline floor', () => {
    const wearerMult = resolveTalentHitMult(
      ABILITIES.chaos_bolt,
      warlockMods('destruction', worn('ruincaller', 4)),
    ).dmgMult;
    const baseMult = resolveTalentHitMult(
      ABILITIES.chaos_bolt,
      warlockMods('destruction', {}),
    ).dmgMult;
    expect(baseMult).toBeCloseTo(1.1, 10);
    expect(wearerMult).toBeCloseTo(1.1 + RUINCALLER_4PC_CHAOS_BOLT_DMG_PCT, 10);
    // Delivered: exactly the 20 percent the copy promises.
    expect(wearerMult / baseMult).toBeCloseTo(1.2, 10);
    // The floor this sizing leans on (spec_baselines.ts).
    expect(specBaselineFor('warlock', 'destruction')?.global?.spellDmgPct).toBeCloseTo(0.1, 10);
  });

  it('the resolved authored damage scales by the same multiplier (no row overlap)', () => {
    const entryOf = (equipment: Partial<Record<string, string>>) =>
      expectDefined(
        abilitiesKnownAt('warlock', 25, warlockMods('destruction', equipment)).find(
          (known) => known.def.id === 'chaos_bolt',
        ),
      );
    const wearerMods = warlockMods('destruction', worn('ruincaller', 4));
    expect(wearerMods.abilities.chaos_bolt?.dmgPct).toBe(RUINCALLER_4PC_CHAOS_BOLT_DMG_PCT);
    const wearerMult = resolveTalentHitMult(ABILITIES.chaos_bolt, wearerMods).dmgMult;
    const direct = entryOf(worn('ruincaller', 4)).effects.find(
      (
        eff,
      ): eff is Extract<(typeof ABILITIES.chaos_bolt.effects)[number], { type: 'directDamage' }> =>
        eff.type === 'directDamage',
    );
    expect(expectDefined(direct).min).toBe(Math.round(192 * wearerMult));
    expect(expectDefined(direct).max).toBe(Math.round(235 * wearerMult));
    // The 2pc alone must NOT move the damage (the row is the 4pc's).
    expect(
      warlockMods('destruction', worn('ruincaller', 2)).abilities.chaos_bolt?.dmgPct ?? 0,
    ).toBe(0);
  });
});

describe('the wearer literals against the authored copy', () => {
  it('pins every audited warlock constant', () => {
    expect(HEXTHREAD_2PC_NEEDLE_DOOM_BONUS).toBe(2);
    expect(HEXTHREAD_4PC_SENTENCE_DOOM_REFUND).toBe(10);
    expect(GRAVEBRAND_2PC_REAPING_COOLDOWN_CUT_SEC).toBe(2);
    expect(GRAVEBRAND_4PC_UNISON_DAMAGE_MULT).toBeCloseTo(1.25, 10);
    expect(RUINCALLER_2PC_CONFLAGRATE_BONUS_CHARGES).toBe(1);
    expect(RUINCALLER_4PC_CHAOS_BOLT_DMG_PCT).toBeCloseTo(0.22, 10);
    // The base literals the copy's claims lean on.
    const needle = ABILITIES.needle_of_fate.effects.find((eff) => eff.type === 'afflictionNeedle');
    expect(needle && 'doom' in needle ? needle.doom : undefined).toBe(7);
    expect(ABILITIES.reaping_command.cooldown).toBe(8);
    expect(ABILITIES.conflagrate.maxCharges).toBe(2);
    // The Hour of Judgment overlap the 4pc refund sits beside.
    expect(ABILITIES.hour_of_judgment.cooldown).toBe(90);
  });
});
