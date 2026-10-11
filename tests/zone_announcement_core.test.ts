import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import { ZoneAnnouncementCore } from '../src/ui/zone_announcement_core';

describe('zone announcements during a ferry voyage', () => {
  it('keeps the normal startup welcome and does not repeat it on the next update', () => {
    const player = {} as Entity;
    const core = new ZoneAnnouncementCore();
    expect(core.initialize('departure', player)).toBe(true);
    expect(core.update('departure', 'departure', player)).toBe(false);
    expect(core.update('next', 'departure', player)).toBe(true);
  });

  it.each(['offline', 'online'])('defers a HUD opened aboard until docking (%s)', (host) => {
    const player = { ferryRiding: host === 'online' } as Entity;
    if (host === 'offline') {
      player.ferryRide = { route: 'ferry', from: 0, to: 1, ship: { x: 0, z: 0, rot: 0 } };
    }
    const core = new ZoneAnnouncementCore();
    expect(core.initialize('destination', player)).toBe(false);
    expect(core.update('destination', 'destination', player)).toBe(false);
    delete player.ferryRide;
    player.ferryRiding = false;
    expect(core.update('destination', 'destination', player)).toBe(true);
    expect(core.update('destination', 'destination', player)).toBe(false);
  });

  it.each(['offline', 'online'])('silences nearby landmarks at sea, then resumes (%s)', (host) => {
    const player = { pos: { x: 12, y: 0, z: 34 }, ferryRiding: host === 'online' } as Entity;
    if (host === 'offline') {
      player.ferryRide = { route: 'ferry', from: 0, to: 1, ship: { x: 0, z: 0, rot: 0 } };
    }
    const pois = [{ x: 12, z: 34, label: 'Harbor' }];
    const core = new ZoneAnnouncementCore();
    expect(core.subzone(player, false, pois, 'Harbor')).toBeNull();
    delete player.ferryRide;
    player.ferryRiding = false;
    expect(core.subzone(player, false, pois, null)).toBe('Harbor');
    expect(core.subzone(player, true, pois, 'Harbor')).toBeNull();
  });

  it.each(['offline', 'online'])('defers crossed zones until docking (%s)', (host) => {
    const player = {} as Entity;
    const core = new ZoneAnnouncementCore();
    expect(core.update('departure', 'departure', player)).toBe(false);
    if (host === 'offline')
      player.ferryRide = { route: 'ferry', from: 0, to: 1, ship: { x: 0, z: 0, rot: 0 } };
    else player.ferryRiding = true;
    expect(core.update('passing', 'departure', player)).toBe(false);
    expect(core.update('destination', 'passing', player)).toBe(false);
    expect(core.update('destination', 'destination', player)).toBe(false);
    delete player.ferryRide;
    player.ferryRiding = false;
    expect(core.update('destination', 'destination', player)).toBe(true);
    expect(core.update('destination', 'destination', player)).toBe(false);
    expect(core.update('passing', 'destination', player)).toBe(true);
  });

  it('does not announce initial placement or a round trip into the departure zone', () => {
    const core = new ZoneAnnouncementCore();
    const player = {} as Entity;
    expect(core.update('departure', '', player)).toBe(false);
    player.ferryRiding = true;
    expect(core.update('passing', 'departure', player)).toBe(false);
    player.ferryRiding = false;
    expect(core.update('departure', 'passing', player)).toBe(false);
  });
});
