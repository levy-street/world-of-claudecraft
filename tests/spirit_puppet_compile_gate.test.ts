// The spirit puppets warmed themselves by DRAWING: a freshly built puppet rode
// one frame with the compile group visible so its shared ghost material's
// program would link at warm time. A visible one-frame draw is a synchronous
// link on the live path, and production caught it four times in a row, at
// reveal + 0.3 to 0.6 s, on the same `+skinning -opaque` MeshBasicMaterial
// program (268, 150, 59 and 35 ms). The pool now takes the host's live compile
// gate and links a HIDDEN root off-thread instead; hosts without a gate (the
// editor viewport, headless, these tests) keep the historical pass.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpiritApparitions } from '../src/render/ability_vfx/spirits';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';

const loadGltf = vi.fn();

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: (url: string) => loadGltf(url),
}));

// warmForClass resolves its models from the authored spec table; the shaman's
// Ghost Wolf is the stable single-model case. BEAR is the second entry of
// SPIRIT_URLS, used where the queue needs more than one puppet in it.
const WOLF = 'wolf';
const BEAR = 'bear';

/**
 * A resolved GLB carrying a real rig: the puppet material is SKINNED (the
 * production program key's differing segment is `+skinning`), so a compile
 * root that does not contain a SkinnedMesh wearing it keys a different
 * program from the one the first spawn draws with.
 */
function skinnedGltf(): { scene: THREE.Object3D; animations: THREE.AnimationClip[] } {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.getAttribute('position').count;
  const index = new Uint16Array(count * 4);
  const weight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weight[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
  const bone = new THREE.Bone();
  bone.name = 'root';
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  root.add(mesh);
  return { scene: root, animations: [] };
}

/**
 * The same rig plus the two mesh kinds a creature GLB also ships: a plain Mesh
 * and an InstancedMesh. All three end up wearing the ONE shared ghost material,
 * and three keys `instancing` and `skinning` into the program cache, so each
 * kind is its own program. The production escape (2026-08-18, 93.9 s) was
 * exactly these two: one plain and two instanced MeshBasicMaterial programs,
 * 59.5 ms, linked inside a live frame.
 */
function mixedGltf(): { scene: THREE.Object3D; animations: THREE.AnimationClip[] } {
  const { scene, animations } = skinnedGltf();
  const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  plain.name = 'horns';
  scene.add(plain);
  const instanced = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshStandardMaterial(),
    4,
  );
  instanced.name = 'quills';
  scene.add(instanced);
  return { scene, animations };
}

/** Every drawable mesh under a root, the set a program is linked per. */
function drawableMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  return meshes;
}

const SPAWN = {
  model: WOLF,
  path: 'rise',
  atKind: 'caster',
  x: 0,
  y: 0,
  z: 0,
  dirX: 1,
  dirZ: 0,
  scale: 1,
  dur: 1.5,
  colorHex: 0xffffff,
  dim: 1,
} as const;

interface PuppetProbe {
  puppets: Map<string, { root: THREE.Object3D; mat: THREE.Material; compiled: boolean }>;
  compileGroup: THREE.Group;
}

function makePool(): { pool: SpiritApparitions; probe: PuppetProbe } {
  const pool = new SpiritApparitions(new THREE.Scene(), () => 0);
  return { pool, probe: pool as unknown as PuppetProbe };
}

/** Record every write to `visible`, not just its value at the end of a frame:
 *  a single visible frame anywhere is the whole bug. */
function watchVisible(object: THREE.Object3D): boolean[] {
  const writes: boolean[] = [];
  let value = object.visible;
  Object.defineProperty(object, 'visible', {
    configurable: true,
    get: () => value,
    set: (next: boolean) => {
      writes.push(next);
      value = next;
    },
  });
  return writes;
}

async function warmOnePuppet(pool: SpiritApparitions, probe: PuppetProbe): Promise<void> {
  pool.warmForClass('shaman');
  await vi.waitFor(() => expect(probe.puppets.has(WOLF)).toBe(true));
}

beforeEach(() => {
  loadGltf.mockReset();
  loadGltf.mockResolvedValue(skinnedGltf());
  resetGpuPrepEventsForTest();
});

const refusedSpawns = (): number => gpuPrepEventsSnapshot().gates.spiritSpawnsRefused;

describe('the gated puppet warm-up', () => {
  it('never makes the compile group visible', async () => {
    const { pool, probe } = makePool();
    pool.setCompileGate(() => new Promise(() => {}));
    const writes = watchVisible(probe.compileGroup);
    await warmOnePuppet(pool, probe);
    for (let frame = 0; frame < 8; frame++) pool.update(1 / 60);
    expect(writes).not.toContain(true);
    expect(probe.compileGroup.visible).toBe(false);
  });

  it('hands the gate a hidden root with the puppet material on a skinned mesh', async () => {
    const { pool, probe } = makePool();
    const roots: THREE.Object3D[] = [];
    pool.setCompileGate((root) => {
      roots.push(root);
      return new Promise(() => {});
    });
    await warmOnePuppet(pool, probe);
    pool.update(1 / 60);

    expect(roots).toHaveLength(1);
    const puppet = probe.puppets.get(WOLF);
    expect(puppet).toBeDefined();
    if (!puppet) return;
    // The root is staged inside the hidden compile group, never on its own.
    expect(roots[0]).toBe(puppet.root);
    expect(roots[0].parent).toBe(probe.compileGroup);
    expect(probe.compileGroup.visible).toBe(false);

    const skinned: THREE.SkinnedMesh[] = [];
    roots[0].traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.material === puppet.mat) skinned.push(mesh);
    });
    expect(skinned.length).toBeGreaterThan(0);
  });

  it('flips readiness only after the gate resolves, and only inside update()', async () => {
    const { pool, probe } = makePool();
    let resolveGate: (() => void) | null = null;
    pool.setCompileGate(
      () =>
        new Promise<void>((resolve) => {
          resolveGate = resolve;
        }),
    );
    await warmOnePuppet(pool, probe);
    pool.update(1 / 60);
    const puppet = probe.puppets.get(WOLF);
    expect(puppet).toBeDefined();
    if (!puppet) return;

    // In flight: staged, hidden, not ready.
    pool.update(1 / 60);
    expect(puppet.compiled).toBe(false);
    expect(puppet.root.parent).toBe(probe.compileGroup);

    expect(resolveGate).not.toBeNull();
    (resolveGate as unknown as () => void)();
    // Resolved, but no frame has run: the callback itself must not move nodes
    // or flip readiness (numPointLights rides three's program cache key).
    await Promise.resolve();
    await Promise.resolve();
    expect(puppet.compiled).toBe(false);
    expect(puppet.root.parent).toBe(probe.compileGroup);

    pool.update(1 / 60);
    expect(puppet.compiled).toBe(true);
    expect(puppet.root.parent).not.toBe(probe.compileGroup);
  });

  it('takes one puppet at a time, so two builds do not stage together', async () => {
    const { pool, probe } = makePool();
    const settles: Array<() => void> = [];
    pool.setCompileGate(
      () =>
        new Promise<void>((resolve) => {
          settles.push(resolve);
        }),
    );
    pool.warmForClass('druid');
    await vi.waitFor(() => expect(probe.puppets.size).toBeGreaterThan(1));
    for (let frame = 0; frame < 4; frame++) pool.update(1 / 60);
    expect(settles).toHaveLength(1);
    expect(probe.compileGroup.children).toHaveLength(1);
  });
});

describe('a gate that rejects', () => {
  it('settles the puppet without throwing and without a visible frame', async () => {
    const { pool, probe } = makePool();
    pool.setCompileGate(() => Promise.reject(new Error('context lost')));
    const writes = watchVisible(probe.compileGroup);
    await warmOnePuppet(pool, probe);
    expect(() => pool.update(1 / 60)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(() => pool.update(1 / 60)).not.toThrow();

    const puppet = probe.puppets.get(WOLF);
    expect(puppet?.compiled).toBe(true);
    expect(puppet?.root.parent).not.toBe(probe.compileGroup);
    expect(writes).not.toContain(true);
  });

  it('survives a gate that throws synchronously', async () => {
    const { pool, probe } = makePool();
    pool.setCompileGate(() => {
      throw new Error('no renderer');
    });
    const writes = watchVisible(probe.compileGroup);
    await warmOnePuppet(pool, probe);
    expect(() => pool.update(1 / 60)).not.toThrow();
    expect(() => pool.update(1 / 60)).not.toThrow();
    expect(probe.puppets.get(WOLF)?.compiled).toBe(true);
    expect(writes).not.toContain(true);
  });
});

describe('without a gate the historical compile pass is unchanged', () => {
  it('still rides one visible frame per fresh puppet', async () => {
    const { pool, probe } = makePool();
    const writes = watchVisible(probe.compileGroup);
    await warmOnePuppet(pool, probe);
    const puppet = probe.puppets.get(WOLF);
    expect(puppet).toBeDefined();
    if (!puppet) return;

    pool.update(1 / 60);
    expect(writes).toContain(true);
    expect(probe.compileGroup.visible).toBe(true);
    expect(puppet.root.parent).toBe(probe.compileGroup);
    expect(puppet.compiled).toBe(false);

    // The next frame ends the pass and empties the group again.
    pool.update(1 / 60);
    expect(puppet.compiled).toBe(true);
    expect(puppet.root.parent).not.toBe(probe.compileGroup);
    expect(probe.compileGroup.visible).toBe(false);
  });

  it('is what a pool gets back when the gate is cleared', async () => {
    const { pool, probe } = makePool();
    pool.setCompileGate(() => new Promise(() => {}));
    pool.setCompileGate(null);
    await warmOnePuppet(pool, probe);
    pool.update(1 / 60);
    expect(probe.compileGroup.visible).toBe(true);
  });
});

describe('the renderer host wiring', () => {
  it('routes the gate through the AbilityVfxFx seam, next to the build scheduler', async () => {
    const { readFileSync } = await import('node:fs');
    const fx = readFileSync(new URL('../src/render/ability_vfx/fx.ts', import.meta.url), 'utf8');
    expect(fx).toContain('setSpiritCompileGate(gate: SpiritCompileGate | null): void {');
    expect(fx).toContain('this.spirits.setCompileGate(gate);');
  });
});

describe('every material the puppet can draw goes through the gate', () => {
  beforeEach(() => {
    loadGltf.mockResolvedValue(mixedGltf());
  });

  it('hands the gate the plain and instanced arms, not just the skinned one', async () => {
    const { pool, probe } = makePool();
    const roots: THREE.Object3D[] = [];
    pool.setCompileGate((root) => {
      roots.push(root);
      return new Promise(() => {});
    });
    await warmOnePuppet(pool, probe);
    pool.update(1 / 60);

    const puppet = probe.puppets.get(WOLF);
    expect(puppet).toBeDefined();
    if (!puppet) return;
    expect(roots).toHaveLength(1);

    const drawn = drawableMeshes(puppet.root);
    const gated = drawableMeshes(roots[0]);
    // The gate root IS the draw root, so no mesh kind can be left behind.
    expect(gated).toEqual(drawn);
    // Vacuity floor: all three kinds are present, each wearing the shared
    // ghost material the first spawn draws with.
    expect(drawn.length).toBe(3);
    expect(drawn.filter((mesh) => (mesh as THREE.SkinnedMesh).isSkinnedMesh)).toHaveLength(1);
    expect(drawn.filter((mesh) => (mesh as THREE.InstancedMesh).isInstancedMesh)).toHaveLength(1);
    expect(drawn.every((mesh) => mesh.material === puppet.mat)).toBe(true);
  });

  it('refuses to show a puppet whose gate has not settled, and warms it next', async () => {
    const { pool, probe } = makePool();
    let settle: (() => void) | null = null;
    pool.setCompileGate(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    await warmOnePuppet(pool, probe);
    const puppet = probe.puppets.get(WOLF);
    expect(puppet).toBeDefined();
    if (!puppet) return;

    // Cast before the warm-up frame: the spirit layer is skipped rather than
    // drawn cold, and nothing is put on stage.
    expect(pool.spawn({ ...SPAWN })).toBe(false);
    expect(pool.activeCount()).toBe(0);
    expect(puppet.compiled).toBe(false);

    pool.update(1 / 60);
    expect(settle).not.toBeNull();
    (settle as unknown as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    pool.update(1 / 60);

    // Gated: the same cast now shows.
    expect(puppet.compiled).toBe(true);
    expect(pool.spawn({ ...SPAWN })).toBe(true);
    expect(pool.activeCount()).toBe(1);
  });

  it('counts every refused spawn in the gpu-prep capture, and only those', async () => {
    // The gate refuses rather than holds, so the cast simply has no spirit
    // layer. That is fair only while it stays rare, and a capture is the only
    // way to know: nothing about a missing spectacle beat is visible
    // otherwise. The count must be of GATE refusals alone, never of the misses
    // the pool already took before it (a model still loading, both slots run).
    const { pool, probe } = makePool();
    pool.setCompileGate(() => new Promise(() => {}));

    // A model that has not loaded yet is not a gate refusal: it is the
    // historical silent miss, and counting it would drown the signal.
    expect(pool.spawn({ ...SPAWN })).toBe(false);
    expect(refusedSpawns()).toBe(0);

    await vi.waitFor(() => expect(probe.puppets.has(WOLF)).toBe(true));
    const puppet = probe.puppets.get(WOLF);
    expect(puppet).toBeDefined();
    if (!puppet) return;
    expect(puppet.compiled).toBe(false);

    expect(pool.spawn({ ...SPAWN })).toBe(false);
    expect(pool.spawn({ ...SPAWN })).toBe(false);
    expect(refusedSpawns()).toBe(2);
    expect(pool.activeCount()).toBe(0);

    // A host with NO gate keeps the historical immediate spawn, so it can
    // never refuse and never counts.
    const { pool: ungated, probe: ungatedProbe } = makePool();
    await warmOnePuppet(ungated, ungatedProbe);
    expect(ungated.spawn({ ...SPAWN })).toBe(true);
    expect(refusedSpawns()).toBe(2);
  });

  it('warms a refused NON-tail puppet first, ahead of the rest of the queue', async () => {
    // The queue is drained from the tail, so a refused cast on the puppet that
    // is NOT at the tail only reaches the gate on the next pump if warmNext
    // really moved it. With two puppets queued, a pump that gates the OTHER one
    // is the whole defect: the cast that was just refused would stay refused
    // for as many casts as there are puppets ahead of it.
    const { pool, probe } = makePool();
    const roots: THREE.Object3D[] = [];
    pool.setCompileGate((root) => {
      roots.push(root);
      return new Promise(() => {});
    });
    // A spawn of an unloaded model warms it; two of them queue two puppets in
    // load order, so the wolf is the non-tail one.
    expect(pool.spawn({ ...SPAWN, model: WOLF })).toBe(false);
    expect(pool.spawn({ ...SPAWN, model: BEAR })).toBe(false);
    await vi.waitFor(() => expect(probe.puppets.size).toBe(2));
    const wolf = probe.puppets.get(WOLF);
    const bear = probe.puppets.get(BEAR);
    expect(wolf).toBeDefined();
    expect(bear).toBeDefined();
    if (!wolf || !bear) return;

    // The refused cast: still no spirit on stage, and nothing gated yet.
    expect(pool.spawn({ ...SPAWN, model: WOLF })).toBe(false);
    expect(pool.activeCount()).toBe(0);
    expect(roots).toHaveLength(0);

    pool.update(1 / 60);
    expect(roots).toEqual([wolf.root]);
    expect(wolf.root.parent).toBe(probe.compileGroup);
    // One puppet at a time: the bear is still queued, untouched and unwarmed.
    expect(bear.root.parent).not.toBe(probe.compileGroup);
    expect(bear.compiled).toBe(false);
    expect(probe.compileGroup.children).toHaveLength(1);
    expect(probe.compileGroup.visible).toBe(false);
  });

  it('requeues an in-use puppet instead of dropping it off the warm-up queue', async () => {
    // The no-gate host spawns immediately, so a puppet can be on stage when
    // the queue reaches it. Dropping it there left every program it mounts to
    // link on its next draw.
    const { pool, probe } = makePool();
    await warmOnePuppet(pool, probe);
    expect(pool.spawn({ ...SPAWN })).toBe(true);

    const roots: THREE.Object3D[] = [];
    pool.setCompileGate((root) => {
      roots.push(root);
      return Promise.resolve();
    });
    pool.update(1 / 60);
    expect(roots).toHaveLength(0);

    // Released, and the queue still holds it: the next frame gates it.
    for (let frame = 0; frame < 40; frame++) pool.update(0.1);
    expect(pool.activeCount()).toBe(0);
    pool.update(1 / 60);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe(probe.puppets.get(WOLF)?.root);
  });
});
