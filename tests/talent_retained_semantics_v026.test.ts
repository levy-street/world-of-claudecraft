import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { onCastCompleted, onDamageTaken, tickProcState } from '../src/sim/combat/talent_procs';
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
import type { AbilityEffect, Entity, PlayerClass, SimEvent } from '../src/sim/types';

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

function spawnTargetAt(
  sim: TestSim,
  player: Entity,
  id: number,
  xOffset: number,
  zOffset: number,
): Entity {
  const target = createMob(id, MOBS.forest_wolf, 1, {
    x: player.pos.x + xOffset,
    y: player.pos.y,
    z: player.pos.z + zOffset,
  });
  target.maxHp = 50_000;
  target.hp = target.maxHp;
  target.hostile = true;
  target.aiState = 'idle';
  sim.addEntity(target);
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
  it('resolves the final Twin Verdicts, Rattling Ambush, Storm Recall, Sky Echo, Bruin Rebound, and content values', () => {
    const rowOption = (cls: PlayerClass, id: string) => {
      const option = ROW_TREES[cls].flatMap((row) => row.options).find((o) => o.id === id);
      if (!option) throw new Error(`missing row option ${cls}:${id}`);
      return option;
    };

    // Balance pass: Swift Verdicts is a cooldown cut (10 -> 8 sec), not
    // banked charges.
    expect(rowOption('paladin', 'pal_r14_swift_verdicts').name).toBe('Swift Verdicts');
    const verdict = resolved('paladin', 'judgement', { 14: 'pal_r14_swift_verdicts' });
    expect(verdict).toMatchObject({ cost: 30 });
    expect(verdict.cooldown).toBeCloseTo(8);
    expect(verdict.bonusCharges ?? 0).toBe(0);

    // Balance pass: hun_r14_sniper_training is Steady Draw now (the Rattling
    // Ambush reset+free relay was the worst loop in the game).
    const steadyDraw = rowOption('hunter', 'hun_r14_sniper_training');
    expect(steadyDraw.name).toBe('Steady Draw');
    expect(steadyDraw.effect.proc).toBeUndefined();
    const aimed = resolved('hunter', 'aimed_shot', { 14: 'hun_r14_sniper_training' });
    expect(aimed.castTime).toBeCloseTo(2.4);
    expect(effect(aimed, 'directDamage')).toEqual(
      effect(resolved('hunter', 'aimed_shot'), 'directDamage'),
    );

    const recall = rowOption('shaman', 'sha_r20_elemental_fury');
    expect(recall.name).toBe('Storm Recall');
    expect(recall.effect.proc).toEqual({
      id: 'sha_storm_recall',
      name: 'Storm Recall',
      school: 'nature',
      trigger: { on: 'spellCrit', abilities: ['lightning_bolt'] },
      responses: [
        { kind: 'cooldownRefund', ability: 'earth_shock', seconds: 'reset' },
        { kind: 'empowerNext', aura: 'next_cast_free', abilities: ['earth_shock'], duration: 8 },
      ],
    });
    const bolt = resolved('shaman', 'lightning_bolt', { 20: 'sha_r20_elemental_fury' });
    const jolt = resolved('shaman', 'earth_shock', { 20: 'sha_r20_elemental_fury' });
    expect(effect(bolt, 'directDamage')).toEqual(
      effect(resolved('shaman', 'lightning_bolt'), 'directDamage'),
    );
    expect(effect(jolt, 'directDamage')).toEqual(
      effect(resolved('shaman', 'earth_shock'), 'directDamage'),
    );

    const skyEcho = rowOption('shaman', 'sha_r11_elemental_attunement');
    expect(skyEcho.name).toBe('Sky Echo');
    expect(skyEcho.effect.proc?.name).toBe('Sky Echo');

    const bruin = rowOption('druid', 'dru_r8_brutal_bash');
    expect(bruin.name).toBe('Bruin Rebound');
    expect(bruin.effect.proc?.name).toBe('Bruin Rebound');
    expect(bruin.effect.proc?.responses).toEqual([
      { kind: 'resource', amount: 15, resourceType: 'rage' },
      { kind: 'cooldownRefund', ability: 'bash', seconds: 20 },
    ]);

    expect(
      effect(resolved('priest', 'mind_sear', { 20: 'pri_r20_mind_sear' }), 'aoeDamage'),
    ).toMatchObject({ min: 24, max: 28 });
    const carnage = ROW_TREES.warlock
      .flatMap((row) => row.options)
      .find((option) => option.id === 'wlk_r20_grimoire_of_haste');
    expect(carnage?.effect.proc?.responses).toContainEqual(
      expect.objectContaining({ kind: 'absorb', amount: 90 }),
    );
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

    const doubleCharge = resolved('warrior', 'charge', { 5: 'war_row_double_charge' }, 'arms');
    expect(doubleCharge).toMatchObject({ charges: 2, bonusCharges: 1 });

    const doubleBlink = resolved('mage', 'blink', { 5: 'mag_r5_double_blink' });
    expect(doubleBlink).toMatchObject({ charges: 2, bonusCharges: 1 });
  });

  it('Fieldhardy (was Calloused Hide) is a flat max-health passive', () => {
    // Balance pass: the on-hit instant Long Draw is gone; the option is the
    // classic Survivalist shape and no bigHitTaken response remains on it.
    const sim = harness(new Sim({ seed: 2608, playerClass: 'hunter', autoEquip: false }));
    sim.setPlayerLevel(20);
    const before = sim.player.maxHp;
    expect(sim.selectTalentRow(17, 'hun_r17_thick_hide')).toBe(true);
    expect(sim.player.maxHp).toBeGreaterThan(before);
    const player = sim.player;
    player.resource = player.maxResource;
    spawnTarget(sim, player);
    onDamageTaken(sim.ctx, player, Math.ceil(player.maxHp * 0.15));
    expect(player.auras.some((aura) => aura.id === 'hun_calloused_hide')).toBe(false);
  });

  it('consumes a scoped cheap-cast aura at the authoritative cost boundary', () => {
    const sim = harness(new Sim({ seed: 2609, playerClass: 'druid', autoEquip: false }));
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

  it('snapshots Viperfletch from the preceding resolved Fell Shot hit', () => {
    const sim = harness(new Sim({ seed: 2610, playerClass: 'hunter', autoEquip: false }));
    sim.setPlayerLevel(20);
    expect(sim.selectTalentRow(14, 'hun_r14_serpents_venom')).toBe(true);
    const player = sim.player;
    const target = spawnTarget(sim, player);
    const res = sim.resolvedAbility('arcane_shot');
    if (!res) throw new Error('missing Fell Shot');
    sim.events = [];

    runEffects(sim.ctx, player, metaOf(sim), target, res);

    const direct = sim.events.find(
      (event) => event.type === 'damage' && event.ability === res.def.name,
    );
    if (!direct || direct.type !== 'damage') throw new Error('missing direct Fell Shot damage');
    const dot = target.auras.find(
      (aura) => aura.kind === 'dot' && aura.id === 'arcane_shot' && aura.sourceId === player.id,
    );
    expect(dot?.value).toBe(Math.max(1, Math.round(Math.round(direct.amount * 0.5) / 3)));
    expect(dot?.school).toBe('nature');
  });

  it("applies conditional bolt damage only for the caster's DoT", () => {
    const damage = (withOwnDot: boolean): number => {
      const sim = harness(new Sim({ seed: 2611, playerClass: 'warlock', autoEquip: false }));
      sim.setPlayerLevel(20);
      expect(sim.selectTalentRow(14, 'wlk_r14_amplify_curse')).toBe(true);
      const player = sim.player;
      const target = spawnTarget(sim, player);
      if (withOwnDot) {
        target.auras.push({
          id: 'corruption',
          name: 'Blackrot',
          kind: 'dot',
          remaining: 18,
          duration: 18,
          value: 1,
          sourceId: player.id,
          school: 'shadow',
        });
      }
      const res = sim.resolvedAbility('shadow_bolt');
      if (!res) throw new Error('missing Gloom Bolt');
      sim.events = [];
      runEffects(sim.ctx, player, metaOf(sim), target, res);
      const event = sim.events.find(
        (candidate) => candidate.type === 'damage' && candidate.ability === res.def.name,
      );
      if (!event || event.type !== 'damage') throw new Error('missing Gloom Bolt damage');
      return event.amount;
    };

    expect(damage(true)).toBeGreaterThan(damage(false));
  });

  it('Steady Rain prevents damage pushback without changing baseline channels', () => {
    const castRemainingAfterHit = (selected: boolean): number => {
      const sim = harness(new Sim({ seed: 2612, playerClass: 'hunter', autoEquip: false }));
      sim.setPlayerLevel(20);
      if (selected) expect(sim.selectTalentRow(20, 'hun_r20_improved_volley')).toBe(true);
      const player = sim.player;
      const attacker = spawnTarget(sim, player, 4);
      player.castingAbility = 'volley';
      player.castRemaining = 2;
      player.castTotal = 3;
      dealDamage(sim.ctx, attacker, player, 10, false, 'physical', 'Test Hit', 'hit');
      return player.castRemaining;
    };

    expect(castRemainingAfterHit(false)).toBeGreaterThan(2);
    expect(castRemainingAfterHit(true)).toBe(2);
  });

  it('fires and consumes Mercy Deferred when real damage crosses its health threshold', () => {
    const sim = harness(new Sim({ seed: 2613, playerClass: 'priest', autoEquip: false }));
    sim.setPlayerLevel(20);
    expect(sim.selectTalentRow(14, 'pri_r14_greater_heal')).toBe(true);
    const player = sim.player;
    const attacker = spawnTarget(sim, player, 4);

    onCastCompleted(sim.ctx, player, 'heal', player);
    expect(player.auras).toContainEqual(
      expect.objectContaining({ kind: 'heal_echo', value: 60, value2: 0.35 }),
    );
    player.hp = Math.round(player.maxHp * 0.4);
    const damage = Math.round(player.maxHp * 0.1);
    const expectedHp = Math.min(player.maxHp, player.hp - damage + 60);
    sim.events = [];

    dealDamage(sim.ctx, attacker, player, damage, false, 'physical', 'Test Hit', 'hit');

    expect(player.hp).toBe(expectedHp);
    expect(player.auras.some((aura) => aura.kind === 'heal_echo')).toBe(false);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'spellfx', fx: 'echoBurst', targetId: player.id }),
    );
  });

  it('makes winning Lingering Dread absorb 20% max-health damage before fear breaks', () => {
    const sim = harness(new Sim({ seed: 2614, playerClass: 'warrior', autoEquip: false }));
    sim.setPlayerLevel(20);
    expect(sim.selectTalentRow(11, 'war_row_lingering_dread')).toBe(true);
    const player = sim.player;
    const target = spawnTarget(sim, player, 4);
    const shout = sim.resolvedAbility('intimidating_shout');
    if (!shout) throw new Error('missing Intimidating Shout');

    runEffects(sim.ctx, player, metaOf(sim), target, shout);
    const fear = target.auras.find((aura) => aura.id === 'fear_incap');
    expect(fear?.breakThreshold).toBe(Math.round(target.maxHp * 0.2));

    dealDamage(sim.ctx, player, target, 100, false, 'physical', 'Test Hit', 'hit');
    expect(target.auras.find((aura) => aura.id === 'fear_incap')?.breakThreshold).toBe(
      Math.round(target.maxHp * 0.2) - 100,
    );
    dealDamage(
      sim.ctx,
      player,
      target,
      Math.round(target.maxHp * 0.2) - 100,
      false,
      'physical',
      'Test Hit',
      'hit',
    );
    expect(target.auras.some((aura) => aura.id === 'fear_incap')).toBe(false);
  });

  it.each([
    ['paladin', 17, 'pal_r17_ardent_defender', 180],
    ['rogue', 17, 'rog_r17_cheat_death', 120],
  ] as const)(
    '%s cheat death saves once, honors its %d-row ICD, and rearms deterministically',
    (cls, level, optionId, icd) => {
      const selectedSim = () => {
        const sim = harness(new Sim({ seed: 2615, playerClass: cls, autoEquip: false }));
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
    const sim = harness(new Sim({ seed: 2616, playerClass: 'rogue', autoEquip: false }));
    sim.setPlayerLevel(20);
    const player = sim.player;
    player.hp = 100;

    dealDamage(sim.ctx, null, player, 200, false, 'physical', 'Lethal Hit', 'hit');

    expect(player.hp).toBe(0);
    expect(player.dead).toBe(true);
  });

  it('Dawnward Ricochet damages and silences its primary before deterministic falloff bounces', () => {
    const sim = harness(new Sim({ seed: 2617, playerClass: 'paladin', autoEquip: false }));
    sim.setPlayerLevel(20);
    expect(sim.selectTalentRow(20, 'pal_r20_aura_mastery')).toBe(true);
    const player = sim.player;
    const primary = spawnTargetAt(sim, player, 9200, 3, 0);
    // Insert the higher id first; equal-distance ties must still choose the lower id.
    const tiedHigh = spawnTargetAt(sim, player, 9102, 3, 4);
    const tiedLow = spawnTargetAt(sim, player, 9101, 7, 0);
    const untouched = spawnTargetAt(sim, player, 9103, 13, 0);
    const ricochet = sim.resolvedAbility('aura_surge');
    if (!ricochet) throw new Error('missing Dawnward Ricochet');
    sim.events = [];

    runEffects(sim.ctx, player, metaOf(sim), primary, ricochet);

    const damage = sim.events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.ability === ricochet.def.name,
    );
    expect(damage.map((event) => event.targetId)).toEqual([primary.id, tiedLow.id, tiedHigh.id]);
    expect(damage[1]?.amount).toBe(Math.max(1, Math.round((damage[0]?.amount ?? 0) * 0.75)));
    expect(damage[2]?.amount).toBe(Math.max(1, Math.round((damage[0]?.amount ?? 0) * 0.75 ** 2)));
    expect(primary.auras.some((aura) => aura.kind === 'silence')).toBe(true);
    expect(untouched.hp).toBe(untouched.maxHp);
  });
});
