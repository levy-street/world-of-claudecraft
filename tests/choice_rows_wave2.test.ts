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

// The mage tree was replaced wholesale by the owner's design (2026-07-11);
// its coverage lives in tests/mage_choice_rows.test.ts.
describe('hunter wave 2 choice rows', () => {
  it('the reworked shot rows: venom damage, mana-only Lean Quiver, no relays', () => {
    // Balance pass: Deepvenom is a flat poison boost (no free-shot relay),
    // Lean Quiver only returns mana (no instant Long Draw), and Steady Draw
    // replaced the Rattling Ambush reset+free loop outright.
    const { sim, p } = rig('hunter', 20, {
      5: 'hun_r5_improved_serpent_sting',
      11: 'hun_r11_efficiency',
      14: 'hun_r14_sniper_training',
    });
    p.resource = p.maxResource - 30;
    for (let i = 0; i < 3; i++) completeCast(sim, 'serpent_sting');
    expect(p.auras.some((a) => a.id === 'hun_venom_relay')).toBe(false);
    expect(p.auras.some((a) => a.id === 'hun_lean_quiver')).toBe(false);
    expect(p.resource).toBe(p.maxResource - 10); // the every-3rd 20 mana survives
    completeCast(sim, 'concussive_shot');
    expect(p.auras.some((a) => a.id === 'hun_full_draw_rhythm')).toBe(false);
    // Deepvenom: the poison dot resolves 20% harder (rank 3 total 55 -> 66).
    expect(sim.resolvedAbility('serpent_sting')?.effects[0]).toMatchObject({
      type: 'dot',
      total: 66,
    });
  });

  it('Pinning Barb and Guisecraft are plain ability improvements now', () => {
    // Balance pass round two: Pinning Barb keeps the base 12 sec cooldown
    // (a cut pushed the 50% slow toward half uptime) and instead deepens the
    // slow to 70% inside the same window; Guisecraft is 25% (50% was too
    // strong once the swap-discount abuse case was gone).
    const { sim } = rig('hunter', 20, {
      5: 'hun_r5_aspect_mastery',
      8: 'hun_r8_improved_concussive',
    });
    const rattling = sim.resolvedAbility('concussive_shot');
    expect(rattling?.cooldown).toBeCloseTo(12);
    expect(rattling?.effects.some((e) => e.type === 'root')).toBe(false);
    expect(
      rattling?.effects.some((e) => e.type === 'slow' && e.mult === 0.3 && e.duration === 4),
    ).toBe(true);
    expect(sim.resolvedAbility('aspect_of_the_hawk')?.effects[0]).toMatchObject({
      type: 'selfBuff',
      value: 63, // rank 3 at level 20: 50 AP * 1.25 rounded
    });
  });

  it('Bloodbond, Deathless Will, and Steady Rain use pet-share, big-hit, and passive hooks', () => {
    // The final #1756 choice pass made the row 17 option (Bloodbond) a passive
    // 20% pet damage share and the row 20 option (Steady Rain) a passive
    // Arrowfall buff; neither is a HoT-expiry or channel proc anymore. The
    // Steady Rain pushback immunity is pinned in
    // tests/talent_retained_semantics_v026.test.ts.
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
    dealDamage(sim, p, 100);
    expect(p.maxHp - p.hp).toBe(80);
    expect(1000 - pet.hp).toBe(20);
    // Patch Up: revive_pet heals 50% more (baseline HoT total 240 -> 360).
    expect(sim.resolvedAbility('revive_pet')?.effects[0]).toMatchObject({
      type: 'hot',
      total: 360,
    });
    // Steady Rain: Arrowfall ticks resolve 50% harder (12-16 -> 18-24).
    expect(sim.resolvedAbility('volley')?.effects[0]).toMatchObject({
      type: 'aoeDamage',
      min: 18,
      max: 24,
    });

    const guarded = rig('hunter', 20, { 11: 'hun_r11_survival_instincts' });
    dealDamage(guarded.sim, guarded.p, Math.ceil(guarded.p.maxHp * 0.35));
    // Balance pass round three: shields are priest-only, so the panic
    // response is the 40% escape burst.
    const burst = guarded.p.auras.find((a) => a.id === 'hun_deathless_will');
    expect(burst?.kind).toBe('buff_speed');
    expect(burst?.value).toBeCloseTo(1.4);
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

    // Bloom's End is self-contained since the final #1756 pass: a full
    // Wildbloom arms an instant Wildmend instead of resetting Swiftmend
    // (unobtainable alongside this row).
    const healer = rig('druid', 20, { 5: 'dru_r5_natures_bounty' });
    healer.p.hp = Math.round(healer.p.maxHp * 0.5);
    expireHot(healer.sim, 'rejuvenation', healer.p);
    expect(healer.p.auras.find((a) => a.id === 'dru_natures_bounty')?.kind).toBe(
      'next_cast_instant',
    );
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
    // Ironhide Reflex is self-contained since the final #1756 pass: a big hit
    // restores 20 rage (only in Bruin Form, via the resourceType gate) and
    // grants a shield, instead of refunding the same-row Savage Mending.
    castAndSettle(bear.sim, 'bear_form', 1);
    expect(bear.p.resourceType).toBe('rage');
    bear.p.resource = 0;
    dealDamage(bear.sim, bear.p, Math.ceil(bear.p.maxHp * 0.25));
    expect(bear.p.resource).toBe(20);
    expect(bear.p.auras.some((a) => a.id === 'dru_survival_of_the_fittest')).toBe(true);
    // Balance pass round two: the capstone is Nature's Fury (a passive
    // moonwing party-crit radiator, covered in tests/natures_fury.test.ts);
    // Galeheart casts no longer refund or arm anything.
    bear.p.cooldowns.set('hurricane', 10);
    completeCast(bear.sim, 'hurricane');
    expect(bear.p.cooldowns.get('hurricane')).toBe(10);
    expect(bear.p.auras.some((a) => a.id === 'dru_improved_hurricane')).toBe(false);
  });
});

describe('warlock wave 2 choice rows', () => {
  it('only Hexstorm still empowers Gloom Bolt, behind its internal cooldown', () => {
    // Balance pass: Pact Deepened and Ashen Focus are flat ability talents
    // (the instant-relay soup is gone); Hexstorm survives with an icd.
    const { sim, p } = rig('warlock', 20, {
      5: 'wlk_r5_improved_immolate',
      14: 'wlk_r14_ruin',
      20: 'wlk_r20_curse_mastery',
    });
    for (let i = 0; i < 3; i++) completeCast(sim, 'immolate');
    expect(p.auras.some((a) => a.id === 'wlk_improved_immolate')).toBe(false);
    const immolate = sim.resolvedAbility('immolate');
    expect(immolate?.effects[0]).toMatchObject({ type: 'directDamage' });
    for (let i = 0; i < 3; i++) completeCast(sim, 'curse_of_agony');
    expect(p.auras.some((a) => a.id === 'wlk_curse_mastery')).toBe(true);
    // Inside the 10 sec icd three more curses do NOT re-arm it.
    p.auras.length = 0;
    for (let i = 0; i < 3; i++) completeCast(sim, 'curse_of_agony');
    expect(p.auras.some((a) => a.id === 'wlk_curse_mastery')).toBe(false);
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

    // Phase-2 defensive pass: Fiendward is a demonic safety net now: the big
    // hit arms a 10 sec echo that pays 15% max health only if the wearer then
    // falls below 35%.
    const guarded = rig('warlock', 20, {
      11: 'wlk_r11_demon_armor',
      17: 'wlk_r17_demonic_resilience',
    });
    guarded.p.hp = Math.round(guarded.p.maxHp * 0.8);
    dealDamage(guarded.sim, guarded.p, Math.ceil(guarded.p.maxHp * 0.2)); // arms at ~60%
    const echo = guarded.p.auras.find((a) => a.id === 'wlk_demon_armor');
    expect(echo?.kind).toBe('heal_echo');
    expect(echo?.value).toBe(Math.round(guarded.p.maxHp * 0.15));
    const beforeDrop = guarded.p.hp;
    dealDamage(guarded.sim, guarded.p, Math.ceil(guarded.p.maxHp * 0.3)); // below 35%
    expect(guarded.p.hp).toBeGreaterThan(beforeDrop - Math.ceil(guarded.p.maxHp * 0.3));
    expect(guarded.p.auras.some((a) => a.id === 'wlk_demon_armor')).toBe(false);
  });
});
