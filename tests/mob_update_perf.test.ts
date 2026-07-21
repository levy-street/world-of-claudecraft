import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const WORLD_SEED = 20061;
const CLUSTER = { x: 0, z: 60 };
// Enough clustered engaged mobs to exercise a high-load realm shape (the fresh
// world already spawns ~400 mobs/npcs/objects and this adds 100 players + the pack).
const PACK = 250;
const PLAYERS = 100;

// Build a deliberately hostile shape: ~100 players packed into one spot, engaged by
// a dense pack of mobs each carrying a deep hate table (the big-pull case where every
// mob's per-tick target scan walks a ~100-entry threat map).
function buildPileup(): { sim: Sim; players: number[]; entities: number } {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
  const players: number[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const pid = sim.addPlayer('warrior', `Zerg${i}`);
    const e = sim.entities.get(pid);
    if (!e) continue;
    e.pos.x = CLUSTER.x + ((i % 10) - 5) * 0.6;
    e.pos.z = CLUSTER.z + (Math.floor(i / 10) - 5) * 0.6;
    e.prevPos = { ...e.pos };
    // Keep the crowd alive across the measurement window so the shape stays stable
    // (players never fight back, so the pack population is stable regardless).
    e.maxHp = 1_000_000;
    e.hp = e.maxHp;
    players.push(pid);
  }

  const template = MOBS.forest_wolf;
  for (let i = 0; i < PACK; i++) {
    const ang = (i / PACK) * Math.PI * 2;
    const r = 2 + (i % 11);
    const pos = sim.groundPos(CLUSTER.x + Math.sin(ang) * r, CLUSTER.z + Math.cos(ang) * r);
    const mob = createMob(sim.nextId++, template, template.maxLevel, pos);
    mob.facing = ang;
    mob.prevFacing = ang;
    sim.addEntity(mob);
    // Force it into the engaged hot path with a deep hate table: every player has
    // tagged it (descending threat), so updateMobTarget walks all PLAYERS entries
    // each tick. leashAnchor at the pack center keeps it from leashing out.
    mob.aiState = 'attack';
    mob.inCombat = true;
    mob.combatTimer = 0;
    mob.aggroTargetId = players[i % players.length];
    mob.leashAnchor = { ...pos };
    mob.spawnPos = { ...pos };
    for (let p = 0; p < players.length; p++) mob.threat.set(players[p], players.length - p);
  }

  return { sim, players, entities: sim.entities.size };
}

describe('mob.update high-load regression budget', () => {
  it('bounds mob.update per-tick cost and tags every mob lap for zone attribution', () => {
    const { sim, entities } = buildPileup();

    // Attribute sim.tick() phase time exactly the way the server does: the sim owns
    // no clock; the host times each phase between laps. Here the test is the host.
    let mark = 0;
    let mobUpdateThisTick = 0;
    let mobLapTotal = 0;
    let mobLapWithEntity = 0;
    const lap = (phase: string, entity?: Entity): void => {
      const t = performance.now();
      const dt = t - mark;
      if (phase === 'mob.update') {
        mobUpdateThisTick += dt;
        mobLapTotal++;
        if (entity !== undefined) mobLapWithEntity++;
      }
      mark = t;
    };
    (sim as unknown as { cfg: { perfLap: typeof lap } }).cfg.perfLap = lap;

    let mobs = 0;
    for (const e of sim.entities.values()) if (e.kind === 'mob') mobs++;

    // Warm up: bucket the crowd into the spatial grid and settle mob states.
    for (let i = 0; i < 10; i++) sim.tick();

    const MEASURE_TICKS = 120;
    const samples: number[] = [];
    for (let i = 0; i < MEASURE_TICKS; i++) {
      mobUpdateThisTick = 0;
      mark = performance.now();
      sim.tick();
      samples.push(mobUpdateThisTick);
    }
    // The budget asserts on the MEDIAN tick, not the mean: this suite runs alongside
    // other Vitest workers, so a one-off GC/scheduling pause can spike a single tick
    // by 50x. The median reflects the steady-state per-tick cost and rejects those
    // outliers, so the gate catches a sustained regression instead of flaking on
    // isolated noise.
    samples.sort((a, b) => a - b);
    const medianMobUpdate = samples[Math.floor(samples.length / 2)];
    const meanMobUpdate = samples.reduce((s, v) => s + v, 0) / samples.length;
    const worstTickMs = samples[samples.length - 1];

    let engaged = 0;
    let maxThreat = 0;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (e.aiState === 'chase' || e.aiState === 'attack' || e.aiState === 'flee') engaged++;
      if (e.threat.size > maxThreat) maxThreat = e.threat.size;
    }

    console.log(
      `[mob.update perf] players=${PLAYERS} entities=${entities} mobs=${mobs} engaged=${engaged} ` +
        `maxThreatTable=${maxThreat} median=${medianMobUpdate.toFixed(2)}ms mean=${meanMobUpdate.toFixed(2)}ms ` +
        `worstTick=${worstTickMs.toFixed(2)}ms laps=${mobLapWithEntity}/${mobLapTotal}`,
    );

    // Instrumentation contract: the sim tags EVERY mob.update lap with its entity so
    // the host can split the phase time per zone.
    expect(mobLapTotal).toBeGreaterThan(0);
    expect(mobLapWithEntity).toBe(mobLapTotal);

    // Shape sanity: we really built the ~100-player / ~750-entity clustered-engaged
    // pile-up, not an empty world.
    expect(entities).toBeGreaterThan(700);
    expect(engaged).toBeGreaterThanOrEqual(PACK - 20);
    expect(maxThreat).toBeGreaterThanOrEqual(PLAYERS - 5);

    // Per-tick budget. Generous by design: the healthy median at this population is a
    // few ms (observed ~2-3 ms), so a 30 ms median bound (still under one 20 Hz tick,
    // 50 ms) leaves ample headroom for slow/contended CI hardware while still catching
    // a sustained order-of-magnitude regression.
    expect(medianMobUpdate).toBeLessThan(30);
  }, 60_000);
});
