import { describe, expect, it } from 'vitest';
import { FARM_CROP_IDS } from '../src/sim/content/farm_crops';
import { FARM_BED_IDS, farmBedById } from '../src/sim/content/farm_patches';
import { normalizeFarmPlots, serializeFarmPlots } from '../src/sim/professions/farm_persist';
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
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: false });
    const beforeIds = [...sim.entities.keys()];

    sim.chat('/dev spawn forest_wolf 4');
    sim.chat('/dev level 60');

    expect([...sim.entities.keys()]).toEqual(beforeIds);
    expect(sim.player.level).toBe(1);
    expect(devSpawns(sim)).toEqual([]);
  });
});

describe('/dev bg (Thornhollow Fields force-start)', () => {
  it('force-starts a short-handed match from whoever is queued, no bots', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true, devCommands: true });
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
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: false });
    sim.chat('/dev bg');
    expect(sim.bgMatchFor(sim.playerId)).toBeNull();
  });
});

// The farming grow-now cheat. Its whole value rests on being a pure TIME
// shortcut: the growth script is pre-rolled once at plant time, so "grow now"
// and "wait it out" must reach the SAME harvest. These pin that literally, by
// asserting the hidden pre-rolled slots and plantedAtMs survive untouched and
// that not one rng draw happens. The parity scenario states the same
// equivalence at the session level; the ready-notice and journal phases reach a
// ready plot through this command, so a regression here is a regression there.
describe('/dev farmgrow (farming grow-now)', () => {
  // A plot fixture written straight onto PlayerMeta, so these tests exercise the
  // cheat and nothing else: they neither need nor assume the plant command.
  function plant(sim: Sim, bedId: string, readyAtMs: number, pid = sim.playerId): void {
    const meta = sim.meta(pid);
    if (!meta) throw new Error(`no meta for ${pid}`);
    meta.farmPlots.set(bedId, {
      cropId: 'vale_wheat',
      plantedAtMs: 1_700_000_000_000,
      readyAtMs,
      survivalRoll: 0.4242,
      yieldSeed: 987_654,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });
  }

  const plotOf = (sim: Sim, bedId: string) => sim.meta(sim.playerId)?.farmPlots.get(bedId);
  const FAR = 4_102_444_800_000; // year 2100, comfortably still growing

  it('brings every growing plot ready, drawing zero rng and disturbing nothing else', () => {
    const sim = devSim();
    sim.tick(); // a real positive clock, so the floored grow-now instant IS now
    plant(sim, 'bed_eastbrook_1', FAR);
    plant(sim, 'bed_eastbrook_2', FAR + 90_000);
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    sim.chat('/dev farmgrow');

    const first = plotOf(sim, 'bed_eastbrook_1');
    const second = plotOf(sim, 'bed_eastbrook_2');
    // Both deadlines collapse onto the SAME instant (the authority's now), which
    // is what "set readyAtMs to now" means without reaching for the private clock.
    expect(first?.readyAtMs).toBe(second?.readyAtMs);
    expect(first?.readyAtMs).toBeLessThan(FAR);
    // Neither plot is growing any more, read back through the real projection.
    for (const row of sim.myFarmPlots) expect(row.status).not.toBe('growing');
    // The pre-roll is the thing that must NOT move: plant time and both hidden
    // outcome slots are byte-identical to what was sown.
    for (const plot of [first, second]) {
      expect(plot?.plantedAtMs).toBe(1_700_000_000_000);
      expect(plot?.survivalRoll).toBe(0.4242);
      expect(plot?.yieldSeed).toBe(987_654);
    }
    expect(draws).toBe(0);
  });

  it('accepts the no-space spelling and reports how many plots it advanced', () => {
    const sim = devSim();
    plant(sim, 'bed_eastbrook_1', FAR);

    sim.chat('/devfarmgrow');

    const logs = sim
      .tick()
      .filter((e) => e.type === 'log' && e.pid === sim.playerId)
      .map((e) => (e.type === 'log' ? e.text : ''));
    expect(logs).toContain('[dev] Advanced 1 farm plot to ready (1 planted).');
    expect(plotOf(sim, 'bed_eastbrook_1')?.readyAtMs).toBeLessThan(FAR);
  });

  it('leaves an already-ready plot alone rather than restamping a settled deadline', () => {
    const sim = devSim();
    plant(sim, 'bed_eastbrook_1', 0); // already past its deadline
    plant(sim, 'bed_eastbrook_2', FAR);

    sim.chat('/dev farmgrow');

    expect(plotOf(sim, 'bed_eastbrook_1')?.readyAtMs).toBe(0);
    expect(plotOf(sim, 'bed_eastbrook_2')?.readyAtMs).toBeLessThan(FAR);
    const logs = sim
      .tick()
      .filter((e) => e.type === 'log' && e.pid === sim.playerId)
      .map((e) => (e.type === 'log' ? e.text : ''));
    // One advanced, two planted: the count reports work done, not rows seen.
    expect(logs).toContain('[dev] Advanced 1 farm plot to ready (2 planted).');
  });

  it('a plot grown in the SAME tick it was planted survives a save round trip', () => {
    // The zero-duration mint (QA round): plantCrop stamps plantedAtMs from the
    // tick-quantized clock, and grow-now in the same tick writes readyAtMs to
    // that same instant, so the row's duration is exactly zero. The loader
    // used to refuse duration <= 0, silently destroying such a plot at the
    // next load; a grow-now must stay a pure time shortcut whose result is a
    // loadable, permanently-ready row. On the server the same window is a
    // plant and a farmgrow inside one millisecond.
    const sim = devSim();
    sim.tick(); // a real, positive clock: the never-ticked zero-clock is not this arm
    const bed = farmBedById('bed_eastbrook_1');
    if (!bed) throw new Error('no such bed');
    sim.player.pos.x = bed.x;
    sim.player.pos.z = bed.z;
    sim.player.prevPos = { ...sim.player.pos };
    sim.addItem('vale_wheat_seed', 1, sim.playerId);
    sim.plantCrop('bed_eastbrook_1', 'vale_wheat');
    const meta = sim.meta(sim.playerId);
    expect(meta?.farmPlots.has('bed_eastbrook_1')).toBe(true);

    sim.chat('/dev farmgrow'); // the clock has not moved since the plant

    const plot = plotOf(sim, 'bed_eastbrook_1');
    // Instantly harvestable, exactly what grow-now means...
    for (const row of sim.myFarmPlots) expect(row.status).not.toBe('growing');
    // ...and STILL loadable: the round trip keeps the row instead of dropping
    // it as tampered, and it comes back permanently ready.
    const loaded = normalizeFarmPlots(serializeFarmPlots(meta?.farmPlots ?? new Map()), {
      validBedIds: FARM_BED_IDS,
      validCropIds: FARM_CROP_IDS,
      nowMs: plot?.readyAtMs ?? 1,
    });
    expect(loaded.has('bed_eastbrook_1')).toBe(true);
    const back = loaded.get('bed_eastbrook_1');
    expect(back?.plantedAtMs).toBe(plot?.plantedAtMs);
    expect(back?.readyAtMs).toBe(plot?.readyAtMs);
  });

  it('with a bed argument advances only that bed', () => {
    const sim = devSim();
    plant(sim, 'bed_eastbrook_1', FAR);
    plant(sim, 'bed_eastbrook_2', FAR);

    sim.chat('/dev farmgrow bed_eastbrook_2');

    expect(plotOf(sim, 'bed_eastbrook_1')?.readyAtMs).toBe(FAR);
    expect(plotOf(sim, 'bed_eastbrook_2')?.readyAtMs).toBeLessThan(FAR);
  });

  it('with a bed argument reports honestly when the plot is already settled', () => {
    // The settled plot is left alone AND said to be left alone: its pre-rolled
    // outcome may be withered, so the old unconditional "is ready" reply could
    // mislead a dev testing wither flows (QA-round finding).
    const sim = devSim();
    plant(sim, 'bed_eastbrook_1', 0); // already past its deadline
    sim.chat('/dev farmgrow bed_eastbrook_1');
    expect(plotOf(sim, 'bed_eastbrook_1')?.readyAtMs).toBe(0);
    const logs = sim
      .tick()
      .filter((e) => e.type === 'log' && e.pid === sim.playerId)
      .map((e) => (e.type === 'log' ? e.text : ''));
    expect(logs).toContain('[dev] Bed bed_eastbrook_1 was already settled; nothing to advance.');
    expect(logs).not.toContain('[dev] Bed bed_eastbrook_1 is ready.');
  });

  it('refuses a REAL bed the caller has nothing planted in, and plants nothing', () => {
    // The interesting refusal: bed_eastbrook_2 is a perfectly valid bed id, so a
    // FARM_BED_IDS check would wave it through. The lookup is against the
    // caller's OWN plots, which is the only thing that can be advanced.
    const sim = devSim();
    plant(sim, 'bed_eastbrook_1', FAR);

    sim.chat('/dev farmgrow bed_eastbrook_2');

    expect(plotOf(sim, 'bed_eastbrook_2')).toBeUndefined();
    expect(plotOf(sim, 'bed_eastbrook_1')?.readyAtMs).toBe(FAR);
    const errors = sim
      .tick()
      .filter((e) => e.type === 'error' && e.pid === sim.playerId)
      .map((e) => (e.type === 'error' ? e.text : ''));
    expect(errors).toContain("[dev] No plot on bed 'bed_eastbrook_2'.");
  });

  it('refuses a caller with no planted beds at all', () => {
    const sim = devSim();

    sim.chat('/dev farmgrow');

    const errors = sim
      .tick()
      .filter((e) => e.type === 'error' && e.pid === sim.playerId)
      .map((e) => (e.type === 'error' ? e.text : ''));
    expect(errors).toContain('[dev] You have no planted beds.');
  });

  it('advances plots belonging to the CALLER only, never another player', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true, devCommands: true });
    const alpha = sim.addPlayer('warrior', 'Alpha');
    const beta = sim.addPlayer('mage', 'Beta');
    plant(sim, 'bed_eastbrook_1', FAR, alpha);
    plant(sim, 'bed_eastbrook_1', FAR, beta);

    sim.chat('/dev farmgrow', alpha);

    expect(sim.meta(alpha)?.farmPlots.get('bed_eastbrook_1')?.readyAtMs).toBeLessThan(FAR);
    expect(sim.meta(beta)?.farmPlots.get('bed_eastbrook_1')?.readyAtMs).toBe(FAR);
  });

  it('is inert without devCommands', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: false });
    plant(sim, 'bed_eastbrook_1', FAR);

    sim.chat('/dev farmgrow');

    expect(plotOf(sim, 'bed_eastbrook_1')?.readyAtMs).toBe(FAR);
  });
});
