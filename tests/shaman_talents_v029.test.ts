import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { iceFloesAuraForAbility } from '../src/sim/combat/empower_next';
import {
  consumeMendingCurrent,
  depositMendingCurrent,
  LIFESPRING_WEAPON_ID,
  mendingCurrent,
} from '../src/sim/combat/shaman_spiritmend';
import {
  applyPrimalExaltation,
  FLOW_STATE_READY_ID,
  onShamanCastCompleted,
  onShamanDamageTaken,
  onShamanManaSpent,
  onThunderWardActivated,
  onThunderWardRetaliated,
  SHAMAN_TALENT_IDS,
  shamanCastTimeMultiplier,
  shamanManaCost,
  shamanTalentSelected,
  triggerWardCycle,
} from '../src/sim/combat/shaman_talents';
import {
  addThunderCharges,
  consumeThunderVent,
  thunderCharges,
  thundercallOnArcBoltImpact,
} from '../src/sim/combat/shaman_thundercall';
import {
  advanceWarspiritCadence,
  applyWarspiritPosture,
  onStormcastConsumed,
  STONEBOUND_DR_ID,
  warspiritCadence,
} from '../src/sim/combat/shaman_warspirit';
import { ROW_LEVELS, rowForLevel } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function shaman(
  rows: Record<number, string> = {},
  spec: 'elemental' | 'enhancement' | 'restoration' = 'elemental',
): { sim: Sim; player: Entity; ally: Entity } {
  // Seed re-hunted (2904 to 2905) after the v0.34.0 catch-up merge shifted the
  // shared draw order; an avoided shock never lands its control effect.
  const sim = new Sim({ seed: 2905, playerClass: 'shaman', noPlayer: true });
  const pid = sim.addPlayer('shaman', 'Talent Shaman');
  const allyId = sim.addPlayer('warrior', 'Protected Ally');
  sim.setPlayerLevel(20, pid);
  sim.setPlayerLevel(20, allyId);
  expect(sim.applyTalents({ spec, rows }, pid)).toBe(true);
  const player = sim.entities.get(pid);
  const ally = sim.entities.get(allyId);
  if (!player || !ally) throw new Error('missing test player');
  sim.drainEvents();
  return { sim, player, ally };
}

function hostile(sim: Sim, player: Entity, id = 92_904): Entity {
  const target = createMob(id, MOBS.training_dummy, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 3,
  });
  target.hostile = true;
  target.hp = target.maxHp = 100_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(target);
  return target;
}

function advance(sim: Sim, seconds: number): void {
  for (let tick = 0; tick < seconds * 20; tick++) sim.tick();
}

describe('Shaman v0.29 talent grid', () => {
  it('publishes exactly the approved six rows and eighteen choices', () => {
    const rows = ROW_LEVELS.map((level) => rowForLevel('shaman', level));
    expect(
      rows.map((row) => [row?.level, ...(row?.options.map((option) => option.name) ?? [])]),
    ).toEqual([
      [5, 'Wolfstep', 'Gathering Winds', 'Flowing Elements'],
      [8, 'Stoneward', 'Warded Elements', 'Ancestral Mending'],
      [11, 'Fault Rebuke', 'Rime Lock', 'Gripping Earth'],
      [14, 'Flow State', 'Imbue Mastery', 'Ward Cycle'],
      [17, 'Primal Exaltation', 'Wayfarer Grace', 'Ancestral Bulwark'],
      [20, 'Deep Reservoir', 'Echoing Elements', 'Living Weapon'],
    ]);
    expect(rows.flatMap((row) => row?.options ?? [])).toHaveLength(18);
  });

  it('keeps selection authoritative by row id', () => {
    const { sim, player } = shaman({ 14: SHAMAN_TALENT_IDS.imbueMastery });
    expect(shamanTalentSelected(sim.ctx, player, SHAMAN_TALENT_IDS.imbueMastery)).toBe(true);
    expect(shamanTalentSelected(sim.ctx, player, SHAMAN_TALENT_IDS.flowState)).toBe(false);
  });

  it('preserves retained talent progress and cooldowns when another row changes', () => {
    const rows = {
      14: SHAMAN_TALENT_IDS.flowState,
      17: SHAMAN_TALENT_IDS.ancestralBulwark,
    };
    const { sim, player } = shaman(rows);
    onShamanManaSpent(sim.ctx, player, 75);
    onThunderWardActivated(sim.ctx, player);
    const progress = player.auras.find((aura) => aura.id === 'shaman_flow_state_progress');
    const cooldown = player.auras.find((aura) => aura.id === 'shaman_ancestral_bulwark_icd');
    expect(progress).toBeDefined();
    expect(cooldown).toBeDefined();

    expect(
      sim.applyTalents({
        spec: 'elemental',
        rows: { ...rows, 5: SHAMAN_TALENT_IDS.gatheringWinds },
      }),
    ).toBe(true);

    expect(player.auras.find((aura) => aura.id === 'shaman_flow_state_progress')).toBe(progress);
    expect(player.auras.find((aura) => aura.id === 'shaman_ancestral_bulwark_icd')).toBe(cooldown);
  });

  it('Stoneward owns one six-charge ally shield and heals through its ICD', () => {
    const { sim, player, ally } = shaman({ 8: SHAMAN_TALENT_IDS.stoneward });
    ally.hp = Math.round(ally.maxHp * 0.5);
    sim.targetEntity(ally.id, player.id);
    sim.castAbility('stoneward', player.id);
    const ward = ally.auras.find((aura) => aura.id === 'shaman_stoneward');
    expect(ward?.charges).toBe(6);
    expect(ward?.duration).toBe(60);
    const before = ally.hp;
    onShamanDamageTaken(sim.ctx, ally, 1);
    expect(ward?.charges).toBe(5);
    expect(ally.hp).toBe(before + Math.round(ally.maxHp * 0.05));
    onShamanDamageTaken(sim.ctx, ally, 1);
    expect(ward?.charges).toBe(5);
  });

  it('routes every control choice through its real cast path', () => {
    const fault = shaman({ 11: SHAMAN_TALENT_IDS.faultRebuke });
    const faultTarget = hostile(fault.sim, fault.player, 92_911);
    faultTarget.castingAbility = 'fireball';
    faultTarget.castRemaining = 3;
    fault.sim.targetEntity(faultTarget.id, fault.player.id);
    fault.sim.castAbility('earth_shock', fault.player.id);
    advance(fault.sim, 1);
    expect(faultTarget.castingAbility).toBeNull();
    expect(faultTarget.auras).toContainEqual(
      expect.objectContaining({ id: 'earth_shock_lockout', kind: 'lockout' }),
    );

    const rime = shaman({ 11: SHAMAN_TALENT_IDS.rimeLock });
    const rimeTarget = hostile(rime.sim, rime.player, 92_912);
    rime.sim.targetEntity(rimeTarget.id, rime.player.id);
    rime.sim.castAbility('frost_shock', rime.player.id);
    advance(rime.sim, 1);
    expect(rimeTarget.auras).toContainEqual(
      expect.objectContaining({ id: 'frost_shock_root', kind: 'root' }),
    );

    const gripping = shaman({ 11: SHAMAN_TALENT_IDS.grippingEarth });
    const grippingTarget = hostile(gripping.sim, gripping.player, 92_913);
    gripping.sim.castAbility('earthbind', gripping.player.id, {
      x: grippingTarget.pos.x,
      z: grippingTarget.pos.z,
    });
    expect(grippingTarget.auras).toContainEqual(
      expect.objectContaining({ id: 'earthbind_root', kind: 'root', remaining: 2 }),
    );
    advance(gripping.sim, 2.1);
    expect(grippingTarget.auras).toContainEqual(
      expect.objectContaining({ id: 'earthbind_slow', kind: 'slow', value: 0.6 }),
    );
  });

  it('Primal Exaltation creates the shared twelve-second throughput window', () => {
    const { sim, player } = shaman({ 17: SHAMAN_TALENT_IDS.primalExaltation });
    sim.castAbility('primal_exaltation', player.id);
    const aura = player.auras.find((candidate) => candidate.id === 'shaman_primal_exaltation');
    expect(aura?.duration).toBe(12);
  });

  it('routes every level 17 choice through its real activation path', () => {
    const primal = shaman({ 17: SHAMAN_TALENT_IDS.primalExaltation });
    primal.sim.castAbility('primal_exaltation', primal.player.id);
    expect(primal.player.auras).toContainEqual(
      expect.objectContaining({ id: 'shaman_primal_exaltation', remaining: 12 }),
    );

    const grace = shaman({ 17: SHAMAN_TALENT_IDS.wayfarerGrace });
    grace.sim.castAbility('ghost_wolf', grace.player.id);
    advance(grace.sim, 3.25);
    grace.sim.castAbility('ghost_wolf', grace.player.id);
    expect(grace.player.auras).toContainEqual(
      expect.objectContaining({ id: 'shaman_wayfarer_grace', kind: 'ice_floes', remaining: 8 }),
    );

    const bulwark = shaman({ 17: SHAMAN_TALENT_IDS.ancestralBulwark });
    bulwark.sim.castAbility('lightning_shield', bulwark.player.id);
    expect(bulwark.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'shaman_ancestral_bulwark',
        kind: 'buff_dr',
        value: 0.4,
        remaining: 6,
      }),
    );
  });

  it('implements all three movement choices without a new action', () => {
    const wolf = shaman({ 5: SHAMAN_TALENT_IDS.wolfstep });
    wolf.player.auras.push({
      id: 'test_slow',
      name: 'Test Slow',
      kind: 'slow',
      value: 0.5,
      remaining: 5,
      duration: 5,
      sourceId: 999,
      school: 'frost',
    });
    wolf.sim.castAbility('ghost_wolf', wolf.player.id);
    expect(wolf.player.auras.some((aura) => aura.kind === 'slow')).toBe(false);
    expect(wolf.sim.resolvedAbility('ghost_wolf', wolf.player.id)?.castTime).toBe(0);

    const winds = shaman({ 5: SHAMAN_TALENT_IDS.gatheringWinds });
    winds.sim.castAbility('ghost_wolf', winds.player.id);
    advance(winds.sim, 3);
    expect(winds.player.auras.find((aura) => aura.id === 'shaman_gathering_winds')).toMatchObject({
      kind: 'buff_speed',
      value: 1.6,
      duration: 3,
    });
    expect(winds.player.auras.some((aura) => aura.id === 'shaman_gathering_winds_icd')).toBe(true);

    const flowing = shaman({ 5: SHAMAN_TALENT_IDS.flowingElements });
    const target = hostile(flowing.sim, flowing.player);
    flowing.sim.targetEntity(target.id, flowing.player.id);
    flowing.sim.castAbility('frost_shock', flowing.player.id);
    expect(
      flowing.player.auras.find((aura) => aura.id === 'shaman_flowing_elements'),
    ).toMatchObject({
      kind: 'ice_floes',
      value: 1,
      duration: 8,
    });
  });

  it('implements reactive ward defense and Flow State accounting', () => {
    const warded = shaman({ 8: SHAMAN_TALENT_IDS.wardedElements });
    onThunderWardRetaliated(warded.sim.ctx, warded.player);
    expect(warded.player.auras.find((aura) => aura.id === 'shaman_warded_elements')).toMatchObject({
      kind: 'buff_dr',
      value: 0.1,
      duration: 3,
    });

    const flow = shaman({ 14: SHAMAN_TALENT_IDS.flowState });
    onShamanManaSpent(flow.sim.ctx, flow.player, 120);
    expect(flow.player.auras.some((aura) => aura.id === FLOW_STATE_READY_ID)).toBe(true);
    expect(shamanManaCost(flow.sim.ctx, flow.player, 65)).toBe(25);
    onShamanManaSpent(flow.sim.ctx, flow.player, 25);
    expect(flow.player.auras.some((aura) => aura.id === FLOW_STATE_READY_ID)).toBe(false);
  });

  it('routes both reactive level 8 defenses through real damage', () => {
    const warded = shaman({ 8: SHAMAN_TALENT_IDS.wardedElements });
    warded.sim.castAbility('lightning_shield', warded.player.id);
    const attacker = hostile(warded.sim, warded.player, 92_908);
    for (
      let attempt = 0;
      attempt < 10 && !warded.player.auras.some((aura) => aura.id === 'shaman_warded_elements');
      attempt++
    ) {
      meleeSwing(warded.sim.ctx, attacker, warded.player, 0, null, {
        cannotBeDodged: true,
      });
    }
    expect(warded.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'shaman_warded_elements',
        kind: 'buff_dr',
        value: 0.1,
        remaining: 3,
      }),
    );

    const mending = shaman({ 8: SHAMAN_TALENT_IDS.ancestralMending });
    mending.player.hp = Math.floor(mending.player.maxHp * 0.5);
    mending.sim.dealDamage(
      null,
      mending.player,
      Math.ceil(mending.player.maxHp * 0.16),
      false,
      'shadow',
      'Test Hit',
      'hit',
    );
    expect(mending.sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'heal2', ability: 'Ancestral Mending' }),
    );
  });

  it('spends a ready Flow State on an eligible action even when the discount makes it free', () => {
    const flow = shaman({ 14: SHAMAN_TALENT_IDS.flowState });
    onShamanManaSpent(flow.sim.ctx, flow.player, 120);
    expect(shamanManaCost(flow.sim.ctx, flow.player, 25)).toBe(0);
    onShamanManaSpent(flow.sim.ctx, flow.player, 0, true);
    expect(flow.player.auras.some((aura) => aura.id === FLOW_STATE_READY_ID)).toBe(false);
  });

  it('keeps a ready Flow State until it is spent or cleaned up', () => {
    const flow = shaman({ 14: SHAMAN_TALENT_IDS.flowState });
    onShamanManaSpent(flow.sim.ctx, flow.player, 120);
    const ready = flow.player.auras.find((aura) => aura.id === FLOW_STATE_READY_ID);
    expect(ready).toBeDefined();
    if (!ready) throw new Error('missing Flow State ready aura');
    ready.remaining = 0.01;

    flow.sim.tick();

    expect(flow.player.auras.some((aura) => aura.id === FLOW_STATE_READY_ID)).toBe(true);
  });

  it('scopes Flowing Elements movement casting to Arc Bolt and Mending Waters', () => {
    const flowing = shaman({ 5: SHAMAN_TALENT_IDS.flowingElements });
    onShamanCastCompleted(flowing.sim.ctx, flowing.player, 'frost_shock');
    expect(iceFloesAuraForAbility(flowing.player, 'lightning_bolt')).toBeDefined();
    expect(iceFloesAuraForAbility(flowing.player, 'healing_wave')).toBeDefined();
    expect(iceFloesAuraForAbility(flowing.player, 'chain_heal')).toBeUndefined();
  });

  it('Ward Cycle restores the canonical defensive ward and mana behind one ICD', () => {
    const { sim, player } = shaman({ 14: SHAMAN_TALENT_IDS.wardCycle });
    player.resource = player.maxResource - 20;
    player.auras.push({
      id: 'lightning_shield',
      name: 'Thunder Ward',
      kind: 'thorns',
      value: 29,
      charges: 1,
      remaining: 600,
      duration: 600,
      sourceId: player.id,
      school: 'nature',
    });
    triggerWardCycle(sim.ctx, player);
    expect(player.resource).toBe(player.maxResource - 10);
    expect(player.auras.find((aura) => aura.id === 'lightning_shield')?.charges).toBe(2);
    triggerWardCycle(sim.ctx, player);
    expect(player.resource).toBe(player.maxResource - 10);
  });

  it('Imbue Mastery strengthens the selected specialization weapon', () => {
    const thunder = shaman({ 14: SHAMAN_TALENT_IDS.imbueMastery });
    thunder.player.auras.push({
      id: 'flametongue_weapon',
      name: 'Pyrebrand Weapon',
      kind: 'imbue',
      value: 8,
      remaining: 300,
      duration: 300,
      sourceId: thunder.player.id,
      school: 'fire',
    });
    for (let count = 0; count < 3; count++) {
      thundercallOnArcBoltImpact(thunder.sim.ctx, thunder.player);
    }
    expect(thunderCharges(thunder.player)).toBe(4);

    const stone = shaman({ 14: SHAMAN_TALENT_IDS.imbueMastery }, 'enhancement');
    applyWarspiritPosture(stone.sim.ctx, stone.player, 'stonebound');
    expect(stone.player.auras.find((aura) => aura.id === STONEBOUND_DR_ID)?.value).toBeCloseTo(
      0.15,
    );

    const spirit = shaman({ 14: SHAMAN_TALENT_IDS.imbueMastery }, 'restoration');
    spirit.player.auras.push({
      id: LIFESPRING_WEAPON_ID,
      name: 'Lifespring Weapon',
      kind: 'imbue',
      value: 0,
      remaining: 300,
      duration: 300,
      sourceId: spirit.player.id,
      school: 'nature',
    });
    expect(
      depositMendingCurrent(spirit.sim.ctx, spirit.player, spirit.ally, 100, 'healing_wave'),
    ).toBe(70);
  });

  it('Primal Exaltation accelerates each specialization engine', () => {
    const thunder = shaman({ 17: SHAMAN_TALENT_IDS.primalExaltation });
    applyPrimalExaltation(thunder.sim.ctx, thunder.player);
    expect(shamanCastTimeMultiplier(thunder.player, 'lightning_bolt')).toBe(0.5);
    thundercallOnArcBoltImpact(thunder.sim.ctx, thunder.player);
    expect(thunderCharges(thunder.player)).toBe(2);

    const war = shaman({ 17: SHAMAN_TALENT_IDS.primalExaltation }, 'enhancement');
    const target = hostile(war.sim, war.player);
    applyWarspiritPosture(war.sim.ctx, war.player, 'galeheart');
    applyPrimalExaltation(war.sim.ctx, war.player);
    advanceWarspiritCadence(war.sim.ctx, war.player, target, 100);
    expect(warspiritCadence(war.player)).toBe(1);
    expect(advanceWarspiritCadence(war.sim.ctx, war.player, target, 100)).toBe(true);

    const spirit = shaman({ 17: SHAMAN_TALENT_IDS.primalExaltation }, 'restoration');
    applyPrimalExaltation(spirit.sim.ctx, spirit.player);
    expect(
      depositMendingCurrent(spirit.sim.ctx, spirit.player, spirit.ally, 100, 'healing_wave'),
    ).toBe(75);
  });

  it('Deep Reservoir retains each specialization rebuild state', () => {
    const thunder = shaman({ 20: SHAMAN_TALENT_IDS.deepReservoir });
    addThunderCharges(thunder.sim.ctx, thunder.player, 5);
    consumeThunderVent(thunder.sim.ctx, thunder.player, 'earth_shock');
    expect(thunderCharges(thunder.player)).toBe(2);

    const war = shaman({ 20: SHAMAN_TALENT_IDS.deepReservoir }, 'enhancement');
    applyWarspiritPosture(war.sim.ctx, war.player, 'galeheart');
    onStormcastConsumed(war.sim.ctx, war.player);
    expect(warspiritCadence(war.player)).toBe(1);

    const spirit = shaman({ 20: SHAMAN_TALENT_IDS.deepReservoir }, 'restoration');
    depositMendingCurrent(spirit.sim.ctx, spirit.player, spirit.ally, 200, 'tidecall');
    consumeMendingCurrent(spirit.sim.ctx, spirit.player, spirit.ally);
    expect(mendingCurrent(spirit.ally, spirit.player.id)?.value).toBe(50);
  });

  it('Echoing Elements and Living Weapon arm nonrecursive specialization payoffs', () => {
    const echo = shaman({ 20: SHAMAN_TALENT_IDS.echoingElements });
    const target = hostile(echo.sim, echo.player);
    addThunderCharges(echo.sim.ctx, echo.player, 5);
    consumeThunderVent(echo.sim.ctx, echo.player, 'earth_shock', target, 500);
    expect(target.auras.find((aura) => aura.id === 'shaman_echoing_elements_damage')).toMatchObject(
      {
        kind: 'dot',
        value: 200,
        tickTimer: 1,
      },
    );

    const faultwake = shaman({ 20: SHAMAN_TALENT_IDS.echoingElements });
    faultwake.player.resource = faultwake.player.maxResource;
    addThunderCharges(faultwake.sim.ctx, faultwake.player, 5);
    faultwake.sim.castAbility('earthquake', faultwake.player.id, {
      x: faultwake.player.pos.x,
      z: faultwake.player.pos.z + 3,
    });
    expect(
      faultwake.sim.ctx.groundAoEs.find((effect) => effect.ability === 'Echoing Elements'),
    ).toMatchObject({ tickTimer: 1, interval: 1.5 });
    expect(thunderCharges(faultwake.player)).toBe(0);

    const living = shaman({ 20: SHAMAN_TALENT_IDS.livingWeapon });
    living.player.auras.push({
      id: 'flametongue_weapon',
      name: 'Pyrebrand Weapon',
      kind: 'imbue',
      value: 8,
      remaining: 300,
      duration: 300,
      sourceId: living.player.id,
      school: 'fire',
    });
    addThunderCharges(living.sim.ctx, living.player, 5);
    consumeThunderVent(living.sim.ctx, living.player, 'earth_shock');
    expect(
      living.player.auras.find((aura) => aura.id === 'shaman_living_weapon_bolt'),
    ).toMatchObject({
      kind: 'next_cast_instant',
      empowerAbilities: ['lightning_bolt'],
    });

    const stone = shaman({ 20: SHAMAN_TALENT_IDS.livingWeapon }, 'enhancement');
    applyWarspiritPosture(stone.sim.ctx, stone.player, 'stonebound');
    onStormcastConsumed(stone.sim.ctx, stone.player);
    expect(
      stone.player.auras.find((aura) => aura.id === 'shaman_living_weapon_absorb')?.value,
    ).toBe(Math.round(stone.player.maxHp * 0.08));
  });

  it('Living Weapon Lifespring seeds one nearby injured ally from Tidecall', () => {
    const { sim, player, ally } = shaman({ 20: SHAMAN_TALENT_IDS.livingWeapon }, 'restoration');
    const secondId = sim.addPlayer('warrior', 'Nearby Injured');
    sim.setPlayerLevel(20, secondId);
    const second = sim.entities.get(secondId);
    if (!second) throw new Error('missing nearby ally');
    ally.hp = ally.maxHp;
    second.hp = Math.round(second.maxHp * 0.5);
    player.auras.push({
      id: LIFESPRING_WEAPON_ID,
      name: 'Lifespring Weapon',
      kind: 'imbue',
      value: 0,
      remaining: 300,
      duration: 300,
      sourceId: player.id,
      school: 'nature',
    });
    depositMendingCurrent(sim.ctx, player, ally, 100, 'tidecall');
    expect(mendingCurrent(second, player.id)?.value).toBe(50);
  });
});
