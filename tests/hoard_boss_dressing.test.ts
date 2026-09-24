// The Buried Hoard boss dressing adapter (src/render/hoard_boss_dressing.ts):
// it is a client of the scene compile gate, sheds entirely on the low tier,
// re-uploads an ice crown only when its growth moves, finds the surged boss by
// his aura, and releases what it owns exactly once.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HoardBossDressing } from '../src/render/hoard_boss_dressing';
import { HOARD_STORM_SURGE_AURA_ID } from '../src/sim/rift/hoard_storm_surge';
import type { IWorld } from '../src/world_api';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const ROOT = 'hoard-boss-dressing';
const CALM_OFF = () => false;
function cue(overrides: Partial<HoardBossCueView> = {}): HoardBossCueView {
  return {
    instanceId: 4,
    cueId: 1,
    kind: 'mark',
    variant: 'frost-ice',
    phase: 'hazard',
    x: 12,
    z: 34,
    radius: 4,
    remaining: 5,
    total: 8,
    ...overrides,
  };
}

function crowns(scene: THREE.Scene): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.InstancedMesh) out.push(node);
  });
  return out;
}

describe('Buried Hoard boss dressing adapter', () => {
  it('attaches through the compile gate, never as a bare scene add', async () => {
    const scene = new THREE.Scene();
    const gated: THREE.Object3D[] = [];
    let release: () => void = () => {};
    const dressing = new HoardBossDressing(
      scene,
      () => 0,
      undefined,
      (target) => {
        gated.push(target);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      CALM_OFF,
      'high',
    );
    expect(gated.map((target) => target.name)).toEqual([ROOT]);
    release();
    await dressing.readyForEntry;
    const root = scene.getObjectByName(ROOT);
    expect(root?.visible).toBe(true);
    // Cosmetic: no lights, no transmission material, and never actionable.
    scene.traverse((node) => {
      expect(node).not.toBeInstanceOf(THREE.Light);
      const material = (node as THREE.Mesh).material;
      if (material) expect(material).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    });
    expect(root?.userData.actionable).toBeUndefined();
    dressing.dispose();
  });

  it('builds nothing at all on the low tier', async () => {
    const scene = new THREE.Scene();
    let gateCalls = 0;
    const dressing = new HoardBossDressing(
      scene,
      () => 0,
      undefined,
      async () => {
        gateCalls++;
      },
      CALM_OFF,
      'low',
    );
    await dressing.readyForEntry;
    dressing.sync([cue()]);
    dressing.update(0.1);
    expect(gateCalls).toBe(0);
    expect(scene.children).toHaveLength(0);
    dressing.dispose();
  });

  it('re-uploads an ice crown only when its growth moves', async () => {
    const scene = new THREE.Scene();
    let samples = 0;
    const dressing = new HoardBossDressing(
      scene,
      () => {
        samples++;
        return 0;
      },
      undefined,
      undefined,
      CALM_OFF,
      'high',
    );
    await dressing.readyForEntry;
    dressing.sync([cue({ phase: 'warning', remaining: 1.5, total: 2 })]);
    const crown = crowns(scene).find((mesh) => mesh.parent?.visible);
    if (!crown) throw new Error('no ice crown shown');
    const afterClaim = crown.instanceMatrix.version;
    const samplesAfterClaim = samples;
    dressing.sync([cue({ phase: 'warning', remaining: 1, total: 2 })]);
    expect(crown.instanceMatrix.version).toBeGreaterThan(afterClaim);
    // The ground under each crystal is sampled once, at claim.
    expect(samples).toBe(samplesAfterClaim);

    // A standing hazard holds one growth value: no re-pose, no upload.
    dressing.sync([cue({ remaining: 5 })]);
    const standing = crown.instanceMatrix.version;
    dressing.sync([cue({ remaining: 4.9 })]);
    dressing.sync([cue({ remaining: 4.8 })]);
    expect(crown.instanceMatrix.version).toBe(standing);

    dressing.sync([]);
    expect(crown.parent?.visible).toBe(false);
    dressing.dispose();
  });

  it('wraps the boss carrying Storm Surge, and only looks for him on a live field', async () => {
    const scene = new THREE.Scene();
    const boss = {
      id: 9,
      kind: 'mob',
      dead: false,
      scale: 3,
      pos: { x: 5, y: 1, z: 7 },
      auras: [{ id: HOARD_STORM_SURGE_AURA_ID, stacks: 4 }],
    };
    let walks = 0;
    const entities = new Map([[boss.id, boss]]);
    const world = {
      entities: {
        get: (id: number) => entities.get(id),
        values: () => {
          walks++;
          return entities.values();
        },
      },
    } as unknown as IWorld;
    const dressing = new HoardBossDressing(scene, () => 0, world, undefined, CALM_OFF, 'high');
    await dressing.readyForEntry;
    const shell = () =>
      scene.getObjectByName(ROOT)?.children.find((child) => child.children.length === 5);

    for (let frame = 0; frame < 30; frame++) dressing.update(0.05);
    expect(walks).toBe(0);
    expect(shell()?.visible).toBe(false);

    dressing.sync([cue({ variant: 'storm-field', radius: 12 })]);
    for (let frame = 0; frame < 30; frame++) dressing.update(0.05);
    expect(shell()?.visible).toBe(true);
    expect(shell()?.position.x).toBe(5);
    const walked = walks;
    for (let frame = 0; frame < 60; frame++) dressing.update(0.05);
    // Tracked by id from here: no further roster walks.
    expect(walks).toBe(walked);

    boss.auras = [];
    dressing.update(0.05);
    expect(shell()?.visible).toBe(false);
    dressing.dispose();
  });

  it('releases every geometry and material exactly once', async () => {
    const scene = new THREE.Scene();
    const dressing = new HoardBossDressing(scene, () => 0, undefined, undefined, CALM_OFF, 'high');
    await dressing.readyForEntry;
    const disposed = new Map<string, number>();
    const owned = new Set<THREE.BufferGeometry | THREE.Material>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) owned.add(mesh.geometry);
      if (mesh.material) owned.add(mesh.material as THREE.Material);
    });
    expect(owned.size).toBeGreaterThan(8);
    for (const resource of owned) {
      resource.addEventListener('dispose', () => {
        disposed.set(resource.uuid, (disposed.get(resource.uuid) ?? 0) + 1);
      });
    }
    dressing.dispose();
    dressing.dispose();
    expect(scene.getObjectByName(ROOT)).toBeUndefined();
    expect(disposed.size).toBe(owned.size);
    expect([...disposed.values()].every((count) => count === 1)).toBe(true);
  });
});
