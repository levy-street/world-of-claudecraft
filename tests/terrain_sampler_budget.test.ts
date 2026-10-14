import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The splat terrain fragment shader lives against the WebGL guarantee of 16
// texture image units, and a program past the limit FAILS TO LINK: no error
// overlay, no fallback, just no terrain drawn at all. Twice now:
// - v0.34: the ultra tier's three builtins on top of twelve photo samplers
//   (fixed by packing the six colour layers into one sampler2DArray);
// - 2026-09-23 (SPACEY, Tidehold/Deepglass): a texture-painted map's shader sat
//   at exactly 16 WITHOUT the scene environment, and the deferred IBL landing
//   a few seconds into play relinked it at 17 ("FRAGMENT shader texture image
//   units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)" on an Apple M5): the
//   ground vanished mid-walk. The old count here missed the paint set, the
//   grass bake it did not recognise, and three r185's dfgLUT.
//
// So the count below is the RICHEST variant the material can link to: every
// conditional arm on (grass bake, texture paint, zone haze) plus every three
// builtin a MeshStandardMaterial carries once the scene is fully lit.
describe('terrain splat sampler budget', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const terrain = read('../src/render/terrain.ts');
  const paint = read('../src/render/terrain_paint_layers.ts');
  const haze = read('../src/render/biome_haze_field.ts');

  // Three's built-ins on the splat material in its richest variant: the
  // macro normalMap, the sun's directionalShadowMap, the scene-environment
  // envMap (bound the moment the IBL lands), and r185's physical dfgLUT.
  const THREE_BUILTINS = ['normalMap', 'directionalShadowMap', 'envMap', 'dfgLUT'];
  const LIMIT = 16;

  /** Every sampler name declared by `uniform sampler...` in `source`. */
  function samplerNames(source: string): string[] {
    const names: string[] = [];
    for (const m of source.matchAll(/uniform\s+(sampler2DArray|sampler2D)\s+([^;]+);/g)) {
      for (const name of m[2].split(',')) names.push(name.trim());
    }
    return names;
  }

  /** The body of one exported GLSL template constant. */
  function glslConst(source: string, name: string): string {
    const start = source.indexOf(`export const ${name} = \``);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const body = source.slice(start + `export const ${name} = \``.length);
    return body.slice(0, body.indexOf('`'));
  }

  it('keeps the six albedo photos packed in one sampler2DArray', () => {
    expect(terrain).toContain('uniform sampler2DArray uAlb;');
    // the pack and the shader agree on the layer order, pinned value-for-value
    expect(terrain).toContain(
      "SPLAT_ALBEDO_LAYERS = ['grassC', 'dirtC', 'rockC', 'sandC', 'mudC', 'snowC']",
    );
    for (const [i, layer] of ['GRASS', 'DIRT', 'ROCK', 'SAND', 'MUD', 'SNOW'].entries()) {
      expect(terrain).toContain(`const float WOC_L_${layer} = ${i}.0;`);
    }
    // no stray per-photo colour sampler resurrects outside the array
    for (const dead of ['uGrass', 'uDirt', 'uRock', 'uSand', 'uMud', 'uSnow']) {
      expect(samplerNames(terrain), `${dead} must stay packed inside uAlb`).not.toContain(dead);
    }
  });

  it('keeps the four detail normals packed in one sampler2DArray', () => {
    expect(terrain).toContain('uniform sampler2DArray uNrm;');
    expect(terrain).toContain("SPLAT_NORMAL_LAYERS = ['grassN', 'dirtN', 'rockN', 'sandN']");
    for (const [i, layer] of ['GRASS', 'DIRT', 'ROCK', 'SAND'].entries()) {
      expect(terrain).toContain(`const float WOC_N_${layer} = ${i}.0;`);
    }
    for (const dead of ['uGrassN', 'uDirtN', 'uRockN', 'uSandN']) {
      expect(samplerNames(terrain), `${dead} must stay packed inside uNrm`).not.toContain(dead);
      expect(terrain, `${dead} must not be tapped directly`).not.toContain(`texture2D(${dead}`);
    }
  });

  it('the richest variant fits the 16-unit limit with one unit to spare', () => {
    const spliced = samplerNames(terrain);
    const paintSet = samplerNames(glslConst(paint, 'PAINT_LAYER_UNIFORMS_GLSL'));
    const hazeSet = samplerNames(glslConst(haze, 'BIOME_HAZE_DECLARATIONS'));
    // vacuity floors: each scan really is finding its set
    expect(spliced).toEqual(
      expect.arrayContaining(['uAlb', 'uNrm', 'uMacro', 'uGroundAO', 'uGrassBake']),
    );
    expect(paintSet).toEqual(['uPaintField', 'uPaintTiles', 'uPaintNormTiles', 'uPaintAoTiles']);
    expect(hazeSet).toEqual(['uHazeField']);
    const all = [...spliced, ...paintSet, ...hazeSet, ...THREE_BUILTINS];
    const detail = `splat shader wants ${all.length} texture units (${all.join(', ')})`;
    expect(all.length, `${detail}; the WebGL guarantee is ${LIMIT}`).toBeLessThanOrEqual(LIMIT);
    // One spare unit: a lighting change (a second shadowed light, a light
    // probe texture) relinks EVERY lit material mid-play, and a variant that
    // lands exactly on the limit today is one such change from invisible
    // ground. Spend the spare deliberately, never by accident.
    expect(all.length, `${detail}; keep at least one unit spare`).toBeLessThanOrEqual(LIMIT - 1);
  });
});
