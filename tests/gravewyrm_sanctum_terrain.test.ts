// The Gravewyrm Sanctum's ground (src/render/authored_field/field_mesh_core.ts
// and src/render/gravewyrm_sanctum/sanctum_terrain.ts): snow, ice and slate
// draw with their own texture families while every older ground keeps the
// family it always had, the Sanctum's tops land in those families, and the
// glacier crevasse paint turns the drop into ice that only darkens and blues
// with depth (never grey, never a sea).

import { describe, expect, it } from 'vitest';
import {
  FIELD_GROUND_COLORS,
  FIELD_TOP_FAMILIES,
  fieldGroundFamily,
  GLACIER_CREVASSE_VOID,
  glacierCliffColor,
  glacierDepthShare,
  glacierIceRamp,
  planFieldCliffs,
  planFieldTops,
  topColor,
} from '../src/render/authored_field/field_mesh_core';
import { GRAVEWYRM_SANCTUM_FIELD } from '../src/sim/content/gravewyrm_sanctum_layout';
import type { FieldCliffRun, FieldGround } from '../src/sim/instances/authored_field';

describe('the Sanctum ground families', () => {
  it('draws snow, ice and slate with their own families', () => {
    expect(fieldGroundFamily('snow')).toBe('snow');
    expect(fieldGroundFamily('ice')).toBe('ice');
    expect(fieldGroundFamily('slate')).toBe('slate');
    for (const f of ['snow', 'ice', 'slate'] as const) expect(FIELD_TOP_FAMILIES).toContain(f);
  });

  it('keeps every older ground in the family it had before the Sanctum', () => {
    const before: Record<string, string> = {
      flagstone: 'stone',
      earth: 'soil',
      grave: 'soil',
      frost: 'soil',
      bone: 'stone',
      ritual: 'stone',
      mud: 'soil',
      wetstone: 'stone',
      quay: 'stone',
      shallows: 'soil',
      moss: 'moss',
      basalt: 'basalt',
      plate: 'plate',
      grating: 'grating',
      soot: 'stone',
    };
    for (const [ground, family] of Object.entries(before)) {
      expect(fieldGroundFamily(ground as FieldGround), ground).toBe(family);
    }
    // Every ground the colour table knows is covered by one of the two lists.
    const all = Object.keys(FIELD_GROUND_COLORS);
    expect(all.sort()).toEqual([...Object.keys(before), 'snow', 'ice', 'slate'].sort());
  });

  it('lays the Sanctum tops in the snow, ice, slate and soil families only', () => {
    const tops = planFieldTops(GRAVEWYRM_SANCTUM_FIELD, { maxEdge: 6, layerLift: 0 });
    for (const f of ['snow', 'ice', 'slate', 'soil'] as const) {
      expect(tops[f].positions.length, f).toBeGreaterThan(0);
    }
    for (const f of ['stone', 'moss', 'basalt', 'plate', 'grating'] as const) {
      expect(tops[f].positions.length, f).toBe(0);
    }
  });

  it('paints snow brighter than ice and ice brighter than slate, all cool', () => {
    const lum = (g: FieldGround) => {
      let sum = 0;
      let red = 0;
      let blue = 0;
      for (let i = 0; i < 40; i++) {
        const c = topColor(g, i * 3.7, i * 5.3, false);
        sum += (c[0] + c[1] + c[2]) / 3;
        red += c[0];
        blue += c[2];
      }
      // Cool on the whole (a rusty seam on the slate may run warm).
      expect(blue, `${g} is cool`).toBeGreaterThan(red);
      return sum / 40;
    };
    const snow = lum('snow');
    const ice = lum('ice');
    const slate = lum('slate');
    expect(snow).toBeGreaterThan(ice);
    expect(ice).toBeGreaterThan(slate);
  });
});

describe('the glacier crevasse paint', () => {
  const run = { style: 'rock' } as FieldCliffRun;

  it('darkens monotonically with depth down to the crevasse void', () => {
    let prev = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const [r, g, b] = glacierIceRamp(t);
      const lum = r + g + b;
      expect(lum).toBeLessThanOrEqual(prev + 1e-9);
      prev = lum;
      // Blue throughout: blue over green over red (ice, never grey or sea-green).
      expect(b).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(r);
    }
    expect(glacierDepthShare(0, 30)).toBe(0);
    expect(glacierDepthShare(30 - GLACIER_CREVASSE_VOID, 30)).toBe(1);
  });

  it('keeps a dark rock lip at the top and clear blue ice below it', () => {
    const top = 30;
    const lip = glacierCliffColor(run, 10, top - 0.3, 10, top);
    const ice = glacierCliffColor(run, 10, top - 14, 10, top);
    const deep = glacierCliffColor(run, 10, GLACIER_CREVASSE_VOID - 10, 10, top);
    // The ice reads clearly blue and brighter in blue than the depth.
    expect(ice[2]).toBeGreaterThan(ice[0] * 1.8);
    expect(deep[2]).toBeLessThan(ice[2]);
    // The lip is either rock or rimed rock: never the ice's saturated blue.
    expect(lip[2] - lip[0]).toBeLessThan(ice[2] - ice[0]);
  });

  it('paints every Sanctum cliff vertex cool and blue-leaning', () => {
    const cliffs = planFieldCliffs(GRAVEWYRM_SANCTUM_FIELD, {
      voidFloor: GRAVEWYRM_SANCTUM_FIELD.voidHeight - 25,
      columnStep: 4,
      rowStep: 6,
      flare: 0.22,
      paint: glacierCliffColor,
    });
    expect(cliffs.colors.length).toBeGreaterThan(0);
    for (let i = 0; i < cliffs.colors.length; i += 3) {
      const r = cliffs.colors[i];
      const b = cliffs.colors[i + 2];
      expect(b + 1e-6).toBeGreaterThanOrEqual(r);
    }
  });
});
