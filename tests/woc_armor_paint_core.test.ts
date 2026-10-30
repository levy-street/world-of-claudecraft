import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  patchWocArmorPaintFragment,
  WOC_ARMOR_METALNESS,
  WOC_ARMOR_PAINT_BEGIN,
  WOC_ARMOR_PAINT_DEFAULTS,
  WOC_ARMOR_PAINT_END,
  WOC_ARMOR_PAINT_OFF,
  type WocArmorPaintSettings,
  wocArmorPaintActive,
  wocArmorPaintBlockOf,
  wocArmorPaintFromQuery,
  wocArmorPaintGlsl,
  wocArmorPaintProgramKey,
  wocArmorPaintQueryKey,
  wocArmorSurfaceFactors,
} from '../src/render/characters/woc_armor_paint_core';

// The painted WOC armour's pure core (woc_armor_paint_core.ts): the metal response caps,
// the one GLSL block every armour material compiles on every tier, its knobs, and the
// session's query surface. The three.js consumer and the factory wiring are
// tests/woc_armor_paint.test.ts.

const KNOBS = Object.keys(WOC_ARMOR_PAINT_DEFAULTS) as (keyof WocArmorPaintSettings)[];

/** The three fragment programs an armour material compiles from: MeshStandardMaterial and
 *  MeshPhysicalMaterial (KHR_materials_specular armour files) share the physical source,
 *  the Low and iOS rebuild is Lambert. */
const SOURCES = {
  standard: THREE.ShaderLib.standard.fragmentShader,
  physical: THREE.ShaderLib.physical.fragmentShader,
  lambert: THREE.ShaderLib.lambert.fragmentShader,
} as const;

const ANCHOR = '#include <emissivemap_fragment>';

/** One knob on its own, every other one at zero. */
function only(knob: keyof WocArmorPaintSettings, value: number): WocArmorPaintSettings {
  return { ...WOC_ARMOR_PAINT_OFF, [knob]: value };
}

describe('the armour metal response', () => {
  it('draws armour metal at 40 percent, as a cap', () => {
    expect(WOC_ARMOR_METALNESS).toBe(0.4);
    // the shipped files: metallicFactor 1 over the ORM metal channel
    expect(wocArmorSurfaceFactors({ metalness: 1 })).toEqual({ metalness: 0.4 });
    // a low file (metallicFactor 0) and a material authored under the cap keep their own
    expect(wocArmorSurfaceFactors({ metalness: 0 })).toEqual({ metalness: 0 });
    expect(wocArmorSurfaceFactors({ metalness: 0.25 }).metalness).toBe(0.25);
    // a second application changes nothing (the derivation may meet a capped clone)
    const once = wocArmorSurfaceFactors({ metalness: 1 });
    expect(wocArmorSurfaceFactors(once)).toEqual(once);
  });

  it('writes no sky-reflection scalar: three never reads it under scene.environment', () => {
    // material.envMapIntensity is replaced by scene.environmentIntensity for every material
    // lit by scene.environment, so a cap there drew nothing; the armour's sky cap is the env
    // sheen's metal share (tests/env_sheen_core.test.ts)
    expect(Object.keys(wocArmorSurfaceFactors({ metalness: 1 }))).toEqual(['metalness']);
  });
});

describe('the paint-over block', () => {
  it('inserts NOTHING with every knob at zero: the program is the stock one, byte for byte', () => {
    expect(wocArmorPaintActive(WOC_ARMOR_PAINT_OFF)).toBe(false);
    for (const [kind, source] of Object.entries(SOURCES)) {
      expect(patchWocArmorPaintFragment(source, WOC_ARMOR_PAINT_OFF), kind).toBe(source);
    }
    // and the zero set really is all zero (a knob added later must be added to it)
    for (const knob of KNOBS) expect(WOC_ARMOR_PAINT_OFF[knob], knob).toBe(0);
    // the non-metal edge share scales the edge: on its own it paints nothing, so it adds
    // no program either
    const shareOnly = { ...WOC_ARMOR_PAINT_OFF, edgeNonMetal: 0.6 };
    expect(wocArmorPaintActive(shareOnly)).toBe(false);
    expect(patchWocArmorPaintFragment(SOURCES.standard, shareOnly)).toBe(SOURCES.standard);
    // every other knob alone is enough to insert the block
    for (const knob of KNOBS) {
      if (knob !== 'edgeNonMetal') expect(wocArmorPaintActive(only(knob, 0.1)), knob).toBe(true);
    }
  });

  it('ships every knob but the brush on, inside its range', () => {
    expect(wocArmorPaintActive(WOC_ARMOR_PAINT_DEFAULTS)).toBe(true);
    for (const knob of KNOBS) {
      if (knob === 'brush') continue;
      expect(WOC_ARMOR_PAINT_DEFAULTS[knob], knob).toBeGreaterThan(0);
      expect(WOC_ARMOR_PAINT_DEFAULTS[knob], knob).toBeLessThanOrEqual(1);
    }
    // the repainted atlases carry the brushwork (scripts/assets/painted_armor/), so the
    // UV-space noise ships off and declares no helpers
    expect(WOC_ARMOR_PAINT_DEFAULTS.brush).toBe(0);
    expect(patchWocArmorPaintFragment(SOURCES.standard, WOC_ARMOR_PAINT_DEFAULTS)).not.toContain(
      'wocArmorPaintNoise',
    );
  });

  it('ships the light terms as a light touch over the painted atlases, the metal response kept', () => {
    // the atlases carry the painted key, shade, crease occlusion and edges: at the values
    // the unpainted atlases took (key 0.3, shade 0.62, cavity 0.7, edge 0.75) the light
    // would be painted twice
    for (const knob of ['key', 'shade', 'cavity', 'edge', 'metalCool'] as const) {
      expect(WOC_ARMOR_PAINT_DEFAULTS[knob], knob).toBeLessThanOrEqual(0.2);
    }
    expect(WOC_ARMOR_PAINT_DEFAULTS.saturation).toBeLessThanOrEqual(0.1);
    // the metal response does not depend on the paint: the floors stay
    expect(WOC_ARMOR_PAINT_DEFAULTS.roughnessFloor).toBe(0.55);
    expect(WOC_ARMOR_PAINT_DEFAULTS.metalRoughnessFloor).toBe(0.6);
  });

  it('emits each knob as its own term with its value baked in, and only when it is on', () => {
    // the term each knob owns, as the GLSL spells it (0.37 is a value no constant uses)
    const terms: Record<keyof WocArmorPaintSettings, string> = {
      saturation: 'mix( vec3( wocApLuma ), wocApColor, 1.37 )',
      metalCool: '0.37 * wocApSteel',
      key: '1.0 + 0.37 * smoothstep( -0.2, 1.0, wocApFacing )',
      shade: '0.37 * smoothstep( 0.1, -0.9, wocApFacing )',
      cavity: 'wocApColor *= 1.0 - 0.37 * wocApCrease',
      edge: 'wocApEdge *= 0.37 * mix(',
      edgeNonMetal: 'mix( 0.37, 1.0, wocApMetal )',
      brush: '1.0 + 0.37 * ( ( wocApStrokeA',
      roughnessFloor: 'mix( 0.37, 0.0, wocApMetal )',
      metalRoughnessFloor: 'mix( 0.0, 0.37, wocApMetal )',
    };
    // ...and what each term is made of, whatever its value: gone with the knob at zero
    const structure: Record<keyof WocArmorPaintSettings, string> = {
      saturation: 'mix( vec3( wocApLuma ), wocApColor,',
      metalCool: 'wocApSteel',
      key: 'smoothstep( -0.2, 1.0, wocApFacing )',
      shade: 'smoothstep( 0.1, -0.9, wocApFacing )',
      cavity: 'wocApCrease',
      edge: 'wocApEdge',
      edgeNonMetal: 'wocApEdge',
      brush: 'wocApStrokeA',
      roughnessFloor: 'roughnessFactor = max(',
      metalRoughnessFloor: 'roughnessFactor = max(',
    };
    for (const knob of KNOBS) {
      // edgeNonMetal only scales the edge term, so it is read with the edge on
      const settings =
        knob === 'edgeNonMetal' ? { ...only('edge', 0.5), edgeNonMetal: 0.37 } : only(knob, 0.37);
      const glsl = wocArmorPaintGlsl(settings);
      expect(glsl, knob).toContain(terms[knob]);
      expect(glsl, knob).toContain(structure[knob]);
      if (knob === 'edgeNonMetal') continue;
      // another knob keeps the block alive while this one is at zero
      const other = knob === 'key' ? 'shade' : 'key';
      expect(wocArmorPaintGlsl(only(other, 0.2)), knob).not.toContain(structure[knob]);
    }
  });

  it('reads metal off the metalness factor on Standard only, scaled back to the full channel', () => {
    // with the brush on, so the brush's own guard is read too
    const glsl = wocArmorPaintGlsl({ ...WOC_ARMOR_PAINT_DEFAULTS, brush: 0.05 });
    // 1 / WOC_ARMOR_METALNESS: a full-metal texel (factor 0.4 x blue 1) is mask 1
    expect(glsl).toContain(
      '#ifdef STANDARD\n\t\tfloat wocApMetal = saturate( metalnessFactor * 2.5 );',
    );
    // the Lambert rebuild has no metalness: no metal arm compiles there
    expect(glsl).toContain('#else\n\t\tfloat wocApMetal = 0.0;');
    // the roughness floors are Standard-only too (Lambert has no roughness)
    expect(glsl).toMatch(/#ifdef STANDARD\n\t\troughnessFactor = max\( roughnessFactor,/);
    // the AO crease reads the map only where the file has one (the low file does not)
    expect(glsl).toContain('#ifdef USE_AOMAP');
    expect(glsl).toContain('texture2D( aoMap, vAoMapUv ).r');
    // the brush rides the colour map's UV (a factor-only material has none)
    expect(glsl).toContain('#ifdef USE_MAP');
    expect(glsl).toContain('vMapUv');
  });

  it('keys the paint and the shade off the GEOMETRIC normal and world up, never the normal map', () => {
    const glsl = wocArmorPaintGlsl(WOC_ARMOR_PAINT_DEFAULTS);
    expect(glsl).toContain('normalize( nonPerturbedNormal )');
    expect(glsl).toContain('normalize( viewMatrix[ 1 ].xyz )');
    expect(glsl).not.toContain('mapN');
    expect(glsl).not.toContain('normalMap');
    // edges and creases: the screen-space curvature of that normal, faded with distance
    expect(glsl).toContain('dFdx( wocApN )');
    expect(glsl).toContain('length( vViewPosition )');
  });

  it('writes only the albedo and the roughness factor: no light, no alpha, no emissive', () => {
    const block = wocArmorPaintGlsl(WOC_ARMOR_PAINT_DEFAULTS);
    expect(block).toContain('diffuseColor.rgb = min( wocApColor, vec3( 1.0 ) );');
    expect(block).not.toMatch(/diffuseColor\.a\s*=/);
    expect(block).not.toContain('totalEmissiveRadiance');
    expect(block).not.toContain('reflectedLight');
    expect(block).not.toContain('gl_FragColor');
    expect(block).not.toContain('discard');
    // wrapped in its own scope, so its locals never collide with a later layer's
    expect(block.startsWith(`${WOC_ARMOR_PAINT_BEGIN}\n{`)).toBe(true);
    expect(block.endsWith(`}\n${WOC_ARMOR_PAINT_END}\n`)).toBe(true);
  });
});

describe('the patch on the real three programs', () => {
  it('lands right after emissivemap_fragment, before any light is gathered, keeping the anchor', () => {
    // with the brush on, so its helpers' place is read too
    const withBrush = { ...WOC_ARMOR_PAINT_DEFAULTS, brush: 0.05 };
    for (const [kind, source] of Object.entries(SOURCES)) {
      const out = patchWocArmorPaintFragment(source, withBrush);
      expect(out, kind).not.toBe(source);
      const anchor = out.indexOf(ANCHOR);
      const block = out.indexOf(WOC_ARMOR_PAINT_BEGIN);
      expect(anchor, kind).toBeGreaterThan(0);
      expect(block, kind).toBeGreaterThan(anchor);
      // the albedo it writes is the one the light reads
      const lights = out.indexOf(
        kind === 'lambert'
          ? '#include <lights_lambert_fragment>'
          : '#include <lights_physical_fragment>',
      );
      expect(block, kind).toBeLessThan(lights);
      // after the normal, the metalness and the roughness it reads
      expect(block, kind).toBeGreaterThan(out.indexOf('#include <normal_fragment_maps>'));
      if (kind !== 'lambert') {
        expect(block, kind).toBeGreaterThan(out.indexOf('#include <metalnessmap_fragment>'));
        expect(block, kind).toBeGreaterThan(out.indexOf('#include <roughnessmap_fragment>'));
      }
      // the brush helpers are declared ahead of main, once
      const pars = out.indexOf('float wocArmorPaintNoise( vec2 p )');
      expect(pars, kind).toBeGreaterThan(0);
      expect(pars, kind).toBeLessThan(out.indexOf('void main() {'));
      expect(out.split('float wocArmorPaintHash(').length - 1, kind).toBe(1);
    }
  });

  it('is idempotent, as the dry compile that runs a hook twice requires', () => {
    for (const source of Object.values(SOURCES)) {
      const once = patchWocArmorPaintFragment(source, WOC_ARMOR_PAINT_DEFAULTS);
      expect(patchWocArmorPaintFragment(once, WOC_ARMOR_PAINT_DEFAULTS)).toBe(once);
      // a fresh source patched again comes out byte-identical (no state carried over)
      expect(patchWocArmorPaintFragment(source, WOC_ARMOR_PAINT_DEFAULTS)).toBe(once);
    }
  });

  it('declares no helpers when the brush is off, and leaves a program with no anchor alone', () => {
    const noBrush = patchWocArmorPaintFragment(SOURCES.standard, {
      ...WOC_ARMOR_PAINT_DEFAULTS,
      brush: 0,
    });
    expect(noBrush).not.toContain('wocArmorPaintNoise');
    expect(noBrush).toContain(WOC_ARMOR_PAINT_BEGIN);
    const bare = 'void main() {\n\tgl_FragColor = vec4( 1.0 );\n}';
    expect(patchWocArmorPaintFragment(bare, WOC_ARMOR_PAINT_DEFAULTS)).toBe(bare);
  });

  it('is ONE block for every material class: the actor treatment never varies by tier', () => {
    // art bible section 6: the Standard tiers, the Physical armour files and the Lambert
    // rebuild of Low and iOS compile the very same text; what a file lacks (the low file's
    // AO and metal channels) is compiled out by three's own defines, not by a tier branch
    const blocks = Object.values(SOURCES).map((source) =>
      wocArmorPaintBlockOf(patchWocArmorPaintFragment(source, WOC_ARMOR_PAINT_DEFAULTS)),
    );
    expect(blocks[0].length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toBe(blocks[0]);
    expect(blocks[0]).toBe(wocArmorPaintGlsl(WOC_ARMOR_PAINT_DEFAULTS).trimEnd());
    // the block names no tier and no profile
    expect(blocks[0]).not.toMatch(/tier|LOW_GFX|lowGfx|constrained|ios/i);
  });
});

describe('the program key', () => {
  it('is one string per look, the same for every armour material, and changes with any knob', () => {
    const key = wocArmorPaintProgramKey(WOC_ARMOR_PAINT_DEFAULTS);
    expect(wocArmorPaintProgramKey({ ...WOC_ARMOR_PAINT_DEFAULTS })).toBe(key);
    expect(key).toContain('woc-armor-paint');
    // the metalness constant is baked into the GLSL (the metal mask), so it keys too
    expect(key).toContain(':0.4:');
    const seen = new Set([key]);
    for (const knob of KNOBS) {
      // a step every knob can take, the brush (off by default) included
      const other = wocArmorPaintProgramKey({
        ...WOC_ARMOR_PAINT_DEFAULTS,
        [knob]: WOC_ARMOR_PAINT_DEFAULTS[knob] + 0.05,
      });
      expect(other, knob).not.toBe(key);
      seen.add(other);
    }
    expect(seen.size).toBe(KNOBS.length + 1);
  });
});

describe('the session query (a dev surface, never a tier)', () => {
  it('ships the defaults with no query, and the stock armour under armorpaint=off', () => {
    expect(wocArmorPaintFromQuery('')).toEqual(WOC_ARMOR_PAINT_DEFAULTS);
    expect(wocArmorPaintFromQuery('?gfx=low&cel=on')).toEqual(WOC_ARMOR_PAINT_DEFAULTS);
    expect(wocArmorPaintFromQuery('?armorpaint=off')).toBeNull();
    expect(wocArmorPaintFromQuery('?armorpaint=0')).toBeNull();
    expect(wocArmorPaintFromQuery('?armorpaint=on')).toEqual(WOC_ARMOR_PAINT_DEFAULTS);
  });

  it('overrides each knob by its own key, clamped to its range, and ignores garbage', () => {
    const keys = new Set<string>();
    for (const knob of KNOBS) {
      const key = wocArmorPaintQueryKey(knob);
      expect(key, knob).toMatch(/^ap[a-z]+$/);
      keys.add(key);
      expect(wocArmorPaintFromQuery(`?${key}=0.125`)?.[knob], knob).toBe(0.125);
      // zero turns one knob off without touching the others
      const off = wocArmorPaintFromQuery(`?${key}=0`);
      expect(off?.[knob], knob).toBe(0);
      for (const other of KNOBS) {
        if (other !== knob)
          expect(off?.[other], `${knob} -> ${other}`).toBe(WOC_ARMOR_PAINT_DEFAULTS[other]);
      }
      expect(wocArmorPaintFromQuery(`?${key}=-3`)?.[knob], knob).toBe(0);
      expect(wocArmorPaintFromQuery(`?${key}=abc`)?.[knob], knob).toBe(
        WOC_ARMOR_PAINT_DEFAULTS[knob],
      );
      expect(wocArmorPaintFromQuery(`?${key}=`)?.[knob], knob).toBe(WOC_ARMOR_PAINT_DEFAULTS[knob]);
    }
    expect(keys.size).toBe(KNOBS.length);
    expect(wocArmorPaintFromQuery('?apkey=9')?.key).toBe(1);
    expect(wocArmorPaintFromQuery('?apbrush=9')?.brush).toBe(0.5);
  });
});
