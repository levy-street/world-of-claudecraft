import { describe, expect, it } from 'vitest';
import { parseBisGearFor } from '../src/sim/dev/parse_bis_loadouts';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function devSim(seed = 42): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
}

function devSpawns(sim: Sim, ownerId = sim.playerId) {
  return [...sim.entities.values()]
    .filter((entity) => entity.devSpawnOwnerId === ownerId)
    .sort((a, b) => a.id - b.id);
}

describe('dev commands', () => {
  it('/dev bis uses the selected spec parse loadout without changing the live spec', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'mage',
      autoEquip: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('frost')).toBe(true);

    sim.chat('/dev bis fire');

    expect(sim.meta(sim.playerId)?.talents.spec).toBe('frost');
    expect(sim.meta(sim.playerId)?.equipment).toEqual(parseBisGearFor('mage', 'fire'));
    expect(
      sim
        .drainEvents()
        .some(
          (event) => event.type === 'log' && event.text.includes('top-parse mage fire loadout'),
        ),
    ).toBe(true);
  });

  it('/dev bis rejects a spec owned by another class without changing gear', () => {
    const sim = devSim();
    const before = { ...sim.meta(sim.playerId)?.equipment };

    sim.chat('/dev bis fire');

    expect(sim.meta(sim.playerId)?.equipment).toEqual(before);
    expect(
      sim
        .drainEvents()
        .some(
          (event) =>
            event.type === 'error' &&
            event.text === "[dev] 'fire' is not a warrior spec. Try: arms, fury, prot.",
        ),
    ).toBe(true);
  });

  it('/dev bis removes stale pieces that are not part of the selected parse loadout', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'paladin',
      autoEquip: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) throw new Error('missing player metadata');
    meta.equipment.offhand = 'highwatch_wallshield';
    meta.equipmentInstance.offhand = { rolled: { quality: 'fine' } };

    sim.chat('/dev bis retribution');

    expect(meta.equipment).toEqual(parseBisGearFor('paladin', 'retribution'));
    expect(meta.equipment.offhand).toBeUndefined();
    expect(meta.equipmentInstance.offhand).toBeUndefined();
  });

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
    const sim = new Sim({
      seed: 9,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
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
    const sim = new Sim({
      seed: 15,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
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

  it('mobilestation places through the REAL specialization gate, not around it', () => {
    const sim = devSim();
    const meta = (sim as any).players.get(sim.playerId);

    // Unspecialized: the cheat saves the walk, never the gate (dev_commands.ts
    // routes through placeMobileStationForPlayer).
    sim.chat('/dev mobilestation engineering');
    expect(meta.mobileStation).toBeNull();

    meta.craftSkills.engineering = 75; // the specialization threshold (#1134)
    sim.chat('/dev mobilestation ENGINEERING'); // the arm lowercases the craft id
    expect(meta.mobileStation?.craftId).toBe('engineering');
    // The IWorld read agrees while the station is active.
    expect(sim.activeMobileStationCraft).toBe('engineering');
  });

  it('is inert when dev commands are disabled', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: false,
      world: EMPTY_TEST_WORLD,
    });
    const beforeIds = [...sim.entities.keys()];

    sim.chat('/dev spawn forest_wolf 4');
    sim.chat('/dev level 60');

    expect([...sim.entities.keys()]).toEqual(beforeIds);
    expect(sim.player.level).toBe(1);
    expect(devSpawns(sim)).toEqual([]);
  });

  it('sets the current target to a percent of max health, else self', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 1;
    sim.chat('/dev hp 50');
    expect(player.hp).toBe(100);

    sim.chat('/dev spawn forest_wolf');
    const mob = devSpawns(sim)[0];
    mob.maxHp = 1000;
    mob.hp = 1000;
    player.targetId = mob.id;
    sim.chat('/dev hp 40');
    expect(mob.hp).toBe(400);
    expect(player.hp).toBe(100);

    sim.chat('/dev hp 0');
    expect(mob.hp).toBe(10);
    sim.chat('/dev hp 999');
    expect(mob.hp).toBe(1000);
  });

  it('never leaves a body at zero, however small its pool', () => {
    const sim = devSim();
    const sub = sim.player;
    sub.maxHp = 50;
    sub.hp = 50;
    // 1% of 50 floors to 0, and a body at 0 hp that no death path produced is
    // a state nothing else in the sim can reach.
    sim.chat('/dev hp 1');
    expect(sub.hp).toBe(1);
  });

  it('refuses a dead or non-self player target instead of silently hitting self', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 200;
    sim.chat('/dev spawn forest_wolf');
    const mob = devSpawns(sim)[0];
    mob.maxHp = 1000;
    mob.hp = 1000;
    mob.dead = true;
    player.targetId = mob.id;
    const dead = sim.chat('/dev hp 10');
    expect(dead).toBeNull();
    expect(mob.hp).toBe(1000);
    // The caller's own hp must NOT have moved: an automation caller whose
    // target did not land would otherwise measure itself and never know.
    expect(player.hp).toBe(200);

    const other = sim.addPlayer('mage', 'Otherling');
    const otherEntity = sim.entities.get(other);
    if (!otherEntity) throw new Error('second player missing');
    otherEntity.maxHp = 300;
    otherEntity.hp = 300;
    player.targetId = other;
    sim.chat('/dev hp 10');
    expect(otherEntity.hp).toBe(300);
    expect(player.hp).toBe(200);

    // ...and targeting YOURSELF still works.
    player.targetId = player.id;
    sim.chat('/dev hp 25');
    expect(player.hp).toBe(50);
  });

  it("refuses another tester's pet, which is an owned mob and not a player", () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 200;
    sim.chat('/dev spawn forest_wolf');
    const pet = devSpawns(sim)[0];
    pet.maxHp = 1000;
    pet.hp = 1000;

    const other = sim.addPlayer('mage', 'Otherling');
    pet.ownerId = other;
    player.targetId = pet.id;
    sim.chat('/dev hp 10');
    expect(pet.hp).toBe(1000);
    expect(player.hp).toBe(200);

    // ...while the caller's OWN pet stays theirs to drive.
    pet.ownerId = player.id;
    sim.chat('/dev hp 10');
    expect(pet.hp).toBe(100);
  });

  it('errors, and changes nothing, when the caller is dead with no target', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 0;
    player.dead = true;
    player.targetId = null;
    sim.chat('/dev hp 90');
    expect(player.hp).toBe(0);
  });

  it('draws no rng, like every dev command', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.chat('/dev hp 50');
    sim.chat('/dev hp 100');
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

describe('/dev bg (Thornhollow Fields force-start)', () => {
  it('force-starts a short-handed match from whoever is queued, no bots', () => {
    const sim = new Sim({
      seed: 9,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const a = sim.addPlayer('warrior', 'Alpha');
    const b = sim.addPlayer('mage', 'Beta');
    const c = sim.addPlayer('priest', 'Gamma');
    for (const p of [a, b, c]) {
      sim.entities.get(p)!.level = 20; // the queue floor; /dev bg itself bypasses it
      sim.bgQueueJoin(p);
    }

    sim.chat('/dev bg', a);

    const match = sim.bgMatchFor(a);
    expect(match).toBeTruthy();
    if (!match) throw new Error('missing match');
    expect(match.teams[0].length + match.teams[1].length).toBe(3);
    expect(match.teams[0].length).toBeGreaterThan(0);
    expect(match.teams[1].length).toBeGreaterThan(0);
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(0);
  });

  it('queues the caller and pads with one dev bot for a solo walk-around, drawing zero rng', () => {
    const sim = devSim();
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    sim.chat('/dev bg');

    const match = sim.bgMatchFor(sim.playerId);
    expect(match).toBeTruthy();
    if (!match) throw new Error('missing match');
    const pids = [...match.teams[0], ...match.teams[1]];
    expect(pids).toHaveLength(2);
    const botPid = pids.find((p) => p !== sim.playerId);
    expect(botPid).toBeDefined();
    expect(sim.players.get(botPid ?? -1)?.isDevBot).toBe(true);
    // exactly ONE draw: the power-rune opening face rolled at match start
    // (startBgMatch); queueing, padding, and team-splitting draw nothing.
    expect(draws).toBe(1);
  });

  it('errors on a repeat call from inside the match', () => {
    const sim = devSim();
    sim.chat('/dev bg');
    expect(sim.bgMatchFor(sim.playerId)).toBeTruthy();
    sim.tick();

    sim.chat('/dev bg');

    const errors = sim
      .tick()
      .filter((e) => e.type === 'error' && e.pid === sim.playerId)
      .map((e) => (e.type === 'error' ? e.text : ''));
    expect(errors).toContain('[dev] You are already in a battleground.');
  });

  it('a refused queue join (not the party leader) starts nothing and leaks no bot', () => {
    const sim = devSim();
    // A dead caller used to be the refusal this pinned. Dying no longer cancels
    // a queue, so the bail-before-padding path is exercised through a refusal
    // that survives: only a party's leader may commit it to the queue.
    const leader = sim.addPlayer('priest', 'Leader');
    sim.partyInvite(sim.playerId, leader);
    sim.partyAccept(sim.playerId);
    expect(sim.partyOf(sim.playerId)!.leader).not.toBe(sim.playerId);

    sim.chat('/dev bg');

    expect(sim.bgMatchFor(sim.playerId)).toBeNull();
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(0);
  });

  it('force-starts for a dead caller, who is seated alive', () => {
    const sim = devSim();
    sim.player.hp = 0;
    sim.player.dead = true;

    sim.chat('/dev bg');

    expect(sim.bgMatchFor(sim.playerId), 'dying must not cancel the queue').toBeTruthy();
    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });

  it('reuses an idle leftover dev bot instead of spawning another', () => {
    const sim = devSim();
    sim.chat('/dev bot Riftbot');
    const botCountBefore = [...sim.players.values()].filter((m) => m.isDevBot).length;
    expect(botCountBefore).toBe(1);

    sim.chat('/dev bg');

    expect(sim.bgMatchFor(sim.playerId)).toBeTruthy();
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(1);
  });

  it('is inert without devCommands', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: false,
      world: EMPTY_TEST_WORLD,
    });
    sim.chat('/dev bg');
    expect(sim.bgMatchFor(sim.playerId)).toBeNull();
  });
});
