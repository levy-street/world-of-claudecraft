import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { contactTexture } from '../src/render/ability_vfx/contact_assets';
import { ImpactFlipbooks } from '../src/render/ability_vfx/flipbooks';
import { flipbookSheet } from '../src/render/ability_vfx/fx_textures';
import type { WarriorFlashStyle } from '../src/render/ability_vfx/warrior_flash';

vi.mock('../src/render/ability_vfx/contact_assets', async () => {
  const three = await import('three');
  const texture = new three.Texture({ width: 512, height: 512 });
  return {
    contactTexture: vi.fn(() => texture),
    isContactSheet: (style: string) =>
      ['contact_cut', 'contact_crush', 'contact_pierce'].includes(style),
  };
});

vi.mock('../src/render/ability_vfx/fx_textures', async () => {
  const three = await import('three');
  const texture = new three.Texture({ width: 512, height: 512 });
  return {
    FLIPBOOK_GRID: 8,
    FLIPBOOK_STYLES: ['flame', 'shatter', 'electric', 'void', 'verdant', 'radiance'],
    flipbookSheet: vi.fn(() => texture),
  };
});

type ImpactMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
const pools: ImpactFlipbooks[] = [];
const camera = new THREE.Quaternion();
const styles = [
  ['warrior_steel_flash', 1],
  ['warrior_blood_flash', 2],
  ['warrior_storm_flash', 3],
  ['warrior_crush_flash', 4],
] as const;

it.each(styles)('expands %s reach without scaling ordinary contacts on pooled reuse', (style) => {
  const { pool, meshes } = fixture();
  pool.spawn(0, 1, 0, 8, 0xffffff, 4, style, 0.4);
  pool.spawn(0, 1, 0, 8, 0xffffff, 4, 'contact_cut', 0.4);
  pool.update(0.08, camera);
  const ordinary = meshes[1].scale.x;
  expect(meshes[0].scale.x).toBeCloseTo(ordinary * 1.7);
  expect(meshes[0].position.equals(meshes[1].position)).toBe(true);
  for (let i = 0; i < 5; i++) pool.spawn(0, 1, 0, 8, 0xffffff, 4, 'contact_cut', 0.4);
  pool.update(0.08, camera);
  expect(meshes[0].scale.x).toBeCloseTo(ordinary);
  expect(meshes[0].material.uniforms.uWarriorStyle.value).toBe(0);
  expect(meshes).toHaveLength(6);
});

function fixture() {
  const scene = new THREE.Scene();
  const pool = new ImpactFlipbooks(scene);
  pools.push(pool);
  const meshes = scene.children as ImpactMesh[];
  return { scene, pool, meshes };
}

function spawn(pool: ImpactFlipbooks, style: WarriorFlashStyle, duration = 0.4) {
  pool.spawn(2, 3, 5, 8, 0x63aadd, 4.5, style, duration, 0.35, 1.7);
}

afterEach(() => {
  for (const pool of pools) pool.dispose();
  pools.length = 0;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each(styles)(
  'routes %s through the existing pooled carrier with distinct style %i',
  (style, id) => {
    const { pool, meshes } = fixture();
    spawn(pool, style);
    const mesh = meshes[0];
    expect(mesh.visible).toBe(true);
    expect(mesh.position.toArray()).toEqual([2, 3, 5]);
    expect(mesh.material.blending).toBe(THREE.CustomBlending);
    expect(mesh.material.blendSrc).toBe(THREE.OneFactor);
    expect(mesh.material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(mesh.material.blendEquation).toBe(THREE.AddEquation);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.uniforms.uWarriorStyle.value).toBe(id);
    expect(mesh.material.uniforms.uHdr.value).toBe(4.5);
    expect(mesh.material.uniforms.uTint.value.getHex()).toBe(0x63aadd);
    expect(contactTexture).toHaveBeenCalledWith('contact_cut');
    expect(flipbookSheet).not.toHaveBeenCalled();
    pool.update(0.04, camera);
    expect(mesh.scale.x / mesh.scale.y).toBeCloseTo(1.7);
    expect(
      mesh.quaternion.angleTo(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35),
      ),
    ).toBeCloseTo(0);
  },
);

it.each(['contact_cut', 'flame', 'warrior_steel_flash'] as const)(
  'clears blood routing without changing the prepared blend state on reuse for %s',
  (style) => {
    const { pool, meshes } = fixture();
    for (let i = 0; i < 6; i++) spawn(pool, 'warrior_blood_flash');
    const material = meshes[0].material;
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.OneFactor);
    expect(material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(material.blendEquation).toBe(THREE.AddEquation);
    expect(material.uniforms.uWarriorStyle.value).toBe(2);
    pool.spawn(2, 3, 5, 8, 0xffffff, 4, style);
    expect(meshes[0].material).toBe(material);
    expect(material.uniforms.uWarriorStyle.value).toBe(style === 'warrior_steel_flash' ? 1 : 0);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.OneFactor);
    expect(material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(material.blendEquation).toBe(THREE.AddEquation);
    pool.update(0.05, camera);
    expect(material.uniforms.uWarriorStyle.value).toBe(style === 'warrior_steel_flash' ? 1 : 0);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrc).toBe(THREE.OneFactor);
    expect(material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(material.blendEquation).toBe(THREE.AddEquation);
    expect(meshes[0].visible).toBe(true);
  },
);

it.each([
  ['warrior_steel_flash', 0.7, 0.42],
  ['warrior_blood_flash', -1.1, -0.65],
  ['warrior_storm_flash', 1.9, 0],
  ['warrior_crush_flash', -0.4, 0.2],
] as const)('projects %s along the world strike under camera orbit', (style, facing, roll) => {
  const { pool, meshes } = fixture();
  pool.spawn(2, 3, 5, 8, 0x63aadd, 4.5, style, 1, roll, 1.7, 0, facing);
  const strike = new THREE.Vector3(
    Math.cos(facing) * Math.cos(roll),
    Math.sin(roll),
    -Math.sin(facing) * Math.cos(roll),
  );
  for (const view of [
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0.9, 0.14)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.62, -1.3, -0.2)),
  ]) {
    pool.update(0.05, view);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(view);
    const projectedStrike = strike.clone().addScaledVector(normal, -strike.dot(normal));
    expect(projectedStrike.length()).toBeGreaterThan(0.1);
    projectedStrike.normalize();
    const visibleAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(meshes[0].quaternion);
    const visibleNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(meshes[0].quaternion);
    expect(visibleAxis.dot(projectedStrike)).toBeCloseTo(1, 7);
    expect(visibleNormal.dot(normal)).toBeCloseTo(1, 7);
    expect(meshes[0].scale.x / meshes[0].scale.y).toBeCloseTo(1.7);
  }
});

it('keeps legacy screen roll under oblique camera rotations without a world facing', () => {
  const { pool, meshes } = fixture();
  const roll = -0.45;
  pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_steel_flash', 1, roll);
  pool.spawn(2, 3, 5, 8, 0xffffff, 1, 'contact_cut', 1, roll);
  for (const yaw of [0.9, -1.3]) {
    const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, yaw, 0.15));
    const expected = view
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    pool.update(0.05, view);
    for (const mesh of meshes.slice(0, 2)) {
      expect(mesh.quaternion.angleTo(expected)).toBeCloseTo(0);
    }
  }
});

it.each(['warrior_steel_flash', 'contact_cut'] as const)(
  'clears the old world-facing direction when a slot is reused for %s without it',
  (style) => {
    const { pool, meshes } = fixture();
    for (let i = 0; i < 6; i++) {
      pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_blood_flash', 1, 0.6, 1.3, 0, 1.2);
    }
    const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, -0.8, 0.1));
    pool.update(0.05, view);
    const prior = meshes[0].quaternion.clone();
    const roll = -0.3;
    pool.spawn(2, 3, 5, 8, 0xffffff, 4, style, 1, roll);
    pool.update(0.05, view);
    const expected = view
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    expect(prior.angleTo(expected)).toBeGreaterThan(0.1);
    expect(meshes[0].quaternion.angleTo(expected)).toBeCloseTo(0);
  },
);

it('falls back to the authored roll when the world strike points directly at the camera', () => {
  const { pool, meshes } = fixture();
  const facing = 0.7,
    roll = 0.4;
  const strike = new THREE.Vector3(
    Math.cos(facing) * Math.cos(roll),
    Math.sin(roll),
    -Math.sin(facing) * Math.cos(roll),
  );
  const view = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), strike);
  const expected = view
    .clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_steel_flash', 1, roll, 1, 0, facing);
  pool.update(0.05, view);
  expect(meshes[0].quaternion.toArray().every(Number.isFinite)).toBe(true);
  expect(meshes[0].quaternion.length()).toBeCloseTo(1);
  expect(meshes[0].quaternion.angleTo(expected)).toBeCloseTo(0);
});

it('retains the last valid projected roll when an orbit makes the strike camera end-on', () => {
  const { pool, meshes } = fixture();
  const facing = 0.7,
    roll = 0.4;
  const firstView = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, -0.8, 0.1));
  pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_steel_flash', 1, roll, 1.7, 0, facing);
  pool.update(0.05, firstView);
  const retainedRotation = firstView.clone().invert().multiply(meshes[0].quaternion);
  const authoredRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    roll,
  );
  expect(retainedRotation.angleTo(authoredRotation)).toBeGreaterThan(0.1);
  const strike = new THREE.Vector3(
    Math.cos(facing) * Math.cos(roll),
    Math.sin(roll),
    -Math.sin(facing) * Math.cos(roll),
  );
  const endOnView = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), strike);
  const expected = endOnView.clone().multiply(retainedRotation);
  for (let i = 0; i < 2; i++) {
    pool.update(0.05, endOnView);
    expect(meshes[0].quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(meshes[0].quaternion.angleTo(expected)).toBeCloseTo(0);
  }
});

it('reconstructs projected world-down from gravity UVs despite camera, strike roll and aspect', () => {
  const { pool, meshes } = fixture();
  pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_blood_flash', 1, -0.65, 2.3, 0, -1.1);
  pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_steel_flash', 1, 0.72, 0.6, 0, 0.7);
  const worldDown = new THREE.Vector3(0, -1, 0);
  for (const view of [
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0.9, 0.14)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.62, -1.3, -0.2)),
  ]) {
    pool.update(0.05, view);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(view);
    const projectedDown = worldDown.clone().addScaledVector(normal, -worldDown.dot(normal));
    expect(projectedDown.length()).toBeGreaterThan(0.1);
    for (const mesh of meshes.slice(0, 2)) {
      const down = mesh.material.uniforms.uWarriorDown.value as THREE.Vector2;
      expect(down.toArray().every(Number.isFinite)).toBe(true);
      const reconstructed = new THREE.Vector3(
        down.x * (mesh.scale.x / mesh.scale.y),
        down.y,
        0,
      ).applyQuaternion(mesh.quaternion);
      expect(reconstructed.distanceTo(projectedDown)).toBeLessThan(1e-8);
      expect(reconstructed.dot(worldDown)).toBeGreaterThan(0);
    }
  }
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  'uses finite legacy orientation for invalid world facing %s',
  (facing) => {
    const { pool, meshes } = fixture();
    const roll = 0.35;
    const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0.8, 0.1));
    const expected = view
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_steel_flash', 1, roll, 1, 0, facing);
    pool.update(0.05, view);
    expect(meshes[0].quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(meshes[0].quaternion.length()).toBeCloseTo(1);
    expect(meshes[0].quaternion.angleTo(expected)).toBeCloseTo(0);
  },
);

it('reuses six prepared quads and their materials under sustained overlapping impacts', () => {
  const { pool, scene, meshes } = fixture();
  const original = meshes.slice();
  const materials = original.map((mesh) => mesh.material);
  const geometry = original[0].geometry;
  expect(original).toHaveLength(6);
  for (let i = 0; i < 64; i++) {
    spawn(pool, styles[i % styles.length][0], 0.5);
    pool.update(0.001, camera);
  }
  expect(scene.children).toEqual(original);
  expect(meshes.filter((mesh) => mesh.visible)).toHaveLength(6);
  for (let i = 0; i < meshes.length; i++) {
    expect(meshes[i].material).toBe(materials[i]);
    expect(meshes[i].geometry).toBe(geometry);
  }
});

it('binds the actual terrain height for Warrior light and resets it on ordinary slot reuse', () => {
  const { pool, meshes } = fixture();
  for (let i = 0; i < 6; i++) {
    pool.spawn(2, 13, 5, 8, 0xffffff, 4, 'warrior_steel_flash', 0.4, 0, 1, 11.7);
    expect(meshes[i].material.uniforms.uWarriorFloor.value).toBe(11.7);
  }
  pool.spawn(2, 3, 5, 8, 0xffffff, 1, 'contact_cut');
  expect(meshes[0].material.uniforms.uWarriorFloor.value).toBe(-1e6);
  pool.spawn(2, 3, 5, 8, 0xffffff, 4, 'warrior_steel_flash', 0.4, 0, 1, Number.NaN);
  expect(meshes[1].material.uniforms.uWarriorFloor.value).toBe(-1e6);
  pool.spawn(2, 11.82, 5, 8, 0xffffff, 4, 'warrior_crush_flash', 0.4, 0, 1, 11.7);
  const uniforms = meshes[2].material.uniforms;
  const width = uniforms.uWarriorFloorBlend.value;
  expect(width).toBeCloseTo(0.18);
  const fraction = (11.82 - uniforms.uWarriorFloor.value - 0.03) / (width - 0.03);
  expect(THREE.MathUtils.smoothstep(fraction, 0, 1)).toBeGreaterThan(0.6);
});

it('clears Warrior routing and phase when a pooled slot returns to an ordinary contact sheet', () => {
  const { pool, meshes } = fixture();
  for (let i = 0; i < 6; i++) spawn(pool, styles[i % styles.length][0]);
  pool.update(0.08, camera);
  for (const mesh of meshes) expect(mesh.material.uniforms.uWarriorPhase.value).toBeGreaterThan(0);
  for (let i = 0; i < 6; i++) pool.spawn(0, 1, 0, 2, 0xffffff, 1.2, 'contact_cut', 0.3);
  for (const mesh of meshes) {
    expect(mesh.material.uniforms.uWarriorStyle.value).toBe(0);
    expect(mesh.material.uniforms.uWarriorPhase.value).toBe(0);
    expect(mesh.material.uniforms.uFrame.value).toBe(0);
    expect(mesh.material.uniforms.uHdr.value).toBe(1.2);
    expect(mesh.material.uniforms.uOpacity.value).toBe(1);
  }
  pool.update(0.03, camera);
  for (const mesh of meshes) expect(mesh.material.uniforms.uFrame.value).toBeGreaterThan(0);
});

it('freezes the reduced-motion Warrior shape while preserving its fade and expiry', () => {
  const { pool, meshes } = fixture();
  for (const [style] of styles) spawn(pool, style, 1);
  pool.update(0.1, camera, true);
  const snapshots = meshes.slice(0, 4).map((mesh) => ({
    phase: mesh.material.uniforms.uWarriorPhase.value,
    scale: mesh.scale.clone(),
    rotation: mesh.quaternion.clone(),
  }));
  pool.update(0.3, camera, true);
  for (let i = 0; i < snapshots.length; i++) {
    expect(meshes[i].material.uniforms.uWarriorPhase.value).toBe(snapshots[i].phase);
    expect(meshes[i].scale.equals(snapshots[i].scale)).toBe(true);
    expect(meshes[i].quaternion.equals(snapshots[i].rotation)).toBe(true);
    expect(meshes[i].visible).toBe(true);
  }
  pool.update(0.4, camera, true);
  for (const mesh of meshes.slice(0, 4)) {
    expect(mesh.material.uniforms.uOpacity.value).toBeGreaterThan(0);
    expect(mesh.material.uniforms.uOpacity.value).toBeLessThan(1);
  }
  pool.update(0.21, camera, true);
  expect(meshes.some((mesh) => mesh.visible)).toBe(false);
});

it('progresses normal Warrior motion and leaves ordinary sheet motion unaffected by reduced motion', () => {
  const { pool, meshes } = fixture();
  spawn(pool, 'warrior_steel_flash', 1);
  pool.update(0.1, camera);
  const phase = meshes[0].material.uniforms.uWarriorPhase.value;
  const size = meshes[0].scale.x;
  pool.update(0.2, camera);
  expect(meshes[0].material.uniforms.uWarriorPhase.value).toBeGreaterThan(phase);
  expect(meshes[0].scale.x).toBeGreaterThan(size);
  pool.spawn(0, 1, 0, 2, 0xffffff, 1.2, 'contact_cut', 1);
  pool.update(0.1, camera, true);
  const frame = meshes[1].material.uniforms.uFrame.value;
  const ordinarySize = meshes[1].scale.x;
  pool.update(0.2, camera, true);
  expect(meshes[1].material.uniforms.uFrame.value).toBeGreaterThan(frame);
  expect(meshes[1].scale.x).toBeGreaterThan(ordinarySize);
});

it('expires and clears active impacts without reviving them on subsequent updates', () => {
  const { pool, meshes } = fixture();
  spawn(pool, 'warrior_crush_flash', 0.2);
  pool.update(0.21, camera);
  expect(meshes.some((mesh) => mesh.visible)).toBe(false);
  spawn(pool, 'warrior_blood_flash', 1);
  expect(meshes.some((mesh) => mesh.visible)).toBe(true);
  pool.clear();
  pool.update(0.01, camera);
  expect(meshes.some((mesh) => mesh.visible)).toBe(false);
  spawn(pool, 'warrior_storm_flash', 0.4);
  expect(meshes.filter((mesh) => mesh.visible)).toHaveLength(1);
});

it('disposes owned resources once and ignores late spawns without disposing the shared texture', () => {
  const { pool, scene, meshes } = fixture();
  spawn(pool, 'warrior_steel_flash');
  const materialDisposals = meshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'));
  const geometryDisposal = vi.spyOn(meshes[0].geometry, 'dispose');
  const textureDisposal = vi.spyOn(contactTexture('contact_cut')!, 'dispose');
  pool.dispose();
  pool.dispose();
  spawn(pool, 'warrior_storm_flash');
  pool.update(0.01, camera);
  pool.clear();
  expect(scene.children).toHaveLength(0);
  for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledTimes(1);
  expect(geometryDisposal).toHaveBeenCalledTimes(1);
  expect(textureDisposal).not.toHaveBeenCalled();
});

it('tracks default, byte and floating targets through pooled render reuse', () => {
  const { scene, meshes } = fixture();
  const mesh = meshes[0];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = { getRenderTarget: () => target } as THREE.WebGLRenderer;
  const render = () =>
    mesh.onBeforeRender(renderer, scene, new THREE.Camera(), mesh.geometry, mesh.material, null!);
  render();
  expect(mesh.material.uniforms.uLowRangeTarget.value).toBe(1);
  for (const [type, expected] of [
    [THREE.UnsignedByteType, 1],
    [THREE.HalfFloatType, 0],
    [THREE.FloatType, 0],
  ] as const) {
    target = new THREE.WebGLRenderTarget(1, 1, { type });
    render();
    expect(mesh.material.uniforms.uLowRangeTarget.value).toBe(expected);
    target.dispose();
  }
  target = null;
  render();
  expect(mesh.material.uniforms.uLowRangeTarget.value).toBe(1);
});
