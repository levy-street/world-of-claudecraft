// Old Thatchgrin keeps his hours with nobody watching (round 12). Every live host (the
// server, the offline browser world) throttles idle mobs outside every player's interest
// radius (SimConfig.idleMobTickRadius, src/sim/mob/idle_tick_skip.ts): an idle, aura-less
// mob far from everyone skips its AI tick. Asleep he carries the slumber aura, so the
// throttle never held his WAKE back; but awake and idle at dawn he had no aura, so the
// throttle skipped the very tick that sends him to his pole, and he stayed off it until a
// player came within the radius (and could see him awake by day on the way in). Pinned
// here through the real host config: with the player far off, dawn still puts him back on
// his pole (asleep, neutral, on his spawn point, facing his field), so whoever rides in
// later finds him already hanging there; nightfall still wakes him unwatched.
import { afterEach, describe, expect, it } from 'vitest';
import { THATCHGRIN_ID } from '../src/sim/content/gourdlight_eve_scarecrow';
import { DAWN_PHASE, DUSK_PHASE, phaseToCycleMs } from '../src/sim/day_night';
import { shouldSkipIdleMobTick } from '../src/sim/mob/idle_tick_skip';
import { SLUMBER_AURA_ID, settleUnwatchedSlumber } from '../src/sim/mob/slumber';
import { resolveScarecrowField } from '../src/sim/seasonal/scarecrow_field';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import { DT, dist2d, type Entity, PLAYER_INTEREST_DROP_RADIUS } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

function clockAt(phase: number) {
  let ms = phaseToCycleMs(phase);
  return { now: () => ms, set: (p: number) => (ms = phaseToCycleMs(p)) };
}

/** A world throttled like the live realm (server/sim_boot_config.ts and the offline
 *  config both pass the interest-drop radius). */
function world(clock: { now: () => number }): Sim {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    dayNightNowMs: clock.now,
    idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
  });
  sim.resetDay = '2026-10-20';
  sim.chat('/dev season on');
  sim.tick();
  return sim;
}

const boss = (sim: Sim) =>
  [...sim.entities.values()].find((e) => e.templateId === THATCHGRIN_ID) as Entity;

function ticks(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}

/** Send the player far out of his interest radius (and keep them there). */
function farAway(sim: Sim, b: Entity): void {
  const p = sim.player;
  p.pos = sim.groundPos(b.spawnPos.x, b.spawnPos.z - 3 * PLAYER_INTEREST_DROP_RADIUS);
  p.prevPos = { ...p.pos };
  sim.tick();
  expect(dist2d(p.pos, b.pos)).toBeGreaterThan(PLAYER_INTEREST_DROP_RADIUS * 2);
}

describe('Old Thatchgrin with nobody near', () => {
  it('climbs back onto his pole at dawn even though no player is within the radius', () => {
    const clock = clockAt(DUSK_PHASE + 0.05);
    const sim = world(clock);
    const b = boss(sim);
    expect(b).toBeDefined();
    farAway(sim, b);
    // nightfall wakes him unwatched (the slumber aura keeps a sleeper ticking)
    ticks(sim, 8);
    expect(b.asleep).toBeFalsy();
    expect(b.hostile).toBe(true);
    // ...and once he is up and idle, the throttle really does skip him: the case at hand
    expect(shouldSkipIdleMobTick(sim.ctx, b)).toBe(true);
    // he strays off his spot while awake (as a wander or a kite would leave him)
    b.pos = sim.groundPos(b.spawnPos.x + 6, b.spawnPos.z + 4);
    b.prevPos = { ...b.pos };
    sim.ctx.rebucket(b);

    clock.set(DAWN_PHASE + 0.05);
    ticks(sim, 1);
    expect(b.asleep).toBe(true);
    expect(b.hostile).toBe(false);
    expect(b.auras.some((a) => a.id === SLUMBER_AURA_ID)).toBe(true);
    // on the pole: his spawn point, facing his field
    const field = resolveScarecrowField(WORLD_SEED);
    expect(field).not.toBeNull();
    expect(dist2d(b.pos, b.spawnPos)).toBeLessThan(0.01);
    expect(b.facing).toBeCloseTo(field?.facing ?? 0, 5);
  });

  it('wakes at nightfall unwatched too, and a player arriving later finds him as the clock says', () => {
    const clock = clockAt(DAWN_PHASE + 0.1);
    const sim = world(clock);
    const b = boss(sim);
    farAway(sim, b);
    ticks(sim, 1);
    expect(b.asleep).toBe(true);
    clock.set(DUSK_PHASE + 0.05);
    ticks(sim, 8);
    expect(b.asleep).toBeFalsy();
    clock.set(DAWN_PHASE + 0.1);
    ticks(sim, 1);
    expect(b.asleep).toBe(true);
    // the arrival: walking in by day finds him already hanging there, never awake
    const p = sim.player;
    p.pos = sim.groundPos(b.spawnPos.x + 30, b.spawnPos.z);
    p.prevPos = { ...p.pos };
    sim.tick();
    expect(b.asleep).toBe(true);
    expect(b.hostile).toBe(false);
  });

  it('leaves a fight running at dawn alone: only an idle, unwatched boss is put to bed', () => {
    const clock = clockAt(DUSK_PHASE + 0.05);
    const sim = world(clock);
    const b = boss(sim);
    farAway(sim, b);
    ticks(sim, 8);
    expect(b.asleep).toBeFalsy();
    b.inCombat = true;
    clock.set(DAWN_PHASE + 0.05);
    sim.tick();
    expect(b.asleep).toBeFalsy();
  });

  it('watched, it does nothing: the visible walk home at dawn is unchanged', () => {
    const clock = clockAt(DUSK_PHASE + 0.05);
    const sim = world(clock);
    const b = boss(sim);
    farAway(sim, b);
    ticks(sim, 8);
    expect(b.asleep).toBeFalsy();
    // he strays, and a player stands in view of him (inside the interest radius)
    b.pos = sim.groundPos(b.spawnPos.x + 12, b.spawnPos.z);
    b.prevPos = { ...b.pos };
    sim.ctx.rebucket(b);
    const p = sim.player;
    p.pos = sim.groundPos(b.pos.x + 40, b.pos.z);
    p.prevPos = { ...p.pos };
    sim.tick();
    clock.set(DAWN_PHASE + 0.05);
    const before = { ...b.pos };
    expect(settleUnwatchedSlumber(sim.ctx, b)).toBe(false);
    expect(b.pos).toEqual(before);
    expect(b.asleep).toBeFalsy();
    // the ordinary driver walks him home and only then puts him on the pole
    sim.tick();
    expect(b.asleep).toBeFalsy();
    expect(dist2d(b.pos, b.spawnPos)).toBeLessThan(12);
  });
});
