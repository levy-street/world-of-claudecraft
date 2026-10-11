import { describe, expect, it } from 'vitest';
import { GLIDER_WIND_TUNNELS } from '../src/sim/content/world_quest_glider';
import { createGliderFlightState } from '../src/sim/minigames/glider_flight';
import {
  applyGliderWind,
  crossesGliderWind,
  type GliderWindTunnelDef,
} from '../src/sim/minigames/glider_wind';
import { decodeGliderState } from '../src/sim/world_quest_glider_wire';

const tunnel: GliderWindTunnelDef = {
  id: 'test',
  x: 0,
  y: 100,
  z: 0,
  yaw: 0,
  radius: 4,
  length: 20,
  speedBoost: 8,
};
const before = { x: 0, y: 100, z: -20 },
  after = { x: 0, y: 100, z: 20 };
describe('glider wind lanes', () => {
  it('sweeps a forward passage even when a tick crosses the whole lane', () => {
    expect(crossesGliderWind(before, after, tunnel)).toBe(true);
    expect(applyGliderWind(22, [], before, after, [tunnel])).toEqual({
      speed: 30,
      windBoosts: ['test'],
    });
  });
  it('rejects reverse passage, camping, and missing the circular opening', () => {
    expect(crossesGliderWind(after, before, tunnel)).toBe(false);
    expect(crossesGliderWind(before, before, tunnel)).toBe(false);
    expect(crossesGliderWind({ ...before, y: 105 }, { ...after, y: 105 }, tunnel)).toBe(false);
    expect(crossesGliderWind({ ...before, x: 5 }, { ...after, x: 5 }, tunnel)).toBe(false);
    expect(crossesGliderWind({ x: -20, y: 100, z: 0 }, { x: 20, y: 100, z: 0 }, tunnel)).toBe(
      false,
    );
  });
  it('caps speed and grants each lane only once per attempt', () => {
    expect(applyGliderWind(36, [], before, after, [tunnel]).speed).toBe(38);
    expect(applyGliderWind(22, ['test'], before, after, [tunnel]).speed).toBe(22);
    expect(createGliderFlightState().windBoosts).toEqual([]);
  });
  it('uses each authored lane direction and gives no speed on a sideways crossing', () => {
    for (const lane of GLIDER_WIND_TUNNELS) {
      const dx = Math.sin(lane.yaw),
        dz = Math.cos(lane.yaw);
      const start = { x: lane.x - dx * lane.length, y: lane.y, z: lane.z - dz * lane.length };
      const end = { x: lane.x + dx * lane.length, y: lane.y, z: lane.z + dz * lane.length };
      expect(crossesGliderWind(start, end, lane)).toBe(true);
      expect(crossesGliderWind(end, start, lane)).toBe(false);
      expect(crossesGliderWind(lane, lane, lane)).toBe(false);
    }
  });
  it('decodes old snapshots and only copies unique known wind ids', () => {
    const old = { ...createGliderFlightState(false), windBoosts: undefined };
    expect(decodeGliderState(old, 'wq_galecrest_slalom')?.windBoosts).toEqual([]);
    const id = GLIDER_WIND_TUNNELS[0].id;
    expect(
      decodeGliderState({ ...old, windBoosts: [id, id, 'bad', 42] }, 'wq_galecrest_slalom')
        ?.windBoosts,
    ).toEqual([id]);
  });
});
