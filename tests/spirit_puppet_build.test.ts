// Spirit puppet construction (a SkeletonUtils rig clone, a material rebind
// traverse, and a per-vertex skinned-bounds measure) used to run inside the GLB
// resolve's own synchronous continuation. warmForClass fires on FIRST SIGHTING
// of a class, so that continuation is a live combat frame, and several models
// of one class resolve within a few frames of each other. The host now hands
// the pool a scheduler that spends an idle slot per build.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPIRIT_URLS, SpiritApparitions } from '../src/render/ability_vfx/spirits';

const loadGltf = vi.fn();

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: (url: string) => loadGltf(url),
}));

// A minimal resolved GLB: buildPuppet's skinned-bounds pass falls back to
// Box3.setFromObject for static-mesh creatures, so no skeleton is needed.
function fakeGltf(): { scene: THREE.Object3D; animations: THREE.AnimationClip[] } {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  return { scene: root, animations: [] };
}

interface PuppetProbe {
  puppets: Map<string, unknown>;
  loading: Set<string>;
}

function makePool(): { pool: SpiritApparitions; probe: PuppetProbe } {
  const pool = new SpiritApparitions(new THREE.Scene(), () => 0);
  return { pool, probe: pool as unknown as PuppetProbe };
}

// warmForClass resolves its models from the authored spec table; the shaman's
// Ghost Wolf is the stable single-model case.
const WOLF = 'wolf';

beforeEach(() => {
  loadGltf.mockReset();
  loadGltf.mockResolvedValue(fakeGltf());
});

describe('SpiritApparitions puppet builds', () => {
  it('builds inline when the host supplies no scheduler', async () => {
    const { pool, probe } = makePool();
    pool.warmForClass('shaman');
    await vi.waitFor(() => expect(probe.puppets.has(WOLF)).toBe(true));
    expect(probe.loading.has(WOLF)).toBe(false);
  });

  it('hands the build to the host scheduler instead of the resolve frame', async () => {
    const { pool, probe } = makePool();
    const queued: Array<() => void> = [];
    pool.setBuildScheduler((build) => queued.push(build));
    pool.warmForClass('shaman');
    await vi.waitFor(() => expect(queued.length).toBe(1));
    // Nothing was constructed in the loader's continuation.
    expect(probe.puppets.has(WOLF)).toBe(false);
    queued[0]();
    expect(probe.puppets.has(WOLF)).toBe(true);
  });

  it('does not queue the same model twice while its build is still pending', async () => {
    const { pool, probe } = makePool();
    const queued: Array<() => void> = [];
    pool.setBuildScheduler((build) => queued.push(build));
    pool.warmForClass('shaman');
    await vi.waitFor(() => expect(queued.length).toBe(1));
    // A second sighting before the deferred build ran must see the model as
    // still loading, or it would load and build a duplicate puppet, stranding
    // the first one's mixer and materials.
    expect(probe.loading.has(WOLF)).toBe(true);
    pool.warmForClass('shaman');
    await vi.waitFor(() => expect(loadGltf).toHaveBeenCalledTimes(1));
    expect(queued).toHaveLength(1);
  });

  it('skips a cast whose puppet has not been built yet, without popping in late', async () => {
    const { pool } = makePool();
    pool.setBuildScheduler(() => {});
    pool.warmForClass('shaman');
    await vi.waitFor(() => expect(loadGltf).toHaveBeenCalled());
    expect(
      pool.spawn({
        model: WOLF,
        path: 'circle',
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
      }),
    ).toBe(false);
  });

  it('warms only models the class can actually conjure', () => {
    const { pool } = makePool();
    pool.warmForClass('shaman');
    for (const call of loadGltf.mock.calls) {
      expect(Object.values(SPIRIT_URLS)).toContain(call[0]);
    }
    expect(loadGltf.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('the renderer runs each build on an idle slot behind the GPU arbiter', () => {
  const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('wires the scheduler into the serial spirit build lane', () => {
    expect(renderer).toContain(
      'this.abilityVfxFx.setSpiritBuildScheduler((build) => this.queueSpiritPuppetBuild(build));',
    );
    const start = renderer.indexOf('private queueSpiritPuppetBuild(');
    expect(start).toBeGreaterThan(-1);
    const method = renderer.slice(start, renderer.indexOf('\n  }', start));
    expect(method).toContain('this.spiritBuildLane = this.spiritBuildLane');
    expect(method).toContain('idleSlot(IDLE_PREWARM_TIMEOUT_MS)');
    expect(method).toContain(
      "this.backgroundGpuWork.run(build, GPU_WORK_PRIORITY.BACKGROUND, 'spirit-puppet')",
    );
  });
});
