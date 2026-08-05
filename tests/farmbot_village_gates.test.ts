import { describe, expect, it } from 'vitest';
import { routeViaGates, WALLED_HUBS, type WalledHub } from '../farmbot/village_gates';

const HUB: WalledHub = {
  id: 'test',
  center: { x: 0, z: 0 },
  radius: 10,
  gates: [
    { x: 10, z: 0 },
    { x: 0, z: 10 },
    { x: -10, z: 0 },
    { x: 0, z: -10 },
  ],
};

describe('farmbot routeViaGates', () => {
  it('routes outside -> inside through the optimal gate', () => {
    const route = routeViaGates({ x: 20, z: 1 }, { x: 1, z: 1 }, [HUB]);
    expect(route).toEqual([
      { x: 10, z: 0 },
      { x: 1, z: 1 },
    ]);
  });

  it('routes inside -> outside through the optimal gate', () => {
    const route = routeViaGates({ x: 1, z: 1 }, { x: 20, z: 1 }, [HUB]);
    expect(route).toEqual([
      { x: 10, z: 0 },
      { x: 20, z: 1 },
    ]);
  });

  it('picks the gate by total leg distance, not just the closest one', () => {
    // pos near the south gate, but the target sits right next to the east one
    const route = routeViaGates({ x: 1, z: -12 }, { x: 9, z: 1 }, [HUB]);
    expect(route[0]).toEqual({ x: 10, z: 0 });
  });

  it('offers the next-best gate at gateIndex 1', () => {
    const best = routeViaGates({ x: 20, z: 1 }, { x: 1, z: 1 }, [HUB], 0);
    const next = routeViaGates({ x: 20, z: 1 }, { x: 1, z: 1 }, [HUB], 1);
    expect(next[0]).not.toEqual(best[0]);
    expect(next[1]).toEqual({ x: 1, z: 1 });
  });

  it('goes direct when both points are inside, or both outside', () => {
    expect(routeViaGates({ x: 1, z: 1 }, { x: 2, z: 2 }, [HUB])).toEqual([{ x: 2, z: 2 }]);
    expect(routeViaGates({ x: 30, z: 30 }, { x: 40, z: 40 }, [HUB])).toEqual([{ x: 40, z: 40 }]);
  });

  it('real eastbrook gates lie on the wall circle', () => {
    const eastbrook = WALLED_HUBS.find((h) => h.id === 'eastbrook');
    if (!eastbrook) throw new Error('eastbrook hub missing from WALLED_HUBS');
    expect(eastbrook.gates.length).toBe(6);
    for (const gate of eastbrook.gates) {
      const r = Math.hypot(gate.x - eastbrook.center.x, gate.z - eastbrook.center.z);
      expect(r).toBeCloseTo(eastbrook.radius, 1);
    }
  });

  it('real fenbridge gates lie on the wall circle', () => {
    const fenbridge = WALLED_HUBS.find((h) => h.id === 'fenbridge');
    if (!fenbridge) throw new Error('fenbridge hub missing from WALLED_HUBS');
    expect(fenbridge.gates.length).toBe(4);
    for (const gate of fenbridge.gates) {
      const r = Math.hypot(gate.x - fenbridge.center.x, gate.z - fenbridge.center.z);
      expect(Math.abs(r - fenbridge.radius)).toBeLessThan(1);
    }
  });
});
