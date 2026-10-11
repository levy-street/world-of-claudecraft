import { expect, it } from 'vitest';
import { LAST_KEEP_CANNON, NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { Sim } from '../src/sim/sim';

it('rejects developer preparation in ordinary worlds', () => {
  const sim = new Sim({ seed: 20061, playerClass: 'mage', devCommands: false });
  sim.chat('/dev cannon');
  expect(sim.players.get(sim.playerId)!.devWorldQuestCycle).toBeNull();
  expect(sim.entities.has(NORTH_WATCH_CANNON.entityId)).toBe(false);
});

it.each([
  { command: '/dev cannon', station: NORTH_WATCH_CANNON },
  { command: '/dev cannon last_keep', station: LAST_KEEP_CANNON },
])('arms $command through normal entry without granting progress', ({ command, station }) => {
  const sim = new Sim({ seed: 20061, playerClass: 'mage', devCommands: true });
  sim.chat(command);
  sim.chat(`/dev tp ${station.x} ${station.z + 2}`);
  sim.tick();
  const meta = sim.players.get(sim.playerId)!;
  expect(sim.player.level).toBeGreaterThanOrEqual(10);
  expect(meta.worldQuestLog.get(station.questId)?.state).toBe('active');
  expect(meta.worldQuestLog.get(station.questId)?.count).toBe(0);
  expect(sim.pickUpObject(station.entityId)).toBe(true);
});
