import { describe, expect, it } from 'vitest';
import { doctrineConvertDamage, placeDoctrineLink } from '../src/sim/combat/priest/doctrine';
import {
  priestOnGroupHeal,
  priestOnShieldConsumed,
  priestOnVigilTriggered,
} from '../src/sim/combat/priest/talents';
import { addGloomtithe, bindEffigy, vespersEchoDamage } from '../src/sim/combat/priest/vespers';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity } from '../src/sim/types';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function playerMeta(ctx: SimContext, player: Entity) {
  const meta = ctx.players.get(player.id);
  if (!meta) throw new Error('player meta missing');
  return meta;
}

function priest(
  spec: 'discipline' | 'holy' | 'shadow',
  rows: Partial<Record<5 | 8 | 11 | 14 | 17 | 20, string>>,
): { sim: Sim; p: Entity; ctx: SimContext } {
  const sim = new Sim({ seed: 2910, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  return { sim, p: sim.player, ctx: ctxOf(sim) };
}

function addAlly(sim: Sim, name: string, distance = 4): Entity {
  const id = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, id);
  const ally = sim.entities.get(id);
  if (!ally) throw new Error('ally missing');
  ally.pos.x = sim.player.pos.x + distance;
  ally.pos.z = sim.player.pos.z;
  return ally;
}

function addMob(sim: Sim, id: number, distance = 8): Entity {
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function aura(input: Partial<Aura> & Pick<Aura, 'id' | 'name' | 'kind' | 'sourceId'>): Aura {
  return {
    remaining: 18,
    duration: 18,
    value: 1,
    school: 'holy',
    ...input,
  } as Aura;
}

function advance(sim: Sim, seconds: number): void {
  for (let tick = 0; tick < seconds * 20; tick++) sim.tick();
}

describe('Priest v0.29 talent mechanics', () => {
  it('resolves each level 5 movement choice onto the intended existing action', () => {
    const shelter = priest('discipline', { 5: 'pri_r5_improved_renew' });
    const ally = addAlly(shelter.sim, 'Sheltered');
    shelter.sim.targetEntity(ally.id);
    shelter.sim.castAbility('power_word_shield');
    expect(ally.auras.find((effect) => effect.id === 'priest_sheltering_step')?.value).toBe(1.4);

    const unbound = priest('discipline', { 5: 'pri_r5_searing_light' });
    unbound.p.auras.push(
      aura({ id: 'test_root', name: 'Test Root', kind: 'root', sourceId: 999 }),
      aura({ id: 'test_slow', name: 'Test Slow', kind: 'slow', sourceId: 999 }),
    );
    unbound.sim.castAbility('veilstep');
    expect(unbound.p.auras.some((effect) => effect.kind === 'root' || effect.kind === 'slow')).toBe(
      false,
    );
    expect(unbound.p.auras.find((effect) => effect.id === 'priest_veil_unbound')?.value).toBe(1.5);

    const procession = priest('discipline', { 5: 'pri_r5_twisted_faith' });
    procession.sim.castAbility('veilstep');
    expect(procession.p.auras.some((effect) => effect.kind === 'processional_grace')).toBe(true);
  });

  it('pins all level 8 defensive values in the resolved proc engine', () => {
    const last = priest('discipline', { 8: 'pri_r17_desperate_prayer' });
    expect(last.sim.resolvedAbility('desperate_prayer')).not.toBeNull();
    last.p.hp = Math.floor(last.p.maxHp * 0.5);
    const beforePrayer = last.p.hp;
    last.sim.castAbility('desperate_prayer');
    expect(last.p.hp - beforePrayer).toBe(Math.round(last.p.maxHp * 0.3));

    const shattered = priest('discipline', { 8: 'pri_r8_improved_shield' });
    expect(
      shattered.ctx.playerMods(playerMeta(shattered.ctx, shattered.p)).procs[0].responses,
    ).toEqual([{ kind: 'heal', amountPctMaxHp: 0.12 }]);
    shattered.p.hp = Math.floor(shattered.p.maxHp * 0.5);
    shattered.sim.targetEntity(shattered.p.id);
    shattered.sim.castAbility('power_word_shield');
    const shield = shattered.p.auras.find((effect) => effect.id === 'power_word_shield');
    if (!shield) throw new Error('missing Psalm of Warding');
    shattered.sim.drainEvents();
    shattered.sim.dealDamage(
      null,
      shattered.p,
      shield.value + 10,
      false,
      'shadow',
      'Test Hit',
      'hit',
    );
    expect(shattered.sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'heal2', ability: 'Shattered Psalm' }),
    );

    const wounded = priest('discipline', { 8: 'pri_r17_inner_fire' });
    const proc = wounded.ctx.playerMods(playerMeta(wounded.ctx, wounded.p)).procs[0];
    expect(proc.trigger).toEqual({ on: 'bigHitTaken', hpFrac: 0.15, icd: 20 });
    expect(proc.responses).toEqual([
      { kind: 'absorb', amountPctMaxHp: 0.15, duration: 10, name: 'Wounded Halo' },
    ]);
    wounded.sim.dealDamage(
      null,
      wounded.p,
      Math.ceil(wounded.p.maxHp * 0.16),
      false,
      'shadow',
      'Test Hit',
      'hit',
    );
    expect(wounded.p.auras).toContainEqual(
      expect.objectContaining({
        id: 'pri_inner_fire',
        kind: 'absorb',
        value: Math.round(wounded.p.maxHp * 0.15),
      }),
    );
  });

  it('runs all level 11 control outcomes, including per-enemy Binding Psalm ICD', () => {
    const hush = priest('discipline', { 11: 'pri_r8_silence' });
    const silenced = addMob(hush.sim, 9929);
    silenced.castingAbility = 'fireball';
    silenced.castRemaining = 3;
    hush.sim.targetEntity(silenced.id);
    hush.sim.castAbility('silence');
    advance(hush.sim, 1);
    expect(silenced.auras).toContainEqual(
      expect.objectContaining({ id: 'silence_silence', kind: 'silence', duration: 4 }),
    );

    const lingering = priest('discipline', { 11: 'pri_r8_psychic_scream' });
    expect(lingering.sim.resolvedAbility('psychic_scream')?.cooldown).toBeCloseTo(21);
    const feared = addMob(lingering.sim, 9930, 3);
    lingering.sim.castAbility('psychic_scream');
    expect(feared.auras).toContainEqual(
      expect.objectContaining({
        id: 'fear_incap',
        name: 'Terror Canticle',
        kind: 'incapacitate',
      }),
    );
    advance(lingering.sim, 4.1);
    expect(
      feared.auras.some((effect) => effect.id === 'priest_lingering_dread' && effect.value === 0.5),
    ).toBe(true);

    const binding = priest('discipline', { 11: 'pri_r11_vampiric_embrace' });
    const owner = addAlly(binding.sim, 'Shield Owner');
    const attacker = addMob(binding.sim, 9931);
    binding.sim.targetEntity(owner.id);
    binding.sim.castAbility('power_word_shield');
    const shield = owner.auras.find((effect) => effect.id === 'power_word_shield');
    if (!shield) throw new Error('missing Binding Psalm shield');
    binding.sim.dealDamage(
      attacker,
      owner,
      shield.value + 10,
      false,
      'physical',
      'Test Hit',
      'hit',
    );
    expect(attacker.auras).toContainEqual(
      expect.objectContaining({
        id: `binding_psalm_${binding.p.id}`,
        kind: 'root',
        remaining: 2,
      }),
    );
    priestOnShieldConsumed(binding.ctx, binding.p, shield, owner, attacker);
    expect(
      attacker.auras.filter((effect) => effect.id === `binding_psalm_${binding.p.id}`),
    ).toHaveLength(1);
    expect(attacker.procState?.icds[`binding_psalm_${binding.p.id}`]).toBe(12);
  });

  it('pins Stilled Mind, Measured Faith, and the Doctrine Living Covenant rider', () => {
    const stilled = priest('discipline', { 14: 'pri_r11_inner_focus' });
    stilled.sim.castAbility('inner_focus');
    expect(
      stilled.p.auras
        .filter((effect) => effect.id.startsWith('inner_focus'))
        .map((effect) => effect.kind)
        .sort(),
    ).toEqual(['cast_shield', 'next_cast_free']);

    const measured = priest('discipline', { 14: 'pri_r11_meditation' });
    measured.sim.targetEntity(measured.p.id);
    for (let cast = 0; cast < 3; cast++) {
      measured.sim.castAbility('renew');
      advance(measured.sim, 2);
    }
    expect(measured.p.auras).toContainEqual(
      expect.objectContaining({
        id: 'pri_measured_faith',
        kind: 'next_cast_cheap',
        value: 0.5,
        duration: 10,
      }),
    );
    const beforeDiscountedCast = measured.p.resource;
    measured.sim.castAbility('renew');
    expect(beforeDiscountedCast - measured.p.resource).toBe(38);
    expect(measured.p.auras.some((effect) => effect.id === 'pri_measured_faith')).toBe(false);

    const living = priest('discipline', { 14: 'pri_r14_pain_and_suffering' });
    const ally = addAlly(living.sim, 'Living Link');
    ally.hp = Math.floor(ally.maxHp * 0.5);
    ally.auras.push(
      aura({
        id: 'power_word_shield',
        name: 'Psalm of Warding',
        kind: 'absorb',
        sourceId: living.p.id,
        value: 50,
        value2: 100,
      }),
    );
    placeDoctrineLink(living.ctx, living.p, ally);
    doctrineConvertDamage(living.ctx, living.p, 100, 'holy', 'smite');
    expect(ally.auras.find((effect) => effect.id === 'power_word_shield')?.value).toBe(56);
  });

  it('pins all three level 17 major prayers to their starting values', () => {
    expect(ABILITIES.power_infusion.cooldown).toBe(120);
    expect(ABILITIES.power_infusion.effects).toEqual([
      { type: 'buffTarget', kind: 'buff_spellhaste', value: 0.2, duration: 15 },
      { type: 'buffTarget', kind: 'buff_dmg_done', value: 0.2, duration: 15 },
      { type: 'buffTarget', kind: 'buff_heal_done', value: 0.2, duration: 15 },
    ]);
    expect(ABILITIES.martyrs_aegis.effects).toEqual([
      { type: 'buffTarget', kind: 'shield_wall', value: 0.4, duration: 8 },
    ]);
    expect(ABILITIES.choir_of_deliverance.channel).toEqual({ duration: 6, ticks: 3 });
    expect(ABILITIES.choir_of_deliverance.cooldown).toBe(180);
  });

  it('routes all three level 17 prayers through their real cast paths', () => {
    const { sim } = priest('discipline', { 17: 'pri_r17_anointing' });
    const ally = addAlly(sim, 'Anointed Ally');
    sim.targetEntity(ally.id);

    sim.castAbility('power_infusion');

    expect(
      ally.auras
        .filter((effect) => effect.name === 'Anointing')
        .map((effect) => effect.kind)
        .sort(),
    ).toEqual(['buff_dmg_done', 'buff_heal_done', 'buff_spellhaste']);

    const aegis = priest('discipline', { 17: 'pri_r17_martyrs_aegis' });
    const protectedAlly = addAlly(aegis.sim, 'Protected Ally');
    aegis.sim.targetEntity(protectedAlly.id);
    aegis.sim.castAbility('martyrs_aegis');
    expect(protectedAlly.auras).toContainEqual(
      expect.objectContaining({
        id: 'martyrs_aegis',
        kind: 'shield_wall',
        value: 0.4,
        remaining: 8,
      }),
    );

    const choir = priest('holy', { 17: 'pri_r17_choir_of_deliverance' });
    const woundedAlly = addAlly(choir.sim, 'Choir Ally');
    woundedAlly.hp = Math.floor(woundedAlly.maxHp * 0.5);
    const before = woundedAlly.hp;
    choir.sim.castAbility('choir_of_deliverance');
    advance(choir.sim, 6.5);
    expect(woundedAlly.hp).toBeGreaterThan(before);
  });

  it('applies Twin Covenant to Doctrine, Benison charges, and Vespers links', () => {
    const doctrine = priest('discipline', { 20: 'pri_r20_twin_covenant' });
    const first = addAlly(doctrine.sim, 'Twin One', 4);
    const second = addAlly(doctrine.sim, 'Twin Two', 6);
    placeDoctrineLink(doctrine.ctx, doctrine.p, first);
    placeDoctrineLink(doctrine.ctx, doctrine.p, second);
    expect(
      [first, second].map(
        (ally) => ally.auras.find((effect) => effect.id === 'priest_doctrine')?.value,
      ),
    ).toEqual([0.7, 0.7]);

    const holy = priest('holy', { 20: 'pri_r20_twin_covenant' });
    expect(holy.sim.resolvedAbility('seraphic_vigil')?.charges).toBe(2);

    const shadow = priest('shadow', { 20: 'pri_r20_twin_covenant' });
    const mobA = addMob(shadow.sim, 9940, 8);
    const mobB = addMob(shadow.sim, 9941, 10);
    for (const mob of [mobA, mobB]) {
      mob.auras.push(
        aura({
          id: 'shadow_word_pain',
          name: 'Dirge of Decay',
          kind: 'dot',
          sourceId: shadow.p.id,
          school: 'shadow',
        }),
      );
      expect(bindEffigy(shadow.ctx, shadow.p, mob)).toBe(true);
    }
    expect(
      [mobA, mobB].filter((mob) => mob.auras.some((effect) => effect.id === 'priest_effigy')),
    ).toHaveLength(2);
  });

  it('schedules one non-recursive Second Verse for all three spec payoffs', () => {
    const doctrine = priest('discipline', { 20: 'pri_r20_second_verse' });
    const ally = addAlly(doctrine.sim, 'Second Mercy');
    ally.hp = Math.floor(ally.maxHp * 0.5);
    placeDoctrineLink(doctrine.ctx, doctrine.p, ally);
    doctrineConvertDamage(doctrine.ctx, doctrine.p, 100, 'holy', 'scouring_mercy');
    expect(
      ally.auras.some((effect) => effect.id.startsWith('priest_second_verse_scouring_mercy')),
    ).toBe(true);

    const holy = priest('holy', { 20: 'pri_r20_second_verse' });
    const holyAlly = addAlly(holy.sim, 'Second Canticle');
    priestOnGroupHeal(holy.ctx, holy.p, holyAlly, 'holy_nova', 'Sunburst Canticle', 100, 200, 80);
    expect(
      holyAlly.auras.some((effect) => effect.id.startsWith('priest_second_verse_holy_nova')),
    ).toBe(true);

    const shadow = priest('shadow', { 20: 'pri_r20_second_verse' });
    const primary = addMob(shadow.sim, 9950, 8);
    const secondary = addMob(shadow.sim, 9951, 10);
    for (const mob of [primary, secondary])
      mob.auras.push(
        aura({
          id: 'shadow_word_pain',
          name: 'Dirge of Decay',
          kind: 'dot',
          sourceId: shadow.p.id,
          school: 'shadow',
        }),
      );
    bindEffigy(shadow.ctx, shadow.p, primary);
    vespersEchoDamage(shadow.ctx, shadow.p, primary, 100, 'mind_blast');
    expect(
      secondary.auras.some((effect) => effect.id.startsWith('priest_second_verse_effigy')),
    ).toBe(true);
  });

  it('manifests every Incarnate Spirit branch, including the five-stack guardian bonus', () => {
    const doctrine = priest('discipline', { 20: 'pri_r20_incarnate_spirit' });
    const owner = addAlly(doctrine.sim, 'Incarnate Shield');
    owner.hp = Math.floor(owner.maxHp * 0.5);
    const before = owner.hp;
    priestOnShieldConsumed(
      doctrine.ctx,
      doctrine.p,
      aura({
        id: 'power_word_shield',
        name: 'Psalm of Warding',
        kind: 'absorb',
        sourceId: doctrine.p.id,
        value: 0,
        value2: 100,
      }),
      owner,
      null,
    );
    expect(owner.hp - before).toBe(40);

    const holy = priest('holy', { 20: 'pri_r20_incarnate_spirit' });
    const primary = addAlly(holy.sim, 'Vigil Primary', 4);
    const splash = addAlly(holy.sim, 'Vigil Splash', 5);
    holy.sim.partyInvite(primary.id, holy.p.id);
    holy.sim.partyAccept(primary.id);
    holy.sim.partyInvite(splash.id, holy.p.id);
    holy.sim.partyAccept(splash.id);
    splash.hp = Math.floor(splash.maxHp * 0.5);
    const splashBefore = splash.hp;
    priestOnVigilTriggered(holy.ctx, holy.p, primary, 100);
    expect(splash.hp - splashBefore).toBe(40);

    const shadow = priest('shadow', { 20: 'pri_r20_incarnate_spirit' });
    const target = addMob(shadow.sim, 9960, 8);
    target.auras.push(
      aura({
        id: 'shadow_word_pain',
        name: 'Dirge of Decay',
        kind: 'dot',
        sourceId: shadow.p.id,
        school: 'shadow',
      }),
    );
    bindEffigy(shadow.ctx, shadow.p, target);
    addGloomtithe(shadow.ctx, shadow.p, 5);
    shadow.p.gcdRemaining = 0;
    shadow.p.resource = shadow.p.maxResource;
    shadow.sim.castAbility('summon_tithefiend');
    shadow.sim.tick();
    const guardian = [...shadow.sim.entities.values()].find(
      (entity) => entity.guardianState?.key === 'tithefiend',
    );
    expect(guardian?.guardianState?.minDamage).toBe(98);
    expect(guardian?.guardianState?.remaining).toBeGreaterThan(22);
  });
});
