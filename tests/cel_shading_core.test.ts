import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  celInkSettings,
  celShadingSettings,
  installCelShading,
  syncCelMaterialInk,
} from '../src/render/cel_shading';
import {
  CEL_MATERIAL_INK_BEGIN,
  CEL_MATERIAL_INK_END,
  CEL_SHADING_DEFAULTS,
  CEL_SHADING_PATCH_MARKER,
  type CelShadingSettings,
  celBandExpression,
  celDirectionalScaleExpression,
  celInkArmActive,
  celLightRampActive,
  celMaterialInkGlsl,
  celNeedsGradePass,
  celShadingFromQuery,
  patchCelDirectionalLightChunk,
  patchCelMaterialInk,
  unpatchCelMaterialInk,
} from '../src/render/cel_shading_core';
import { patchOpaqueFragmentNanGuard } from '../src/render/final_color_nan_guard_core';
import { patchPointLightFragmentChunk } from '../src/render/point_light_shader_core';
import { CEL_INK_GLSL } from '../src/render/post_cel_ink_glsl';

const STOCK_CHUNK = THREE.ShaderChunk.lights_fragment_begin;
const DIR_SECTION = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const RECT_SECTION = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';
const DIR_SHADOW_MULTIPLY =
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]';

// three's WebGLProgram unrollLoops, verbatim regex: the body is pasted once per
// light WITHOUT its braces, so a declaration inside it would repeat.
function unrollLoops(source: string, count: number): string {
  return source
    .replace(/NUM_DIR_LIGHTS/g, String(count))
    .replace(
      /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g,
      (_m, start: string, end: string, snippet: string) => {
        let out = '';
        for (let i = Number(start); i < Number(end); i++) {
          out += snippet
            .replace(/\[\s*i\s*\]/g, `[ ${i} ]`)
            .replace(/UNROLLED_LOOP_INDEX/g, `${i}`);
        }
        return out;
      },
    );
}

// Evaluate the generated GLSL band expression in JS (smoothstep is the only call).
function bandFn(look: CelShadingSettings): (x: number) => number {
  const smoothstep = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const body = celBandExpression(look);
  return new Function('smoothstep', 'x', `return ${body};`).bind(null, smoothstep) as (
    x: number,
  ) => number;
}

// The old default look, before the ramp became an accent: the full banded cut
// with the crisp edge, the ink and the saturation lift.
const OLD_FULL_CEL: CelShadingSettings = {
  ...CEL_SHADING_DEFAULTS,
  mix: 1,
  softness: 0.025,
  ink: 0.85,
  saturation: 1.12,
};
// An inked look, for the ink paths (the default retires the ink).
const INKED: CelShadingSettings = { ...CEL_SHADING_DEFAULTS, ink: 0.85 };

// Evaluate the generated directional-light scale in JS, exactly as the patched
// chunk computes it: `WOC_CEL_BAND` is the band expression, and GLSL's `mix`
// and `max` are the only other calls. Returns what the light colour is
// multiplied by before RE_Direct multiplies its own NL back in.
function scaleFn(look: CelShadingSettings): (nl: number, shadow: number) => number {
  const band = bandFn(look);
  const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;
  const expr = celDirectionalScaleExpression(look);
  return new Function(
    'WOC_CEL_BAND',
    'mix',
    'max',
    'wocCelNL',
    'wocCelShadow',
    `return ${expr};`,
  ).bind(null, band, mix, Math.max) as (nl: number, shadow: number) => number;
}

// What the sun delivers to a lambert face: the scale times RE_Direct's own NL.
function irradianceFn(look: CelShadingSettings): (nl: number, shadow: number) => number {
  const scale = scaleFn(look);
  return (nl, shadow) => scale(nl, shadow) * nl;
}

describe('celShadingFromQuery', () => {
  it('is null (the stock look) unless cel is on', () => {
    expect(celShadingFromQuery('')).toBeNull();
    expect(celShadingFromQuery('?cel=off')).toBeNull();
    expect(celShadingFromQuery('?cel=true')).toBeNull();
    expect(celShadingFromQuery('?zonehaze=off&celbands=3')).toBeNull();
  });

  it('opts in on cel=on or cel=1 with the defaults, or by default when defaultOn is true', () => {
    expect(celShadingFromQuery('?cel=on')).toEqual(CEL_SHADING_DEFAULTS);
    expect(celShadingFromQuery('?gfx=ultra&cel=1')).toEqual(CEL_SHADING_DEFAULTS);
    expect(celShadingFromQuery('', true)).toEqual(CEL_SHADING_DEFAULTS);
    expect(celShadingFromQuery('?cel=off', true)).toBeNull();
    expect(celShadingFromQuery('?cel=0', true)).toBeNull();
  });

  it('ships the painted defaults: a soft 10 percent accent, no ink, neutral saturation', () => {
    expect(CEL_SHADING_DEFAULTS.mix).toBe(0.1);
    expect(CEL_SHADING_DEFAULTS.ink).toBe(0);
    expect(CEL_SHADING_DEFAULTS.saturation).toBe(1);
    // Wider than the old crisp cut (0.025), so even the accent's edge is soft.
    expect(CEL_SHADING_DEFAULTS.softness).toBeGreaterThanOrEqual(0.08);
    expect(celShadingFromQuery('', true)).toMatchObject({ mix: 0.1, ink: 0, saturation: 1 });
  });

  it('reads and clamps every tuning knob', () => {
    expect(
      celShadingFromQuery(
        '?cel=on&cellight=off&celmix=0.4&celbands=3&celedge=0.4&celsoft=0.05&cellit=0.8&celmid=0.4&celink=0.5&celinkwidth=2&celsat=1.3',
      ),
    ).toEqual({
      light: false,
      mix: 0.4,
      bands: 3,
      edge: 0.4,
      softness: 0.05,
      lit: 0.8,
      mid: 0.4,
      ink: 0.5,
      inkWidth: 2,
      saturation: 1.3,
    });
    const clamped = celShadingFromQuery(
      '?cel=on&celink=7&celinkwidth=0&celedge=-1&celsat=9&celmix=3&celsoft=9',
    );
    expect(clamped).toMatchObject({
      ink: 1,
      inkWidth: 0.5,
      edge: 0.05,
      saturation: 2,
      mix: 1,
      softness: 0.3,
    });
    expect(celShadingFromQuery('?cel=on&celmix=-1&celsoft=0')).toMatchObject({
      mix: 0,
      softness: 0.005,
    });
    const junk = celShadingFromQuery('?cel=on&celbands=4&cellit=abc&celedge=');
    expect(celShadingFromQuery('?cel=on&cellit=0.3&celmid=0.8')).toMatchObject({
      lit: 0.3,
      mid: 0.3,
    });
    expect(junk).toMatchObject({
      bands: 2,
      lit: CEL_SHADING_DEFAULTS.lit,
      edge: CEL_SHADING_DEFAULTS.edge,
    });
  });
});

describe('celBandExpression', () => {
  it('2-band: zero below the edge, the lit level above it, monotone between', () => {
    for (const look of [CEL_SHADING_DEFAULTS, OLD_FULL_CEL]) {
      const band = bandFn(look);
      expect(band(0)).toBe(0);
      expect(band(look.edge - look.softness - 0.005)).toBe(0);
      expect(band(look.edge + look.softness + 0.005)).toBeCloseTo(look.lit, 6);
      expect(band(1)).toBeCloseTo(look.lit, 6);
      let prev = 0;
      for (let x = 0; x <= 1; x += 0.005) {
        expect(band(x)).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = band(x);
      }
    }
  });

  it('the softness widens the terminator: the default edge is a soft gradient, not a cut', () => {
    const steepest = (look: CelShadingSettings): number => {
      const band = bandFn(look);
      let worst = 0;
      for (let x = 0; x < 1; x += 0.001)
        worst = Math.max(worst, (band(x + 0.001) - band(x)) / 0.001);
      return worst;
    };
    // Same edge and lit level; four times the width is a quarter of the slope.
    expect(steepest(CEL_SHADING_DEFAULTS)).toBeLessThan(steepest(OLD_FULL_CEL) / 3);
    // The band still ramps fully from shadow to lit across the soft edge.
    const band = bandFn(CEL_SHADING_DEFAULTS);
    expect(band(CEL_SHADING_DEFAULTS.edge)).toBeCloseTo(CEL_SHADING_DEFAULTS.lit / 2, 6);
  });

  it('never starts an edge at or below zero, however soft', () => {
    for (const look of [
      { ...CEL_SHADING_DEFAULTS, edge: 0.05, softness: 0.3 },
      { ...CEL_SHADING_DEFAULTS, bands: 3 as const, softness: 0.3 },
    ]) {
      const band = bandFn(look);
      expect(band(0)).toBe(0);
      expect(band(0.005)).toBe(0);
      expect(band(1)).toBeCloseTo(look.lit, 6);
    }
  });

  it('3-band: a flat mid tone between the two edges, crisp or soft', () => {
    const crisp = { ...CEL_SHADING_DEFAULTS, bands: 3 as const, softness: 0.025 };
    const band = bandFn(crisp);
    expect(band(0.02)).toBe(0);
    expect(band(0.25)).toBeCloseTo(crisp.mid, 6);
    expect(band(0.3)).toBeCloseTo(crisp.mid, 6);
    expect(band(0.9)).toBeCloseTo(crisp.lit, 6);
    const soft = { ...CEL_SHADING_DEFAULTS, bands: 3 as const };
    const softBand = bandFn(soft);
    expect(softBand(0.005)).toBe(0);
    expect(softBand(0.25)).toBeCloseTo(soft.mid, 6);
    expect(softBand(0.3)).toBeCloseTo(soft.mid, 6);
    expect(softBand(0.9)).toBeCloseTo(soft.lit, 6);
    let prev = 0;
    for (let x = 0; x <= 1; x += 0.005) {
      expect(softBand(x)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = softBand(x);
    }
  });

  it('keeps the band / NL pre-scale bounded, so no grazing face blows out', () => {
    for (const look of [
      CEL_SHADING_DEFAULTS,
      OLD_FULL_CEL,
      { ...CEL_SHADING_DEFAULTS, bands: 3 as const },
      { ...CEL_SHADING_DEFAULTS, edge: 0.05 },
      { ...OLD_FULL_CEL, edge: 0.05 },
    ]) {
      const band = bandFn(look);
      const scale = scaleFn(look);
      let worst = 0;
      let worstScale = 0;
      for (let x = 0; x <= 1; x += 0.0005) {
        worst = Math.max(worst, band(x) / Math.max(x, 1e-4));
        worstScale = Math.max(worstScale, scale(x, 1));
      }
      // band() is zero below (lowest edge - softness), so the scale peaks
      // just past that point and can never approach the 1e-4 floor.
      expect(worst).toBeLessThan(25);
      expect(Number.isFinite(worst)).toBe(true);
      expect(worstScale).toBeLessThanOrEqual(Math.max(1, worst) + 1e-9);
    }
  });
});

describe('celDirectionalScaleExpression (the ramp as a 10 percent accent)', () => {
  const grid: Array<[number, number]> = [];
  for (let nl = 0; nl <= 1.0001; nl += 0.025) {
    for (const shadow of [0, 0.18, 0.5, 1]) grid.push([nl, shadow]);
  }

  it('mix 0 is the stock shadow multiply, exactly', () => {
    const look = { ...CEL_SHADING_DEFAULTS, mix: 0 };
    expect(celDirectionalScaleExpression(look)).toBe('wocCelShadow');
    const scale = scaleFn(look);
    for (const [nl, shadow] of grid) expect(scale(nl, shadow)).toBe(shadow);
  });

  it('mix 1 is the full banded cut, exactly', () => {
    expect(celDirectionalScaleExpression(OLD_FULL_CEL)).toBe(
      'WOC_CEL_BAND( wocCelNL * wocCelShadow ) / max( wocCelNL, 1e-4 )',
    );
    const scale = scaleFn(OLD_FULL_CEL);
    const band = bandFn(OLD_FULL_CEL);
    for (const [nl, shadow] of grid) {
      expect(scale(nl, shadow)).toBe(band(nl * shadow) / Math.max(nl, 1e-4));
    }
  });

  it('the default sun is 90 percent the stock lambert and 10 percent the soft band', () => {
    expect(celDirectionalScaleExpression(CEL_SHADING_DEFAULTS)).toBe(
      'mix( wocCelShadow, WOC_CEL_BAND( wocCelNL * wocCelShadow ) / max( wocCelNL, 1e-4 ), 0.1 )',
    );
    const irradiance = irradianceFn(CEL_SHADING_DEFAULTS);
    const band = bandFn(CEL_SHADING_DEFAULTS);
    for (const [nl, shadow] of grid) {
      const stock = nl * shadow;
      expect(irradiance(nl, shadow)).toBeCloseTo(0.9 * stock + 0.1 * band(stock), 12);
      // An accent, never the show: never more than the mix away from stock.
      expect(Math.abs(irradiance(nl, shadow) - stock)).toBeLessThanOrEqual(0.1 + 1e-12);
    }
  });

  it('keeps the sun monotone in NL at every mix', () => {
    for (const mix of [0, 0.1, 0.5, 1]) {
      const irradiance = irradianceFn({ ...CEL_SHADING_DEFAULTS, mix });
      let prev = 0;
      for (let nl = 0; nl <= 1.0001; nl += 0.005) {
        expect(irradiance(nl, 1)).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = irradiance(nl, 1);
      }
    }
  });
});

describe('patchCelDirectionalLightChunk (pinned three lights_fragment_begin)', () => {
  const patched = patchCelDirectionalLightChunk(STOCK_CHUNK, CEL_SHADING_DEFAULTS);

  it('folds the directional shadow into the ramp and leaves every other section alone', () => {
    expect(patched).toContain(CEL_SHADING_PATCH_MARKER);
    expect(STOCK_CHUNK).toContain(DIR_SHADOW_MULTIPLY);
    expect(patched).not.toContain(DIR_SHADOW_MULTIPLY);
    expect(patched).toContain('wocCelShadow = ( directLight.visible && receiveShadow )');
    expect(patched).toContain(
      'directLight.color *= mix( wocCelShadow, WOC_CEL_BAND( wocCelNL * wocCelShadow ) / max( wocCelNL, 1e-4 ), 0.1 );',
    );
    // Mix 1 is the old full cel line, byte for byte.
    expect(patchCelDirectionalLightChunk(STOCK_CHUNK, OLD_FULL_CEL)).toContain(
      'directLight.color *= WOC_CEL_BAND( wocCelNL * wocCelShadow ) / max( wocCelNL, 1e-4 );',
    );
    const head = STOCK_CHUNK.indexOf(DIR_SECTION);
    expect(patched.slice(0, head)).toBe(STOCK_CHUNK.slice(0, head));
    expect(patched.slice(patched.indexOf(RECT_SECTION))).toBe(
      STOCK_CHUNK.slice(STOCK_CHUNK.indexOf(RECT_SECTION)),
    );
  });

  it('keeps the stock shadow multiply for toon materials (gradient map, not NL)', () => {
    const toonStart = patched.indexOf('#ifdef TOON');
    expect(toonStart).toBeGreaterThan(patched.indexOf(DIR_SECTION));
    const toonArm = patched.slice(toonStart, patched.indexOf('#else', toonStart));
    expect(toonArm).toContain('directLight.color *= wocCelShadow;');
    expect(toonArm).not.toContain('WOC_CEL_BAND');
  });

  it('declares its temporaries once, outside the unrolled loop body', () => {
    for (const lights of [1, 2]) {
      const unrolled = unrollLoops(patched, lights);
      expect(unrolled.match(/float wocCelShadow;/g)).toHaveLength(1);
      expect(unrolled.match(/float wocCelNL;/g)).toHaveLength(1);
      expect(unrolled.match(/wocCelShadow = 1\.0;/g)).toHaveLength(lights);
      expect(unrolled.match(/WOC_CEL_BAND\( wocCelNL \* wocCelShadow \)/g)).toHaveLength(lights);
    }
  });

  it('is idempotent and composes with the point-light pruning in either order', () => {
    expect(patchCelDirectionalLightChunk(patched, CEL_SHADING_DEFAULTS)).toBe(patched);
    const celThenPoint = patchPointLightFragmentChunk(patched);
    const pointThenCel = patchCelDirectionalLightChunk(
      patchPointLightFragmentChunk(STOCK_CHUNK),
      CEL_SHADING_DEFAULTS,
    );
    expect(celThenPoint).toBe(pointThenCel);
    expect(celThenPoint).toContain(CEL_SHADING_PATCH_MARKER);
    expect(celThenPoint).not.toBe(patched);
  });

  it('throws when a pinned three anchor moves', () => {
    expect(() =>
      patchCelDirectionalLightChunk(
        STOCK_CHUNK.replace('getDirectionalLightInfo( directionalLight, directLight );', ''),
        CEL_SHADING_DEFAULTS,
      ),
    ).toThrow(/directional-light info anchor/);
    expect(() =>
      patchCelDirectionalLightChunk(STOCK_CHUNK.replace(DIR_SECTION, ''), CEL_SHADING_DEFAULTS),
    ).toThrow(/section anchor/);
  });
});

describe('installCelShading', () => {
  it('is off in a host without a location (tests, server, RL env)', () => {
    expect(celShadingSettings()).toBeNull();
    expect(THREE.ShaderChunk.lights_fragment_begin).not.toContain(CEL_SHADING_PATCH_MARKER);
  });

  it('patches only for a look that keeps the light ramp', () => {
    const chunks = { lights_fragment_begin: STOCK_CHUNK };
    expect(installCelShading(null, chunks)).toBe(false);
    expect(installCelShading({ ...CEL_SHADING_DEFAULTS, light: false }, chunks)).toBe(false);
    // A zero mix IS the stock lighting: the chunk stays byte for byte.
    expect(installCelShading({ ...CEL_SHADING_DEFAULTS, mix: 0 }, chunks)).toBe(false);
    expect(chunks.lights_fragment_begin).toBe(STOCK_CHUNK);
    expect(celLightRampActive(null)).toBe(false);
    expect(celLightRampActive({ ...CEL_SHADING_DEFAULTS, mix: 0 })).toBe(false);
    expect(celLightRampActive({ ...CEL_SHADING_DEFAULTS, light: false })).toBe(false);
    expect(celLightRampActive(CEL_SHADING_DEFAULTS)).toBe(true);
    expect(installCelShading(CEL_SHADING_DEFAULTS, chunks)).toBe(true);
    expect(chunks.lights_fragment_begin).toContain(CEL_SHADING_PATCH_MARKER);
    expect(installCelShading(CEL_SHADING_DEFAULTS, chunks)).toBe(false);
  });
});

const STOCK_OPAQUE = THREE.ShaderChunk.opaque_fragment;
const OPAQUE_WRITE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';

describe('cel material ink (the outline for chains with no output grade)', () => {
  const patched = patchCelMaterialInk(STOCK_OPAQUE, INKED);

  it('sits right before the opaque write, gated to the lit material kinds', () => {
    expect(STOCK_OPAQUE).not.toContain(CEL_MATERIAL_INK_BEGIN);
    const begin = patched.indexOf(CEL_MATERIAL_INK_BEGIN);
    const end = patched.indexOf(CEL_MATERIAL_INK_END);
    const write = patched.indexOf(OPAQUE_WRITE);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    expect(write).toBeGreaterThan(end);
    const block = patched.slice(begin, end);
    expect(block).toContain(
      '#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON )',
    );
    // The geometric normal, never the normal-mapped one, drives both gates.
    expect(block).toContain('normalize( nonPerturbedNormal )');
    // Curvature per yard of surface (normal change over position change), so
    // the gate means the same near and far and flat ground never qualifies.
    expect(block).toContain(
      'length( fwidth( wocInkN ) ) / max( length( fwidth( vViewPosition ) ), 1e-4 )',
    );
    expect(block).toContain('length( vViewPosition )');
    expect(patchCelMaterialInk(patched, INKED)).toBe(patched);
  });

  it('bakes the look ink strength and saturation into the block', () => {
    const glsl = celMaterialInkGlsl({ ...CEL_SHADING_DEFAULTS, ink: 0.5, saturation: 1.3 });
    expect(glsl).toContain('* wocInkCurve * wocInkNear * 0.5;');
    expect(glsl).toContain('outgoingLight, 1.3 )');
    expect(glsl).toContain('outgoingLight *= 1.0 - wocInk * 0.82;');
  });

  it('emits only the half that does something', () => {
    const satOnly = celMaterialInkGlsl({ ...CEL_SHADING_DEFAULTS, ink: 0, saturation: 1.3 });
    expect(satOnly).toContain('outgoingLight, 1.3 )');
    expect(satOnly).not.toContain('fwidth');
    expect(satOnly).not.toContain('wocInkCurve');
    const inkOnly = celMaterialInkGlsl({ ...CEL_SHADING_DEFAULTS, ink: 0.5, saturation: 1 });
    expect(inkOnly).toContain('* wocInkCurve * wocInkNear * 0.5;');
    expect(inkOnly).not.toContain('wocInkLuma');
  });

  it('comes back out cleanly, before or after the NaN guard', () => {
    expect(unpatchCelMaterialInk(patched)).toBe(STOCK_OPAQUE);
    expect(unpatchCelMaterialInk(STOCK_OPAQUE)).toBe(STOCK_OPAQUE);
    const guarded = patchOpaqueFragmentNanGuard(STOCK_OPAQUE);
    expect(unpatchCelMaterialInk(patchCelMaterialInk(guarded, INKED))).toBe(guarded);
    expect(unpatchCelMaterialInk(patchOpaqueFragmentNanGuard(patched))).toBe(guarded);
  });

  it('throws when three moved the opaque write anchor', () => {
    expect(() => patchCelMaterialInk(STOCK_OPAQUE.replace(OPAQUE_WRITE, ''), INKED)).toThrow(
      /opaque_fragment write anchor/,
    );
  });
});

describe('syncCelMaterialInk', () => {
  it('follows the active profile: in with no output grade, out with one, never doubled', () => {
    const chunks = { opaque_fragment: STOCK_OPAQUE };
    expect(syncCelMaterialInk(true, null, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
    expect(syncCelMaterialInk(false, INKED, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
    expect(syncCelMaterialInk(true, INKED, chunks)).toBe(true);
    expect(syncCelMaterialInk(true, INKED, chunks)).toBe(true);
    expect(chunks.opaque_fragment.split(CEL_MATERIAL_INK_BEGIN)).toHaveLength(2);
    expect(syncCelMaterialInk(false, INKED, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
  });

  it('never installs for the default look (ink 0, saturation 1), and takes a stale block out', () => {
    const chunks = { opaque_fragment: STOCK_OPAQUE };
    expect(syncCelMaterialInk(true, CEL_SHADING_DEFAULTS, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
    expect(syncCelMaterialInk(true, INKED, chunks)).toBe(true);
    expect(syncCelMaterialInk(true, CEL_SHADING_DEFAULTS, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
    // The saturation alone still has work, so a celsat A/B keeps the arm.
    expect(syncCelMaterialInk(true, { ...CEL_SHADING_DEFAULTS, saturation: 1.2 }, chunks)).toBe(
      true,
    );
  });

  it('is a no-op in a host without a location (headless hosts have no look)', () => {
    expect(syncCelMaterialInk(true)).toBe(false);
    expect(THREE.ShaderChunk.opaque_fragment).not.toContain(CEL_MATERIAL_INK_BEGIN);
  });
});

describe('the retired ink costs nothing', () => {
  it('has no display arm for the default look, one for any ink or saturation', () => {
    expect(celInkArmActive(null)).toBe(false);
    expect(celInkArmActive(CEL_SHADING_DEFAULTS)).toBe(false);
    expect(celInkArmActive({ ...CEL_SHADING_DEFAULTS, ink: 0.1 })).toBe(true);
    expect(celInkArmActive({ ...CEL_SHADING_DEFAULTS, saturation: 1.12 })).toBe(true);
    // Headless hosts have no look at all.
    expect(celInkSettings()).toBeNull();
  });

  it('the grade ink returns before its first depth tap when the ink is 0', () => {
    const body = CEL_INK_GLSL.slice(CEL_INK_GLSL.indexOf('float celInkAmount('));
    const gate = body.indexOf('if (uCelInk.x <= 0.0) return 0.0;');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf('celInvDist('));
  });
});

describe('celNeedsGradePass', () => {
  it('turns the grade on for a no-grade profile under an inked look, except on iOS', () => {
    expect(celNeedsGradePass(INKED, false, 'other')).toBe(true);
    expect(celNeedsGradePass(INKED, false, 'android')).toBe(true);
    expect(celNeedsGradePass(INKED, false, undefined)).toBe(true);
    expect(celNeedsGradePass(INKED, false, 'ios')).toBe(false);
    expect(celNeedsGradePass(INKED, true, 'other')).toBe(false);
    expect(celNeedsGradePass(null, false, 'other')).toBe(false);
  });

  it('never forces a grade while the ink is retired (the default), on any platform', () => {
    for (const platform of ['other', 'android', 'ios', undefined] as const) {
      expect(celNeedsGradePass(CEL_SHADING_DEFAULTS, false, platform)).toBe(false);
      // A saturation-only A/B rides the material arm instead of a grade pass.
      expect(celNeedsGradePass({ ...CEL_SHADING_DEFAULTS, saturation: 1.2 }, false, platform)).toBe(
        false,
      );
    }
  });
});
