// Real-WebGL proof for the three patch's degenerate-normal guard in
// normal_fragment_begin (tests/three_compile_async_patch.test.ts pins its
// text). The guard tests the squared length of the FINITE input before
// normalize, so no NaN is born and none is compared. It replaced a form that
// normalized first and then compared the possibly-NaN result, which GLSL ES
// leaves implementation-defined.
//
// Two claims, on both the smooth and the FLAT_SHADED arm:
// 1. Every non-degenerate input (unit, non-unit, tiny but nonzero, and a real
//    flat-shaded close-up) renders the same bytes as the previous form, both
//    the raw normal and the lit colour.
// 2. A zero input shades with the fallback normal, finite, and a back face under
//    DOUBLE_SIDED gets the flipped fallback.
// The previous form's result on the zero input is only logged, never asserted:
// it is driver evidence, not a contract.
//
// Inputs are driven by uniforms through macros around the include, so the
// shipped chunk text compiles unchanged and the driver cannot fold the values.
// Read back from a FloatType target, which keeps NaN and Inf as written.
//
// Lives under tests/browser/** and ends in .browser.test.ts, so a bare
// `vitest run` skips it; `npm run test:browser` (chromium) runs it.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSoftwareRendererName } from '../../src/render/software_renderer';
import '../../src/render/final_color_nan_guard';

const SHIPPED_NORMAL_BEGIN = THREE.ShaderChunk.normal_fragment_begin;
const GUARDED_OPAQUE = THREE.ShaderChunk.opaque_fragment;
const NEW_SMOOTH =
  'vec3 normal = dot( vNormal, vNormal ) > 0.0 ? normalize( vNormal ) : vec3( 0.0, 0.0, 1.0 );';
const OLD_SMOOTH =
  'vec3 normal = normalize( vNormal ); normal = dot( normal, normal ) > 0.0 ? normal : vec3( 0.0, 0.0, 1.0 );';
const NEW_FLAT =
  'vec3 wocFlatN = cross( fdx, fdy );\n\tvec3 normal = dot( wocFlatN, wocFlatN ) > 0.0 ? normalize( wocFlatN ) : vec3( 0.0, 0.0, 1.0 );';
const OLD_FLAT =
  'vec3 normal = normalize( cross( fdx, fdy ) ); normal = dot( normal, normal ) > 0.0 ? normal : vec3( 0.0, 0.0, 1.0 );';
const OLD_NORMAL_BEGIN = SHIPPED_NORMAL_BEGIN.replace(NEW_SMOOTH, OLD_SMOOTH).replace(
  NEW_FLAT,
  OLD_FLAT,
);
// Unguarded stock three, logged beside the previous form to show whether the zero input
// really produced a NaN on this driver.
const STOCK_NORMAL_BEGIN = SHIPPED_NORMAL_BEGIN.replace(
  NEW_SMOOTH,
  'vec3 normal = normalize( vNormal );',
).replace(NEW_FLAT, 'vec3 normal = normalize( cross( fdx, fdy ) );');
const NORMAL_BEGIN: Record<Form, string> = {
  new: SHIPPED_NORMAL_BEGIN,
  old: OLD_NORMAL_BEGIN,
  stock: STOCK_NORMAL_BEGIN,
};
// The raw readbacks (the normal itself, and the lit colour of a degenerate input) strip the
// final-colour guard so a NaN stays visible.
const UNGUARDED_OPAQUE = GUARDED_OPAQUE.replace(
  /\/\/ WOC_OPAQUE_NAN_GUARD\n(?:.*floatBitsToUint.*\n){4}/,
  '',
);
const SIZE = 4;
const FALLBACK = [0, 0, 1];

type Form = 'new' | 'old' | 'stock';
// normal: outgoingLight = normal, unguarded. lit: production path. litRaw: lit, unguarded.
type Output = 'normal' | 'lit' | 'litRaw';
// smooth: vNormal = uNormal. flat: vViewPosition = uScale * (x, y, 0.3x + 0.7y)
// of gl_FragCoord, so cross(fdx, fdy) is about uScale^2 * (-0.3, -0.7, 1).
// flatCloseUp: a real flat-shaded plane 4 mm from a perspective camera.
type Input = 'smooth' | 'flat' | 'flatCloseUp';
interface Case {
  name: string;
  input: Input;
  normal?: [number, number, number];
  scale?: number;
  backFace?: boolean;
}
const FINITE_CASES: Case[] = [
  { name: 'smooth unit', input: 'smooth', normal: [0.267261, 0.534522, 0.801784] },
  { name: 'smooth non-unit', input: 'smooth', normal: [0.3, -0.4, 1.7] },
  { name: 'smooth small', input: 'smooth', normal: [2e-7, 1e-7, -3e-7] },
  { name: 'smooth tiny', input: 'smooth', normal: [1e-18, -2e-18, 3e-18] },
  { name: 'flat unit footprint', input: 'flat', scale: 1 },
  // Squared length about 1e-13: below a 1e-12 threshold, so a threshold guard would fail it.
  { name: 'flat close-up footprint', input: 'flat', scale: 5e-4 },
  { name: 'flat tiny footprint', input: 'flat', scale: 1e-9 },
  { name: 'flat real close-up plane', input: 'flatCloseUp' },
];
const DEGENERATE_CASES: Case[] = [
  { name: 'smooth zero vNormal', input: 'smooth', normal: [0, 0, 0] },
  { name: 'flat zero derivatives', input: 'flat', scale: 0 },
  {
    name: 'smooth zero vNormal, double-sided back face',
    input: 'smooth',
    normal: [0, 0, 0],
    backFace: true,
  },
];

let renderer: THREE.WebGLRenderer;
let shaderError: string | null = null;
let adapter = '';
const uniforms = {
  uNormal: { value: new THREE.Vector3() },
  uScale: { value: 0 },
};
const materials = new Map<string, THREE.MeshStandardMaterial>();
const linkedSources = new Map<string, string>();

function inputSplice(input: Input): string {
  if (input === 'smooth') {
    return 'vec3 wocTestNormal = uNormal;\n#define vNormal wocTestNormal\n#include <normal_fragment_begin>\n#undef vNormal';
  }
  if (input === 'flat') {
    return (
      'vec3 wocTestViewPosition = uScale * vec3( gl_FragCoord.x, gl_FragCoord.y, 0.3 * gl_FragCoord.x + 0.7 * gl_FragCoord.y );\n' +
      '#define vViewPosition wocTestViewPosition\n#include <normal_fragment_begin>\n#undef vViewPosition'
    );
  }
  return '#include <normal_fragment_begin>';
}

function spliced(source: string, needle: string, replacement: string): string {
  expect(source, `splice anchor ${needle}`).toContain(needle);
  return source.replace(needle, replacement);
}

function materialKey(form: Form, testCase: Case, output: Output): string {
  return `${form}:${testCase.input}:${output}:${testCase.backFace ? 'double' : 'front'}`;
}

function material(form: Form, testCase: Case, output: Output): THREE.MeshStandardMaterial {
  const key = materialKey(form, testCase, output);
  const cached = materials.get(key);
  if (cached) return cached;
  const made = new THREE.MeshStandardMaterial({
    color: 0x336633,
    roughness: 0.5,
    flatShading: testCase.input !== 'smooth',
    side: testCase.backFace ? THREE.DoubleSide : THREE.FrontSide,
  });
  made.customProgramCacheKey = () => `degenerate-normal-guard:${key}`;
  made.onBeforeCompile = (shader) => {
    shader.uniforms.uNormal = uniforms.uNormal;
    shader.uniforms.uScale = uniforms.uScale;
    let source = spliced(
      shader.fragmentShader,
      '#include <common>',
      '#include <common>\nuniform vec3 uNormal;\nuniform float uScale;',
    );
    source = spliced(source, '#include <normal_fragment_begin>', inputSplice(testCase.input));
    if (output === 'normal') {
      source = spliced(
        source,
        '#include <opaque_fragment>',
        'outgoingLight = normal;\n#include <opaque_fragment>',
      );
    }
    shader.fragmentShader = source;
  };
  materials.set(key, made);
  return made;
}

function fragmentSourceOf(made: THREE.Material): string {
  const gl = renderer.getContext();
  const linked = (renderer.properties.get(made) as { currentProgram?: { program: WebGLProgram } })
    .currentProgram;
  for (const shader of linked ? (gl.getAttachedShaders(linked.program) ?? []) : []) {
    if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) {
      return gl.getShaderSource(shader) ?? '';
    }
  }
  return '';
}

/** Renders one case and returns the whole FloatType frame. */
function render(form: Form, output: Output, testCase: Case): Float32Array {
  if (testCase.normal) uniforms.uNormal.value.fromArray(testCase.normal);
  uniforms.uScale.value = testCase.scale ?? 0;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 4, 5);
  scene.add(sun);
  const made = material(form, testCase, output);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), made);
  // Tilted, so the geometry's own normal is not the (0, 0, 1) fallback.
  plane.rotation.x = -0.4;
  scene.add(plane);
  let camera: THREE.Camera;
  if (testCase.input === 'flatCloseUp') {
    const perspective = new THREE.PerspectiveCamera(50, 1, 1e-4, 10);
    perspective.position.set(0.001, 0.0015, 0.004);
    perspective.lookAt(0, 0, 0);
    camera = perspective;
  } else {
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    ortho.position.set(0, 0, testCase.backFace ? -5 : 5);
    ortho.lookAt(0, 0, 0);
    camera = ortho;
  }
  THREE.ShaderChunk.normal_fragment_begin = NORMAL_BEGIN[form];
  THREE.ShaderChunk.opaque_fragment = output === 'lit' ? GUARDED_OPAQUE : UNGUARDED_OPAQUE;
  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true, type: THREE.FloatType });
  const label = `${form} ${output} ${testCase.name}`;
  try {
    shaderError = null;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const out = new Float32Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, out);
    expect(shaderError, label).toBeNull();
    // The target clears to alpha 0 and the opaque draw writes 1: every texel was drawn.
    for (let texel = 0; texel < SIZE * SIZE; texel++) {
      expect(out[texel * 4 + 3], `${label} texel ${texel} alpha`).toBe(1);
    }
    // The chunk swap reached the program that actually linked.
    const key = materialKey(form, testCase, output);
    if (!linkedSources.has(key)) {
      const source = fragmentSourceOf(made);
      const markers = {
        new: [NEW_SMOOTH, NEW_FLAT],
        old: [OLD_SMOOTH, OLD_FLAT],
        stock: [
          'vec3 normal = normalize( vNormal );',
          'vec3 normal = normalize( cross( fdx, fdy ) );',
        ],
      }[form];
      expect(source.includes(testCase.input === 'smooth' ? markers[0] : markers[1]), label).toBe(
        true,
      );
      expect(source.includes('WOC_OPAQUE_NAN_GUARD'), label).toBe(output === 'lit');
      linkedSources.set(key, source);
    }
    return out;
  } finally {
    renderer.setRenderTarget(null);
    rt.dispose();
    THREE.ShaderChunk.normal_fragment_begin = SHIPPED_NORMAL_BEGIN;
    THREE.ShaderChunk.opaque_fragment = GUARDED_OPAQUE;
  }
}

const bits = (frame: Float32Array): number[] => Array.from(new Uint32Array(frame.buffer));
const rgbOf = (frame: Float32Array, texel: number): number[] =>
  Array.from(frame.slice(texel * 4, texel * 4 + 3));
const texels = (frame: Float32Array): number[][] =>
  Array.from({ length: SIZE * SIZE }, (_, texel) => rgbOf(frame, texel));

function describeNormals(frame: Float32Array): string {
  const rgb = texels(frame).flat();
  if (rgb.some(Number.isNaN)) return 'NaN';
  if (rgb.some((v) => !Number.isFinite(v))) return 'Inf';
  const fallback = texels(frame).every((n) => n[0] === 0 && n[1] === 0 && Math.abs(n[2]) === 1);
  return fallback ? 'fallback' : `other ${rgbOf(frame, 0).join(',')}`;
}

beforeAll(() => {
  expect(SHIPPED_NORMAL_BEGIN.split(NEW_SMOOTH).length - 1).toBe(1);
  expect(SHIPPED_NORMAL_BEGIN.split(NEW_FLAT).length - 1).toBe(1);
  expect(OLD_NORMAL_BEGIN).toContain(OLD_SMOOTH);
  expect(OLD_NORMAL_BEGIN).toContain(OLD_FLAT);
  expect(STOCK_NORMAL_BEGIN).not.toContain('> 0.0');
  expect(GUARDED_OPAQUE).toContain('floatBitsToUint');
  expect(UNGUARDED_OPAQUE).not.toContain('floatBitsToUint');
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program) => {
    shaderError = gl.getProgramInfoLog(program) || 'shader compile/link failed';
  };
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  adapter = String(
    dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  console.log(
    `[degenerate_normal_guard.browser] adapter: ${adapter} (software: ${isSoftwareRendererName(adapter)})`,
  );
});

afterAll(() => {
  for (const made of materials.values()) made.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
});

describe('degenerate-normal guard in real WebGL', () => {
  it.each(FINITE_CASES)('$name: renders the same bytes as the previous form', (testCase) => {
    for (const output of ['normal', 'lit'] as const) {
      const shipped = render('new', output, testCase);
      const previous = render('old', output, testCase);
      expect(
        shipped.every(Number.isFinite),
        `${testCase.name} ${output}: ${Array.from(shipped)}`,
      ).toBe(true);
      expect(bits(shipped), `${testCase.name} ${output}`).toEqual(bits(previous));
    }
    // The frame holds the normalized input, not the fallback or a cleared target.
    const normals = texels(render('new', 'normal', testCase));
    const expected = testCase.normal
      ? new THREE.Vector3().fromArray(testCase.normal).normalize().toArray()
      : null;
    for (const [texel, n] of normals.entries()) {
      const label = `${testCase.name} texel ${texel}: ${n}`;
      expect(Math.hypot(n[0], n[1], n[2]), label).toBeCloseTo(1, 5);
      if (expected) for (let i = 0; i < 3; i++) expect(n[i], label).toBeCloseTo(expected[i], 6);
      else expect(n, label).not.toEqual(FALLBACK);
    }
  });

  it.each(DEGENERATE_CASES)('$name: shades with the fallback normal', (testCase) => {
    const want = testCase.backFace ? [0, 0, -1] : FALLBACK;
    const normals = render('new', 'normal', testCase);
    for (const [texel, n] of texels(normals).entries()) {
      // + 0 folds -0 into 0: the flipped fallback's zero components may carry either sign.
      expect(
        n.map((v) => v + 0),
        `${testCase.name} texel ${texel}`,
      ).toEqual(want);
    }
    const lit = render('new', 'litRaw', testCase);
    for (const [texel, rgb] of texels(lit).entries()) {
      const label = `${testCase.name} texel ${texel}: ${rgb}`;
      expect(rgb.every(Number.isFinite), label).toBe(true);
      expect(
        rgb.some((v) => v > 0),
        label,
      ).toBe(true);
    }
    // Stock three must not land on the fallback, or the input was not degenerate.
    const stock = describeNormals(render('stock', 'normal', testCase));
    expect(stock, testCase.name).not.toBe('fallback');
    // Driver evidence only: what the previous form made of it.
    const previous = describeNormals(render('old', 'normal', testCase));
    console.log(
      `[degenerate_normal_guard.browser] ${testCase.name}: previous form ${previous}, stock ${stock} (adapter: ${adapter})`,
    );
  });
});
