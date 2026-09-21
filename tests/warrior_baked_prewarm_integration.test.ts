import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import {
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import * as assets from '../src/render/ability_vfx/production_assets';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function fixture(cls: string, warriorTextures = true) {
  const scene = new THREE.Scene();
  const names = [
    'blood',
    'steel',
    'pressure',
    'rock',
    'warrior_power',
    'warrior_fervor',
    'harvest_impact',
    'warrior_bite',
    'warrior_shear',
    'warrior_crush',
  ] as const;
  const textures = new Map<string, THREE.Texture>(names.map((name) => [name, new THREE.Texture()]));
  const smoke = new THREE.Texture();
  const uploaded = new Set<THREE.Texture>();
  const texture = (name: string) => (warriorTextures ? (textures.get(name) ?? null) : null);
  vi.spyOn(assets, 'warriorBloodTexture').mockImplementation(() => texture('blood'));
  vi.spyOn(assets, 'warriorSteelTexture').mockImplementation(() => texture('steel'));
  vi.spyOn(assets, 'warriorPressureTexture').mockImplementation(() => texture('pressure'));
  vi.spyOn(assets, 'warriorRockTexture').mockImplementation(() => texture('rock'));
  const bakedTexture = vi
    .spyOn(assets, 'bakedTexture')
    .mockImplementation((kind) => (kind === 'smoke' ? smoke : texture(kind)));
  const pool = new BakedImpactLayers(scene, (value) => uploaded.has(value));
  const live = scene.children.slice() as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  const poolUnits = vi.spyOn(pool, 'units');
  // Exercise the production dispatch method and real baked pool. Unrelated
  // families are empty collaborators; no canvas or other-family GPU setup.
  const empty = () => ({ units: vi.fn(() => []) });
  const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
  Object.assign(fx, {
    crests: { preparation: empty() },
    guards: empty(),
    powerForms: empty(),
    spiritHammers: empty(),
    furyStates: empty(),
    baked: pool,
  });
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const seenSlots = new Set<THREE.BufferGeometry>();
  const host = {
    properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
    compile: vi.fn(async () => {
      expect(uploaded.size).toBe(10);
    }),
    draw: vi.fn((_group: THREE.Group, root: THREE.Object3D) => {
      expect(uploaded.size).toBe(10);
      const mesh = root as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      expect(
        live.some((slot) => slot.geometry === mesh.geometry && slot.material === mesh.material),
      ).toBe(true);
      expect(mesh.material.uniforms.uMap.value).toBe(textures.get('harvest_impact'));
      seenSlots.add(mesh.geometry);
    }),
  };
  type Job = {
    work: PrewarmResumeUnit['run'];
    resolve(): void;
    reject(reason: unknown): void;
    label: string;
  };
  const jobs: Job[] = [];
  const labels: string[] = [];
  const queue = {
    run: vi.fn((work: PrewarmResumeUnit['run'], priority: number, label: string) => {
      expect(priority).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
      labels.push(label);
      return new Promise<void>((resolve, reject) => jobs.push({ work, resolve, reject, label }));
    }),
  };
  const upload = vi.fn((value: THREE.Texture) => {
    uploaded.add(value);
  });
  const entry = activeKitPrewarmEntry(scene, cls, {
    queue: queue as unknown as Pick<BackgroundGpuQueue, 'run'>,
    geometry: (kinds) => fx.authoredPrewarmUnits(host, kinds),
    texture: upload,
  });
  async function next() {
    expect(jobs).toHaveLength(1);
    const job = jobs.shift();
    if (!job) throw new Error('Expected a queued preparation unit');
    try {
      await job.work();
      job.resolve();
    } catch (error) {
      job.reject(error);
      throw error;
    }
    await Promise.resolve();
  }
  cleanups.push(() => {
    cancelActiveAbilityKit(scene);
    pool.dispose();
    for (const value of textures.values()) value.dispose();
    smoke.dispose();
  });
  const spawn = (kind: 'warrior_shear' | 'warrior_crush' | 'warrior_fervor') =>
    pool.spawn(kind, 0, 1, 0, 4, 0xffffff, 0xffffff, 0.2, 0, 0, 0);
  return {
    scene,
    textures,
    host,
    seenSlots,
    fx,
    pool,
    poolUnits,
    bakedTexture,
    jobs,
    labels,
    queue,
    upload,
    entry,
    next,
    spawn,
  };
}

it.each(['warrior_shear', 'warrior_crush', 'warrior_fervor'] as const)(
  'routes a selected Warrior through texture uploads and awaits every actual baked slot for %s',
  async (kind) => {
    const h = fixture('mage');
    let complete = false;
    const task = ensureActiveAbilityKit(h.scene, 'warrior').then(() => {
      complete = true;
    });
    expect(h.poolUnits).toHaveBeenCalled();
    expect(h.spawn(kind)).toBe(false);
    for (let i = 0; i < 10; i++) await h.next();
    expect(h.upload.mock.calls.map(([value]) => value)).toEqual([...h.textures.values()]);
    expect(h.host.compile).not.toHaveBeenCalled();
    expect(h.host.draw).not.toHaveBeenCalled();
    expect(h.spawn(kind)).toBe(false);
    for (let i = 0; i < 29; i++) await h.next();
    expect(h.jobs[0].label).toBe('baked-upload:slot:9');
    expect(complete).toBe(false);
    expect(h.seenSlots.size).toBe(9);
    for (let i = 0; i < 9; i++) expect(h.spawn(kind)).toBe(true);
    expect(h.spawn(kind)).toBe(false);
    await h.next();
    await task;
    expect(complete).toBe(true);
    expect(h.host.compile).toHaveBeenCalledTimes(10);
    expect(h.host.draw).toHaveBeenCalledTimes(10);
    expect(h.seenSlots.size).toBe(10);
    expect(h.spawn(kind)).toBe(true);
    expect(h.spawn(kind)).toBe(false);
    expect(h.labels).toHaveLength(40);
    expect(new Set(h.labels).size).toBe(40);
    await ensureActiveAbilityKit(h.scene, 'warrior');
    expect(h.labels).toHaveLength(40);
  },
);

it('keeps other classes and generic dispatch independent of missing Warrior textures', async () => {
  const h = fixture('mage', false);
  expect(h.entry.progress()).toEqual({ done: 0, planned: 0, trimmed: false });
  await ensureActiveAbilityKit(h.scene);
  expect(h.fx.authoredPrewarmUnits(h.host)).toEqual([]);
  expect(h.fx.authoredPrewarmUnits(h.host, ['fire'])).toEqual([]);
  expect(h.poolUnits).not.toHaveBeenCalled();
  expect(h.bakedTexture).not.toHaveBeenCalled();
  expect(h.queue.run).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.host.compile).not.toHaveBeenCalled();
  expect(h.host.draw).not.toHaveBeenCalled();
  expect(h.pool.spawn('smoke', 0, 1, 0, 4, 0xffffff, 0xffffff, 0.2, 0, 0, 0)).toBe(true);
});
