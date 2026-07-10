import { describe, expect, it } from 'vitest';
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
  it('shot rhythm procs grant free or instant followups', () => {
    const { sim, p } = rig('hunter', 20, {
      5: 'hun_r5_improved_serpent_sting',
      11: 'hun_r11_efficiency',
      14: 'hun_r14_sniper_training',
    });
    p.resource = p.maxResource - 30;
    for (let i = 0; i < 3; i++) completeCast(sim, 'serpent_sting');
    expect(p.auras.some((a) => a.id === 'hun_improved_venom_barb')).toBe(true);
    expect(p.auras.some((a) => a.id === 'hun_lean_quiver')).toBe(true);
    expect(p.resource).toBe(p.maxResource - 10);
    // Sniper Training is now an ability-mod (Long Draw casts faster + hits harder),
    // not a proc.
    const base = new Sim({ seed: 17, playerClass: 'hunter', autoEquip: true });
    base.setPlayerLevel(20);
    const modded = sim.resolvedAbility('aimed_shot')!;
    const baseline = base.resolvedAbility('aimed_shot')!;
    expect(modded.castTime).toBeLessThan(baseline.castTime);
    expect(modded.castTime).toBeCloseTo(baseline.castTime * 0.7, 5);
  });

  it('Master Tamer, Deathless Will, and Volley use HoT, big-hit, and channel hooks', () => {
    const { sim, p } = rig('hunter', 20, {
      11: 'hun_r11_mend_pet',
      17: 'hun_r17_master_tamer',
      20: 'hun_r20_improved_volley',
    });
    // Master Tamer is now a self-contained defensive proc (big hit -> shield),
    // no longer contingent on the Patch Up (mend_pet) talent.
    p.hp = p.maxHp;
    dealDamage(sim, p, Math.ceil(p.maxHp * 0.35));
    expect(p.auras.some((a) => a.id === 'hun_master_tamer')).toBe(true);
    completeCast(sim, 'volley');
    expect(p.auras.some((a) => a.id === 'hun_improved_volley')).toBe(true);

    const guarded = rig('hunter', 20, { 11: 'hun_r11_survival_instincts' });
    dealDamage(guarded.sim, guarded.p, Math.ceil(guarded.p.maxHp * 0.35));
    expect(guarded.p.auras.some((a) => a.id === 'hun_deathless_will')).toBe(true);
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

    // Nature's Bounty is now self-contained: a full-duration Rejuvenation
    // empowers the next Regrowth (baseline) instead of resetting Swiftmend.
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
