// Buried Hoard encounter accents: the pure plans
// (src/render/hoard_encounter_accents_core.ts) and the adapter that paints them
// (src/render/hoard_encounter_accents.ts).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HoardEncounterAccents } from '../src/render/hoard_encounter_accents';
import {
  HOARD_SLAM_LANDED_WITHIN_SEC,
  HOARD_SLAM_SEC,
  HOARD_SLAM_SHARD_COUNT,
  hoardControlSigil,
  hoardSlamRise,
  hoardSlamShards,
  hoardSlamShock,
} from '../src/render/hoard_encounter_accents_core';
import { HOARD_CAST_FEAR, HOARD_CAST_HEX } from '../src/sim/rift/hoard_control_casts';
import type { IWorld } from '../src/world_api';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const ROOT = 'hoard-encounter-accents';
const CALM_OFF = () => false;

function frontal(overrides: Partial<HoardBossCueView> = {}): HoardBossCueView {
  return {
    instanceId: 4,
    cueId: 7,
    kind: 'sweep',
    variant: 'brute-wide',
    phase: 'warning',
    x: 10,
    z: 20,
    radius: 14,
    facing: 0.6,
    halfAngle: 1.2,
    remaining: 1.5,
    total: 1.5,
    ...overrides,
  };
}

function shown(scene: THREE.Scene, predicate: (group: THREE.Object3D) => boolean): number {
  const root = scene.getObjectByName(ROOT);
  return (root?.children ?? []).filter((child) => child.visible && predicate(child)).length;
}

const isSlam = (group: THREE.Object3D) =>
  group.children.some((child) => child instanceof THREE.InstancedMesh);
const isSigil = (group: THREE.Object3D) => !isSlam(group);

describe('frontal rupture plan', () => {
  it('scatters deterministic spikes inside the cone, travelling outward from the boss', () => {
    const shards = hoardSlamShards(7);
    expect(shards).toHaveLength(HOARD_SLAM_SHARD_COUNT);
    expect(hoardSlamShards(7)).toEqual(shards);
    expect(hoardSlamShards(8)).not.toEqual(shards);
    for (const shard of shards) {
      expect(Math.abs(shard.angleFraction)).toBeLessThanOrEqual(1);
      expect(shard.radiusFraction).toBeGreaterThan(0.2);
      expect(shard.radiusFraction).toBeLessThanOrEqual(1);
      expect(shard.girth).toBeGreaterThanOrEqual(0.6);
    }
    const near = shards.reduce((a, b) => (a.radiusFraction < b.radiusFraction ? a : b));
    const far = shards.reduce((a, b) => (a.radiusFraction > b.radiusFraction ? a : b));
    expect(far.delay).toBeGreaterThan(near.delay);
  });

  it('punches a spike up fast, overshoots, then sinks it back to nothing', () => {
    expect(hoardSlamRise(0, 0.05)).toBe(0);
    expect(hoardSlamRise(0.04, 0.05)).toBe(0);
    expect(hoardSlamRise(0.2, 0.05)).toBeGreaterThan(1);
    expect(hoardSlamRise(0.45, 0.05)).toBeCloseTo(1, 1);
    expect(hoardSlamRise(HOARD_SLAM_SEC + 0.1, 0.05)).toBe(0);
  });

  it('races the shock arc to the edge of the cone and burns it out', () => {
    const start = hoardSlamShock(0);
    const end = hoardSlamShock(0.32);
    expect(start.scale).toBeLessThan(0.2);
    expect(end.scale).toBeCloseTo(1.05, 2);
    expect(start.opacity).toBeGreaterThan(0.9);
    expect(end.opacity).toBe(0);
    expect(hoardSlamShock(HOARD_SLAM_SEC).scorchOpacity).toBe(0);
  });
});

describe('control cast sigil plan', () => {
  it('closes the inner ring on the caster as the cast completes', () => {
    const start = hoardControlSigil(0, 0, 1);
    const late = hoardControlSigil(0.9, 0, 1);
    expect(start.inner).toBeCloseTo(start.outer);
    expect(late.inner).toBeLessThan(start.inner * 0.4);
    expect(late.outer).toBe(start.outer);
    expect(hoardControlSigil(3, 0, 1).inner).toBe(hoardControlSigil(1, 0, 1).inner);
    // A bigger caster wears a bigger ring.
    expect(hoardControlSigil(0, 0, 3).outer).toBeGreaterThan(start.outer);
  });

  it('holds still under reduced motion', () => {
    const a = hoardControlSigil(0.5, 0.1, 1, true);
    const b = hoardControlSigil(0.5, 0.77, 1, true);
    expect(a.spin).toBe(0);
    expect(a.opacity).toBe(b.opacity);
  });
});

describe('Buried Hoard encounter accents adapter', () => {
  it('attaches through the compile gate and builds nothing on the low tier', async () => {
    const scene = new THREE.Scene();
    const gated: string[] = [];
    const gate = async (target: THREE.Object3D) => {
      gated.push(target.name);
    };
    const accents = new HoardEncounterAccents(scene, () => 0, undefined, gate, CALM_OFF, 'high');
    await accents.readyForEntry;
    expect(gated).toEqual([ROOT]);
    expect(scene.getObjectByName(ROOT)?.userData.actionable).toBeUndefined();
    scene.traverse((node) => expect(node).not.toBeInstanceOf(THREE.Light));
    accents.dispose();

    const lowScene = new THREE.Scene();
    const low = new HoardEncounterAccents(lowScene, () => 0, undefined, gate, CALM_OFF, 'low');
    await low.readyForEntry;
    low.sync([frontal({ remaining: 0.1 })]);
    low.sync([]);
    low.update(0.1);
    expect(gated).toEqual([ROOT]);
    expect(lowScene.children).toHaveLength(0);
    low.dispose();
  });

  it('ruptures the ground when a frontal lands, never when it is cancelled', async () => {
    const scene = new THREE.Scene();
    const accents = new HoardEncounterAccents(
      scene,
      () => 0,
      undefined,
      undefined,
      CALM_OFF,
      'high',
    );
    await accents.readyForEntry;

    // Cancelled with most of its fuse left (the boss died or reset): nothing.
    accents.sync([frontal({ remaining: 1.2 })]);
    accents.sync([]);
    accents.update(0.05);
    expect(shown(scene, isSlam)).toBe(0);

    accents.sync([frontal({ cueId: 8, remaining: 1.2 })]);
    accents.sync([frontal({ cueId: 8, remaining: HOARD_SLAM_LANDED_WITHIN_SEC - 0.1 })]);
    expect(shown(scene, isSlam)).toBe(0);
    accents.sync([]);
    accents.update(0.05);
    expect(shown(scene, isSlam)).toBe(1);

    // It burns out on its own and frees the slot.
    for (let frame = 0; frame < 40; frame++) accents.update(0.05);
    expect(shown(scene, isSlam)).toBe(0);
    accents.dispose();
  });

  it('marks a hoard mob casting a control, in its school colour, until the cast ends', async () => {
    const scene = new THREE.Scene();
    const caster = {
      id: 3,
      kind: 'mob',
      dead: false,
      scale: 1.4,
      pos: { x: 2, y: 0, z: 9 },
      castingAbility: HOARD_CAST_HEX as string | null,
      castRemaining: 1.8,
      castTotal: 1.8,
    };
    const bystander = { ...caster, id: 5, castingAbility: 'rift_bolt' };
    const entities = new Map([
      [caster.id, caster],
      [bystander.id, bystander],
    ]);
    const world = { riftFloor: { seed: 1 }, entities } as unknown as IWorld;
    const accents = new HoardEncounterAccents(scene, () => 0, world, undefined, CALM_OFF, 'high');
    await accents.readyForEntry;

    accents.update(0.2);
    expect(shown(scene, isSigil)).toBe(1);
    const sigil = scene.getObjectByName(ROOT)?.children.find((c) => c.visible && isSigil(c));
    expect(sigil?.position.x).toBe(2);
    const ring = sigil?.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const nature = ring.material.color.getHex();

    caster.castRemaining = 0.2;
    accents.update(0.05);
    const inner = sigil?.children[1] as THREE.Mesh;
    expect(inner.scale.x).toBeLessThan(ring.scale.x * 0.5);

    // Interrupted: the sigil drops at once.
    caster.castingAbility = null;
    accents.update(0.05);
    expect(shown(scene, isSigil)).toBe(0);

    caster.castingAbility = HOARD_CAST_FEAR;
    caster.castRemaining = 1.8;
    accents.update(0.2);
    expect(shown(scene, isSigil)).toBe(1);
    const shadowSigil = scene.getObjectByName(ROOT)?.children.find((c) => c.visible && isSigil(c));
    const shadowRing = shadowSigil?.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(shadowRing.material.color.getHex()).not.toBe(nature);
    accents.dispose();
  });

  it('releases every geometry and material exactly once', async () => {
    const scene = new THREE.Scene();
    const accents = new HoardEncounterAccents(
      scene,
      () => 0,
      undefined,
      undefined,
      CALM_OFF,
      'high',
    );
    await accents.readyForEntry;
    const disposed = new Map<string, number>();
    const owned = new Set<THREE.BufferGeometry | THREE.Material>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) owned.add(mesh.geometry);
      if (mesh.material) owned.add(mesh.material as THREE.Material);
    });
    for (const resource of owned) {
      resource.addEventListener('dispose', () => {
        disposed.set(resource.uuid, (disposed.get(resource.uuid) ?? 0) + 1);
      });
    }
    accents.dispose();
    accents.dispose();
    expect(scene.getObjectByName(ROOT)).toBeUndefined();
    expect(disposed.size).toBe(owned.size);
    expect([...disposed.values()].every((count) => count === 1)).toBe(true);
  });
});
