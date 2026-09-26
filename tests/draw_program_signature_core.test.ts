// drawProgramSignature: one string per PROGRAM a (material, object) draw links,
// so a pool of per-slot clones collapses to one compile unit while any two
// draws three would link as different programs stay apart. Every case is
// checked against three's own program cache key (tests/helpers/
// three_program_keys.ts, the pinned WebGLPrograms over a stub renderer): a
// signature that merged two keys would let the cast gate open on a program
// that never linked. One case per axis, each pair differing in that axis only.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachBiomeHaze } from '../src/render/biome_haze_field';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { threeProgramKeys } from './helpers/three_program_keys';

type Draw = { object: THREE.Object3D; material: THREE.Material };
type Pair = () => [Draw, Draw];

const plane: THREE.BufferGeometry = new THREE.PlaneGeometry(1, 1);
const on = (object: THREE.Object3D, material: THREE.Material): Draw => ({ object, material });
const mesh = (material: THREE.Material, geometry = plane): Draw =>
  on(new THREE.Mesh(geometry, material), material);
const sig = (draw: Draw): string => drawProgramSignature(draw.object, draw.material);
const key = (draw: Draw): string => threeProgramKeys(draw.material, draw.object);
const basic = (params: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...params });
const tex = (patch: Record<string, unknown> = {}): THREE.Texture =>
  Object.assign(new THREE.Texture(), patch);
const geo = (edit: (geometry: THREE.BufferGeometry) => void): THREE.BufferGeometry => {
  const geometry = plane.clone();
  edit(geometry);
  return geometry;
};
const hooked = (cacheKey: string, body: string): THREE.Material => {
  const material = basic();
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = `// ${body}\n${shader.fragmentShader}`;
  };
  material.customProgramCacheKey = () => cacheKey;
  return material;
};
const shader = (patch: Record<string, unknown> = {}): THREE.ShaderMaterial =>
  Object.assign(new THREE.ShaderMaterial({ vertexShader: 'void main() {}' }), patch);
const points = (material: THREE.Material, geometry = plane): Draw =>
  on(new THREE.Points(geometry, material), material);
const vertexColored = basic({ vertexColors: true });
const lit = (params: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial(params);

/** Pairs three links as two programs: the signature must keep them apart. */
// biome-ignore format: one axis per row
const SPLITS: Array<[string, Pair]> = [
  ['transparency', () => [mesh(basic()), mesh(basic({ transparent: false }))]],
  ['blending', () => [mesh(basic({ transparent: false })), mesh(basic({ transparent: false, blending: THREE.AdditiveBlending }))]],
  ['points vs mesh', () => [points(new THREE.PointsMaterial()), mesh(basic())]],
  ['toneMapped', () => [mesh(basic()), mesh(basic({ toneMapped: false }))]],
  ['wireframe', () => [mesh(lit({ flatShading: true })), mesh(lit({ flatShading: true, wireframe: true }))]],
  ['uv channel', () => [mesh(basic({ map: tex() })), mesh(basic({ map: tex({ channel: 1 }) }))]],
  ['precision', () => [mesh(basic()), mesh(Object.assign(basic(), { precision: 'lowp' }))]],
  ['sizeAttenuation', () => [points(new THREE.PointsMaterial()), points(new THREE.PointsMaterial({ sizeAttenuation: false }))]],
  ['normalMapType', () => [mesh(lit({ normalMap: tex() })), mesh(lit({ normalMap: tex(), normalMapType: THREE.ObjectSpaceNormalMap }))]],
  ['packed normal map', () => [mesh(lit({ normalMap: tex() })), mesh(lit({ normalMap: tex({ format: THREE.RGFormat }) }))]],
  ['video map', () => [mesh(basic({ map: tex({ colorSpace: THREE.SRGBColorSpace }) })), mesh(basic({ map: tex({ colorSpace: THREE.SRGBColorSpace, isVideoTexture: true }) }))]],
  ['video emissive map', () => [mesh(lit({ emissiveMap: tex({ colorSpace: THREE.SRGBColorSpace }) })), mesh(lit({ emissiveMap: tex({ colorSpace: THREE.SRGBColorSpace, isVideoTexture: true }) }))]],
  ['combine', () => [mesh(basic()), mesh(basic({ combine: THREE.MixOperation }))]],
  ['matcap', () => [mesh(new THREE.MeshMatcapMaterial()), mesh(new THREE.MeshMatcapMaterial({ matcap: tex() }))]],
  ['depthPacking', () => [mesh(new THREE.MeshDepthMaterial()), mesh(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }))]],
  ...['anisotropy', 'clearcoat', 'dispersion', 'iridescence', 'sheen', 'transmission'].map(
    (scalar): [string, Pair] => [scalar, () => [mesh(new THREE.MeshPhysicalMaterial()), mesh(new THREE.MeshPhysicalMaterial({ [scalar]: 0.5 }))]],
  ),
  ['forceSinglePass', () => [mesh(basic({ side: THREE.DoubleSide })), mesh(basic({ side: THREE.DoubleSide, forceSinglePass: true }))]],
  ['hook key', () => [mesh(hooked('a', 'rim')), mesh(hooked('b', 'rim'))]],
  ['hooked vs plain', () => [mesh(basic()), mesh(hooked('a', 'rim'))]],
  ['zone haze hook', () => { const hazed = basic(); attachBiomeHaze(hazed); return [mesh(basic()), mesh(hazed)]; }],
  ['shader source', () => [mesh(shader()), mesh(shader({ fragmentShader: 'void main() { gl_FragColor = vec4(0.5); }' }))]],
  ['shader defines', () => [mesh(shader()), mesh(shader({ defines: { USE_RIM: '' } }))]],
  ['raw shader', () => [mesh(shader()), mesh(Object.assign(new THREE.RawShaderMaterial(), { vertexShader: 'void main() {}' }))]],
  ['pointsUvs', () => { const mapped = new THREE.PointsMaterial({ map: tex() }); return [points(mapped), points(mapped, geo((g) => g.deleteAttribute('uv')))]; }],
  ['instancing', () => [mesh(vertexColored), on(new THREE.InstancedMesh(plane, vertexColored, 4), vertexColored)]],
  ['instanced morph texture', () => { const a = new THREE.InstancedMesh(plane, vertexColored, 4); const b = new THREE.InstancedMesh(plane, vertexColored, 4); b.morphTexture = new THREE.DataTexture(); return [on(a, vertexColored), on(b, vertexColored)]; }],
  ['batched colours', () => { const a = new THREE.BatchedMesh(1, 4, 6, vertexColored); const b = new THREE.BatchedMesh(1, 4, 6, vertexColored); Object.assign(b, { _colorsTexture: new THREE.DataTexture() }); return [on(a, vertexColored), on(b, vertexColored)]; }],
  ['skinning', () => [mesh(vertexColored), on(new THREE.SkinnedMesh(plane, vertexColored), vertexColored)]],
  ['normals', () => [mesh(vertexColored), mesh(vertexColored, geo((g) => g.deleteAttribute('normal')))]],
  ['vertex alpha', () => [mesh(vertexColored, geo((g) => g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(12), 3)))), mesh(vertexColored, geo((g) => g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(16), 4))))]],
  ['morph positions', () => [mesh(vertexColored), mesh(vertexColored, geo((g) => { g.morphAttributes.position = [plane.attributes.position.clone()]; }))]],
  ['morph normal presence', () => [mesh(basic()), mesh(basic(), geo((g) => { g.morphAttributes.normal = []; }))]],
  ['morph colour presence', () => [mesh(basic()), mesh(basic(), geo((g) => { g.morphAttributes.color = []; }))]],
  ['position presence', () => [mesh(basic()), mesh(basic(), geo((g) => g.deleteAttribute('position')))]],
];

/** Axes the signature splits although the oracle cannot see them (no env
 *  map, no extensions, fixed clipping in the stub), or although three shares
 *  one program (`threeSame`: the draw kind, glslVersion; an extra unit is an
 *  idle slot and a cache hit). */
// biome-ignore format: one axis per row
const SIGNATURE_ONLY: Array<[string, Pair, boolean]> = [
  ['env map mapping', () => [mesh(basic({ envMap: tex({ mapping: THREE.CubeReflectionMapping }) })), mesh(basic({ envMap: tex({ mapping: THREE.EquirectangularReflectionMapping }) }))], false],
  ['clip-cull extension', () => [mesh(shader()), mesh(shader({ extensions: { clipCullDistance: true } }))], false],
  ['multi-draw extension', () => [mesh(shader()), mesh(shader({ extensions: { multiDraw: true } }))], false],
  ['local clipping planes', () => [mesh(basic()), mesh(basic({ clippingPlanes: [new THREE.Plane()] }))], false],
  ['glslVersion', () => [mesh(shader()), mesh(shader({ glslVersion: THREE.GLSL3 }))], true],
  ['line vs mesh kind', () => { const line = new THREE.LineBasicMaterial(); return [on(new THREE.LineSegments(plane, line), line), mesh(line)]; }, true],
];

/** Pairs three links as ONE program: the signature must fold them. */
// biome-ignore format: one axis per row
const FOLDS: Array<[string, Pair]> = [
  ['uniforms, texture instances and name', () => { const proto = basic({ color: 0x7a3cff, map: tex() }); const clone = Object.assign(proto.clone(), { opacity: 0.2, map: tex(), name: 'slot-7' }); clone.color.set(0xff2040); return [mesh(proto), mesh(clone)]; }],
  ['geometry with the same attribute set', () => [mesh(basic()), mesh(basic(), new THREE.RingGeometry(0.5, 1, 32))]],
  ['one hook key over two hook bodies', () => [mesh(hooked('a', 'rim')), mesh(hooked('a', 'glow'))]],
  ['two zone-hazed instances', () => { const [a, b] = [basic(), basic()]; attachBiomeHaze(a); attachBiomeHaze(b); return [mesh(a), mesh(b)]; }],
  ['shader uniforms', () => [mesh(shader()), mesh(shader({ uniforms: { uTint: { value: new THREE.Color(0xff0000) } } }))]],
];

describe('drawProgramSignature', () => {
  it.each(SPLITS)('splits on %s, where three links two programs', (_, pair) => {
    const [a, b] = pair();
    expect(key(a), 'three keys them as two programs').not.toBe(key(b));
    expect(sig(a)).not.toBe(sig(b));
  });

  it.each(SIGNATURE_ONLY)('splits on %s, which the oracle does not key', (_, pair, threeSame) => {
    const [a, b] = pair();
    if (threeSame) expect(key(a)).toBe(key(b));
    expect(sig(a)).not.toBe(sig(b));
  });

  it.each(FOLDS)('folds %s into one program', (_, pair) => {
    const [a, b] = pair();
    expect(key(a), 'three keys them as one program').toBe(key(b));
    expect(sig(a)).toBe(sig(b));
  });

  it('the oracle resets the sticky precision: a lowp key does not re-key the next draw', () => {
    const base = mesh(basic());
    const first = key(base);
    key(mesh(Object.assign(basic(), { precision: 'lowp' })));
    expect(key(base)).toBe(first);
  });
});
