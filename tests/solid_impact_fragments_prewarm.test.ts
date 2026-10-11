import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import {
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import * as contact from '../src/render/ability_vfx/contact_assets';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { GuardPrewarm } from '../src/render/ability_vfx/guard_prewarm';
import * as assets from '../src/render/ability_vfx/production_assets';
import { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';
import type { BackgroundGpuQueue } from '../src/render/background_gpu_queue';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';

const KINDS = ['ice_shard', 'stone_chip', 'metal_splinter'] as const;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  assets.productionAssetInternalsForTest.reset();
});

function liveFragments(scene: THREE.Scene) {
  return scene.children.filter((child) => child.name.startsWith('solidImpact:')) as THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >[];
}

const burst = (pool: SolidImpactFragments, kind: (typeof KINDS)[number]) =>
  pool.burst(kind, 0, 1, 0, 0xffffff, 6, 1, 0, 1, () => 0, 0.5);

// The pool is built at boot, before the kit's demand load lands, and the kit
// recipe (the renderer's `geometry` host arm through `authoredPrewarmUnits`)
// is what builds and prepares it once the fragment geometry is resident.
function kit(scene: THREE.Scene, fragments: SolidImpactFragments) {
  const empty = { units: () => [] };
  const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
  Object.assign(fx, {
    crests: empty,
    guards: empty,
    powerForms: empty,
    spiritHammers: empty,
    furyStates: empty,
    baked: empty,
    fragments,
  });
  const textures = [
    vi.spyOn(assets, 'warriorBloodTexture'),
    vi.spyOn(assets, 'warriorSteelTexture'),
    vi.spyOn(assets, 'warriorPressureTexture'),
    vi.spyOn(assets, 'warriorRockTexture'),
  ].map((spy) => {
    const texture = new THREE.Texture();
    spy.mockReturnValue(texture);
    return texture;
  });
  const sheet = new THREE.Texture();
  vi.spyOn(assets, 'bakedTexture').mockReturnValue(sheet);
  vi.spyOn(contact, 'contactTexture').mockReturnValue(sheet);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const compiled = new Set<THREE.Material>();
  const drawn = new Set<THREE.Material>();
  const host = {
    properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
    compile: vi.fn(async (root: THREE.Object3D) => {
      root.traverse((node) => {
        const material = (node as THREE.Mesh).material as THREE.Material | undefined;
        if (material) compiled.add(material);
      });
    }),
    draw: vi.fn((group: THREE.Group, child: THREE.Object3D) => {
      expect(group.visible).toBe(false);
      const material = (child as THREE.Mesh).material as THREE.Material;
      expect(compiled.has(material)).toBe(true);
      // Nothing can spawn a fragment of this kind before its upload finished.
      const kind = KINDS.find(
        (k) => (scene.getObjectByName(`solidImpact:${k}`) as THREE.Mesh).material === material,
      );
      expect(kind).toBeDefined();
      if (kind) expect(burst(fragments, kind)).toBe(0);
      drawn.add(material);
    }),
  };
  const labels: [string, number][] = [];
  const queue = {
    run: vi.fn(async (work: PrewarmResumeUnit['run'], priority: number, label: string) => {
      labels.push([label, priority]);
      await work();
    }),
  };
  activeKitPrewarmEntry(scene, 'warrior', {
    queue: queue as unknown as Pick<BackgroundGpuQueue, 'run'>,
    geometry: (kinds) => fx.authoredPrewarmUnits(host, kinds),
    texture: () => {},
  });
  cleanups.push(() => {
    cancelActiveAbilityKit(scene);
    fragments.dispose();
    for (const texture of textures) texture.dispose();
    sheet.dispose();
  });
  return { fx, host, labels, compiled, drawn };
}

it('builds and prepares the boot-built fragment pool through the Warrior kit once its geometry lands', async () => {
  const scene = new THREE.Scene();
  // Built at boot: the demand load has not landed, so no geometry exists yet.
  const pool = new SolidImpactFragments(scene);
  expect(assets.fragmentGeometry('stone_chip')).toBeNull();
  expect(liveFragments(scene)).toHaveLength(0);
  for (const kind of KINDS) expect(burst(pool, kind)).toBe(0);
  const k = kit(scene, pool);
  // The load lands.
  const sources = new Map(KINDS.map((kind) => [kind, new THREE.IcosahedronGeometry(1, 0)]));
  vi.spyOn(assets, 'fragmentGeometry').mockImplementation((kind) => sources.get(kind) ?? null);
  cleanups.push(() => {
    for (const source of sources.values()) source.dispose();
  });

  await ensureActiveAbilityKit(scene);

  const live = liveFragments(scene);
  expect(live.map((mesh) => mesh.name).sort()).toEqual(
    KINDS.map((kind) => `solidImpact:${kind}`).sort(),
  );
  // Every live material was compiled and drawn by a preparation unit on the
  // kit's own lane, so no live frame links a fragment program.
  for (const mesh of live) {
    expect(k.compiled.has(mesh.material)).toBe(true);
    expect(k.drawn.has(mesh.material)).toBe(true);
    expect(mesh.visible).toBe(false);
  }
  for (const kind of KINDS) {
    for (const step of ['build', 'compile', 'touch', 'upload'])
      expect(k.labels).toContainEqual([`fragment-${step}:${kind}`, GPU_WORK_PRIORITY.BOOT_DEBT]);
  }
  for (const kind of KINDS) expect(burst(pool, kind)).toBeGreaterThan(0);
  const stone = live.find((mesh) => mesh.name === 'solidImpact:stone_chip');
  expect(stone?.visible).toBe(true);
  expect(stone?.geometry.getAttribute('position').count).toBe(
    sources.get('stone_chip')?.getAttribute('position').count,
  );

  // Idempotent: a second kit run and a later recipe have nothing left to do.
  const compiles = k.host.compile.mock.calls.length;
  await ensureActiveAbilityKit(scene);
  expect(k.fx.authoredPrewarmUnits(k.host)).toEqual([]);
  expect(k.host.compile).toHaveBeenCalledTimes(compiles);
  expect(liveFragments(scene)).toHaveLength(3);

  // The pool owns what it built, and its hidden carriers leave with it.
  const disposals = live.flatMap((mesh) => [
    vi.spyOn(mesh.geometry, 'dispose'),
    vi.spyOn(mesh.material, 'dispose'),
  ]);
  pool.dispose();
  expect(scene.children).toHaveLength(0);
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  for (const kind of KINDS) expect(burst(pool, kind)).toBe(0);
});

it('keeps the fragments off, and builds nothing, while the kit geometry is absent', async () => {
  const scene = new THREE.Scene();
  const pool = new SolidImpactFragments(scene);
  const k = kit(scene, pool);
  await expect(ensureActiveAbilityKit(scene)).rejects.toThrow('fragment geometry');
  expect(liveFragments(scene)).toHaveLength(0);
  expect(k.host.compile).not.toHaveBeenCalled();
  expect(k.host.draw).not.toHaveBeenCalled();
  for (const kind of KINDS) expect(burst(pool, kind)).toBe(0);
  pool.update(0.1, false);
});

function builtPool() {
  const scene = new THREE.Scene();
  const pool = new SolidImpactFragments(scene);
  const sources = new Map(KINDS.map((kind) => [kind, new THREE.IcosahedronGeometry(1, 0)]));
  vi.spyOn(assets, 'fragmentGeometry').mockImplementation((kind) => sources.get(kind) ?? null);
  cleanups.push(() => {
    for (const source of sources.values()) source.dispose();
  });
  const host = {
    properties: { get: () => ({ programs: new Map() }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const units = pool.units(host);
  for (const kind of KINDS) units.find((unit) => unit.id === `fragment-build:${kind}`)?.run();
  return { scene, pool, host, units };
}

it('finishes every batch cleanup when one carrier disposal throws, then reports it', () => {
  const { scene, pool } = builtPool();
  const live = liveFragments(scene);
  expect(live).toHaveLength(3);
  const failure = new Error('carrier cleanup failed');
  const carriers = vi.spyOn(GuardPrewarm.prototype, 'dispose');
  carriers.mockImplementationOnce(() => {
    throw failure;
  });
  const disposals = live.flatMap((mesh) => [
    vi.spyOn(mesh.geometry, 'dispose'),
    vi.spyOn(mesh.material, 'dispose'),
  ]);
  let thrown: unknown;
  try {
    pool.dispose();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AggregateError);
  expect((thrown as AggregateError).errors).toEqual([failure]);
  expect(carriers).toHaveBeenCalledTimes(3);
  expect(liveFragments(scene)).toHaveLength(0);
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  for (const kind of KINDS) expect(burst(pool, kind)).toBe(0);
  // Disposal is terminal: a second call is a no-op, not a second throw.
  expect(() => pool.dispose()).not.toThrow();
});

it('fails a preparation step whose carrier unit no longer exists instead of skipping it', async () => {
  const { pool, units } = builtPool();
  cleanups.push(() => pool.dispose());
  const real = GuardPrewarm.prototype.units;
  vi.spyOn(GuardPrewarm.prototype, 'units').mockImplementation(function (this: GuardPrewarm, h) {
    return real
      .call(this, h)
      .map((unit) => (unit.id === 'guard-compile' ? { ...unit, id: 'guard-link' } : unit));
  });
  const compile = units.find((unit) => unit.id === 'fragment-compile:stone_chip');
  expect(compile).toBeDefined();
  await expect(async () => compile?.run()).rejects.toThrow('guard-compile');
  expect(burst(pool, 'stone_chip')).toBe(0);
});
