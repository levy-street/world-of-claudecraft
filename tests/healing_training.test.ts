import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  HEALING_DUMMY_IDS,
  HEALING_DUMMY_SCOUT_ID,
  HEALING_DUMMY_TANK_ID,
  HEALING_TRAINING_GROUND_SPAWNS,
} from '../src/sim/content/healing_training';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { handleDevChat } from '../src/sim/dev_commands';
import { playerDummyRestHp } from '../src/sim/mob/practice_dummies';
import { Sim } from '../src/sim/sim';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 42;

describe('Healing Training Ground: templates and placement', () => {
  it('all 5 healing dummy templates are registered with high max HP and low rest fractions', () => {
    for (const id of HEALING_DUMMY_IDS) {
      const template = MOBS[id];
      expect(template).toBeDefined();
      expect(template.dummy).toBe(true);
      expect(template.friendlyPracticeTarget).toBe(true);
      expect(template.dmgBase).toBe(0);
      expect(template.moveSpeed).toBe(0);
      expect(template.loot).toEqual([]);
      expect(template.hpBase).toBeGreaterThanOrEqual(40000);
      const restHpFraction = template.restHpFraction;
      expect(restHpFraction).toBeDefined();
      if (restHpFraction !== undefined) {
        expect(restHpFraction).toBeLessThanOrEqual(0.3);
        expect(restHpFraction).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  it('all spawn positions are on dry, unblocked ground', () => {
    for (const spawn of HEALING_TRAINING_GROUND_SPAWNS) {
      const blocked = isBlocked(SEED, spawn.pos.x, spawn.pos.z, 0.6);
      const gh = groundHeight(spawn.pos.x, spawn.pos.z, SEED);
      const wl = waterLevelAt(spawn.pos.x, spawn.pos.z, SEED);
      expect(blocked).toBe(false);
      expect(gh).toBeGreaterThan(wl);
    }
  });

  it('all spawn positions maintain clearance with existing town entities', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest', world: BUILTIN_WORLD });
    for (const spawn of HEALING_TRAINING_GROUND_SPAWNS) {
      for (const e of sim.entities.values()) {
        if (HEALING_DUMMY_IDS.includes(e.templateId as (typeof HEALING_DUMMY_IDS)[number]))
          continue;
        const d = Math.hypot(e.pos.x - spawn.pos.x, e.pos.z - spawn.pos.z);
        expect(d).toBeGreaterThan(2.5);
      }
    }
  });

  it('spawns all 5 healing training dummies in a real Sim with low starting HP', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest', world: BUILTIN_WORLD });
    for (const spawn of HEALING_TRAINING_GROUND_SPAWNS) {
      const dummy = [...sim.entities.values()].find((e) => e.templateId === spawn.mobId && !e.dead);
      expect(dummy).toBeDefined();
      if (!dummy) continue;
      expect(dummy.level).toBe(20);
      expect(dummy.hostile).toBe(false);
      expect(dummy.friendlyPracticeTarget).toBe(true);
      expect(dummy.maxHp).toBeGreaterThanOrEqual(40000);

      const template = MOBS[spawn.mobId];
      const expectedRestHp = playerDummyRestHp(dummy.maxHp, template?.restHpFraction);
      expect(dummy.hp).toBe(expectedRestHp);
      expect(dummy.hp).toBeLessThan(dummy.maxHp * 0.35); // strictly low health
    }
  });
});

describe('Healing Training Ground: priest healing mechanics', () => {
  it('a priest can target a healing dummy and heal it with single-target heals', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest', devCommands: true });
    sim.setPlayerLevel(20);

    const scout = [...sim.entities.values()].find(
      (e) => e.templateId === HEALING_DUMMY_SCOUT_ID && !e.dead,
    );
    expect(scout).toBeDefined();
    if (!scout) return;
    const initialHp = scout.hp;

    // Position player in front of the dummies
    sim.player.pos = sim.groundPos(-82, -42);
    sim.player.facing = 0;

    // Target the scout
    sim.targetEntity(scout.id);
    expect(sim.player.targetId).toBe(scout.id);

    // Cast Flash Heal
    sim.castAbility('flash_heal');
    // Progress through cast time (Flash heal is 1.5s -> 30 ticks)
    let maxHpObserved = initialHp;
    for (let i = 0; i < 35; i++) {
      sim.tick();
      if (scout.hp > maxHpObserved) {
        maxHpObserved = scout.hp;
      }
    }

    expect(maxHpObserved).toBeGreaterThan(initialHp);
  });

  it('a priest can cast prayer_of_healing (Choirmend) to heal all nearby dummies in AoE', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest', devCommands: true });
    sim.setPlayerLevel(20);
    sim.setSpec('holy');
    sim.player.pos = sim.groundPos(-82, -42);
    sim.player.facing = 0;

    const dummies = HEALING_TRAINING_GROUND_SPAWNS.map((s) =>
      [...sim.entities.values()].find((e) => e.templateId === s.mobId && !e.dead),
    ).filter((d): d is NonNullable<typeof d> => d !== undefined);
    expect(dummies.length).toBe(HEALING_TRAINING_GROUND_SPAWNS.length);
    const initialHps = dummies.map((d) => d.hp);

    // Cast Choirmend (Prayer of Healing, 30yd AoE centered on player, 3s cast)
    sim.castAbility('prayer_of_healing');
    expect(sim.player.castingAbility).toBe('prayer_of_healing');

    let anyHealed = false;
    // 3s cast = 60 ticks
    for (let i = 0; i < 65; i++) {
      sim.tick();
      if (dummies.some((d, idx) => d.hp > initialHps[idx])) {
        anyHealed = true;
      }
    }

    expect(anyHealed).toBe(true);
  });

  it('a priest can apply renew (Lingering Grace) to heal over time', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest', devCommands: true });
    sim.setPlayerLevel(20);
    sim.player.pos = sim.groundPos(-82, -42);
    sim.player.facing = 0;

    const tank = [...sim.entities.values()].find(
      (e) => e.templateId === HEALING_DUMMY_TANK_ID && !e.dead,
    );
    expect(tank).toBeDefined();
    if (!tank) return;

    sim.targetEntity(tank.id);
    sim.castAbility('renew');

    // Renew applies a HoT aura that ticks periodically
    expect(tank.auras.some((a) => a.kind === 'hot')).toBe(true);
  });

  it('sheds healing back toward resting HP under repeated ticks', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest' });
    const tank = [...sim.entities.values()].find(
      (e) => e.templateId === HEALING_DUMMY_TANK_ID && !e.dead,
    );
    expect(tank).toBeDefined();
    if (!tank) return;
    const template = MOBS[HEALING_DUMMY_TANK_ID];
    const restHp = playerDummyRestHp(tank.maxHp, template?.restHpFraction);
    expect(tank.hp).toBe(restHp);

    // Heal the tank to full health
    tank.hp = tank.maxHp;
    expect(tank.hp).toBe(tank.maxHp);

    // Tick for shedding (5% per second; from 100% to 20% takes 16 seconds = 320 ticks)
    for (let i = 0; i < 20 * 20; i++) sim.tick();

    // Settle back to rest HP, never below it
    expect(tank.hp).toBe(restHp);
  });

  it('/dev healing teleports the player to the healing training ground at level 20', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest', devCommands: true });
    expect(sim.player.level).toBe(1);

    handleDevChat(sim.ctx, '/dev healing', sim.player.id);

    expect(sim.player.level).toBe(20);
    expect(Math.round(sim.player.pos.x)).toBe(-82);
    expect(Math.round(sim.player.pos.z)).toBe(-42);
    expect(sim.player.facing).toBe(0); // facing east towards the dummies
  });
});

describe('Healing Training Ground: Chronomancer mechanics', () => {
  it('a chronomancer can place Temporal Echo on a healing dummy, damage the combat dummy, and build Temporal Aegis', () => {
    const sim = new Sim({
      seed: SEED,
      playerClass: 'mage',
      world: BUILTIN_WORLD,
      devCommands: true,
    });
    handleDevChat(sim.ctx, '/dev healing', sim.player.id);
    expect(sim.setSpec('arcane')).toBe(true);

    const scout = [...sim.entities.values()].find(
      (e) => e.templateId === HEALING_DUMMY_SCOUT_ID && !e.dead,
    );
    expect(scout).toBeDefined();
    if (!scout) return;

    const combatDummy = [...sim.entities.values()].find(
      (e) => e.templateId === 'hub_training_dummy' && !e.dead,
    );
    expect(combatDummy).toBeDefined();
    if (!combatDummy) return;

    // Apply Temporal Echo on the healing dummy
    sim.targetEntity(scout.id);
    sim.player.facing = Math.atan2(scout.pos.z - sim.player.pos.z, scout.pos.x - sim.player.pos.x);
    sim.castAbility('temporal_echo');
    sim.tick();
    expect(scout.auras.some((a) => a.kind === 'temporal_echo')).toBe(true);

    // Wait out GCD
    for (let i = 0; i < 30; i++) sim.tick();

    // Target the combat dummy and cast Aether Surge
    sim.targetEntity(combatDummy.id);
    sim.player.facing = Math.atan2(
      combatDummy.pos.z - sim.player.pos.z,
      combatDummy.pos.x - sim.player.pos.x,
    );
    sim.castAbility('arcane_surge');

    let heal2Event: { amount?: number; ability?: string } | null = null;
    while (sim.player.castingAbility) {
      const evs = sim.tick();
      const h = evs.find((e) => e.type === 'heal2' && e.targetId === scout.id);
      if (h) heal2Event = h as { amount?: number; ability?: string };
    }

    expect(heal2Event).toBeDefined();
    expect(heal2Event?.amount).toBeGreaterThan(0);
    expect(heal2Event?.ability).toBe('Temporal Echo');

    // Now cast again with scout at max HP to test Temporal Aegis shield creation
    for (let i = 0; i < 30; i++) sim.tick();
    sim.castAbility('arcane_surge');

    let aegisEvent: { name?: string } | null = null;
    while (sim.player.castingAbility) {
      scout.hp = scout.maxHp;
      const evs = sim.tick();
      const a = evs.find(
        (e) => e.type === 'aura' && e.targetId === scout.id && e.name === 'Temporal Aegis',
      );
      if (a) aegisEvent = a as { name?: string };
    }

    expect(aegisEvent).toBeDefined();
    const aegis = scout.auras.find((a) => a.id === 'temporal_aegis');
    expect(aegis).toBeDefined();
    expect(aegis?.kind).toBe('absorb');
    expect(aegis?.value).toBeGreaterThan(0);
    expect(aegis?.value).toBeLessThanOrEqual(scout.maxHp * 0.2);
  });

  it('a solo chronomancer can cast Temporal Cascade to mark all 5 healing training dummies without a party', () => {
    const sim = new Sim({
      seed: SEED,
      playerClass: 'mage',
      world: BUILTIN_WORLD,
      devCommands: true,
    });
    handleDevChat(sim.ctx, '/dev healing', sim.player.id);
    expect(sim.setSpec('arcane')).toBe(true);

    const scout = [...sim.entities.values()].find(
      (e) => e.templateId === HEALING_DUMMY_SCOUT_ID && !e.dead,
    );
    expect(scout).toBeDefined();
    if (!scout) return;

    // Solo mage casts Temporal Cascade directly on the scout dummy
    sim.targetEntity(scout.id);
    sim.player.facing = Math.atan2(scout.pos.z - sim.player.pos.z, scout.pos.x - sim.player.pos.x);
    sim.castAbility('temporal_cascade');
    expect(sim.player.castingAbility).toBe('temporal_cascade');

    while (sim.player.castingAbility) {
      sim.tick();
    }

    // Up to 5 friendly targets in range receive group Temporal Echo (scout + caster + closest dummies)
    const healingDummies = [...sim.entities.values()].filter(
      (e) => e.templateId?.startsWith('healing_dummy_') && !e.dead,
    );
    expect(healingDummies).toHaveLength(5);

    const markedFriendlies = [sim.player, ...healingDummies].filter((e) =>
      e.auras.some(
        (a) => a.kind === 'temporal_echo' && a.echoGroup === true && a.sourceId === sim.player.id,
      ),
    );
    expect(markedFriendlies).toHaveLength(5);
    expect(scout.auras.some((a) => a.kind === 'temporal_echo')).toBe(true);
  });
});
