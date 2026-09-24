import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { hoardCueAppearance } from '../src/render/hoard_boss_fx_core';
import { HoardOrbitalLightning } from '../src/render/hoard_orbital_lightning';
import {
  type OrbitalOrbPose,
  orbitalBoltPoints,
  orbitalOrbPose,
} from '../src/render/hoard_orbital_lightning_core';
import {
  ORBITAL_LIGHTNING as C,
  orbitalShotTime,
} from '../src/sim/rift/hoard_orbital_lightning_core';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const pose = (): OrbitalOrbPose => ({
  x: 0,
  y: 0,
  z: 0,
  scale: 0,
  brightness: 0,
  spin: 0,
  shotAge: 0,
  shotWave: 0,
  impactScale: 0,
  impactBrightness: 0,
});
function cue(elapsed = 1): HoardBossCueView {
  return {
    instanceId: 4,
    cueId: 10,
    kind: 'sweep',
    variant: 'storm-orbital',
    phase: 'warning',
    x: 12,
    z: 20,
    facing: 0.5,
    radius: C.orbitRadius,
    total: C.totalDuration,
    remaining: C.totalDuration - elapsed,
  };
}
function mesh(scene: THREE.Scene, name: string): THREE.InstancedMesh {
  return scene.getObjectByName(name) as THREE.InstancedMesh;
}

describe('Orbital Lightning choreography', () => {
  it('keeps six evenly spaced orbs on the shared orbit and ramps charge', () => {
    const out = pose();
    for (let i = 0; i < 6; i++) {
      expect(orbitalOrbPose(1, i, 0, false, out)).toBe(out);
      expect(Math.hypot(out.x, out.z)).toBeCloseTo(6.2);
      const a = Math.atan2(out.x, out.z);
      orbitalOrbPose(1, (i + 1) % 6, 0, false, out);
      expect((Math.atan2(out.x, out.z) - a + Math.PI * 2) % (Math.PI * 2)).toBeCloseTo(Math.PI / 3);
    }
    const early = orbitalOrbPose(0.8, 0, 0, false, out).brightness;
    expect(orbitalOrbPose(2.42, 0, 0, false, out).brightness).toBeGreaterThan(early * 2);
  });
  it('has one short discharge at a time and no residual or geometry at the end', () => {
    const out = pose();
    for (let wave = 0; wave < C.waveCount; wave++) {
      for (let shot = 0; shot < 6; shot++) {
        let active = 0;
        for (let i = 0; i < 6; i++) {
          orbitalOrbPose(orbitalShotTime(shot, wave) + 0.01, i, 0, false, out);
          if (out.shotAge >= 0 && out.shotAge < C.shotDuration) active++;
        }
        expect(active).toBe(1);
      }
    }
    for (let i = 0; i < 6; i++) {
      orbitalOrbPose(C.totalDuration, i, 0, false, out);
      expect(out.scale).toBe(0);
      expect(out.impactBrightness).toBe(0);
    }
  });
  it('calms bobbing and crackle without changing orbit, targeting, or timing', () => {
    const a = orbitalOrbPose(2.5, 0, 0.6, false, pose());
    const b = orbitalOrbPose(2.5, 0, 0.6, true, pose());
    expect([a.x, a.z, a.shotAge, a.scale]).toEqual([b.x, b.z, b.shotAge, b.scale]);
    expect(b.y).toBe(C.orbitHeight);
    const out = new Float32Array(39);
    orbitalBoltPoints(1, 3, 2, 8, 0.1, 9, 2, 4, out);
    expect(Array.from(out.slice(0, 3))).toEqual([1, 3, 2]);
    expect(out[36]).toBe(8);
    expect(out[37]).toBeCloseTo(0.1);
    expect(out[38]).toBe(9);
    const copy = out.slice();
    orbitalBoltPoints(1, 3, 2, 8, 0.1, 9, 2, 4, out);
    expect(out).toEqual(copy);
  });
});

describe('Orbital Lightning pooled painter', () => {
  it('smooths offline pose steps without advancing the shot clock', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardOrbitalLightning(scene, () => 0);
    await fx.readyForEntry;
    const transform = new THREE.Matrix4();
    fx.sync([cue(1)]);
    fx.update(1 / 60);
    mesh(scene, 'Orb_Core').getMatrixAt(0, transform);
    const start = transform.elements[12];
    const target = orbitalOrbPose(1.05, 0, 0.5, false, pose()).x;
    fx.sync([cue(1.05)]);
    fx.update(1 / 60);
    mesh(scene, 'Orb_Core').getMatrixAt(0, transform);
    const first = transform.elements[12];
    expect(first).toBeGreaterThan(start);
    expect(first).toBeLessThan(target);
    fx.sync([cue(1.05)]);
    fx.update(1 / 60);
    mesh(scene, 'Orb_Core').getMatrixAt(0, transform);
    expect(transform.elements[12]).toBeGreaterThan(first);
    expect(transform.elements[12]).toBeLessThan(target);
    expect(mesh(scene, 'BeamCore').count).toBe(0);
    fx.dispose();
  });
  it('does not double-advance an online countdown on nonzero frame deltas', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardOrbitalLightning(scene, () => 0);
    await fx.readyForEntry;
    fx.sync([cue(2.44)]);
    fx.update(0.1);
    expect(mesh(scene, 'BeamCore').count).toBe(0);
    fx.sync([cue(2.45 - 1e-14)]);
    fx.update(0);
    expect(mesh(scene, 'BeamCore').count).toBeGreaterThan(0);
    fx.sync([cue(2.46)]);
    fx.update(0.1);
    expect(mesh(scene, 'BeamCore').count).toBeGreaterThan(0);
    fx.dispose();
  });
  it('uses authored geometry on the first lazy import, even if assets arrive later', async () => {
    let loaded!: (source: THREE.Group[]) => void;
    const pending = new Promise<THREE.Group[]>((resolve) => {
      loaded = resolve;
    });
    const scene = new THREE.Scene();
    const fx = new HoardOrbitalLightning(scene, () => 0, undefined, undefined, 'high', pending);
    const source = new THREE.Group();
    const authored = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.4));
    authored.name = 'Core';
    source.add(authored);
    loaded([source]);
    await fx.readyForEntry;
    expect(mesh(scene, 'Orb_Core').geometry.attributes.position.count).toBe(24);
    fx.dispose();
    authored.geometry.dispose();
    (authored.material as THREE.Material).dispose();
  });
  it.each(['low', 'ultra'] as const)(
    'keeps identity and shot on %s without per-frame terrain sampling',
    async (tier) => {
      const scene = new THREE.Scene();
      const ground = vi.fn(() => 0);
      const fx = new HoardOrbitalLightning(scene, ground, undefined, () => false, tier);
      await fx.readyForEntry;
      fx.sync([cue(2.5)]);
      fx.update(0);
      expect(mesh(scene, 'Orb_Core').count).toBe(6);
      expect(mesh(scene, 'Orb_LocalArcs').visible).toBe(true);
      expect(mesh(scene, 'BeamCore').count).toBeGreaterThan(0);
      expect(mesh(scene, 'Impact_GroundArcs').visible).toBe(true);
      const calls = ground.mock.calls.length;
      for (let i = 0; i < 100; i++) {
        fx.sync([cue(2.5)]);
        fx.update(0);
      }
      expect(ground).toHaveBeenCalledTimes(calls);
      expect(
        hoardCueAppearance({ ...cue(), kind: 'mark', variant: 'storm-orbital-impact' }).palette,
      ).toBe('storm');
      fx.sync([]);
      fx.update(0.1);
      expect(scene.getObjectByName('OrbitalCast_0')?.visible).toBe(false);
      fx.dispose();
      expect(scene.children).toHaveLength(0);
    },
  );
  it('does not replay earlier shots on late join and releases owned resources once', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardOrbitalLightning(scene, () => 0);
    await fx.readyForEntry;
    fx.sync([cue(4.8)]);
    fx.update(0);
    expect(mesh(scene, 'BeamCore').count).toBe(0);
    const geometry = mesh(scene, 'Orb_Core').geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    fx.dispose();
    fx.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('bakes optimized GLB node transforms without mutating the cached source', async () => {
    const source = new THREE.Group();
    const original = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0));
    original.name = 'Core';
    original.scale.setScalar(0.175);
    original.position.y = 0.04;
    source.add(original);
    const scene = new THREE.Scene();
    const fx = new HoardOrbitalLightning(scene, () => 0, undefined, undefined, 'high', [source]);
    await fx.readyForEntry;
    const geometry = mesh(scene, 'Orb_Core').geometry;
    expect(geometry).not.toBe(original.geometry);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.max.y).toBeLessThan(0.22);
    expect(original.scale.x).toBe(0.175);
    const dispose = vi.spyOn(original.geometry, 'dispose');
    fx.dispose();
    expect(dispose).not.toHaveBeenCalled();
    original.geometry.dispose();
    (original.material as THREE.Material).dispose();
  });
  it('does not reattach if disposed while the compile gate is pending', async () => {
    const scene = new THREE.Scene();
    let complete!: () => void;
    const fx = new HoardOrbitalLightning(
      scene,
      () => 0,
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await Promise.resolve();
    await Promise.resolve();
    fx.dispose();
    complete();
    await fx.readyForEntry;
    expect(scene.children).toHaveLength(0);
  });
});
