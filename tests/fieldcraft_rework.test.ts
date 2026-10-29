import { describe, expect, it } from 'vitest';
import { anchorProbeInOpenField } from '../scripts/probe_anchor';
import {
  CHARACTER_EFFECT_FEIGN_DEATH,
  characterEffectFlags,
  hasCharacterEffect,
} from '../src/render/character_effects_core';
import { dealDamage } from '../src/sim/combat/damage';
import {
  BLOODHOOK_SLOW_ID,
  HUNTING_MOMENTUM_ID,
  shrapnelConeTargets,
} from '../src/sim/combat/hunter_fieldcraft';
import { isPlayingDead, PLAY_DEAD_ID } from '../src/sim/combat/hunter_play_dead';
import { TRAILBREAK_LANDING_ID } from '../src/sim/combat/hunter_tick';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { partyFrameVitals } from '../src/sim/party_frame_info';
import { isPersistentEngineAura } from '../src/sim/persistent_aura';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { canDetectStealthedTarget, petCanSeeStealthedTarget } from '../src/sim/threat';
import type { Aura, Entity } from '../src/sim/types';
import { shownAsDead } from '../src/ui/target_frame_descriptor';

// The Fieldcraft rework (Bloodhook, Hunting Momentum, Shrapnel Charge, Tactical
// Camo, the shared hunter cooldowns, Patch Up, Bloodtrail, Quickblood, the
// Trailbreak landing sprint) and the class-wide Play Dead feign death.

type TestSim = Sim & { addEntity(entity: Entity): void; nextId: number };

function hunter(spec: string | null = 'survival', seed = 4501): TestSim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  anchorProbeInOpenField(sim);
  sim.player.facing = 0;
  sim.player.resource = sim.player.maxResource;
  return sim;
}

/** A training dummy at (dx, dz) from the hunter; facing 0 looks down +z. */
function addMob(sim: TestSim, dx: number, dz: number): Entity {
  const mob = createMob(
    sim.nextId++,
    MOBS.training_dummy,
    20,
    sim.groundPos(sim.player.pos.x + dx, sim.player.pos.z + dz),
  );
  mob.hostile = true;
  mob.moveSpeed = 0;
  mob.aiState = 'idle';
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  sim.addEntity(mob);
  return mob;
}

function addPet(sim: TestSim): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + 1,
    y: sim.player.pos.y,
    z: sim.player.pos.z - 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  sim.addEntity(pet);
  return pet;
}

function momentum(stacks: number, sourceId: number): Aura {
  return {
    id: HUNTING_MOMENTUM_ID,
    name: 'Hunting Momentum',
    kind: 'hunter_momentum',
    remaining: 3600,
    duration: 3600,
    value: stacks,
    stacks,
    sourceId,
    school: 'physical',
  };
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

describe('Fieldcraft rework: ability data', () => {
  it('ships the requested cooldowns, costs and ranges', () => {
    const sim = hunter();
    const bloodhook = sim.resolvedAbility('bloodhook');
    expect(bloodhook?.cooldown).toBe(10);
    expect(bloodhook?.def.minRange ?? 0).toBe(0);
    expect(bloodhook?.def.range).toBe(25);
    expect(sim.resolvedAbility('shellskin')?.cooldown).toBe(60);
    expect(sim.resolvedAbility('wildheart')?.cooldown).toBe(45);
    expect(sim.resolvedAbility('revive_pet')?.def.cost).toBe(0);
    const hush = sim.resolvedAbility('counter_shot');
    expect(hush?.cooldown).toBe(15);
    expect(hush?.def.offGcd).toBe(true);
    const shrapnel = sim.resolvedAbility('shrapnel_charge');
    expect(shrapnel?.cooldown).toBe(10);
    expect(shrapnel?.def.requiresTarget).toBe(false);
    const playDead = sim.resolvedAbility('play_dead');
    expect(playDead?.cooldown).toBe(30);
    expect(playDead?.def.offGcd).toBe(true);
    expect(playDead?.def.castTime).toBe(0);
  });

  it('gives Quickblood 20% Agility and leaves Tactical Camo to Lonely Soul', () => {
    const withMastery = hunter('survival');
    expect(
      computeTalentModifiers('hunter', { ...emptyAllocation(), spec: 'survival' }, 20).stats.agiPct,
    ).toBe(0.2);
    expect(withMastery.player.stats.agi).toBeGreaterThan(hunter(null).player.stats.agi);
    // Stealth Rework: Tactical Camo is granted by Lonely Soul to every spec
    // (tests/tactical_camo_lonely_soul.test.ts), not by the Fieldcraft spec.
    expect(withMastery.resolvedAbility('tactical_camo')).toBeNull();
    expect(hunter('beast_mastery').resolvedAbility('tactical_camo')).toBeNull();
    expect(hunter('beast_mastery').resolvedAbility('play_dead')).not.toBeNull();
  });
});

describe('Bloodhook', () => {
  it('slows the hooked target by 30% for 3 sec on arrival', () => {
    const sim = hunter();
    const mob = addMob(sim, 0, 12);
    sim.targetEntity(mob.id);
    sim.castAbility('bloodhook');
    ticks(sim, 40);
    const slow = mob.auras.find((aura) => aura.id === BLOODHOOK_SLOW_ID);
    expect(slow).toMatchObject({ kind: 'slow', value: 0.7, duration: 3 });
    expect(mob.auras.some((aura) => aura.id === 'bloodhook_bleed')).toBe(true);
  });

  it('hooks a target already in melee range (no minimum range)', () => {
    const sim = hunter();
    const mob = addMob(sim, 0, 2);
    sim.targetEntity(mob.id);
    sim.castAbility('bloodhook');
    ticks(sim, 10);
    expect(mob.auras.some((aura) => aura.id === 'bloodhook_bleed')).toBe(true);
  });
});

describe('Hunting Momentum', () => {
  it('is a persistent bank that adds 15% movement speed per stack', () => {
    const sim = hunter();
    expect(isPersistentEngineAura(HUNTING_MOMENTUM_ID)).toBe(true);
    const base = moveSpeedMult(sim.player);
    sim.player.auras.push(momentum(3, sim.playerId));
    expect(moveSpeedMult(sim.player)).toBeCloseTo(base * 1.45, 6);
  });

  it('clears when the hunter leaves combat', () => {
    const sim = hunter();
    sim.player.auras.push(momentum(2, sim.playerId));
    sim.player.combatTimer = 99;
    ticks(sim, 2);
    expect(sim.player.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
  });

  it('makes a full-bank Woundrend deal 60% more strike damage', () => {
    const sim = hunter();
    const mob = addMob(sim, 0, 2);
    sim.targetEntity(mob.id);
    sim.player.auras.push(momentum(3, sim.playerId));
    const events: { ability?: string; amount?: number }[] = [];
    sim.castAbility('mongoose_bite');
    for (let i = 0; i < 10; i++) events.push(...(sim.tick() as never[]));
    const strike = events.find((e) => (e as { ability?: string }).ability === 'Woundrend');
    const payoff = events.find((e) => (e as { ability?: string }).ability === 'Hunting Momentum');
    expect(strike?.amount).toBeGreaterThan(0);
    expect(payoff?.amount).toBe(Math.round((strike?.amount ?? 0) * 0.6));
    expect(sim.player.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
  });
});

describe('Shrapnel Charge', () => {
  it('hits every enemy in the 10-yard, 90-degree front cone and nothing behind', () => {
    const sim = hunter();
    const front = [
      addMob(sim, 0, 3),
      addMob(sim, 1, 5),
      addMob(sim, -1, 6),
      addMob(sim, 2, 7),
      addMob(sim, -2, 8),
      addMob(sim, 0, 9),
    ];
    const behind = addMob(sim, 0, -4);
    const far = addMob(sim, 0, 14);
    const wide = addMob(sim, 6, 1);
    const { primary, others } = shrapnelConeTargets(sim.ctx, sim.player, 10, 90);
    const hit = new Set([primary, ...others].map((e) => e?.id));
    for (const mob of front) expect(hit.has(mob.id)).toBe(true);
    for (const mob of [behind, far, wide]) expect(hit.has(mob.id)).toBe(false);
    // The nearest enemy is the main target when the hunter's target is not hit.
    expect(primary?.id).toBe(front[0].id);
  });

  it('prefers the hunter target, grants 1 Momentum per hit cast, on a 10 sec cooldown', () => {
    const sim = hunter();
    addMob(sim, 0, 3);
    const target = addMob(sim, 0, 6);
    sim.targetEntity(target.id);
    expect(shrapnelConeTargets(sim.ctx, sim.player, 10, 90).primary?.id).toBe(target.id);
    sim.castAbility('shrapnel_charge');
    ticks(sim, 2);
    const stacks = () =>
      sim.player.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID)?.stacks ?? 0;
    expect(stacks()).toBe(1);
    expect(sim.player.cooldowns.get('shrapnel_charge') ?? 0).toBeGreaterThan(4);
    ticks(sim, 20 * 10); // clear the 10 sec cooldown
    sim.castAbility('shrapnel_charge');
    ticks(sim, 2);
    expect(stacks()).toBe(2);
  });

  it('grants nothing when the cone is empty', () => {
    const sim = hunter();
    addMob(sim, 0, -5);
    sim.castAbility('shrapnel_charge');
    ticks(sim, 2);
    expect(sim.player.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
  });
});

describe('Tactical Camo', () => {
  it('moves at 80% and breaks on taking or dealing damage, like Duskveil', () => {
    const sim = hunter();
    expect(sim.applyTalents({ spec: 'survival', rows: { 8: 'hun_r8_beastguard' } })).toBe(true);
    const base = moveSpeedMult(sim.player);
    sim.castAbility('tactical_camo');
    ticks(sim, 1);
    expect(sim.player.auras.some((aura) => aura.id === 'tactical_camo')).toBe(true);
    expect(moveSpeedMult(sim.player)).toBeCloseTo(base * 0.8, 6);
    const mob = addMob(sim, 0, 3);
    const camo = () => sim.player.auras.some((aura) => aura.id === 'tactical_camo');
    dealDamage(sim.ctx, mob, sim.player, 10, false, 'physical', 'Test Hit', 'hit');
    expect(camo()).toBe(false);
    sim.player.cooldowns.delete('tactical_camo');
    sim.player.inCombat = false;
    sim.player.combatTimer = 99;
    sim.castAbility('tactical_camo');
    ticks(sim, 1);
    expect(camo()).toBe(true);
    dealDamage(sim.ctx, sim.player, mob, 10, false, 'physical', 'Test Hit', 'hit');
    expect(camo()).toBe(false);
  });
});

describe('Bloodtrail Assault without a pet', () => {
  it('doubles Focus regeneration only while no pet lives', () => {
    const sim = hunter();
    sim.player.auras.push({
      id: 'bloodtrail_assault',
      name: 'Bloodtrail Assault',
      kind: 'hunter_bloodtrail',
      remaining: 600,
      duration: 600,
      value: 1,
      sourceId: sim.playerId,
      school: 'physical',
    });
    const regen = (): number => {
      sim.player.resource = 0;
      ticks(sim, 40);
      return sim.player.resource;
    };
    const lonely = regen();
    const pet = addPet(sim);
    const withPet = regen();
    expect(withPet).toBeGreaterThan(0);
    expect(lonely).toBe(withPet * 2);
    pet.dead = true;
    expect(regen()).toBe(lonely);
  });
});

describe('Trailbreak landing sprint', () => {
  it('grants 50% movement speed for 3 sec once the leap touches down', () => {
    const sim = hunter();
    sim.castAbility('trailbreak');
    sim.tick();
    expect(sim.player.auras.some((aura) => aura.id === TRAILBREAK_LANDING_ID)).toBe(false);
    for (let i = 0; i < 80 && !sim.player.auras.some((a) => a.id === TRAILBREAK_LANDING_ID); i++)
      sim.tick();
    const sprint = sim.player.auras.find((aura) => aura.id === TRAILBREAK_LANDING_ID);
    expect(sprint).toMatchObject({ kind: 'buff_speed', value: 1.5, duration: 3 });
    expect(sim.player.onGround).toBe(true);
  });
});

describe('Play Dead', () => {
  it('lies down without dying, wipes threat, and hides from mobs and pets', () => {
    const sim = hunter('beast_mastery');
    const mob = addMob(sim, 0, 3);
    mob.threat.set(sim.playerId, 500);
    mob.aggroTargetId = sim.playerId;
    mob.inCombat = true;
    sim.castAbility('play_dead');
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(true);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBeGreaterThan(0);
    expect(mob.threat.has(sim.playerId)).toBe(false);
    expect(mob.aggroTargetId).not.toBe(sim.playerId);
    expect(canDetectStealthedTarget(mob, sim.player, 40)).toBe(false);
    expect(petCanSeeStealthedTarget(sim.player)).toBe(false);
  });

  it('drops an enemy player who had the hunter targeted', () => {
    const sim = hunter();
    const rival = sim.addPlayer('mage', 'Rival');
    const duel = {
      a: sim.playerId,
      b: rival,
      state: 'active' as const,
      timer: 0,
      controlled: new Map(),
    };
    sim.ctx.duels.set(sim.playerId, duel);
    sim.ctx.duels.set(rival, duel);
    const rivalEntity = sim.entities.get(rival);
    if (!rivalEntity) throw new Error('missing rival');
    rivalEntity.targetId = sim.playerId;
    sim.castAbility('play_dead');
    sim.tick();
    expect(rivalEntity.targetId).toBe(null);
  });

  it('draws as dead everywhere it is shown', () => {
    const sim = hunter();
    sim.castAbility('play_dead');
    sim.tick();
    expect(shownAsDead(sim.player)).toBe(true);
    expect(partyFrameVitals(sim.player)).toEqual({ hp: 0, res: 0, dead: 1 });
    const flags = characterEffectFlags(sim.player.auras);
    expect(hasCharacterEffect(flags, CHARACTER_EFFECT_FEIGN_DEATH)).toBe(true);
  });

  it('ends on recast even while on cooldown, on moving, and on another ability', () => {
    const sim = hunter();
    sim.castAbility('play_dead');
    sim.tick();
    expect(sim.player.cooldowns.get(PLAY_DEAD_ID) ?? 0).toBeGreaterThan(0);
    sim.castAbility('play_dead');
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(false);

    sim.player.cooldowns.delete(PLAY_DEAD_ID);
    sim.castAbility('play_dead');
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(true);
    // Being displaced (a knockback, a moving platform) is not the hunter moving.
    sim.player.pos = { ...sim.player.pos, x: sim.player.pos.x + 2 };
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(true);
    sim.moveInput.forward = true;
    sim.tick();
    sim.moveInput.forward = false;
    expect(isPlayingDead(sim.player)).toBe(false);

    sim.player.cooldowns.delete(PLAY_DEAD_ID);
    sim.castAbility('play_dead');
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(true);
    sim.castAbility('wildheart');
    sim.tick();
    expect(isPlayingDead(sim.player)).toBe(false);
  });

  it('keeps idle and returning mobs off the hunter while they feign', () => {
    const sim = hunter('beast_mastery');
    sim.castAbility('play_dead');
    sim.tick();
    // An idle hostile spawned right next to the 'corpse' never pulls it.
    const idle = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
      x: sim.player.pos.x + 3,
      y: sim.player.pos.y,
      z: sim.player.pos.z,
    });
    idle.hostile = true;
    sim.addEntity(idle);
    const hpBefore = sim.player.hp;
    ticks(sim, 60);
    expect(isPlayingDead(sim.player)).toBe(true);
    expect(idle.aggroTargetId).not.toBe(sim.playerId);
    expect(sim.player.hp).toBe(hpBefore);
  });

  it('drops a press queued before lying down instead of standing back up', () => {
    const sim = hunter();
    const mob = addMob(sim, 0, 3);
    sim.targetEntity(mob.id);
    sim.player.queuedCastAbility = 'shrapnel_charge';
    sim.player.gcdRemaining = 0.5;
    sim.castAbility('play_dead');
    ticks(sim, 20);
    expect(isPlayingDead(sim.player)).toBe(true);
    expect(sim.player.queuedCastAbility).toBe(null);
  });
});

describe('Lonely Soul with the Woundrend payoff', () => {
  it('adds +60% of the landed strike once, not the 10% twice', () => {
    const sim = hunter('survival', 4502);
    expect(sim.applyTalents({ spec: 'survival', rows: { 8: 'hun_r8_beastguard' } })).toBe(true);
    const mob = addMob(sim, 0, 2);
    sim.targetEntity(mob.id);
    sim.player.auras.push(momentum(3, sim.playerId));
    const events: { ability?: string; amount?: number }[] = [];
    sim.castAbility('mongoose_bite');
    for (let i = 0; i < 10; i++) events.push(...(sim.tick() as never[]));
    const strike = events.find((e) => e.ability === 'Woundrend');
    const payoff = events.find((e) => e.ability === 'Hunting Momentum');
    expect(strike?.amount).toBeGreaterThan(0);
    expect(payoff?.amount).toBe(Math.round((strike?.amount ?? 0) * 0.6));
  });
});
