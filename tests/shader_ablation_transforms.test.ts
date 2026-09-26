import { describe, expect, it } from 'vitest';
import {
  ABLATIONS,
  pickPrograms,
  wornTriRSpan,
} from '../scripts/lib/shader_ablation_transforms.mjs';

const VERTEX = '#version 300 es\n#define USE_SHADOWMAP\n#define USE_ENVMAP\nvoid main() {}\n';
const FRAGMENT = [
  '#version 300 es',
  '#define USE_ENVMAP',
  '#define ENVMAP_TYPE_CUBE_UV',
  '#define CUBEUV_MAX_MIP 7.0',
  '#define USE_SHADOWMAP',
  '#define SHADOWMAP_TYPE_PCF',
  'float wornTriR(',
  '  sampler2D tex, const in vec3 p, const in vec3 w, const in vec3 axis',
  ') {',
  '  if ( w.x >= 0.999 ) { return texture2D( tex, p.zy ).r; }',
  '  return texture2D( tex, p.xy ).r * w.z;',
  '}',
  'void main() {',
  '  if ( uWornTaps > 0.0 && wornCamD < uWornParEnd ) {',
  '    float h = wornTriR( uWornDisp, p, w, a );',
  '  }',
  '}',
  '',
].join('\n');

describe('shader ablation transforms', () => {
  it('drops exactly the shadow map define, in both stages', () => {
    const out = ABLATIONS['no-shadowmap']({ vertex: VERTEX, fragment: FRAGMENT });
    expect(out?.fragment).not.toMatch(/^#define USE_SHADOWMAP\b/m);
    expect(out?.vertex).not.toMatch(/^#define USE_SHADOWMAP\b/m);
    // SHADOWMAP_TYPE_PCF is a different define and the env map is untouched.
    expect(out?.fragment).toContain('#define SHADOWMAP_TYPE_PCF');
    expect(out?.fragment).toContain('#define USE_ENVMAP');
  });

  it('drops the env map define family and nothing else', () => {
    const out = ABLATIONS['no-envmap']({ vertex: VERTEX, fragment: FRAGMENT });
    expect(out?.fragment).not.toMatch(/ENVMAP|CUBEUV/);
    expect(out?.vertex).not.toMatch(/ENVMAP/);
    expect(out?.fragment).toContain('#define USE_SHADOWMAP');
  });

  it('skips a program that does not carry the ingredient', () => {
    const bare = { vertex: 'void main() {}', fragment: 'void main() {}' };
    for (const name of Object.keys(ABLATIONS)) expect(ABLATIONS[name](bare)).toBeNull();
  });

  it('finds the whole worn function, nested braces included', () => {
    const span = wornTriRSpan(FRAGMENT);
    expect(span).not.toBeNull();
    const text = FRAGMENT.slice(span?.start, span?.end);
    expect(text.startsWith('float wornTriR(')).toBe(true);
    expect(text.endsWith('}')).toBe(true);
    expect(text).toContain('* w.z;');
    expect(text).not.toContain('void main');
  });

  it('swaps the worn function body and leaves its call sites alone', () => {
    const flat = ABLATIONS['worn-flat']({ vertex: VERTEX, fragment: FRAGMENT });
    expect(flat?.fragment).not.toContain('w.x >= 0.999');
    expect(flat?.fragment).toContain('float h = wornTriR( uWornDisp, p, w, a );');
    expect(flat?.vertex).toBe(VERTEX);
    const grad = ABLATIONS['worn-grad']({ vertex: VERTEX, fragment: FRAGMENT });
    expect(grad?.fragment).toContain('textureGrad( tex, p.zy, dxZY, dyZY )');
    expect(grad?.fragment).toContain('w.x >= 0.999');
  });

  it('keeps every branch and read of the worn function under a single exit', () => {
    const out = ABLATIONS['worn-single-exit']({ vertex: VERTEX, fragment: FRAGMENT });
    const span = wornTriRSpan(out?.fragment ?? '');
    const body = (out?.fragment ?? '').slice(span?.start, span?.end);
    expect(body.match(/\breturn\b/g)).toHaveLength(1);
    expect(body).toContain('w.x >= 0.999');
    expect(body.match(/texture2D\(/g)).toHaveLength(12);
  });

  it('stacks the unbranched read and the parallax switch in one variant', () => {
    const out = ABLATIONS['worn-flat-no-parallax']({ vertex: VERTEX, fragment: FRAGMENT });
    expect(out?.fragment).toContain('if ( false ) {');
    expect(out?.fragment).not.toContain('w.x >= 0.999');
  });

  it('switches the parallax block off without deleting it', () => {
    const out = ABLATIONS['worn-no-parallax']({ vertex: VERTEX, fragment: FRAGMENT });
    expect(out?.fragment).toContain('if ( false ) {');
    expect(out?.fragment).not.toContain('uWornTaps > 0.0 &&');
  });

  it('samples deterministically, whatever the input order', () => {
    const programs = ['c', 'a', 'd', 'b'].map((hash) => ({ hash }));
    const accept = (p: { hash: string }) => p.hash !== 'a';
    expect(pickPrograms(programs, accept, 2).map((p) => p.hash)).toEqual(['b', 'c']);
    expect(pickPrograms([...programs].reverse(), accept, 2).map((p) => p.hash)).toEqual(['b', 'c']);
  });
});
