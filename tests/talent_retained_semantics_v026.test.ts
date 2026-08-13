import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { tickProcState } from '../src/sim/combat/talent_procs';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  accumulateTalentEffect,
  computeTalentModifiers,
  emptyModifiers,
  ROW_TREES,
} from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { AbilityEffect, Entity, PlayerClass } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function harness(sim: Sim): TestSim {
  return sim as TestSim;
}

function spawnTarget(sim: TestSim, player: Entity, distance = 12): Entity {
  const target = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  target.maxHp = 50_000;
  target.hp = target.maxHp;
  target.hostile = true;
  target.aiState = 'idle';
  sim.addEntity(target);
  player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
  sim.targetEntity(target.id, player.id);
  return target;
}

function metaOf(sim: TestSim): PlayerMeta {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  return meta;
}

function resolved(
  cls: PlayerClass,
  abilityId: string,
  rows: Record<number, string> = {},
  spec: string | null = null,
): ResolvedAbility {
  const mods = computeTalentModifiers(cls, { spec, rows }, 20);
  const ability = abilitiesKnownAt(cls, 20, mods).find((entry) => entry.def.id === abilityId);
  if (!ability) throw new Error(`missing ${cls}:${abilityId}`);
  return ability;
}

function effect<T extends AbilityEffect['type']>(
  ability: ResolvedAbility,
  type: T,
): Extract<AbilityEffect, { type: T }> {
  const found = ability.effects.find(
    (candidate): candidate is Extract<AbilityEffect, { type: T }> => candidate.type === type,
  );
  if (!found) throw new Error(`missing ${type} effect on ${ability.def.id}`);
  return found;
}

describe('retained v0.26 all-class Talents V2 semantics', () => {
  it('resolves the retained Concussive Economy and Warlock content values', () => {
    const rowOption = (cls: PlayerClass, id: string) => {
      const option = ROW_TREES[cls].flatMap((row) => row.options).find((o) => o.id === id);
      if (!option) throw new Error(`missing row option ${cls}:${id}`);
      return option;
    };

    const concussive = rowOption('druid', 'dru_r11_improved_mark');
    expect(concussive.name).toBe('Concussive Economy');
    expect(concussive.effect.proc?.name).toBe('Concussive Economy');
    expect(concussive.effect.proc?.responses).toEqual([
      { kind: 'resource', amount: 15, resourceType: 'rage' },
      { kind: 'cooldownRefund', ability: 'bash', seconds: 20 },
    ]);

    const reflection = ROW_TREES.warlock
      .flatMap((row) => row.options)
      .find((option) => option.id === 'wlk_r20_grimoire_of_haste');
    expect(reflection?.name).toBe('Forbidden Reflection');
    expect(reflection?.effect.global?.warlockForbiddenReflection).toBe(60);
    expect(reflection?.effect.tuning?.reflectionWindow).toBe(10);
  });

  it('scales both the flat bonus and coefficient of a weapon strike', () => {
    const base = abilitiesKnownAt('rogue', 20, emptyModifiers()).find(
      (entry) => entry.def.id === 'backstab',
    );
    if (!base) throw new Error('missing baseline backstab');
    const mods = emptyModifiers();
    accumulateTalentEffect(mods, { ability: [{ ability: 'backstab', dmgPct: 0.2 }] });
    const boosted = abilitiesKnownAt('rogue', 20, mods).find(
      (entry) => entry.def.id === 'backstab',
    );
    if (!boosted) throw new Error('missing boosted backstab');
    const before = effect(base, 'weaponStrike');
    const after = effect(boosted, 'weaponStrike');
    expect(after.bonus).toBe(Math.round(before.bonus * 1.2));
    expect(after.weaponMult).toBeCloseTo((before.weaponMult ?? 1) * 1.2);
  });

  it('resolves native and talent-added stored uses onto the one recharge model', () => {
    // Unified charge model: a def's native maxCharges resolves exactly like the
    // Double Charge talent's bonusCharges (charges = 1 + bonusCharges), so the
    // cast gate, recharge, wire, and persistence share a single path.
    const twinstrike = resolved('warrior', 'raging_gale', {}, 'fury');
    expect(twinstrike).toMatchObject({ charges: 2, bonusCharges: 1 });

    // The warrior arm was Double Charge, which this branch replaced with Intervene,
    // so `charge` no longer takes talent bonusCharges. The talent-added half of the
    // claim is still covered by Double Blink below; only the warrior INSTANCE is
    // gone, not the mechanism.
    const doubleBlink = resolved('mage', 'blink', { 5: 'mag_r5_double_blink' });
    expect(doubleBlink).toMatchObject({ charges: 2, bonusCharges: 1 });
  });

  it('consumes a scoped cheap-cast aura at the authoritative cost boundary', () => {
    const sim = harness(
      new Sim({ seed: 2609, playerClass: 'druid', autoEquip: false, world: EMPTY_TEST_WORLD }),
    );
    sim.setPlayerLevel(20);
    const player = sim.player;
    player.resource = player.maxResource;
    sim.castAbility('cat_form');
    for (let i = 0; i < 35; i++) sim.tick();
    spawnTarget(sim, player, 4);
    player.resource = 23;
    player.auras.push({
      id: 'test_cheap_claw',
      name: 'Test Cheap Claw',
      kind: 'next_cast_cheap',
      remaining: 8,
      duration: 8,
      value: 0.5,
      sourceId: player.id,
      school: 'nature',
      empowerAbilities: ['claw'],
    });

    sim.castAbility('claw');

    expect(player.resource).toBe(0);
    expect(player.auras.some((aura) => aura.id === 'test_cheap_claw')).toBe(false);
  });

  it("reduces each Warlock specialization's primary generator cost by 25%", () => {
    const rows = { 14: 'wlk_r14_amplify_curse' };

    expect(resolved('warlock', 'needle_of_fate', rows, 'affliction').cost).toBe(23);
    // 55 base, -25% from the talent, then demonology's innate -8% generator
    // baseline (spec_baselines.ts) stacks multiplicatively: floor lands at 37.
    expect(resolved('warlock', 'soul_harvest', rows, 'demonology').cost).toBe(37);
    expect(resolved('warlock', 'shadow_bolt', rows, 'destruction').cost).toBe(42);
  });

  it('makes winning Lingering Dread absorb 10% max-health damage before fear breaks', () => {
    const sim = harness(
      new Sim({ seed: 2614, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD }),
    );
    sim.setPlayerLevel(20);
    expect(sim.selectTalentRow(11, 'war_row_lingering_dread')).toBe(true);
    const player = sim.player;
    const target = spawnTarget(sim, player, 4);
    const shout = sim.resolvedAbility('intimidating_shout');
    if (!shout) throw new Error('missing Intimidating Shout');

    runEffects(sim.ctx, player, metaOf(sim), target, shout);
    const fear = target.auras.find((aura) => aura.id === 'fear_incap');
    expect(fear?.breakThreshold).toBe(Math.round(target.maxHp * 0.1));

    dealDamage(sim.ctx, player, target, 100, false, 'physical', 'Test Hit', 'hit');
    expect(target.auras.find((aura) => aura.id === 'fear_incap')?.breakThreshold).toBe(
      Math.round(target.maxHp * 0.1) - 100,
    );
    dealDamage(
      sim.ctx,
      player,
      target,
      Math.round(target.maxHp * 0.1) - 100,
      false,
      'physical',
      'Test Hit',
      'hit',
    );
    expect(target.auras.some((aura) => aura.id === 'fear_incap')).toBe(false);
  });

  it.each([['rogue', 8, 'rog_r8_borrowed_breath', 120]] as const)(
    '%s cheat death saves once, honors its %d-row ICD, and rearms deterministically',
    (cls, level, optionId, icd) => {
      const selectedSim = () => {
        const sim = harness(
          new Sim({ seed: 2615, playerClass: cls, autoEquip: false, world: EMPTY_TEST_WORLD }),
        );
        sim.setPlayerLevel(20);
        expect(sim.selectTalentRow(level, optionId)).toBe(true);
        return sim;
      };
      const sim = selectedSim();
      const player = sim.player;
      player.hp = 100;

      dealDamage(sim.ctx, null, player, 200, false, 'physical', 'Lethal Hit', 'hit');
      expect(player.hp).toBe(1);
      expect(player.dead).toBe(false);
      expect(player.procState?.icds.cheat_death).toBe(icd);

      player.hp = 100;
      dealDamage(sim.ctx, null, player, 200, false, 'physical', 'Lethal Hit', 'hit');
      expect(player.hp).toBe(0);
      expect(player.dead).toBe(true);

      const rearmed = selectedSim();
      rearmed.player.hp = 100;
      dealDamage(rearmed.ctx, null, rearmed.player, 200, false, 'physical', 'Lethal Hit', 'hit');
      tickProcState(rearmed.player, icd);
      rearmed.player.hp = 100;
      dealDamage(rearmed.ctx, null, rearmed.player, 200, false, 'physical', 'Lethal Hit', 'hit');
      expect(rearmed.player.hp).toBe(1);
      expect(rearmed.player.procState?.icds.cheat_death).toBe(icd);
    },
  );

  it('does not grant cheat death without the selected row', () => {
    const sim = harness(
      new Sim({ seed: 2616, playerClass: 'rogue', autoEquip: false, world: EMPTY_TEST_WORLD }),
    );
    sim.setPlayerLevel(20);
    const player = sim.player;
    player.hp = 100;

    dealDamage(sim.ctx, null, player, 200, false, 'physical', 'Lethal Hit', 'hit');

    expect(player.hp).toBe(0);
    expect(player.dead).toBe(true);
  });
});
