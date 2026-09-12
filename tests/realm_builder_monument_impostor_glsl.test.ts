import { describe, expect, it } from 'vitest';
import {
  MONUMENT_IMPOSTOR_FRAGMENT,
  MONUMENT_IMPOSTOR_VERTEX,
} from '../src/render/realm_builder_monument_impostor_glsl';

// The Node half of the impostor's shader coverage, paired with the module the
// way post_finite_guard_glsl.test.ts pairs with its own. It costs about a
// millisecond and rides `vitest related`, so it is the cheap floor; the real
// driver link lives in tests/browser/dry_compile_sources.browser.test.ts.
//
// The two halves fail on different axes ON PURPOSE, which is what makes the
// pair worth having. This one reads the source text, so it catches ONE class
// of defect (an identifier the language reserves) across the whole module
// without a GL context. The browser one links against a driver, so it catches
// EVERY class but only for a shader some scene actually instantiates.

/**
 * The GLSL ES 3.00 words that cannot name a variable. Deliberately NOT the
 * whole specification list: these are the qualifiers and reserved words a
 * shader author plausibly reaches for as a noun, which is how `vec3 flat`
 * shipped and never compiled for the life of v0.42.
 *
 * `attribute` and `varying` are absent on purpose. The spec reserves both, but
 * three's WebGL2 prefix defines them away (`#define attribute in`,
 * `#define varying out`), and this module's own sources use `varying`.
 */
const RESERVED_AS_IDENTIFIER = [
  // Interpolation and auxiliary qualifiers.
  'flat',
  'smooth',
  'centroid',
  'sample',
  'patch',
  // Storage, memory and layout qualifiers.
  'layout',
  'shared',
  'invariant',
  'precise',
  'coherent',
  'volatile',
  'restrict',
  'readonly',
  'writeonly',
  'subroutine',
  // Reserved by the specification for future use.
  'common',
  'partition',
  'active',
  'filter',
  'resource',
  'namespace',
  'using',
  'cast',
  'inline',
  'noinline',
  'sizeof',
  'union',
  'this',
  'template',
  'typedef',
  'external',
  'input',
  'output',
  'buffer',
] as const;

const DECLARED_TYPE =
  '(?:vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234](?:x[234])?|float|int|uint|bool)';

/** Every reserved word this source declares as a variable, in source order. */
function reservedIdentifiers(source: string): string[] {
  return RESERVED_AS_IDENTIFIER.filter((word) =>
    new RegExp(`\\b${DECLARED_TYPE}\\s+${word}\\b`).test(source),
  );
}

describe('realm_builder_monument_impostor_glsl', () => {
  it('declares no reserved word as a variable', () => {
    // The positive control first: without it this would be a negative pin on a
    // token that is never present, and a broken matcher would pass over
    // nothing. The string is the line that actually shipped.
    expect(reservedIdentifiers('vec3 flat = normalize(vec3(right.x, 0.0, right.z));')).toEqual([
      'flat',
    ]);
    expect(reservedIdentifiers('vec3 flatRight = normalize(right);')).toEqual([]);
    // `varying vec2 vUv` must not trip it: three's prefix defines the word away.
    expect(reservedIdentifiers('varying vec2 vUv;')).toEqual([]);

    expect(reservedIdentifiers(MONUMENT_IMPOSTOR_VERTEX)).toEqual([]);
    expect(reservedIdentifiers(MONUMENT_IMPOSTOR_FRAGMENT)).toEqual([]);
  });

  it('billboards about the vertical axis only', () => {
    // The zeroed Y is the whole claim of the docblock: a statue that tips to
    // face the camera reads as a card from a rise. A right vector taken whole
    // would compile and look wrong, which no link test can catch.
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain(
      'vec3 flatRight = normalize(vec3(right.x, 0.0, right.z));',
    );
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain(
      'vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);',
    );
    // Only x and z ride the flattened basis; y passes through as authored.
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('flatRight.x * position.x');
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('flatRight.z * position.x');
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('position.y');
  });

  it('alpha-tests rather than blending, so the card sorts like the solid', () => {
    expect(MONUMENT_IMPOSTOR_FRAGMENT).toContain('if (texel.a < 0.5) discard;');
    expect(MONUMENT_IMPOSTOR_FRAGMENT).toContain('gl_FragColor = vec4(texel.rgb, 1.0);');
  });

  it('ends on the tail a lit surface ends on, in order', () => {
    // The docblock's promise: a card that skipped this would stand un-fogged
    // and un-toned at the fog wall while the buildings around it fade.
    const tail = ['tonemapping_fragment', 'colorspace_fragment', 'fog_fragment'].map((chunk) =>
      MONUMENT_IMPOSTOR_FRAGMENT.indexOf(`#include <${chunk}>`),
    );
    expect(tail.every((at) => at >= 0)).toBe(true);
    expect(tail).toEqual([...tail].sort((a, b) => a - b));
    // Fog needs its declarations in both stages, or the tail does not compile.
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('#include <fog_pars_vertex>');
    expect(MONUMENT_IMPOSTOR_FRAGMENT).toContain('#include <fog_pars_fragment>');
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('#include <fog_vertex>');
  });

  it('declares the uniforms and the varying the material wires', () => {
    // buildImpostor supplies uAtlas, uCell and uCellSize; a rename on one side
    // only leaves a silently unbound uniform rather than a failed link.
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('uniform vec2 uCell;');
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('uniform vec2 uCellSize;');
    expect(MONUMENT_IMPOSTOR_FRAGMENT).toContain('uniform sampler2D uAtlas;');
    expect(MONUMENT_IMPOSTOR_VERTEX).toContain('varying vec2 vUv;');
    expect(MONUMENT_IMPOSTOR_FRAGMENT).toContain('varying vec2 vUv;');
  });
});
