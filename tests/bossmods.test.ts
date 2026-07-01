import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { BossModsData } from '../src/ui/bossmods';

const warn = (mechanic: string, eta: number): SimEvent =>
  ({ type: 'bossWarn', entityId: 99, mechanic, eta }) as SimEvent;

describe('BossModsData (raid warnings)', () => {
  it('adds a countdown timer + flashes an alert for a telegraphed mechanic', () => {
    const d = new BossModsData();
    d.onEvent(warn('stomp', 4), 1000);
    expect(d.timers).toHaveLength(1);
    expect(d.timers[0]).toMatchObject({ mechanic: 'stomp', total: 4 });
    expect(d.timers[0].endsAt).toBe(1000 + 4000);
    expect(d.alertMechanic).toBe('stomp');
  });

  it('an instant mechanic (eta 0) flashes an alert but adds no bar', () => {
    const d = new BossModsData();
    d.onEvent(warn('enrage', 0), 1000);
    expect(d.timers).toHaveLength(0);
    expect(d.alertMechanic).toBe('enrage');
  });

  it('a fresh cast of the same mechanic replaces its timer (no duplicates)', () => {
    const d = new BossModsData();
    d.onEvent(warn('gravebreaker', 4), 1000);
    d.onEvent(warn('gravebreaker', 4), 5000);
    expect(d.timers).toHaveLength(1);
    expect(d.timers[0].endsAt).toBe(5000 + 4000);
  });

  it('ignores non-bossWarn events', () => {
    const d = new BossModsData();
    d.onEvent({ type: 'death', entityId: 1, killerId: 2 } as SimEvent, 1000);
    expect(d.timers).toHaveLength(0);
    expect(d.alertMechanic).toBeNull();
  });

  it('update() prunes expired bars and clears a stale alert', () => {
    const d = new BossModsData();
    d.onEvent(warn('soul_rend', 8), 1000);
    d.update(1000 + 4000); // mid-flight: bar alive, alert still up
    expect(d.timers).toHaveLength(1);
    d.update(1000 + 9000); // past the 8s bar + the 2.6s alert
    expect(d.timers).toHaveLength(0);
    expect(d.alertMechanic).toBeNull();
  });

  it('ordered() returns active bars soonest-first', () => {
    const d = new BossModsData();
    d.onEvent(warn('deathless_rage', 10), 0);
    d.onEvent(warn('stomp', 4), 0);
    expect(d.ordered().map((t) => t.mechanic)).toEqual(['stomp', 'deathless_rage']);
  });
});
