// The Islands of the Wind's look (src/render/smith_heart_fx/breath_isles_fx_core.ts):
// the rock drawn IS the floor you stand on (every top vertex on the isle's own
// field surface, nothing over its edge), the underside hangs below it, the
// routes run on the ride's own arc from each circle to where it carries, the
// Bulwark thins and cracks as its absorb runs down, the objects are told
// apart, and the new bars have their display names.

import { describe, expect, it } from 'vitest';
import {
  bulwarkLook,
  circleRoute,
  isleCrystals,
  isleDepth,
  isleObjectKind,
  isleRock,
  isleRoots,
} from '../src/render/smith_heart_fx/breath_isles_fx_core';
import { BREATH, BREATH_ISLES, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import {
  galePathTemplate,
  homeGaleTemplate,
  ISLE_CASTS,
  isleSpots,
  rideArc,
  rideTemplate,
} from '../src/sim/encounters/smith_heart';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';
import { castDisplayName } from '../src/ui/cast_display_name';

describe('breath_isles_fx_core', () => {
  it("draws each isle's top on its own floor, the hang below it, triangles whole", () => {
    BREATH_ISLES.forEach((isle, i) => {
      const r = isleRock(i);
      expect(r.positions.length % 3).toBe(0);
      expect(r.colors.length).toBe(r.positions.length);
      expect(r.indices.length % 3).toBe(0);
      const n = r.positions.length / 3;
      for (const k of r.indices) expect(k).toBeLessThan(n);
      let lowest = Number.POSITIVE_INFINITY;
      for (let v = 0; v < n; v++) {
        const x = r.positions[v * 3];
        const y = r.positions[v * 3 + 1];
        const z = r.positions[v * 3 + 2];
        lowest = Math.min(lowest, y);
        // Nothing stands over the floor; the floor's ring lies on it.
        expect(y).toBeLessThanOrEqual(isle.h + 0.05);
        if (y > isle.h - 0.1)
          expect(authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)?.id, `${x},${z}`).toBe(isle.id);
      }
      expect(lowest).toBeLessThan(isle.h - isleDepth(i));
      expect(isleCrystals(i).length).toBeGreaterThan(10);
      for (const root of isleRoots(i)) expect(root[root.length - 1].y).toBeLessThan(isle.h - 4);
    });
  });

  it('runs each route on the ride arc from its circle to where it carries', () => {
    BREATH_ISLES.forEach((isle, i) => {
      const s = isleSpots()[i];
      const out = circleRoute(i, 'path', 20, { cornice: BREATH.cornice.h });
      expect(out[0].x).toBeCloseTo(s.path.x, 6);
      expect(out[20].x).toBeCloseTo(s.land.x, 6);
      expect(out[20].y).toBeCloseTo(isle.h, 6);
      const mid = rideArc(
        { x: s.path.x, y: BREATH.cornice.h, z: s.path.z },
        { x: s.land.x, y: isle.h, z: s.land.z },
        0.5,
      );
      expect(out[10].y).toBeCloseTo(mid.y, 6);
      const home = circleRoute(i, 'home', 20, { cornice: BREATH.cornice.h });
      expect(home[20].z).toBeCloseTo(s.back.z, 6);
    });
  });

  it('the Bulwark thins and cracks as its absorb runs down', () => {
    const full = bulwarkLook(100, 100, 0);
    const half = bulwarkLook(50, 100, 0);
    const low = bulwarkLook(5, 100, 0);
    expect(full.crack).toBe(0);
    expect(half.solid).toBeLessThan(full.solid);
    expect(low.crack).toBeGreaterThan(half.crack);
    expect(low.solid).toBeGreaterThan(0.3);
  });

  it('tells its objects apart, and names its bars', () => {
    expect(isleObjectKind(galePathTemplate(1))).toBe('path');
    expect(isleObjectKind(homeGaleTemplate(0))).toBe('home');
    expect(isleObjectKind(rideTemplate('out', 1, 3.2))).toBe('ride');
    expect(isleObjectKind('sh_breath_vortex')).toBeNull();
    for (const id of Object.values(ISLE_CASTS)) expect(castDisplayName(id), id).not.toBe(id);
    expect(castDisplayName('heart_breath_cradle_channel')).toBe("Thunder's Cradle");
  });
});
