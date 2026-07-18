import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';

function devSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, devCommands: true });
}

function devSpawns(sim: Sim, ownerId = sim.playerId) {
  return [...sim.entities.values()]
    .filter((entity) => entity.devSpawnOwnerId === ownerId)
    .sort((a, b) => a.id - b.id);
}

describe('dev commands', () => {
  it('spawns concrete mob templates without drawing RNG', () => {
    const sim = devSim();
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    sim.chat('/dev spawn forest_wolf 3 17');

    const spawned = devSpawns(sim);
    expect(spawned).toHaveLength(3);
    expect(spawned.map((mob) => [mob.templateId, mob.level, mob.devSpawnOwnerId])).toEqual([
      ['forest_wolf', 17, sim.playerId],
      ['forest_wolf', 17, sim.playerId],
      ['forest_wolf', 17, sim.playerId],
    ]);
    expect(new Set(spawned.map((mob) => `${mob.pos.x},${mob.pos.y},${mob.pos.z}`)).size).toBe(3);
    expect(draws).toBe(0);
  });

  it('keeps spawn placement deterministic and clamps oversized batches', () => {
    const run = () => {
      const sim = devSim(77);
      sim.player.facing = 0.7;
      sim.chat('/dev spawn forest_wolf 999 999');
      return devSpawns(sim).map((mob) => ({ level: mob.level, pos: mob.pos }));
    };

    const first = run();
    expect(first).toHaveLength(20);
    expect(first.every((mob) => mob.level === MAX_LEVEL)).toBe(true);
    expect(run()).toEqual(first);
  });

  it('despawns only mobs created by the requesting developer', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true, devCommands: true });
    const alpha = sim.addPlayer('warrior', 'Alpha');
    const beta = sim.addPlayer('mage', 'Beta');
    sim.chat('/dev spawn forest_wolf 2', alpha);
    sim.chat('/dev spawn wild_boar 1', beta);
    const betaSpawn = devSpawns(sim, beta)[0];
    const alphaEntity = sim.entities.get(alpha);
    expect(alphaEntity).toBeDefined();
    if (!alphaEntity) throw new Error('missing alpha player');
    alphaEntity.targetId = betaSpawn.id;

    sim.chat('/dev despawn target', alpha);
    expect(sim.entities.has(betaSpawn.id)).toBe(true);
    expect(alphaEntity.targetId).toBe(betaSpawn.id);

    sim.chat('/dev despawn spawned', alpha);
    expect(devSpawns(sim, alpha)).toEqual([]);
    expect(devSpawns(sim, beta).map((mob) => mob.id)).toEqual([betaSpawn.id]);
  });

  it('clears every player target and owned spawn when its developer leaves', () => {
    const sim = new Sim({ seed: 15, playerClass: 'warrior', noPlayer: true, devCommands: true });
    const alpha = sim.addPlayer('warrior', 'Alpha');
    const beta = sim.addPlayer('mage', 'Beta');
    sim.chat('/dev spawn forest_wolf 2', alpha);
    const [first, second] = devSpawns(sim, alpha);
    const alphaEntity = sim.entities.get(alpha);
    const betaEntity = sim.entities.get(beta);
    expect(alphaEntity).toBeDefined();
    expect(betaEntity).toBeDefined();
    if (!alphaEntity || !betaEntity) throw new Error('missing test players');
    alphaEntity.targetId = first.id;
    betaEntity.targetId = second.id;

    sim.chat('/dev despawn spawned', alpha);
    expect(alphaEntity.targetId).toBeNull();
    expect(betaEntity.targetId).toBeNull();

    sim.chat('/dev spawn wild_boar 2', alpha);
    sim.removePlayer(alpha);
    expect(devSpawns(sim, alpha)).toEqual([]);
  });

  it('restores player test state and clears combat relationships', () => {
    const sim = devSim();
    const player = sim.player;
    sim.chat('/dev spawn forest_wolf');
    const mob = devSpawns(sim)[0];
    player.hp = 1;
    player.resource = 0;
    player.cooldowns.set('heroic_strike', 50);
    player.gcdRemaining = 1;
    player.potionCooldownUntil = sim.time + 60;
    player.potionCdRemaining = 60;
    player.inCombat = true;
    player.autoAttack = true;
    mob.inCombat = true;
    mob.targetId = player.id;
    mob.aggroTargetId = player.id;
    mob.threat.set(player.id, 100);

    sim.chat('/dev heal');
    sim.chat('/dev resource');
    sim.chat('/dev cooldowns');
    sim.chat('/dev combatreset');

    expect(player.hp).toBe(player.maxHp);
    expect(player.resource).toBe(player.maxResource);
    expect(player.cooldowns.size).toBe(0);
    expect(player.gcdRemaining).toBe(0);
    expect(player.potionCooldownUntil).toBe(sim.time);
    expect(player.inCombat).toBe(false);
    expect(player.autoAttack).toBe(false);
    expect(mob.threat.has(player.id)).toBe(false);
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.targetId).toBeNull();
    expect(mob.inCombat).toBe(false);
  });

  it('revives through the normal resurrection teardown', () => {
    const sim = devSim();
    sim.chat('/dev kill');
    expect(sim.player.dead).toBe(true);

    sim.chat('/dev revive');

    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(sim.player.inCombat).toBe(false);
  });

  it('is inert when dev commands are disabled', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: false });
    const beforeIds = [...sim.entities.keys()];

    sim.chat('/dev spawn forest_wolf 4');
    sim.chat('/dev level 60');

    expect([...sim.entities.keys()]).toEqual(beforeIds);
    expect(sim.player.level).toBe(1);
    expect(devSpawns(sim)).toEqual([]);
  });
});
