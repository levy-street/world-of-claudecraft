import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';

const HOUR = 60 * 60 * 1000;

describe('Sim.raidLockouts', () => {
  it('returns nothing when no raid is locked', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    expect(sim.raidLockouts()).toEqual([]);
  });

  it('projects a granted lockout as remaining ms, dropping expired ones', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const now = Math.floor(sim.time * 1000);
    const meta = (sim as any).primary;
    meta.raidLockouts.set('nythraxis_boss_arena', now + 5 * HOUR);
    meta.raidLockouts.set('expired_raid', now - 1000); // already past

    const out = sim.raidLockouts();
    expect(out).toEqual([{ id: 'nythraxis_boss_arena', msRemaining: 5 * HOUR }]);
  });
});

describe('ClientWorld.raidLockouts', () => {
  it('derives remaining time from the mirrored expiry map and the local clock', () => {
    const client: ClientWorld = Object.create(ClientWorld.prototype);
    const now = Date.now();
    (client as any).selfLockouts = {
      nythraxis_boss_arena: now + 3 * HOUR,
      stale_raid: now - 5000, // expired -> excluded
    };
    const out = client.raidLockouts();
    expect(out.map((l) => l.id)).toEqual(['nythraxis_boss_arena']);
    expect(out[0].msRemaining).toBeGreaterThan(3 * HOUR - 2000);
    expect(out[0].msRemaining).toBeLessThanOrEqual(3 * HOUR);
  });

  it('is empty (no throw) before any snapshot has set the lockout map', () => {
    const client: ClientWorld = Object.create(ClientWorld.prototype);
    expect(client.raidLockouts()).toEqual([]);
  });
});
