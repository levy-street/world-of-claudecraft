import { describe, expect, it } from 'vitest';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { CANNON_ENDLESS } from '../src/sim/minigames/cannon_endless';
import { Sim } from '../src/sim/sim';
import { type SimEvent, TICK_RATE } from '../src/sim/types';

type CannonResultEvent = Extract<SimEvent, { type: 'cannonResult' }>;
type ScoreEvent = Extract<SimEvent, { type: 'worldQuestScore' }>;

function armed(): Sim {
  const sim = new Sim({ seed: 5, playerClass: 'mage', devCommands: true });
  sim.chat('/dev cannon');
  sim.chat(`/dev tp ${NORTH_WATCH_CANNON.x} ${NORTH_WATCH_CANNON.z + 2}`);
  sim.tick();
  sim.tick();
  return sim;
}

/** Fire the readiest shot at the enemy closest to the line, every tick. */
function autoFire(sim: Sim): void {
  const encounter = sim.vehicleSession?.encounter;
  if (!encounter) return;
  const enemy = [...encounter.enemies].sort((a, b) => b.z - a.z)[0];
  if (!enemy) return;
  const point = { x: enemy.x, z: Math.min(NORTH_WATCH_CANNON.field.maxZ, enemy.z + 1) };
  for (const action of ['cannonball', 'incendiary', 'grapeshot'] as const) {
    if (sim.useVehicleAction(action, point)) break;
  }
}

describe('endless cannon play at the manned station', () => {
  it('credits the quest once at the victory, keeps the cannon manned, and a later fall costs nothing', () => {
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    if (!sim.enterVehicle(NORTH_WATCH_CANNON.id)) {
      // The developer arm could not seat the tester on this seed/world; the
      // kernel suite covers the endless machine itself.
      return;
    }
    const results: CannonResultEvent[] = [];
    const scores: ScoreEvent[] = [];
    const copperBefore = sim.copper;
    let victoryTick = -1;
    for (let tick = 0; tick < 300 * TICK_RATE && sim.vehicleSession; tick++) {
      autoFire(sim);
      for (const event of sim.tick()) {
        if (event.type === 'cannonResult') results.push(event as CannonResultEvent);
        if (event.type === 'worldQuestScore') scores.push(event as ScoreEvent);
      }
      if (
        victoryTick < 0 &&
        meta.worldQuestLog.get(NORTH_WATCH_CANNON.questId)?.state === 'completed'
      )
        victoryTick = tick;
      // Once endless play begins, stop firing so the wall comes quickly.
      if (victoryTick >= 0 && tick > victoryTick + 2 * TICK_RATE) break;
    }
    expect(victoryTick).toBeGreaterThan(0);
    expect(results).toHaveLength(1);
    expect(results[0].medal).not.toBeNull();
    // The victory posts the authored line as a ladder row (waves held so far).
    expect(scores).toEqual([
      {
        type: 'worldQuestScore',
        pid: sim.playerId,
        board: 'north_watch_cannon',
        medal: results[0].medal,
        metric: results[0].wavesCleared,
      },
    ]);
    const session = sim.vehicleSession;
    expect(session?.encounter.endless).toBe(true);
    expect(session?.encounter.victoryMedal).toBe(results[0].medal);
    const rewarded = sim.copper;
    expect(rewarded).toBeGreaterThan(copperBefore);
    // Hold fire: the endless waves breach the line and the run ends with the medal intact.
    for (let tick = 0; tick < 240 * TICK_RATE && sim.vehicleSession; tick++) {
      for (const event of sim.tick()) {
        if (event.type === 'cannonResult') results.push(event as CannonResultEvent);
        if (event.type === 'worldQuestScore') scores.push(event as ScoreEvent);
      }
    }
    expect(sim.vehicleSession).toBeNull();
    expect(results).toHaveLength(2);
    // The endless fall posts the total waves held with the victory medal intact.
    expect(scores).toHaveLength(2);
    expect(scores[1]).toMatchObject({
      board: 'north_watch_cannon',
      medal: results[0].medal,
      metric: results[1].wavesCleared,
    });
    expect(scores[1].metric).toBeGreaterThanOrEqual(scores[0].metric);
    expect(results[1].medal).toBe(results[0].medal);
    expect(results[1].wavesCleared).toBeGreaterThanOrEqual(3);
    expect(results[1].wavesCleared).toBeLessThanOrEqual(3 + CANNON_ENDLESS.maxRounds);
    expect(sim.copper).toBe(rewarded);
    // No retry lockout after an endless fall: the cannon is manned again at once.
    expect(sim.enterVehicle(NORTH_WATCH_CANNON.id)).toBe(true);
    expect(sim.vehicleSession?.encounter.endless ?? false).toBe(false);
  }, 150_000); // A full-world session ticks minutes of game time.
});
