import { describe, expect, it } from 'vitest';
import { locationDisplay } from '../src/admin/location';

describe('admin location display', () => {
  it('uses a nearby POI as the primary overworld location', () => {
    const display = locationDisplay({
      x: 76,
      z: -76,
      location: {
        kind: 'overworld',
        zoneId: 'eastbrook_vale',
        zone: 'Eastbrook Vale',
        instanceId: null,
        instance: null,
        instanceSlot: null,
        poiIndex: 6,
        poi: 'Bandit Camp',
        poiDistance: 4,
      },
    });

    expect(display.primary).toBe('Bandit Camp');
    expect(display.secondary).toBe('76, -76');
    expect(display.details).toContain('Zone: Eastbrook Vale');
    expect(display.details).toContain('Nearest landmark: Bandit Camp');
    expect(display.details).toContain('Distance: 4 yd');
  });

  it('uses the instance name as the primary dungeon location', () => {
    const display = locationDisplay({
      x: 900,
      z: -1250,
      location: {
        kind: 'dungeon',
        zoneId: 'eastbrook_vale',
        zone: 'Eastbrook Vale',
        instanceId: 'hollow_crypt',
        instance: 'The Hollow Crypt',
        instanceSlot: 2,
        poiIndex: null,
        poi: null,
        poiDistance: null,
      },
    });

    expect(display.primary).toBe('The Hollow Crypt');
    expect(display.details).toContain('Instance: The Hollow Crypt');
    expect(display.details).toContain('Slot: 2');
  });
});
