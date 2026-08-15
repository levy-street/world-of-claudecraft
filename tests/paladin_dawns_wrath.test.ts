import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import {
  applyDawnsWrathOverride,
  DAWNS_WRATH_DAMAGE_MULT,
  DAWNS_WRATH_DURATION,
  DAWNS_WRATH_KIND,
  DAWNS_WRATH_PROC_CHANCE,
  grantDawnsWrath,
} from '../src/sim/combat/paladin_dawns_wrath';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function makeRetribution(): TestSim {
  const sim = new Sim({ seed: 9931, playerClass: 'paladin', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('retribution')).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function targetAt(sim: TestSim, distance: number, hpFraction = 1): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 50_000;
  mob.hp = Math.round(mob.maxHp * hpFraction);
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.swingTimer = 999;
  sim.addEntity(mob);
  return mob;
}

function proc(player: Entity) {
  return player.auras.find((aura) => aura.kind === DAWNS_WRATH_KIND);
}

function resolved(sim: Sim, id: string): ResolvedAbility {
  const ability = sim.resolvedAbility(id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

function damageAfterCast(sim: Sim, target: Entity, hpBefore: number): number {
  for (let tick = 0; tick < 200 && target.hp === hpBefore; tick++) sim.tick();
  return hpBefore - target.hp;
}

describe("Retribution Paladin Dawn's Wrath", () => {
  it('pins the proc chance, duration, damage bonus, and player-facing contract', () => {
    expect(DAWNS_WRATH_PROC_CHANCE).toBe(0.15);
    expect(DAWNS_WRATH_DURATION).toBe(8);
    expect(DAWNS_WRATH_DAMAGE_MULT).toBe(1.2);
    expect(ABILITIES.final_edict.description).toContain('15% chance');
    expect(ABILITIES.final_edict.description).toContain("Dawn's Wrath");
    expect(ABILITIES.hammer_of_wrath.description).toContain('additional cast');
    expect(ABILITIES.hammer_of_wrath.description).toContain('20% more damage');
  });

  it('grants the proc after a successful Retribution auto-attack roll', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 2);
    sim.rng.next = () => 0.99;
    const chances: number[] = [];
    sim.rng.chance = (chance) => {
      chances.push(chance);
      return chance === DAWNS_WRATH_PROC_CHANCE;
    };

    meleeSwing(sim.ctx, sim.player, target, 0, null, { autoAttack: true });

    expect(chances).toContain(DAWNS_WRATH_PROC_CHANCE);
    expect(proc(sim.player)).toMatchObject({
      name: "Dawn's Wrath",
      remaining: 8,
      duration: 8,
      sourceId: sim.player.id,
    });
  });

  it('does not grant the proc when successful attacks lose their Dawn’s Wrath roll', () => {
    const autoSim = makeRetribution();
    const autoTarget = targetAt(autoSim, 2);
    const autoChances: number[] = [];
    autoSim.rng.next = () => 0.99;
    autoSim.rng.chance = (chance) => {
      autoChances.push(chance);
      return false;
    };

    expect(meleeSwing(autoSim.ctx, autoSim.player, autoTarget, 0, null, { autoAttack: true })).toBe(
      true,
    );
    expect(autoChances).toContain(DAWNS_WRATH_PROC_CHANCE);
    expect(proc(autoSim.player)).toBeUndefined();

    const finalSim = makeRetribution();
    const finalTarget = targetAt(finalSim, 2);
    const finalChances: number[] = [];
    finalSim.targetEntity(finalTarget.id);
    finalSim.rng.next = () => 0.99;
    finalSim.rng.chance = (chance) => {
      finalChances.push(chance);
      return false;
    };

    finalSim.castAbility('final_edict');

    expect(finalTarget.hp).toBeLessThan(finalTarget.maxHp);
    expect(finalChances).toContain(DAWNS_WRATH_PROC_CHANCE);
    expect(proc(finalSim.player)).toBeUndefined();
  });

  it('does not roll the proc after a missed auto-attack', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 2);
    const chances: number[] = [];
    sim.rng.next = () => 0;
    sim.rng.chance = (chance) => {
      chances.push(chance);
      return true;
    };

    expect(meleeSwing(sim.ctx, sim.player, target, 0, null, { autoAttack: true })).toBe(false);

    expect(chances).toHaveLength(0);
    expect(chances).not.toContain(DAWNS_WRATH_PROC_CHANCE);
    expect(proc(sim.player)).toBeUndefined();
  });

  it('grants the proc after a successful Final Edict roll, but not after a miss', () => {
    const hitSim = makeRetribution();
    const hitTarget = targetAt(hitSim, 2);
    hitSim.targetEntity(hitTarget.id);
    hitSim.rng.next = () => 0.99;
    hitSim.rng.chance = (chance) => chance === DAWNS_WRATH_PROC_CHANCE;

    hitSim.castAbility('final_edict');

    expect(hitTarget.hp).toBeLessThan(hitTarget.maxHp);
    expect(proc(hitSim.player)).toBeDefined();

    const missSim = makeRetribution();
    const missTarget = targetAt(missSim, 2);
    missSim.targetEntity(missTarget.id);
    const chances: number[] = [];
    missSim.rng.next = () => 0;
    missSim.rng.chance = (chance) => {
      chances.push(chance);
      return true;
    };

    missSim.castAbility('final_edict');

    expect(missTarget.hp).toBe(missTarget.maxHp);
    expect(chances).not.toContain(DAWNS_WRATH_PROC_CHANCE);
    expect(proc(missSim.player)).toBeUndefined();
  });

  it('is Retribution-only, does not stack, and refreshes its eight-second duration', () => {
    const sim = makeRetribution();
    grantDawnsWrath(sim.ctx, sim.player);
    const activeProc = proc(sim.player);
    if (!activeProc) throw new Error("missing Dawn's Wrath proc");
    activeProc.remaining = 2;
    grantDawnsWrath(sim.ctx, sim.player);

    expect(sim.player.auras.filter((aura) => aura.kind === DAWNS_WRATH_KIND)).toHaveLength(1);
    expect(proc(sim.player)?.remaining).toBe(8);

    for (let elapsed = 0; elapsed <= 8; elapsed += DT) sim.tick();
    expect(proc(sim.player)).toBeUndefined();

    const protection = new Sim({ seed: 9932, playerClass: 'paladin', autoEquip: true }) as TestSim;
    protection.setPlayerLevel(20);
    expect(protection.setSpec('protection')).toBe(true);
    const target = targetAt(protection, 2);
    const protectionChances: number[] = [];
    protection.rng.next = () => 0.99;
    protection.rng.chance = (chance) => {
      protectionChances.push(chance);
      return chance === 1;
    };

    expect(
      meleeSwing(protection.ctx, protection.player, target, 0, null, { autoAttack: true }),
    ).toBe(true);
    expect(protectionChances).toHaveLength(1);
    expect(protectionChances).not.toContain(DAWNS_WRATH_PROC_CHANCE);
    expect(proc(protection.player)).toBeUndefined();
  });

  it('replays auto attack, Final Edict, and empowered Hammer with an exact RNG trace', () => {
    function runTrace() {
      // Seed re-hunted for the v0.34.0 catch-up (main's content adds shifted the
      // world-construction stream): the first swing must LAND and PROC Dawn's
      // Wrath or the empowered Hammer is never castable and the trace collapses.
      // Spare seeds with the same shape: 20.
      const sim = new Sim({ seed: 13, playerClass: 'paladin', autoEquip: true }) as TestSim;
      sim.setPlayerLevel(20);
      expect(sim.setSpec('retribution')).toBe(true);
      const target = targetAt(sim, 2);
      const draws: number[] = [];
      const chances: number[] = [];
      sim.rng.setObserver((value) => draws.push(Number(value.toFixed(6))));
      const seededChance = sim.rng.chance.bind(sim.rng);
      sim.rng.chance = (chance) => {
        chances.push(chance);
        return seededChance(chance);
      };

      meleeSwing(sim.ctx, sim.player, target, 0, null, { autoAttack: true });
      const autoHp = target.hp;
      const autoAura = proc(sim.player)?.remaining;
      sim.targetEntity(target.id);
      sim.castAbility('final_edict');
      const finalHp = target.hp;
      const finalAura = proc(sim.player)?.remaining;
      sim.player.gcdRemaining = 0;
      sim.player.swingTimer = 999;
      const hpBeforeHammer = target.hp;
      sim.castAbility('hammer_of_wrath');
      damageAfterCast(sim, target, hpBeforeHammer);

      return {
        draws,
        chances,
        autoHp,
        autoAura,
        finalHp,
        finalAura,
        hammerHp: target.hp,
        procActive: proc(sim.player) !== undefined,
        hammerCooldown: sim.player.cooldowns.get('hammer_of_wrath') ?? 0,
        devotion: sim.player.paladinDevotion?.value ?? 0,
      };
    }

    const first = runTrace();
    expect(runTrace()).toEqual(first);
    expect(first).toEqual({
      draws: [
        0.881369, 0.599931, 0.574934, 0.142454, 0.642304, 0.290732, 0.157766, 0.643683, 0.914991,
        0.328397, 0.508796,
      ],
      chances: [0.068, 0.15, 0.068, 0.15, 0.96, 0.0756],
      autoHp: 49976,
      autoAura: 8,
      finalHp: 49880,
      finalAura: 8,
      hammerHp: 49640,
      procActive: false,
      hammerCooldown: 0,
      devotion: 2,
    });
  });

  it('builds an extra cooldown-free Hammer cast with 20% full-damage scaling', () => {
    const sim = makeRetribution();
    const base = resolved(sim, 'hammer_of_wrath');
    grantDawnsWrath(sim.ctx, sim.player);

    const empowered = applyDawnsWrathOverride(sim.ctx, sim.player, base);

    expect(empowered).toMatchObject({ cost: 0, cooldown: 0 });
    expect(empowered.effects).toEqual([
      expect.objectContaining({
        type: 'directDamage',
        min: base.effects[0].type === 'directDamage' ? base.effects[0].min : undefined,
        max: base.effects[0].type === 'directDamage' ? base.effects[0].max : undefined,
        damageMult: 1.2,
      }),
    ]);

    function castDamage(empoweredCast: boolean): number {
      const damageSim = makeRetribution();
      const target = targetAt(damageSim, 15, 0.19);
      damageSim.targetEntity(target.id);
      if (empoweredCast) grantDawnsWrath(damageSim.ctx, damageSim.player);
      damageSim.player.spellPower = 70;
      damageSim.rng.next = () => 0.5;
      damageSim.rng.chance = (chance) => chance > 0.5;
      const hpBefore = target.hp;
      damageSim.castAbility('hammer_of_wrath');
      return damageAfterCast(damageSim, target, hpBefore);
    }

    const normalDamage = castDamage(false);
    expect(normalDamage).toBeGreaterThan(0);
    expect(castDamage(true)).toBe(Math.round(normalDamage * DAWNS_WRATH_DAMAGE_MULT));
  });

  it('bypasses a running Hammer cooldown without clearing or restarting it', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 15);
    sim.targetEntity(target.id);
    sim.player.spellPower = 70;
    sim.player.cooldowns.set('hammer_of_wrath', 5);
    sim.rng.next = () => 0.5;
    sim.rng.chance = (chance) => chance > 0.5;
    grantDawnsWrath(sim.ctx, sim.player);

    const hpBefore = target.hp;
    sim.castAbility('hammer_of_wrath');

    expect(proc(sim.player)).toBeUndefined();
    expect(sim.player.cooldowns.get('hammer_of_wrath')).toBe(5);
    expect(sim.player.gcdRemaining).toBe(1.5);
    expect(damageAfterCast(sim, target, hpBefore)).toBeGreaterThan(0);
    expect(sim.player.cooldowns.get('hammer_of_wrath')).toBeGreaterThan(0);
    expect(sim.player.cooldowns.get('hammer_of_wrath')).toBeLessThan(5);
    expect(sim.player.paladinDevotion?.value).toBe(1);
  });

  it('spends the stored cast first below 20%, leaving the normal ready Hammer available', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 15, 0.19);
    sim.targetEntity(target.id);
    sim.rng.next = () => 0.5;
    sim.rng.chance = (chance) => chance > 0.5;
    grantDawnsWrath(sim.ctx, sim.player);

    const empoweredHpBefore = target.hp;
    sim.castAbility('hammer_of_wrath');
    expect(proc(sim.player)).toBeUndefined();
    expect(sim.player.cooldowns.has('hammer_of_wrath')).toBe(false);
    expect(damageAfterCast(sim, target, empoweredHpBefore)).toBeGreaterThan(0);
    expect(sim.player.paladinDevotion?.value).toBe(1);

    while (sim.player.gcdRemaining > 0) sim.tick();
    const hpBefore = target.hp;
    sim.castAbility('hammer_of_wrath');
    expect(sim.player.cooldowns.get('hammer_of_wrath')).toBe(6);
    expect(damageAfterCast(sim, target, hpBefore)).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(hpBefore);
    expect(sim.player.paladinDevotion?.value).toBe(2);
  });

  it('preserves the stored cast when Hammer fails a normal cast gate', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 31);
    sim.targetEntity(target.id);
    sim.player.cooldowns.set('hammer_of_wrath', 5);
    grantDawnsWrath(sim.ctx, sim.player);

    sim.castAbility('hammer_of_wrath');

    expect(proc(sim.player)).toBeDefined();
    expect(sim.player.cooldowns.get('hammer_of_wrath')).toBe(5);
    expect(target.hp).toBe(target.maxHp);
  });

  it('preserves the stored cast when an active GCD rejects Hammer early', () => {
    const sim = makeRetribution();
    const target = targetAt(sim, 15);
    sim.targetEntity(target.id);
    sim.player.gcdRemaining = 1;
    sim.player.cooldowns.set('hammer_of_wrath', 5);
    grantDawnsWrath(sim.ctx, sim.player);

    sim.castAbility('hammer_of_wrath');

    expect(proc(sim.player)).toBeDefined();
    expect(sim.player.gcdRemaining).toBe(1);
    expect(sim.player.cooldowns.get('hammer_of_wrath')).toBe(5);
    expect(target.hp).toBe(target.maxHp);
  });
});
