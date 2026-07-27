import { describe, expect, it } from 'vitest';
import { telemetryZoneId } from '../src/game/world_telemetry';
import {
  ARENA_X_MIN,
  DUNGEON_X_THRESHOLD,
  delveOrigin,
  YUMI_BAND_X_MAX,
  YUMI_BAND_X_MIN,
} from '../src/sim/data';

describe('telemetry zone id', () => {
  it('reports the overworld zoneAt id by z position', () => {
    expect(telemetryZoneId(0, 0)).toBe('eastbrook_vale');
    expect(telemetryZoneId(-40, 300)).toBe('mirefen_marsh');
  });

  it('keeps the west overworld edge on the zone id, not an instance id', () => {
    expect(telemetryZoneId(DUNGEON_X_THRESHOLD, 10)).toBe('eastbrook_vale');
  });

  it('reports a bounded dungeon-scoped id inside a dungeon band', () => {
    expect(telemetryZoneId(900, 0)).toBe('dungeon:hollow_crypt');
  });

  it('reports a bounded delve-scoped id inside a delve band', () => {
    expect(telemetryZoneId(delveOrigin(0, 0).x, delveOrigin(0, 0).z)).toBe(
      'delve:collapsed_reliquary',
    );
  });

  it('reports the fixed arena and yumi ids for their bands', () => {
    expect(telemetryZoneId(ARENA_X_MIN + 10, 0)).toBe('arena');
    expect(telemetryZoneId(YUMI_BAND_X_MIN + 10, 0)).toBe('yumi_maze');
  });

  it('keeps the defensive fallbacks bounded for unmapped instance coordinates', () => {
    // A delve-band slot with no delve record behind it (only indexes 0-1 have
    // content today) still emits a bounded label, never a raw coordinate.
    expect(telemetryZoneId(7900, 0)).toBe('delve:unknown');
    // Past every mapped band (beyond the yumi maze ceiling) folds to the
    // generic instance label.
    expect(telemetryZoneId(YUMI_BAND_X_MAX + 10, 0)).toBe('instance');
  });
});
