// Cave brightness (MapLighting.caveLight): a map knob that lifts the carved
// cavity vertex tint floor so big caverns stay readable. SPACEY (a mine
// rebuild, 2026-09-18): the 70 yd halls vanished into black.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { buildCavityMesh } from '../src/render/cut_cavity_core';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

// a 6 yd sphere of air 20 yd under a flat surface, marched at 1 yd cells
function marchRoom(caveDark?: number): Float32Array {
  const arrays = buildCavityMesh({
    x0: 0,
    y0: -32,
    z0: 0,
    cell: 1,
    nx: 16,
    ny: 16,
    nz: 16,
    fieldAt: (x, y, z) => Math.hypot(x - 8, y + 20, z - 8) - 6,
    heightAt: () => 0,
    faceCoarse: [1, 1, 1, 1],
    caveDark,
  });
  if (!arrays) throw new Error('no cavity mesh');
  return arrays.colors;
}

function darkest(colors: Float32Array): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < colors.length; i += 3) min = Math.min(min, colors[i]);
  return min;
}

describe('cave brightness', () => {
  it('lifts the tint floor of a buried room toward plain rock', () => {
    const shipped = darkest(marchRoom());
    const lit = darkest(marchRoom(0.8));
    expect(shipped).toBeLessThan(0.55);
    expect(lit).toBeGreaterThan(shipped + 0.2);
    // never darker than the shipped floor, never brighter than plain rock
    expect(darkest(marchRoom(0.1))).toBeGreaterThanOrEqual(shipped - 1e-6);
    expect(darkest(marchRoom(1))).toBeLessThanOrEqual(1.2);
  });

  it('survives the document sanitizer only when it lifts something', () => {
    const map = newFlatCustomMap('Cave Light', 'map_cave_light', 1752710400000, {
      width: 60,
      height: 60,
    });
    map.lighting = {
      sunIntensity: 2,
      sunColor: 0xffffff,
      hemiIntensity: 1,
      skyColor: 0xa8d0f0,
      envScale: 1,
      sunAzimuthDeg: 120,
      sunElevationDeg: 50,
      caveLight: 1.7,
    };
    expect(sanitizeMapDoc(JSON.parse(JSON.stringify(map)))?.lighting?.caveLight).toBe(1);
    map.lighting.caveLight = 0;
    expect(sanitizeMapDoc(JSON.parse(JSON.stringify(map)))?.lighting?.caveLight).toBeUndefined();
  });

  it('is read by the tile mesher from the active world and re-marched when the slider moves', () => {
    const mesh = codeWithoutLineComments(
      readFileSync(new URL('../src/render/cut_cavity_mesh.ts', import.meta.url), 'utf8'),
    );
    expect(mesh).toContain('getActiveWorldContent().lighting?.caveLight');
    expect(mesh.split('caveDark: caveDarkFloor()').length - 1).toBe(2); // sync + worker jobs
    // the lighting rig re-marches the carve interiors when caveLight moves
    const rig = codeWithoutLineComments(
      readFileSync(new URL('../src/render/authored_map/lighting_rig.ts', import.meta.url), 'utf8'),
    );
    expect(rig).toContain('if (caveLightChanged(prev, profile)) onCaveLight();');
    const layers = codeWithoutLineComments(
      readFileSync(new URL('../src/render/authored_map/layers.ts', import.meta.url), 'utf8'),
    );
    expect(layers).toContain('refreshCutCavityMeshes(this.cavityGroup, this.seed, null)');
    const renderer = codeWithoutLineComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    expect(renderer).toContain('authoredLayers: () => r.authoredLayers,');
    const facade = codeWithoutLineComments(
      readFileSync(new URL('../src/render/editor_api/editor_api.ts', import.meta.url), 'utf8'),
    );
    expect(facade).toContain('h.authoredLayers()?.remarchCavities()');
  });
});
