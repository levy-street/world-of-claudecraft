import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PaladinConsecrationVisuals } from '../src/render/paladin_consecration_visual';

function radialBounds(root: THREE.Object3D, centerX: number, centerZ: number, name: string) {
  const mesh = root.getObjectByName(name) as THREE.Mesh | undefined;
  const positions = mesh?.geometry.getAttribute('position');
  if (!positions) throw new Error(`missing ${name}`);
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let index = 0; index < positions.count; index++) {
    const distance = Math.hypot(positions.getX(index) - centerX, positions.getZ(index) - centerZ);
    if (distance > 0.01) min = Math.min(min, distance);
    max = Math.max(max, distance);
  }
  return { min, max };
}

describe('Paladin Consecration ground visual', () => {
  it('fills the exact six-metre damage area with a layered sacred seal', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 2);

    groundFx.sync([
      {
        id: 'consecration:1:20',
        x: 4,
        z: 7,
        radius: 6,
        duration: 9,
        remaining: 4,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    const baseBounds = radialBounds(visual, 4, 7, 'paladin-consecration-base-glow');
    const runeBounds = radialBounds(visual, 4, 7, 'paladin-consecration-sun-rune-field');
    const perimeterBounds = radialBounds(visual, 4, 7, 'paladin-consecration-perimeter');

    expect(baseBounds.max).toBeCloseTo(6);
    expect(perimeterBounds.min).toBeGreaterThan(5.8);
    expect(perimeterBounds.max).toBeCloseTo(6);
    expect(runeBounds.max).toBeGreaterThan(5);
    expect(runeBounds.max).toBeLessThanOrEqual(6);

    expect(visual.getObjectByName('paladin-consecration-light-fissures')).toBeUndefined();
    expect(visual.getObjectByName('paladin-consecration-inner-ring')).toBeDefined();
    expect(visual.getObjectByName('paladin-consecration-middle-ring')).toBeDefined();
    expect(visual.getObjectByName('paladin-consecration-shimmer')).toBeDefined();
    const motes = visual.getObjectByName('paladin-consecration-motes');
    const wisps = visual.getObjectByName('paladin-consecration-edge-wisps');
    expect(motes).toBeInstanceOf(THREE.InstancedMesh);
    expect(wisps).toBeInstanceOf(THREE.InstancedMesh);
    const rotation = motes?.rotation.y ?? 0;
    groundFx.update(1, true);
    expect(motes?.rotation.y).toBe(rotation);
    groundFx.update(1, false);
    expect(motes?.rotation.y).toBeGreaterThan(rotation);
    groundFx.update(4, false);
    expect(scene.getObjectByName('paladin-consecration')).toBeUndefined();
  });

  it('drapes the full yellow damage circle over uneven terrain', () => {
    const scene = new THREE.Scene();
    const groundY = (x: number, z: number): number => Math.sin(x * 0.25) + Math.cos(z * 0.2) * 0.5;
    const groundFx = new PaladinConsecrationVisuals(scene, groundY);

    groundFx.sync([
      {
        id: 'consecration:normal',
        x: 0,
        z: 0,
        radius: 6,
        duration: 9,
        remaining: 9,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    const base = visual.getObjectByName('paladin-consecration-base-glow') as THREE.Mesh;
    const positions = base.geometry.getAttribute('position');
    const sampledRadii = new Set<string>();
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      sampledRadii.add(Math.hypot(x, z).toFixed(2));
      expect(y).toBeCloseTo(groundY(x, z) + 0.055, 4);
    }
    expect(sampledRadii.has('0.00')).toBe(true);
    expect(sampledRadii.has('6.00')).toBe(true);
    expect(sampledRadii.size).toBe(9);

    const pulse = visual.getObjectByName('paladin-consecration-pulse-ring');
    const initialScale = pulse?.scale.x ?? 0;
    groundFx.update(0.15, false);
    expect(pulse?.scale.x).toBeGreaterThan(initialScale);
  });

  it('keeps the sacred seal readable while dropping decorative drawables at low quality', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 0);
    groundFx.setQuality(0);
    groundFx.sync([
      {
        id: 'consecration:low',
        x: 0,
        z: 0,
        radius: 6,
        duration: 9,
        remaining: 9,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    expect(visual.getObjectByName('paladin-consecration-base-glow')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-perimeter')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-sun-rune-field')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-pulse-ring')?.visible).toBe(true);
    expect(visual.getObjectByName('paladin-consecration-middle-ring')?.visible).toBe(false);
    expect(visual.getObjectByName('paladin-consecration-shimmer')?.visible).toBe(false);
    expect(visual.getObjectByName('paladin-consecration-motes')?.visible).toBe(false);
    expect(visual.getObjectByName('paladin-consecration-edge-wisps')?.visible).toBe(false);
  });

  it('disposes both instanced meshes (motes and edge wisps) when a seal expires', () => {
    const scene = new THREE.Scene();
    const groundFx = new PaladinConsecrationVisuals(scene, () => 0);
    groundFx.sync([
      {
        id: 'consecration:dispose',
        x: 0,
        z: 0,
        radius: 6,
        duration: 9,
        remaining: 9,
      },
    ]);

    const visual = scene.getObjectByName('paladin-consecration');
    if (!visual) throw new Error('missing Consecration visual');
    const motes = visual.getObjectByName('paladin-consecration-motes') as THREE.InstancedMesh;
    const wisps = visual.getObjectByName('paladin-consecration-edge-wisps') as THREE.InstancedMesh;
    const moteDisposeSpy = vi.spyOn(motes, 'dispose');
    const wispDisposeSpy = vi.spyOn(wisps, 'dispose');

    groundFx.update(10, false);

    expect(moteDisposeSpy).toHaveBeenCalledTimes(1);
    expect(wispDisposeSpy).toHaveBeenCalledTimes(1);
  });
});
