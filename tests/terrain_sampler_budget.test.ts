import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The splat terrain fragment shader lives against the WebGL guarantee of 16
// texture image units, and a program past the limit FAILS TO LINK: no error
// overlay, no fallback, just no terrain drawn at all (the v0.34
// invisible-ground regression, reproduced at the ultra tier where three's
// own normalMap + directionalShadowMap + envMap samplers are all active on
// top of the spliced set). These pins hold the budget the fix restored: the
// six photo COLOUR layers stay packed in ONE sampler2DArray, and the
// spliced sampler count stays inside the ceiling below.
describe('terrain splat sampler budget', () => {
  const terrain = readFileSync(new URL('../src/render/terrain.ts', import.meta.url), 'utf8');

  // Three's built-ins active on the splat material at the richest tier:
  // normalMap, one directionalShadowMap, and the scene-environment envMap.
  const THREE_BUILTINS = 3;
  const LIMIT = 16;

  /** Every sampler name the splat material's spliced GLSL declares. */
  function splicedSamplerNames(): string[] {
    const names: string[] = [];
    for (const m of terrain.matchAll(/uniform\s+(sampler2DArray|sampler2D)\s+([^;]+);/g)) {
      for (const name of m[2].split(',')) names.push(name.trim());
    }
    return names;
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
    for (const dead of ['uGrass,', 'uDirt,', 'uRock,', 'uSand,', 'uMud,', 'uSnow,']) {
      expect(
        splicedSamplerNames().some((n) => `${n},` === dead),
        `${dead.slice(0, -1)} must stay packed inside uAlb`,
      ).toBe(false);
    }
  });

  it('declared spliced samplers fit the 16-unit limit beside three builtins', () => {
    const names = splicedSamplerNames();
    // vacuity floor: the declaration scan really is finding the spliced set
    expect(names).toContain('uAlb');
    expect(names).toContain('uGroundAO');
    expect(names.length).toBeGreaterThanOrEqual(7);
    // uHazeField is declared in biome_haze_field.ts and spliced in too
    const total = names.length + 1 + THREE_BUILTINS;
    expect(
      total,
      `splat shader wants ${total} texture units (${names.join(', ')} + uHazeField + ${THREE_BUILTINS} three builtins); the WebGL guarantee is ${LIMIT}`,
    ).toBeLessThanOrEqual(LIMIT);
  });
});
