import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
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
  celMaterialInkGlsl,
  celNeedsGradePass,
  celShadingFromQuery,
  patchCelDirectionalLightChunk,
  patchCelMaterialInk,
  unpatchCelMaterialInk,
} from '../src/render/cel_shading_core';
import { patchOpaqueFragmentNanGuard } from '../src/render/final_color_nan_guard_core';
import { patchPointLightFragmentChunk } from '../src/render/point_light_shader_core';

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

  it('reads and clamps every tuning knob', () => {
    expect(
      celShadingFromQuery(
        '?cel=on&cellight=off&celbands=3&celedge=0.4&cellit=0.8&celmid=0.4&celink=0.5&celinkwidth=2&celsat=1.3',
      ),
    ).toEqual({
      light: false,
      bands: 3,
      edge: 0.4,
      lit: 0.8,
      mid: 0.4,
      ink: 0.5,
      inkWidth: 2,
      saturation: 1.3,
    });
    const clamped = celShadingFromQuery('?cel=on&celink=7&celinkwidth=0&celedge=-1&celsat=9');
    expect(clamped).toMatchObject({ ink: 1, inkWidth: 0.5, edge: 0.05, saturation: 2 });
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
    const band = bandFn(CEL_SHADING_DEFAULTS);
    expect(band(0)).toBe(0);
    expect(band(CEL_SHADING_DEFAULTS.edge - 0.03)).toBe(0);
    expect(band(CEL_SHADING_DEFAULTS.edge + 0.03)).toBeCloseTo(CEL_SHADING_DEFAULTS.lit, 6);
    expect(band(1)).toBeCloseTo(CEL_SHADING_DEFAULTS.lit, 6);
    let prev = 0;
    for (let x = 0; x <= 1; x += 0.005) {
      expect(band(x)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = band(x);
    }
  });

  it('3-band: a flat mid tone between the two edges', () => {
    const look = { ...CEL_SHADING_DEFAULTS, bands: 3 as const };
    const band = bandFn(look);
    expect(band(0.02)).toBe(0);
    expect(band(0.25)).toBeCloseTo(look.mid, 6);
    expect(band(0.3)).toBeCloseTo(look.mid, 6);
    expect(band(0.9)).toBeCloseTo(look.lit, 6);
  });

  it('keeps the band / NL pre-scale bounded, so no grazing face blows out', () => {
    for (const look of [
      CEL_SHADING_DEFAULTS,
      { ...CEL_SHADING_DEFAULTS, bands: 3 as const },
      { ...CEL_SHADING_DEFAULTS, edge: 0.05 },
    ]) {
      const band = bandFn(look);
      let worst = 0;
      for (let x = 0; x <= 1; x += 0.0005) worst = Math.max(worst, band(x) / Math.max(x, 1e-4));
      // band() is zero below (lowest edge - softness), so the scale peaks
      // just past that point and can never approach the 1e-4 floor.
      expect(worst).toBeLessThan(25);
      expect(Number.isFinite(worst)).toBe(true);
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
    expect(chunks.lights_fragment_begin).toBe(STOCK_CHUNK);
    expect(installCelShading(CEL_SHADING_DEFAULTS, chunks)).toBe(true);
    expect(chunks.lights_fragment_begin).toContain(CEL_SHADING_PATCH_MARKER);
    expect(installCelShading(CEL_SHADING_DEFAULTS, chunks)).toBe(false);
  });
});

const STOCK_OPAQUE = THREE.ShaderChunk.opaque_fragment;
const OPAQUE_WRITE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';

describe('cel material ink (the outline for chains with no output grade)', () => {
  const patched = patchCelMaterialInk(STOCK_OPAQUE, CEL_SHADING_DEFAULTS);

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
    expect(patchCelMaterialInk(patched, CEL_SHADING_DEFAULTS)).toBe(patched);
  });

  it('bakes the look ink strength and saturation into the block', () => {
    const glsl = celMaterialInkGlsl({ ...CEL_SHADING_DEFAULTS, ink: 0.5, saturation: 1.3 });
    expect(glsl).toContain('* wocInkCurve * wocInkNear * 0.5;');
    expect(glsl).toContain('outgoingLight, 1.3 )');
    expect(glsl).toContain('outgoingLight *= 1.0 - wocInk * 0.82;');
  });

  it('comes back out cleanly, before or after the NaN guard', () => {
    expect(unpatchCelMaterialInk(patched)).toBe(STOCK_OPAQUE);
    expect(unpatchCelMaterialInk(STOCK_OPAQUE)).toBe(STOCK_OPAQUE);
    const guarded = patchOpaqueFragmentNanGuard(STOCK_OPAQUE);
    expect(unpatchCelMaterialInk(patchCelMaterialInk(guarded, CEL_SHADING_DEFAULTS))).toBe(guarded);
    expect(unpatchCelMaterialInk(patchOpaqueFragmentNanGuard(patched))).toBe(guarded);
  });

  it('throws when three moved the opaque write anchor', () => {
    expect(() =>
      patchCelMaterialInk(STOCK_OPAQUE.replace(OPAQUE_WRITE, ''), CEL_SHADING_DEFAULTS),
    ).toThrow(/opaque_fragment write anchor/);
  });
});

describe('syncCelMaterialInk', () => {
  it('follows the active profile: in with no output grade, out with one, never doubled', () => {
    const chunks = { opaque_fragment: STOCK_OPAQUE };
    expect(syncCelMaterialInk(true, null, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
    expect(syncCelMaterialInk(false, CEL_SHADING_DEFAULTS, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
    expect(syncCelMaterialInk(true, CEL_SHADING_DEFAULTS, chunks)).toBe(true);
    expect(syncCelMaterialInk(true, CEL_SHADING_DEFAULTS, chunks)).toBe(true);
    expect(chunks.opaque_fragment.split(CEL_MATERIAL_INK_BEGIN)).toHaveLength(2);
    expect(syncCelMaterialInk(false, CEL_SHADING_DEFAULTS, chunks)).toBe(false);
    expect(chunks.opaque_fragment).toBe(STOCK_OPAQUE);
  });

  it('is a no-op without ?cel=on (headless hosts have no look)', () => {
    expect(syncCelMaterialInk(true)).toBe(false);
    expect(THREE.ShaderChunk.opaque_fragment).not.toContain(CEL_MATERIAL_INK_BEGIN);
  });
});

describe('celNeedsGradePass', () => {
  it('turns the grade on for a no-grade profile under the cel look, except on iOS', () => {
    expect(celNeedsGradePass(CEL_SHADING_DEFAULTS, false, 'other')).toBe(true);
    expect(celNeedsGradePass(CEL_SHADING_DEFAULTS, false, 'android')).toBe(true);
    expect(celNeedsGradePass(CEL_SHADING_DEFAULTS, false, undefined)).toBe(true);
    expect(celNeedsGradePass(CEL_SHADING_DEFAULTS, false, 'ios')).toBe(false);
    expect(celNeedsGradePass(CEL_SHADING_DEFAULTS, true, 'other')).toBe(false);
    expect(celNeedsGradePass(null, false, 'other')).toBe(false);
  });
});
