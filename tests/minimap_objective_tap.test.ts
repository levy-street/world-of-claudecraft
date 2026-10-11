import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MINIMAP_OBJECTIVE_TAP_RADIUS_PX,
  minimapTapProbe,
} from '../src/ui/hud/map/minimap_objective_tap';

describe('minimap objective tap probe', () => {
  it('maps a client tap into the scaled canvas with a scaled hit radius', () => {
    const rect = { left: 100, top: 50, width: 120, height: 120 };
    expect(minimapTapProbe(160, 110, rect, { width: 240, height: 240 })).toEqual({
      x: 120,
      y: 120,
      radius: MINIMAP_OBJECTIVE_TAP_RADIUS_PX * 2,
    });
    expect(minimapTapProbe(100, 50, { ...rect, height: 60 }, { width: 240, height: 240 })).toEqual({
      x: 0,
      y: 0,
      radius: MINIMAP_OBJECTIVE_TAP_RADIUS_PX * 4,
    });
  });

  it('refuses a canvas without a layout box', () => {
    const canvas = { width: 240, height: 240 };
    expect(minimapTapProbe(0, 0, { left: 0, top: 0, width: 0, height: 120 }, canvas)).toBeNull();
    expect(minimapTapProbe(0, 0, { left: 0, top: 0, width: 120, height: 0 }, canvas)).toBeNull();
  });

  it('stays welded to the private Hud members it reads and writes', () => {
    const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    for (const anchor of [
      'private sim: IWorld,',
      'private readonly minimapPainter = new MinimapPainter(',
      "private mapLevel: MapLevel = 'zone';",
      'private mapZoneOverride: string | null = null;',
      'private mapZoom = 1;',
      'private mapCenter: { x: number; z: number } | null = null;',
      'private mapPing: { x: number; z: number } | null = null;',
      'private readonly mapMarkerInteraction: MapMarkerInteractionController;',
      '  toggleMap(): void {',
      '  private updateMapWindow(): void {',
      'bindMinimapObjectiveTap(mm, this);',
    ]) {
      expect(hudSource, anchor).toContain(anchor);
    }
  });
});
