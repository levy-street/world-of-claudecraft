// The Islands of the Wind's fill (src/render/smith_heart/heart_isle_fill.ts,
// heart_kit.ts's `isle` material): the isles' hang, seen from the Cornice,
// faces down away from the sun; the fill keeps it a lit cool blue-violet and
// never lets it sink to black (the painted world's L1 and L6). It is one
// program of its own, warmed with every kit material, and the isles and
// their drifting stones draw with it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyHeartIsleFill,
  HEART_ISLE_FILL,
  heartIsleFillAt,
} from '../src/render/smith_heart/heart_isle_fill';
import { HEART_KIT_MATERIALS, heartKitSlotMaterial } from '../src/render/smith_heart/heart_kit';

describe('the isles fill', () => {
  it('lifts every face a little and a face turned down most, cooler', () => {
    const up = heartIsleFillAt(1);
    const side = heartIsleFillAt(0);
    const down = heartIsleFillAt(-1);
    expect(up).toEqual([...HEART_ISLE_FILL.floor]);
    expect(side).toEqual(up);
    for (let k = 0; k < 3; k++) {
      expect(up[k]).toBeGreaterThan(0.1);
      expect(down[k]).toBeGreaterThan(up[k] + 0.15);
    }
    // Cool: blue over red, below as on top.
    expect(down[2]).toBeGreaterThan(down[0]);
    expect(up[2]).toBeGreaterThan(up[0]);
    // A fill, never a glow: the stone's own colour stays under its lit faces.
    expect(Math.max(...down)).toBeLessThan(0.6);
  });

  it('patches the stone program and keys it apart', () => {
    expect(HEART_KIT_MATERIALS).toContain('isle');
    const isle = heartKitSlotMaterial('isle');
    const stone = heartKitSlotMaterial('stone');
    expect(isle).not.toBe(stone);
    expect(isle.name).toBe('SmithHeartKitIsle');
    expect(isle.customProgramCacheKey()).toContain('smith-heart-isle');
    expect(stone.customProgramCacheKey()).not.toContain('smith-heart-isle');
    const shader = {
      vertexShader: '',
      fragmentShader: 'void main() {\n#include <emissivemap_fragment>\n}',
      uniforms: {},
    };
    // Its own hook alone (the shared detail layer's is pinned elsewhere).
    const probe = applyHeartIsleFill({
      onBeforeCompile: () => {},
      customProgramCacheKey: () => 'probe',
    } as unknown as Parameters<typeof applyHeartIsleFill>[0]);
    probe.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += diffuseColor.rgb');
    expect(shader.fragmentShader).toContain('inverseTransformDirection( normal, viewMatrix ).y');
    expect(probe.customProgramCacheKey()).toMatch(/^smith-heart-isle\|.*\|probe$/);
  });

  it('draws the isles and their drifting stones with it', () => {
    const src = readFileSync('src/render/smith_heart_fx/breath_isles_fx.ts', 'utf8');
    expect(src).toMatch(/heartKitMeshes\(SMITH_HEART_BREATH_KIT_URL, kit\.piece, 'isle'\)/);
    expect(src).toMatch(/heartKitSlotMaterial\(slot === 'stone' \? 'isle' : slot\)/);
  });
});
