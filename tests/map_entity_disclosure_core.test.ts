import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isLiveMapEntityDisclosed,
  LIVE_MAP_ENTITY_DISCLOSURE_RADIUS,
} from '../src/ui/map_entity_disclosure_core';

describe('live map entity disclosure', () => {
  it('includes the exact 80-yard boundary in every planar direction', () => {
    const r = LIVE_MAP_ENTITY_DISCLOSURE_RADIUS;
    expect(r).toBe(80);
    expect(isLiveMapEntityDisclosed(10, -20, 10 + r, -20)).toBe(true);
    expect(isLiveMapEntityDisclosed(10, -20, 10 - r, -20)).toBe(true);
    expect(isLiveMapEntityDisclosed(10, -20, 10, -20 + r)).toBe(true);
    expect(isLiveMapEntityDisclosed(10, -20, 10, -20 - r)).toBe(true);
  });

  it('uses squared planar distance and excludes points just outside the boundary', () => {
    const r = LIVE_MAP_ENTITY_DISCLOSURE_RADIUS;
    const diagonal = r / Math.SQRT2;
    expect(isLiveMapEntityDisclosed(0, 0, diagonal, diagonal)).toBe(true);
    expect(isLiveMapEntityDisclosed(0, 0, r + Number.EPSILON * r, 0)).toBe(false);
    expect(isLiveMapEntityDisclosed(0, 0, r, 1)).toBe(false);
  });
});

describe('live map disclosure policy ownership', () => {
  const consumers = [
    {
      name: 'Rift instance map',
      path: '../src/ui/hud/rift/rift_map_core.ts',
      importPath: '../../map_entity_disclosure_core',
      expectedCalls: 2,
    },
    {
      name: 'Delve instance map',
      path: '../src/ui/hud/delve/delve_map_painter.ts',
      importPath: '../../map_entity_disclosure_core',
      expectedCalls: 1,
    },
    {
      name: 'zone-map live Rift landmark',
      path: '../src/ui/map_navigation_landmarks_core.ts',
      importPath: './map_entity_disclosure_core',
      expectedCalls: 1,
    },
  ] as const;

  it.each(consumers)(
    '$name calls the one neutral disclosure predicate',
    ({ path, importPath, expectedCalls }) => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');

      expect(source).toContain(`import { isLiveMapEntityDisclosed } from '${importPath}';`);
      expect(source.match(/\bisLiveMapEntityDisclosed\(/g)).toHaveLength(expectedCalls);
      expect(source).not.toMatch(
        /\b(?:isInstanceMapEntityDisclosed|INSTANCE_MAP_ENTITY_DISCLOSURE_RADIUS|LIVE_MAP_ENTITY_DISCLOSURE_RADIUS|LIVE_RIFT_ZONE_MAP_RANGE(?:_SQUARED)?)\b/,
      );
    },
  );

  it('has no legacy HUD-local disclosure policy module', () => {
    expect(
      existsSync(new URL('../src/ui/hud/instance_map_disclosure_core.ts', import.meta.url)),
    ).toBe(false);
  });
});
