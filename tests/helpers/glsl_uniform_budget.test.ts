// The uniform vector count of tests/helpers/glsl_uniform_budget.ts, held to cases worked
// by hand: which lines a preprocessor keeps, which uniforms a text declares, what they
// cost with nothing packed, and what they pack into by the appendix's algorithm (GLSL ES
// 1.00 appendix A section 7, as ANGLE runs it). The suites that lean on it count a merged
// WOC head's program (tests/woc_head_uniform_budget.test.ts and the real-browser
// tests/browser/woc_merged_head_uniforms.browser.test.ts).
import { describe, expect, it } from 'vitest';
import {
  activeGlslUniforms,
  type GlslUniform,
  glslUniforms,
  liveGlsl,
  liveGlslUniforms,
  packedUniformVectors,
  samplerImageUnits,
  uniformBaseName,
  uniformsPackInto,
  uniformVectorRows,
} from './glsl_uniform_budget';

const u = (type: string, name: string, count = 1): GlslUniform => ({ name, type, count });
const names = (list: readonly GlslUniform[]): string[] => list.map((x) => x.name);

describe('liveGlsl: the lines a preprocessor keeps', () => {
  const SOURCE = `#define A
#ifdef A
uniform float a;
#else
uniform float b;
#endif
#ifndef A
uniform float c;
#elif defined( B ) || NUM > 2
uniform float d;
#else
uniform float e;
#endif
#if ( NUM > 0 ) && defined( A )
uniform vec3 f[ NUM ];
#endif
#undef A
#ifdef A
uniform float g;
#endif
// uniform float commented;
/* uniform float blocked; */
#pragma unroll_loop_start
uniform float h;`;

  it('walks define, undef, ifdef, ifndef, if, elif and else in order', () => {
    expect(names(liveGlslUniforms(SOURCE, { NUM: 3 }).uniforms)).toEqual(['a', 'd', 'f', 'h']);
    // the same text under another census: the elif no longer holds, the array is gone
    expect(names(liveGlslUniforms(SOURCE, { NUM: 0 }).uniforms)).toEqual(['a', 'e', 'h']);
    // ...and a define handed in from outside is one the text can undefine
    expect(names(liveGlslUniforms(SOURCE, { NUM: 1, B: '' }).uniforms)).toEqual([
      'a',
      'd',
      'f',
      'h',
    ]);
    expect(liveGlsl(SOURCE, { NUM: 3 }).defines.has('A')).toBe(false);
  });

  it('keeps nothing of a dead arm, whatever its own conditionals say', () => {
    const nested = `#ifdef MISSING
#ifdef A
uniform float h;
#else
uniform float i;
#endif
#else
uniform float j;
#endif`;
    expect(names(liveGlslUniforms(nested, { A: '' }).uniforms)).toEqual(['j']);
    // the first arm that holds is the only one: a later elif that would hold is skipped
    const chain = `#if N > 0
uniform float one;
#elif N > 1
uniform float two;
#else
uniform float none;
#endif`;
    expect(names(liveGlslUniforms(chain, { N: 5 }).uniforms)).toEqual(['one']);
    expect(names(liveGlslUniforms(chain, { N: 0 }).uniforms)).toEqual(['none']);
  });

  it('reads the conditions three writes, and refuses one it cannot', () => {
    const holds = (condition: string, defined: Record<string, string | number> = {}): boolean =>
      names(liveGlslUniforms(`#if ${condition}\nuniform float x;\n#endif`, defined).uniforms)
        .length === 1;
    expect(
      holds('defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0', {
        USE_SHADOWMAP: '',
        NUM_DIR_LIGHT_SHADOWS: 1,
      }),
    ).toBe(true);
    expect(
      holds('defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0', { NUM_DIR_LIGHT_SHADOWS: 1 }),
    ).toBe(false);
    expect(holds('! defined ( USE_TANGENT ) && ( defined ( A ) || defined( B ) )', { B: '' })).toBe(
      true,
    );
    expect(
      holds('! defined ( USE_TANGENT ) && ( defined ( A ) || defined( B ) )', {
        B: '',
        USE_TANGENT: '',
      }),
    ).toBe(false);
    expect(
      holds('UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES', {
        UNION_CLIPPING_PLANES: 1,
        NUM_CLIPPING_PLANES: 2,
      }),
    ).toBe(true);
    // an undefined name is 0, as a C preprocessor reads it
    expect(holds('NEVER_DEFINED > 0')).toBe(false);
    expect(holds('NEVER_DEFINED == 0')).toBe(true);
    // a macro that names another
    expect(holds('COUNT >= 3', { COUNT: 'OTHER', OTHER: 3 })).toBe(true);
    // ...and one whose value is no integer is refused, never read as 0
    expect(() => holds('RATIO > 0', { RATIO: '( 1.0 / 3.0 )' })).toThrow(/cannot read: RATIO/);
    expect(() => holds('RATIO > 0', { RATIO: '0.5' })).toThrow(/cannot read: RATIO/);
    // (a bare define is 0 in a comparison, as an undefined name is)
    expect(holds('FLAG > 0', { FLAG: '' })).toBe(false);
    expect(() => liveGlsl('#if N % 2\n#endif', { N: 1 })).toThrow(/cannot read/);
    expect(() => liveGlsl('#ifdef A\nuniform float x;', {})).toThrow(/left open/);
    expect(() => liveGlsl('#endif', {})).toThrow(/no #if/);
  });
});

describe('glslUniforms: what a text declares', () => {
  it('reads every declarator, an array by its size, a struct by its fields, a sampler apart', () => {
    const text = `struct PointLight {
  vec3 position;
  vec3 color;
  float distance;
  float decay;
};
uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
uniform float uAge,uKind , uAmount;
uniform vec2 uContact,uRight;
uniform highp sampler2D map;
uniform vec4 table[18];
uniform vec3 lightProbe[ 9 ];
uniform mat4 viewMatrix;
uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
uniform float uAge;`;
    const { uniforms, samplers } = glslUniforms(
      text,
      new Map([
        ['NUM_POINT_LIGHTS', '10'],
        ['NUM_CLIPPING_PLANES', '0'],
      ]),
    );
    expect(uniforms).toEqual([
      u('vec3', 'pointLights.position', 10),
      u('vec3', 'pointLights.color', 10),
      u('float', 'pointLights.distance', 10),
      u('float', 'pointLights.decay', 10),
      u('float', 'uAge'),
      u('float', 'uKind'),
      u('float', 'uAmount'),
      u('vec2', 'uContact'),
      u('vec2', 'uRight'),
      u('vec4', 'table', 18),
      u('vec3', 'lightProbe', 9),
      u('mat4', 'viewMatrix'),
    ]);
    expect(samplers).toEqual([u('sampler2D', 'map')]);
    // an array size nothing defines is not guessed at
    expect(() => glslUniforms('uniform vec3 lights[ NUM_LIGHTS ];')).toThrow(/array size/);
  });

  it('throws on a declaration it cannot read: nothing declared is ever counted as nothing', () => {
    // guards: a form the parser skipped (the array on the type, a struct with an array
    // field or a list of names) dropped its rows from the count without a word
    // the size on the type: the keyword is there, the statement is not one it reads
    expect(() => glslUniforms('uniform vec4[18] table;')).toThrow(
      /1 uniform declarations in the text, 0 it can read/,
    );
    expect(() => glslUniforms('uniform float a;\nuniform vec4[18] table;')).toThrow(
      /2 uniform declarations in the text, 1 it can read/,
    );
    // a struct a uniform is declared with: an array field, a list of names
    const array = 'struct Lit { vec3 color; float ramp[4]; };\nuniform Lit lit;';
    expect(() => glslUniforms(array)).toThrow(/a field of Lit it cannot read: float ramp\[4\]/);
    const list = 'struct Lit { vec3 color, tint; };\nuniform Lit lit;';
    expect(() => glslUniforms(list)).toThrow(/a field of Lit it cannot read: vec3 color, tint/);
    // ...where a precision on a field is read, and a struct no uniform uses holds anything
    const fine = `struct Unused { float ramp[4]; vec3 a, b; };
struct Lit { highp vec3 color; float power; };
uniform Lit lit[2];`;
    expect(glslUniforms(fine).uniforms).toEqual([
      u('vec3', 'lit.color', 2),
      u('float', 'lit.power', 2),
    ]);
  });
});

describe('the counts', () => {
  it('uniformVectorRows: every element a vector of its own, a matrix a vector a row', () => {
    expect(uniformVectorRows([u('float', 'a')])).toBe(1);
    expect(uniformVectorRows([u('vec2', 'a'), u('bool', 'b'), u('vec4', 'c')])).toBe(3);
    expect(uniformVectorRows([u('mat3', 'a'), u('mat4', 'b')])).toBe(7);
    expect(uniformVectorRows([u('vec4', 'table', 18), u('float', 'f', 5)])).toBe(23);
    expect(() => uniformVectorRows([u('dvec3', 'a')])).toThrow(/does not know/);
  });

  it('packedUniformVectors: a single component beside a three column row', () => {
    // a vec4 row, then the vec3 with the float in its fourth column
    expect(packedUniformVectors([u('vec4', 'a'), u('vec3', 'b'), u('float', 'c')])).toBe(2);
    // two vec3 rows hold two floats; the third takes a row of its own
    const three = [
      u('vec3', 'a'),
      u('vec3', 'b'),
      u('float', 'c'),
      u('float', 'd'),
      u('float', 'e'),
    ];
    expect(packedUniformVectors(three)).toBe(3);
    expect(uniformVectorRows(three)).toBe(5);
    // a mat3 is three rows of three, with a float beside each
    expect(
      packedUniformVectors([u('mat3', 'm'), u('float', 'a'), u('float', 'b'), u('float', 'c')]),
    ).toBe(3);
    expect(packedUniformVectors([u('mat4', 'm')])).toBe(4);
  });

  it('packedUniformVectors: two column variables share rows only once columns 0 and 1 are spent', () => {
    const pair = [u('vec2', 'a', 3), u('vec2', 'b', 3)];
    // the fewest rows that take them: the second up columns 2 and 3 of the same three rows
    expect(packedUniformVectors(pair)).toBe(3);
    expect(uniformsPackInto(3, pair)).toBe(true);
    expect(uniformsPackInto(2, pair)).toBe(false);
    // ...where a vec4 table of the same two components a slot is three rows whatever the grid
    expect(packedUniformVectors([u('vec4', 't', 3)])).toBe(3);
  });

  it('packedUniformVectors: an array stays in one column, a struct field goes an element at a time', () => {
    // one float array of five: five rows down one column
    expect(packedUniformVectors([u('float', 'ramp', 5)])).toBe(5);
    // five floats that are five elements of a struct array: four to a row
    expect(packedUniformVectors([u('float', 'lights.decay', 5)])).toBe(2);
    // ten point lights: two vec3 rows a light, its two floats beside them
    const lights = [
      u('vec3', 'pointLights.position', 10),
      u('vec3', 'pointLights.color', 10),
      u('float', 'pointLights.distance', 10),
      u('float', 'pointLights.decay', 10),
    ];
    expect(packedUniformVectors(lights)).toBe(20);
    expect(uniformVectorRows(lights)).toBe(40);
  });

  it('packs a sampler as a single component, and holds a variable taller than the grid out', () => {
    const table = [u('vec4', 'a')];
    const four = ['m', 'n', 'o', 'p'].map((name) => u('sampler2D', name));
    expect(packedUniformVectors(table)).toBe(1);
    expect(packedUniformVectors(table, four)).toBe(2);
    expect(packedUniformVectors(table, [...four, u('sampler2D', 'q')])).toBe(3);
    expect(uniformsPackInto(3, [u('vec4', 'tall', 4)])).toBe(false);
    expect(uniformsPackInto(4, [u('vec4', 'tall', 4)])).toBe(true);
    // the limit is a limit: one row past it fails, by one three column row
    expect(uniformsPackInto(4, [u('vec4', 'tall', 4), u('vec3', 'more')])).toBe(false);
  });
});

describe('activeGlslUniforms: a linked program', () => {
  const FLOAT = 0x1406;
  const VEC3 = 0x8b51;
  const VEC4 = 0x8b52;
  const MAT4 = 0x8b5c;
  const SAMPLER_2D = 0x8b5e;
  const context = (list: { name: string; size: number; type: number }[]) => ({
    ACTIVE_UNIFORMS: 0x8b86,
    getProgramParameter: (_program: unknown, pname: number): unknown =>
      pname === 0x8b86 ? list.length : null,
    getActiveUniform: (_program: unknown, index: number) => list[index] ?? null,
  });

  it('reads an array once with its size, a struct element as the driver lists it, a sampler apart', () => {
    const gl = context([
      { name: 'uWocHmRef[0]', size: 18, type: VEC4 },
      { name: 'pointLights[3].color', size: 1, type: VEC3 },
      { name: 'opacity', size: 1, type: FLOAT },
      { name: 'viewMatrix', size: 1, type: MAT4 },
      { name: 'map', size: 1, type: SAMPLER_2D },
    ]);
    const { uniforms, samplers } = activeGlslUniforms(gl, {});
    expect(uniforms).toEqual([
      u('vec4', 'uWocHmRef', 18),
      u('vec3', 'pointLights[3].color'),
      u('float', 'opacity'),
      u('mat4', 'viewMatrix'),
    ]);
    expect(samplers).toEqual([u('sampler2D', 'map')]);
    // image units are an element each: an array of two samplers takes two
    expect(samplerImageUnits([...samplers, u('sampler2DShadow', 'shadowMaps', 2)])).toBe(3);
    expect(uniformVectorRows(uniforms)).toBe(18 + 1 + 1 + 4);
    expect(names(uniforms).map(uniformBaseName)).toEqual([
      'uWocHmRef',
      'pointLights',
      'opacity',
      'viewMatrix',
    ]);
    // a type the count does not know is never counted as nothing
    expect(() => activeGlslUniforms(context([{ name: 'x', size: 1, type: 0x9999 }]), {})).toThrow(
      /does not know/,
    );
  });
});
