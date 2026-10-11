import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorAreaContact } from '../src/render/ability_vfx/warrior_area';
import { warriorImpactFan } from '../src/render/ability_vfx/warrior_impact_fan';
import { warriorShearPhase } from '../src/render/ability_vfx/warrior_impact_material';
import { drawWarriorLeapLanding } from '../src/render/ability_vfx/warrior_leap';
import { preparedFragments } from './helpers/prepared_fragments';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const three = await import('three');
  const texture = new three.Texture();
  const geometry = new three.IcosahedronGeometry(1, 0);
  return { bakedTexture: () => texture, fragmentGeometry: () => geometry };
});

it('honors spirit tint only on steel-family sprites and preserves approved blood playback', () => {
  const scene = new THREE.Scene();
  const pool = new BakedImpactLayers(scene, () => true);
  for (const kind of ['warrior_shear', 'harvest_impact', 'smoke'] as const)
    expect(pool.spawn(kind, 0, 2, 0, 8, 0x65b9e1, 0xffffff, 0.25, 0, 0, 0)).toBe(true);
  const meshes = scene.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  pool.update(0.025, new THREE.Quaternion(), false);
  expect(meshes[0].material.uniforms.uMaterialTint.value).toBe(1);
  expect(meshes[0].material.uniforms.uTint.value.getHex()).toBe(0x65b9e1);
  expect(meshes[0].material.uniforms.uFrame.value).toBeCloseTo(warriorShearPhase(0.1) * 63);
  for (const mesh of meshes.slice(1, 3)) {
    expect(mesh.material.uniforms.uMaterialTint.value).toBe(0);
    expect(mesh.material.uniforms.uFrame.value).toBeCloseTo(6.3);
  }
  pool.update(0.025, new THREE.Quaternion(), true);
  for (const mesh of meshes.slice(0, 3))
    expect(mesh.material.uniforms.uFrame.value).toBeCloseTo(0.36 * 63);
  pool.dispose();
});

it('keeps steel breakup continuous, forward-only and within the original lifetime', () => {
  let prior = -1;
  for (let i = 0; i <= 100; i++) {
    const phase = warriorShearPhase(i / 100);
    expect(phase).toBeGreaterThanOrEqual(prior);
    expect(phase).toBeLessThanOrEqual(1);
    prior = phase;
  }
  expect(warriorShearPhase(0)).toBe(0);
  expect(warriorShearPhase(1)).toBe(1);
  expect(warriorShearPhase(0.18)).toBeCloseTo(0.3);
  expect(warriorShearPhase(0.72)).toBeCloseTo(0.72);
});

it('throws varied metal chips far enough to read while preserving shared pool limits and default fragments', async () => {
  const scene = new THREE.Scene();
  const pool = await preparedFragments(scene);
  const mesh = scene.children.find(
    (n) => n.name === 'solidImpact:metal_splinter',
  ) as THREE.Mesh<THREE.InstancedBufferGeometry>;
  const burst = (fractured: boolean) =>
    pool.burst('metal_splinter', 0, 2, 0, 0xd6e2eb, 14, 1.6, 0, 1, () => 0, 0.28, fractured);
  expect(burst(true)).toBe(14);
  const velocity = mesh.geometry.getAttribute('aVelocity');
  const shape = mesh.geometry.getAttribute('aShape');
  const travel = Array.from(
    { length: 14 },
    (_, i) => Math.hypot(velocity.getX(i), velocity.getZ(i)) * 0.2,
  );
  expect(Math.max(...travel)).toBeGreaterThan(2.8);
  expect(new Set(Array.from({ length: 14 }, (_, i) => shape.getY(i))).size).toBe(4);
  expect(burst(true)).toBe(14);
  expect(burst(true)).toBe(4);
  expect(burst(true)).toBe(0);
  expect(mesh.geometry.instanceCount).toBe(32);
  pool.clear();
  expect(burst(false)).toBe(14);
  for (let i = 0; i < 14; i++) expect(shape.getY(i)).toBe(1);
  pool.update(0.29, true);
  expect(mesh.visible).toBe(false);
  pool.dispose();
});

it('keeps unequal receiving exits at their original contact after scratch reuse, and yields to occupied ribbons', () => {
  const pathRibbon = vi.fn<SequencerHost['pathRibbon']>(() => true);
  const host = { pathRibbon } as unknown as SequencerHost;
  const at = { x: 2, y: 3, z: 5 };
  expect(warriorImpactFan(host, at, 0.7, -0.3, 4, 0xc5d5e1)).toBe(2);
  const sample = () =>
    pathRibbon.mock.calls.map((call) => {
      expect(call[6]).toBe(true);
      expect(call[7]).toBe(0);
      const points = Array.from({ length: 25 }, () => new THREE.Vector3());
      expect(call[3](points)).toBe(25);
      return points;
    });
  const first = sample();
  expect(first[1][24].distanceTo(first[1][0])).toBeGreaterThan(
    first[0][24].distanceTo(first[0][0]),
  );
  Object.assign(at, { x: 900, y: 100, z: -500 });
  expect(sample()).toEqual(first);
  pathRibbon.mockReturnValue(false);
  expect(warriorImpactFan(host, at, 0, 0, 4, 0xc5d5e1)).toBe(0);
});

it('reserves the last available area ribbon for the enemy imprint when the atlas pool rejects', () => {
  let free = 1;
  const admitted: Parameters<SequencerHost['pathRibbon']>[] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, _height: number, out: THREE.Vector3) =>
        Object.assign(out, { x: 0, y: 1, z: id === 1 ? 0 : 3 }),
      facingAt: () => 0,
      bakedAt: vi.fn(() => false),
      pathRibbon: vi.fn<SequencerHost['pathRibbon']>((...args) => {
        if (!free) return false;
        free--;
        admitted.push(args);
        return true;
      }),
    },
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as unknown as SequencerHost;
  expect(drawWarriorAreaContact(host, 'cleave', 1, 2, 1, 1)).toBe(true);
  expect(admitted).toHaveLength(1);
  expect(admitted[0][9]).toBe(true);
  expect(host.contact).toHaveBeenCalledTimes(1);
  expect(host.pathRibbon).toHaveBeenCalledTimes(3);
});

it('keeps short-lived metal at the impact when distant terrain rises beyond its visible trajectory', async () => {
  const scene = new THREE.Scene();
  const pool = await preparedFragments(scene);
  const ground = vi.fn((x: number, z: number) => (Math.hypot(x, z) > 6 ? 30 : 0));
  expect(pool.burst('metal_splinter', 0, 2, 0, 0xffffff, 14, 1.6, 0, 1, ground, 0.28, true)).toBe(
    14,
  );
  const mesh = scene.children.find(
    (n) => n.name === 'solidImpact:metal_splinter',
  ) as THREE.Mesh<THREE.InstancedBufferGeometry>;
  const origins = mesh.geometry.getAttribute('aOrigin');
  for (let i = 0; i < 14; i++) expect(origins.getY(i)).toBe(2);
  for (const [x, z] of ground.mock.calls) expect(Math.hypot(x, z)).toBeLessThan(6);
  pool.dispose();
});

it('admits debris on all four sides of a landing inside the real fixed pool', async () => {
  const scene = new THREE.Scene();
  const pool = await preparedFragments(scene);
  const host = new Proxy(
    {
      groundYAt: () => 0,
      fragmentsAt: vi.fn<NonNullable<SequencerHost['fragmentsAt']>>(
        (kind, x, y, z, color, count, power, dx, dz, life, fractured) =>
          pool.burst(kind, x, y, z, color, count, power, dx, dz, () => 0, life, fractured),
      ),
    },
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as unknown as SequencerHost;
  drawWarriorLeapLanding(host, 0, 0, 6, 0);
  const mesh = scene.children.find(
    (n) => n.name === 'solidImpact:stone_chip',
  ) as THREE.Mesh<THREE.InstancedBufferGeometry>;
  const life = mesh.geometry.getAttribute('aLife');
  const origin = mesh.geometry.getAttribute('aOrigin');
  const velocity = mesh.geometry.getAttribute('aVelocity');
  const directions = new Set<number>();
  let admitted = 0;
  let outward = 0;
  for (let i = 0; i < life.count; i++) {
    if (life.getY(i) <= 0) continue;
    admitted++;
    directions.add(
      (Math.round(Math.atan2(origin.getX(i), origin.getZ(i)) / (Math.PI / 2)) + 4) % 4,
    );
    const dot = origin.getX(i) * velocity.getX(i) + origin.getZ(i) * velocity.getZ(i);
    expect(Number.isFinite(dot)).toBe(true);
    outward += dot;
  }
  expect(admitted).toBe(30);
  expect(directions.size).toBe(4);
  expect(outward).toBeGreaterThan(0);
  expect(life.count).toBe(32);
  pool.update(0.63, false);
  expect(mesh.visible).toBe(false);
  for (const tier of [1, 2]) {
    vi.mocked(host.fragmentsAt!).mockClear();
    drawWarriorLeapLanding(host, 0, 0, 6, tier);
    expect(host.fragmentsAt).not.toHaveBeenCalled();
  }
  pool.dispose();
});
