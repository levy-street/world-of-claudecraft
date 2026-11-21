// Edge-on fade for the kit foliage's cutout cards
// (src/render/assets/foliage_edge_fade.ts): scoped to `Leaves_dg_*`
// materials, injected before the alpha test, and CHAINED by the placed-asset
// sway rather than replaced by it.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyFoliageEdgeFade,
  edgeFadeRange,
  FOLIAGE_DARK_KNEE,
  FOLIAGE_DARK_LIFT,
  FOLIAGE_SKY_WRAP,
  injectFoliageEdgeFade,
  isEdgeFadeFoliage,
} from '../src/render/assets/foliage_edge_fade';
import { attachPlacedTreeSway, detachPlacedTreeSway } from '../src/render/placed_assets';

const FRAG = 'void main() {\n#include <alphamap_fragment>\n#include <alphatest_fragment>\n}';
const VERT = '#include <common>\nvoid main() {\n#include <begin_vertex>\n}';

function scene(name: string) {
  const mat = new THREE.MeshStandardMaterial({ name, alphaTest: 0.5 });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));
  return { root, mat };
}

describe('foliage edge fade', () => {
  it('applies only to the kit foliage', () => {
    expect(isEdgeFadeFoliage('Leaves_dg_pine')).toBe(true);
    expect(isEdgeFadeFoliage('Leaves_dg_bloom')).toBe(true);
    expect(isEdgeFadeFoliage('Leaves')).toBe(false);
    expect(isEdgeFadeFoliage('Bark_dg_pine')).toBe(false);
    expect(applyFoliageEdgeFade(scene('Leaves_oak').root)).toBe(0);
  });

  it('fades alpha by the card GEOMETRIC facing, before the alpha test, once', () => {
    const sh = { fragmentShader: FRAG };
    injectFoliageEdgeFade(sh);
    injectFoliageEdgeFade(sh);
    expect(sh.fragmentShader.match(/wocFacing =/g)?.length).toBe(1);
    expect(sh.fragmentShader).toContain('dFdx(vViewPosition)');
    expect(sh.fragmentShader.indexOf('wocFacing')).toBeLessThan(
      sh.fragmentShader.indexOf('#include <alphatest_fragment>'),
    );
  });

  it('fades snow boughs earliest, clump sheets next, conifer boughs last', () => {
    const [snowLo] = edgeFadeRange('Leaves_dg_snow');
    const [clumpLo] = edgeFadeRange('Leaves_dg_under');
    const [pineLo] = edgeFadeRange('Leaves_dg_pine');
    expect(snowLo).toBeGreaterThan(clumpLo);
    expect(clumpLo).toBeGreaterThan(pineLo);
    const sh = { fragmentShader: FRAG };
    injectFoliageEdgeFade(sh, edgeFadeRange('Leaves_dg_snow'), true);
    expect(sh.fragmentShader).toContain('smoothstep(0.150, 0.400');
    // every card fades when near-vertical and seen from steeply below; snow
    // also swaps its white for underside green from below
    expect(sh.fragmentShader).toContain('wocBelow');
    expect(sh.fragmentShader).toContain('wocSnowM');
    // the snow tag is read BEFORE any fade scales alpha
    expect(sh.fragmentShader.indexOf('wocSnowM =')).toBeLessThan(
      sh.fragmentShader.indexOf('wocFacing ='),
    );
    const green = { fragmentShader: FRAG };
    injectFoliageEdgeFade(green, edgeFadeRange('Leaves_dg_pine'));
    expect(green.fragmentShader).toContain('wocBelow');
    expect(green.fragmentShader).not.toContain('wocSnowM');
    // hanging wisteria (the bloom sheet) is exempt from the from-below fade
    const bloom = { fragmentShader: FRAG };
    injectFoliageEdgeFade(bloom, edgeFadeRange('Leaves_dg_bloom'), false, false);
    expect(bloom.fragmentShader).not.toContain('wocBelow');
  });

  it('is chained by the placed-asset sway and restored by its detach', () => {
    const { root, mat } = scene('Leaves_dg_pine');
    expect(applyFoliageEdgeFade(root)).toBe(1);
    const base = mat.onBeforeCompile;
    attachPlacedTreeSway(root, 0, 10, 'tree');
    const sh = { fragmentShader: FRAG, vertexShader: VERT, uniforms: {} } as never;
    mat.onBeforeCompile(sh, {} as never);
    const out = sh as unknown as { fragmentShader: string; vertexShader: string };
    // both the sway (vertex) and the fade (fragment) are in the program
    expect(out.vertexShader).toContain('wocSwayWave');
    expect(out.fragmentShader).toContain('wocFacing');
    detachPlacedTreeSway(root);
    expect(mat.onBeforeCompile).toBe(base);
  });

  it('lifts the darkest leaves without flattening them (SPACEY: "reduce the range from light to dark")', () => {
    const LIT =
      'void main() {\n#include <map_fragment>\n#include <color_fragment>\n#include <lights_fragment_begin>\n#include <lights_fragment_maps>\n#include <lights_fragment_end>\n#include <alphatest_fragment>\n}';
    const sh = { fragmentShader: LIT };
    injectFoliageEdgeFade(sh);
    const f = sh.fragmentShader;
    // the texel toe goes in right after the map sample, before vertex colour
    expect(f.indexOf('wocToe')).toBeGreaterThan(f.indexOf('#include <map_fragment>'));
    expect(f.indexOf('wocToe')).toBeLessThan(f.indexOf('#include <color_fragment>'));
    // the sky wrap edits the indirect light while three's irradiance is open
    expect(f.indexOf('wocAway')).toBeGreaterThan(f.indexOf('#include <lights_fragment_maps>'));
    expect(f.indexOf('wocAway')).toBeLessThan(f.indexOf('#include <lights_fragment_end>'));
    // a leaf facing up keeps its light; the wrap only blends toward it
    expect(f).toContain('max( dot( geometryNormal, wocUp ), 0.0 )');
    expect(FOLIAGE_SKY_WRAP).toBeGreaterThan(0);
    expect(FOLIAGE_SKY_WRAP).toBeLessThan(1);
    // the toe is monotonic: d/dY of Y + L*(1 - Y/K)^2 stays positive
    expect(1 - (2 * FOLIAGE_DARK_LIFT) / FOLIAGE_DARK_KNEE).toBeGreaterThan(0);
  });

  it('shares customProgramCacheKey across distinct materials with identical parameters', () => {
    const a = scene('Leaves_dg_pine');
    const b = scene('Leaves_dg_pine');
    expect(a.mat.uuid).not.toBe(b.mat.uuid);
    applyFoliageEdgeFade(a.root);
    applyFoliageEdgeFade(b.root);
    expect(a.mat.customProgramCacheKey()).toBe(b.mat.customProgramCacheKey());
    attachPlacedTreeSway(a.root, 0, 10, 'tree');
    attachPlacedTreeSway(b.root, 0, 10, 'tree');
    expect(a.mat.customProgramCacheKey()).toBe(b.mat.customProgramCacheKey());
    detachPlacedTreeSway(a.root);
    detachPlacedTreeSway(b.root);
    expect(a.mat.customProgramCacheKey()).toBe(b.mat.customProgramCacheKey());
  });
});
