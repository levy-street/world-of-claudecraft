import { describe, expect, it } from 'vitest';
import { rangedSwing } from '../src/sim/combat/auto_attack';
import { onCastCompleted, onHotExpired } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

function rig(
  cls: PlayerClass,
  level: number,
  rows: Record<number, string>,
  spec: string | null = null,
) {
  const sim = new Sim({ seed: 17, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function addTargetMob(sim: Sim, hp = 100000, dist = 10): Entity {
  const p = sim.player;
  const mob = createMob(9200, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = 0;
  return mob;
}

function castAndSettle(sim: Sim, ability: string, seconds = 4, refill = true): void {
  if (refill) sim.player.resource = sim.player.maxResource;
  sim.castAbility(ability);
  for (let i = 0; i < 20 * seconds; i++) sim.tick();
}

function dealDamage(sim: Sim, target: Entity, amount: number): void {
  (
    sim as unknown as {
      dealDamage(
        s: Entity | null,
        t: Entity,
        n: number,
        c: boolean,
        sc: string,
        a: string | null,
        k: string,
      ): void;
    }
  ).dealDamage(null, target, amount, false, 'physical', null, 'hit');
}

function completeCast(sim: Sim, ability: string, target: Entity | null = null): void {
  onCastCompleted(
    (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx,
    sim.player,
    ability,
    target,
  );
}

function expireHot(sim: Sim, ability: string, target: Entity): void {
  onHotExpired(
    (sim as unknown as { ctx: Parameters<typeof onHotExpired>[0] }).ctx,
    sim.player,
    ability,
    target,
  );
}

describe('mage wave 2 choice rows', () => {
  it('Mana Attunement and Slow Burn create visible next-cast decisions', () => {
    const { sim, p } = rig('mage', 20, {
      5: 'mag_r5_mana_attunement',
      14: 'mag_r14_hot_streak',
    });
    p.resource = p.maxResource - 100;
    for (let i = 0; i < 3; i++) completeCast(sim, 'fireball');
    expect(p.auras.some((a) => a.id === 'mag_mana_attunement')).toBe(true);
    expect(p.resource).toBe(p.maxResource - 80);
    expect(p.auras.some((a) => a.id === 'mag_slow_burn')).toBe(true);
    expect(p.auras.find((a) => a.id === 'mag_slow_burn')?.kind).toBe('next_cast_instant');
  });

  it('Mana Attunement counts successful Waterbind casts', () => {
    const { sim, p } = rig('mage', 20, { 5: 'mag_r5_mana_attunement' });
    for (let i = 0; i < 3; i++) castAndSettle(sim, 'conjure_water');
    expect(p.auras.some((a) => a.id === 'mag_mana_attunement')).toBe(true);
  });

  it('Deep Rime and Battlemage Armor apply shields from their triggers', () => {
    const { sim, p } = rig('mage', 20, {
      11: 'mag_r11_permafrost',
      17: 'mag_r17_battlemage_armor',
    });
    addTargetMob(sim, 100000, 3);
    castAndSettle(sim, 'frost_nova', 2);
    expect(p.auras.some((a) => a.id === 'mag_deep_rime' && a.kind === 'absorb')).toBe(true);
    dealDamage(sim, p, Math.ceil(p.maxHp * 0.2));
    expect(p.auras.some((a) => a.id === 'mag_battlemage_armor')).toBe(true);
  });
});

describe('hunter wave 2 choice rows', () => {
  it('Guisecraft responds to Harrier, Marten, and Courser guises', () => {
    for (const aspect of ['aspect_of_the_hawk', 'aspect_of_the_monkey', 'aspect_of_the_cheetah']) {
      const { sim, p } = rig('hunter', 20, { 5: 'hun_r5_aspect_mastery' });
      completeCast(sim, aspect);
      expect(p.auras.find((a) => a.id === 'hun_aspect_mastery')?.kind, aspect).toBe(
        'next_cast_cheap',
      );
    }
  });

  it('Venom Barb arms a free Fell Shot and Rattling Shot arms an immediate follow-up', () => {
    const resetRig = rig('hunter', 20, { 5: 'hun_r5_improved_serpent_sting' });
    addTargetMob(resetRig.sim, 100000, 10);
    completeCast(resetRig.sim, 'serpent_sting');
    expect(resetRig.p.auras.find((a) => a.id === 'hun_venom_relay')?.kind).toBe('next_cast_free');

    const burst = rig('hunter', 20, { 14: 'hun_r14_sniper_training' });
    addTargetMob(burst.sim, 100000, 10);
    burst.p.cooldowns.set('arcane_shot', 5);
    completeCast(burst.sim, 'concussive_shot');
    expect(burst.p.cooldowns.has('arcane_shot')).toBe(false);
    expect(burst.p.auras.find((a) => a.id === 'hun_full_draw_rhythm')?.kind).toBe('next_cast_free');
  });

  it('Lean Quiver counts Auto Shot, restores mana, and refreshes its pending Long Draw', () => {
    const { sim, p } = rig('hunter', 20, { 11: 'hun_r11_efficiency' });
    const target = addTargetMob(sim, 100000, 10);
    p.resource = p.maxResource - 80;
    for (let i = 0; i < 3; i++) {
      rangedSwing(sim.ctx, p, target, { min: 10, max: 14, speed: 2.4 });
    }
    expect(p.auras.some((a) => a.id === 'hun_lean_quiver')).toBe(true);
    expect(p.resource).toBe(p.maxResource - 60);
    const first = p.auras.find((a) => a.id === 'hun_lean_quiver');
    if (!first) throw new Error('missing Lean Quiver empowerment');
    first.remaining = 2;
    for (let i = 0; i < 3; i++) {
      rangedSwing(sim.ctx, p, target, { min: 10, max: 14, speed: 2.4 });
    }
    expect(first.remaining).toBe(8);
    expect(p.resource).toBe(p.maxResource - 40);
    p.resource = p.maxResource;
    sim.castAbility('aimed_shot');
    expect(p.castingAbility).toBeNull();
    expect(p.auras.some((a) => a.id === 'hun_lean_quiver')).toBe(false);
  });

  it('Patch Up is baseline pet-only care that heals a living pet or revives a dead one', () => {
    const { sim, p } = rig('hunter', 20, {});
    const pet = createMob(9301, MOBS.forest_wolf, 20, {
      x: p.pos.x + 2,
      y: p.pos.y,
      z: p.pos.z,
    });
    pet.hostile = false;
    pet.ownerId = p.id;
    pet.maxHp = 1000;
    pet.hp = 500;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(pet);

    expect(sim.resolvedAbility('revive_pet')?.def.name).toBe('Patch Up');
    sim.castAbility('revive_pet');
    for (let i = 0; i < 61; i++) sim.tick();
    expect(pet.auras.some((a) => a.kind === 'hot')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'hot')).toBe(false);

    pet.dead = true;
    pet.hp = 0;
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('revive_pet');
    for (let i = 0; i < 61; i++) sim.tick();
    expect(pet.dead).toBe(false);
    expect(pet.hp).toBeGreaterThan(0);

    const improved = rig('hunter', 20, { 11: 'hun_r11_mend_pet' });
    expect(improved.sim.resolvedAbility('revive_pet')?.effects[0]).toMatchObject({
      type: 'hot',
      total: 360,
    });
  });

  it('Bristleguard is exactly 50 percentage points of dodge for 10 sec', () => {
    const { sim } = rig('hunter', 20, { 17: 'hun_r17_deterrence' });
    const resolved = sim.resolvedAbility('deterrence');
    expect(resolved?.effects).toEqual([
      { type: 'selfBuff', kind: 'buff_dodge', value: 0.5, duration: 10 },
    ]);
    expect(resolved?.def.description).toContain('50 percentage points');
  });

  it('Dreamthorn gives Fieldcraft a real burst window even when its control breaks', () => {
    const { sim, p } = rig('hunter', 20, {}, 'survival');
    const target = addTargetMob(sim, 100000, 10);
    sim.castAbility('wyvern_sting');
    for (let i = 0; i < 20 && !target.auras.some((a) => a.kind === 'incapacitate'); i++) sim.tick();
    expect(target.auras.some((a) => a.kind === 'incapacitate')).toBe(true);
    dealDamage(sim, target, 1);
    expect(target.auras.some((a) => a.kind === 'incapacitate')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'buff_dmg_done' && a.value === 0.15)).toBe(true);
    expect(p.auras.some((a) => a.kind === 'buff_haste' && a.value === 1.15)).toBe(true);
  });

  it('Wildfang Rally grants both attack power and 5% attack speed', () => {
    const { sim, p } = rig('hunter', 20, { 20: 'hun_r20_aspect_of_the_wild' });
    sim.castAbility('aspect_of_the_wild');
    expect(p.auras.some((a) => a.kind === 'buff_ap' && a.value === 45)).toBe(true);
    expect(p.auras.some((a) => a.kind === 'buff_haste' && a.value === 1.05)).toBe(true);
  });

  it('Calloused Hide makes the scoped physical Long Draw cast instant', () => {
    const { sim, p } = rig('hunter', 20, { 17: 'hun_r17_thick_hide' });
    addTargetMob(sim, 100000, 10);
    dealDamage(sim, p, Math.ceil(p.maxHp * 0.2));
    expect(p.auras.some((a) => a.id === 'hun_calloused_hide')).toBe(true);
    p.resource = p.maxResource;
    sim.castAbility('aimed_shot');
    expect(p.castingAbility).toBeNull();
    expect(p.auras.some((a) => a.id === 'hun_calloused_hide')).toBe(false);
  });

  it('Bloodbond, Deathless Will, and Arrowfall use pet-share, big-hit, and channel hooks', () => {
    const { sim, p } = rig('hunter', 20, {
      11: 'hun_r11_mend_pet',
      17: 'hun_r17_master_tamer',
      20: 'hun_r20_improved_volley',
    });
    const pet = createMob(9300, MOBS.forest_wolf, 20, {
      x: p.pos.x + 2,
      y: p.pos.y,
      z: p.pos.z,
    });
    pet.hostile = false;
    pet.ownerId = p.id;
    pet.maxHp = pet.hp = 1000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(pet);
    p.hp = p.maxHp;
    const playerBefore = p.hp;
    const petBefore = pet.hp;
    dealDamage(sim, p, 100);
    expect(playerBefore - p.hp).toBe(80);
    expect(petBefore - pet.hp).toBe(20);
    p.resource = p.maxResource;
    sim.castAbility('volley', p.id, { x: p.pos.x, z: p.pos.z + 10 });
    const channelRemaining = p.castRemaining;
    (sim as unknown as { pushbackCast(target: Entity): void }).pushbackCast(p);
    expect(p.castRemaining).toBe(channelRemaining);
    expect(sim.resolvedAbility('volley')?.effects[0]).toMatchObject({
      type: 'aoeDamage',
      min: 18,
      max: 24,
    });

    const guarded = rig('hunter', 20, { 11: 'hun_r11_survival_instincts' });
    dealDamage(guarded.sim, guarded.p, Math.ceil(guarded.p.maxHp * 0.35));
    expect(guarded.p.auras.find((a) => a.id === 'hun_deathless_will')?.value).toBe(200);
  });
});

describe('rogue wave 2 choice rows', () => {
  it('Evasion grants a cheap builder and poison swings restore energy', () => {
    const { sim, p } = rig('rogue', 20, {
      14: 'rog_r14_deadly_brew',
      17: 'rog_r17_improved_evasion',
    });
    addTargetMob(sim, 100000, 3);
    p.resource = 40;
    castAndSettle(sim, 'evasion', 1, false);
    expect(p.auras.some((a) => a.id === 'rog_improved_evasion')).toBe(true);
    castAndSettle(sim, 'instant_poison', 2);
    p.resource = 20;
    sim.startAutoAttack();
    for (let i = 0; i < 20 * 6 && p.resource <= 20; i++) sim.tick();
    expect(p.resource).toBeGreaterThan(20);
  });

  it('Cheat Death prevents one killing blow', () => {
    const { sim, p } = rig('rogue', 20, { 17: 'rog_r17_cheat_death' });
    dealDamage(sim, p, p.hp + 100);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(1);
  });
});

describe('druid wave 2 choice rows', () => {
  it('form and heal loops create cheap casts, cooldown resets, and echoes', () => {
    const { sim, p } = rig('druid', 20, {
      5: 'dru_r5_ferocity',
      14: 'dru_r14_empowered_touch',
    });
    castAndSettle(sim, 'cat_form', 1);
    expect(p.auras.some((a) => a.id === 'dru_redmaw')).toBe(true);

    // Nature's Bounty is self-contained at unlock: a full Wildbloom empowers
    // baseline Wildmend rather than waiting for a later spell.
    const healer = rig('druid', 20, { 5: 'dru_r5_natures_bounty' });
    healer.p.hp = Math.round(healer.p.maxHp * 0.5);
    expireHot(healer.sim, 'rejuvenation', healer.p);
    expect(healer.p.auras.some((a) => a.kind === 'next_cast_instant')).toBe(true);
  });

  it('Empowered Touch echo and Survival of the Fittest big-hit loop resolve', () => {
    const { sim, p } = rig('druid', 20, { 14: 'dru_r14_empowered_touch' });
    p.hp = Math.round(p.maxHp * 0.7);
    sim.targetEntity(sim.playerId);
    castAndSettle(sim, 'healing_touch', 4);
    expect(p.auras.some((a) => a.id === 'dru_empowered_touch')).toBe(true);
    p.hp = Math.round(p.maxHp * 0.4);
    dealDamage(sim, p, Math.ceil(p.maxHp * 0.2));
    expect(p.auras.some((a) => a.id === 'dru_empowered_touch')).toBe(false);

    const bear = rig('druid', 20, {
      17: 'dru_r17_survival_of_the_fittest',
      20: 'dru_r20_improved_hurricane',
    });
    // Survival of the Fittest is now self-contained: a big hit restores rage
    // and grants a shield, instead of refunding the same-row Savage Mending.
    castAndSettle(bear.sim, 'bear_form', 1);
    expect(bear.p.resourceType).toBe('rage');
    bear.p.resource = 0;
    dealDamage(bear.sim, bear.p, Math.ceil(bear.p.maxHp * 0.25));
    expect(bear.p.resource).toBe(20);
    expect(bear.p.auras.some((a) => a.id === 'dru_survival_of_the_fittest')).toBe(true);
    bear.p.cooldowns.set('hurricane', 10);
    completeCast(bear.sim, 'hurricane');
    expect(bear.p.cooldowns.get('hurricane')).toBe(6);
    expect(bear.p.auras.some((a) => a.id === 'dru_improved_hurricane')).toBe(true);
  });
});

describe('warlock wave 2 choice rows', () => {
  it('Fire and curse rhythms empower Shadow Bolt', () => {
    const { sim, p } = rig('warlock', 20, {
      5: 'wlk_r5_improved_immolate',
      14: 'wlk_r14_ruin',
      20: 'wlk_r20_curse_mastery',
    });
    for (let i = 0; i < 3; i++) completeCast(sim, 'immolate');
    expect(p.auras.some((a) => a.id === 'wlk_improved_immolate')).toBe(true);
    for (let i = 0; i < 3; i++) completeCast(sim, 'curse_of_agony');
    expect(p.auras.some((a) => a.id === 'wlk_curse_mastery')).toBe(true);
  });

  it('Deepened Hex and defensive pact hooks change live combat outcomes', () => {
    const hit = (withDot: boolean) => {
      const { sim } = rig('warlock', 20, { 14: 'wlk_r14_amplify_curse' });
      const mob = addTargetMob(sim);
      if (withDot) {
        mob.auras.push({
          id: 'corruption',
          name: 'Corruption',
          kind: 'dot',
          remaining: 10,
          duration: 10,
          value: 1,
          tickInterval: 99,
          tickTimer: 99,
          sourceId: sim.player.id,
          school: 'shadow',
        });
      }
      const before = mob.hp;
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('shadow_bolt');
      for (let i = 0; i < 20 * 4; i++) sim.tick();
      expect(mob.dead).toBe(false);
      return before - mob.hp;
    };
    expect(hit(true)).toBeGreaterThan(hit(false) * 1.15);

    const guarded = rig('warlock', 20, {
      11: 'wlk_r11_demon_armor',
      17: 'wlk_r17_demonic_resilience',
    });
    guarded.p.hp = Math.round(guarded.p.maxHp * 0.5);
    const before = guarded.p.hp;
    dealDamage(guarded.sim, guarded.p, Math.ceil(guarded.p.maxHp * 0.2));
    expect(guarded.p.auras.some((a) => a.id === 'wlk_demon_armor')).toBe(true);
    expect(guarded.p.hp).toBeGreaterThan(before - Math.ceil(guarded.p.maxHp * 0.2));
  });
});
