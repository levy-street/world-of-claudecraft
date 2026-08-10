import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NeedleOfFateVfx } from '../src/render/needle_of_fate_vfx';

function anchorWriter(anchors: ReadonlyMap<number, THREE.Vector3>) {
  return (id: number, _height: number, out: THREE.Vector3): boolean => {
    const anchor = anchors.get(id);
    if (!anchor) return false;
    out.copy(anchor);
    return true;
  };
}

function materialOf(scene: THREE.Scene, name: string): THREE.Material & { opacity: number } {
  const mesh = scene.getObjectByName(name) as THREE.Mesh | THREE.Points | undefined;
  expect(mesh, `${name} should exist`).toBeDefined();
  expect(Array.isArray(mesh?.material)).toBe(false);
  return mesh?.material as THREE.Material & { opacity: number };
}

function rootCount(scene: THREE.Scene, family: string): number {
  let count = 0;
  const pattern = new RegExp(`^needle-of-fate-${family}-\\d+$`);
  scene.traverse((object) => {
    if (pattern.test(object.name)) count++;
  });
  return count;
}

describe('Needle of Fate VFX painter', () => {
  it('stages a rendered eye-and-rune windup until cast stop or anchor loss', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([[1, new THREE.Vector3(0, 1.4, 0)]]);
    const vfx = new NeedleOfFateVfx(scene, camera, anchorWriter(anchors));

    vfx.beginCast(1, 1.5);
    vfx.update(0.75);

    expect(scene.getObjectByName('needle-of-fate-windup-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-windup-eye-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-windup-runes-0')?.visible).toBe(true);
    expect(materialOf(scene, 'needle-of-fate-windup-outer-0').opacity).toBeGreaterThan(0.8);
    expect(scene.getObjectByName('needle-of-fate-windup-eye-0')?.scale.x).toBeGreaterThan(1.5);
    expect(scene.getObjectByName('needle-of-fate-windup-runes-0')?.rotation.z).not.toBe(0);

    vfx.update(1);
    expect(scene.getObjectByName('needle-of-fate-windup-0')?.visible).toBe(true);

    vfx.endCast(1);
    expect(scene.getObjectByName('needle-of-fate-windup-0')?.visible).toBe(false);

    vfx.beginCast(1, 1.5);
    anchors.delete(1);
    vfx.update(1 / 20);
    expect(scene.getObjectByName('needle-of-fate-windup-1')?.visible).toBe(false);
  });

  it('flies at the target, opens one bounded iris, and reuses a fixed graph', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1.4, 0)],
      [2, new THREE.Vector3(8, 1.1, 0)],
    ]);
    const onImpact = vi.fn();
    const vfx = new NeedleOfFateVfx(scene, camera, anchorWriter(anchors), false, onImpact);
    const sceneChildren = [...scene.children];
    const graphBefore: THREE.Object3D[] = [];
    scene.traverse((object) => graphBefore.push(object));

    vfx.spawn(1, 2);
    const trail = scene.getObjectByName('needle-of-fate-trail-0') as THREE.Mesh;
    const trailPosition = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const trailBefore = Array.from(trailPosition.array);
    expect(scene.getObjectByName('needle-of-fate-projectile-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-release-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-ribbon-glow-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-coils-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-coils-0')?.children).toHaveLength(3);

    vfx.update(1 / 20);
    expect(materialOf(scene, 'needle-of-fate-release-outer-0').opacity).toBeGreaterThan(0);
    expect(Array.from(trailPosition.array)).not.toEqual(trailBefore);
    expect(scene.getObjectByName('needle-of-fate-coils-0')?.rotation.y).not.toBe(0);
    expect(scene.getObjectByName('needle-of-fate-coils-0')?.rotation.z).not.toBe(0);

    for (let frame = 1; frame < 12; frame++) vfx.update(1 / 20);

    expect(onImpact).toHaveBeenCalledOnce();
    expect(onImpact).toHaveBeenCalledWith(2);
    expect(scene.getObjectByName('needle-of-fate-impact-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-impact-eye-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-shockwave-0')?.visible).toBe(true);
    expect(scene.getObjectByName('needle-of-fate-impact-sparks-0')?.visible).toBe(true);
    expect(materialOf(scene, 'needle-of-fate-impact-outer-0').opacity).toBeGreaterThan(0.5);
    expect(scene.getObjectByName('needle-of-fate-impact-eye-0')?.scale.x).toBeGreaterThan(2);
    expect(scene.getObjectByName('needle-of-fate-shockwave-0')?.scale.x).toBeGreaterThan(1);
    const sparks = scene.getObjectByName('needle-of-fate-impact-sparks-0') as THREE.Points;
    const sparkPosition = sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(Array.from(sparkPosition.array).some((value) => value !== 0)).toBe(true);

    for (let frame = 0; frame < 20; frame++) vfx.update(1 / 20);
    expect(scene.getObjectByName('needle-of-fate-impact-0')?.visible).toBe(false);

    for (let cast = 0; cast < 80; cast++) {
      vfx.beginCast(1, 1.5);
      vfx.update(0.01);
      vfx.endCast(1);
      vfx.spawn(1, 2);
      vfx.update(1 / 20);
    }
    expect(scene.children).toEqual(sceneChildren);
    const graphAfter: THREE.Object3D[] = [];
    scene.traverse((object) => graphAfter.push(object));
    expect(graphAfter).toEqual(graphBefore);
  });

  it('uses smaller bounded pools on low detail while retaining the needle and impact', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(4, 1, 0)],
    ]);

    new NeedleOfFateVfx(scene, camera, anchorWriter(anchors), true);

    expect(rootCount(scene, 'windup')).toBe(8);
    expect(rootCount(scene, 'release')).toBe(8);
    expect(rootCount(scene, 'projectile')).toBe(8);
    expect(rootCount(scene, 'impact')).toBe(8);
    expect(scene.getObjectByName('needle-of-fate-coils-0')?.children).toHaveLength(1);
    expect(scene.getObjectByName('needle-of-fate-veil-0')).toBeUndefined();
    expect(scene.getObjectByName('needle-of-fate-ribbon-glow-0')).toBeUndefined();
    expect(scene.getObjectByName('needle-of-fate-lashes-0')).toBeUndefined();
    expect(scene.getObjectByName('needle-of-fate-flash-0')).toBeUndefined();
    expect(scene.getObjectByName('needle-of-fate-pillar-0')).toBeUndefined();
    expect(scene.getObjectByName('needle-of-fate-impact-sparks-0')).toBeUndefined();
    expect(scene.getObjectByName('needle-of-fate-windup-runes-0')).toBeUndefined();

    const vfx = new NeedleOfFateVfx(new THREE.Scene(), camera, anchorWriter(anchors), true);
    for (let cast = 0; cast < 5; cast++) vfx.spawn(1, 2);
    expect(
      vfx.group.children.filter(
        (child) =>
          child.visible &&
          (child.name.startsWith('needle-of-fate-projectile-') ||
            child.name.startsWith('needle-of-fate-trail-')),
      ),
    ).toHaveLength(10);
  });

  it.each([1, 2])('fizzles without an impact when anchor %i disappears in flight', (missingId) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(20, 1, 0)],
    ]);
    const onImpact = vi.fn();
    const vfx = new NeedleOfFateVfx(scene, camera, anchorWriter(anchors), false, onImpact);

    vfx.spawn(1, 2);
    anchors.delete(missingId);
    vfx.update(1 / 20);

    expect(scene.getObjectByName('needle-of-fate-projectile-0')?.visible).toBe(false);
    expect(onImpact).not.toHaveBeenCalled();
  });

  it('forces its visual impact at the authoritative flight deadline', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Vector3(20, 1, 0);
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, target],
    ]);
    const onImpact = vi.fn();
    const vfx = new NeedleOfFateVfx(scene, camera, anchorWriter(anchors), false, onImpact);

    vfx.spawn(1, 2);
    target.x += 100;
    vfx.update(2.95);
    expect(onImpact).not.toHaveBeenCalled();
    target.x += 100;
    vfx.update(0.05);

    expect(onImpact).toHaveBeenCalledOnce();
    expect(onImpact).toHaveBeenCalledWith(2);
  });

  it('uses the same inclusive arrival reach as the authoritative projectile', () => {
    const camera = new THREE.PerspectiveCamera();
    const hitAtBoundary = vi.fn();
    const boundaryAnchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(1.3, 1, 0)],
    ]);
    const boundaryVfx = new NeedleOfFateVfx(
      new THREE.Scene(),
      camera,
      anchorWriter(boundaryAnchors),
      false,
      hitAtBoundary,
    );
    boundaryVfx.spawn(1, 2);
    boundaryVfx.update(1 / 20);
    expect(hitAtBoundary).toHaveBeenCalledOnce();

    const missOutsideBoundary = vi.fn();
    const outsideAnchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(1.301, 1, 0)],
    ]);
    const outsideVfx = new NeedleOfFateVfx(
      new THREE.Scene(),
      camera,
      anchorWriter(outsideAnchors),
      false,
      missOutsideBoundary,
    );
    outsideVfx.spawn(1, 2);
    outsideVfx.update(1 / 20);
    expect(missOutsideBoundary).not.toHaveBeenCalled();
  });

  it('clear hides every active VFX family without changing the graph', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(0.2, 1, 0)],
      [3, new THREE.Vector3(20, 1, 0)],
      [4, new THREE.Vector3(-2, 1, 0)],
    ]);
    const vfx = new NeedleOfFateVfx(scene, camera, anchorWriter(anchors));
    const graphBefore: THREE.Object3D[] = [];
    scene.traverse((object) => graphBefore.push(object));

    vfx.beginCast(4, 1.5);
    vfx.spawn(1, 2);
    vfx.update(1 / 20);
    vfx.spawn(1, 3);
    vfx.clear();

    const activeRoots: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (
        object.visible &&
        (/^needle-of-fate-windup-\d+$/.test(object.name) ||
          /^needle-of-fate-release-\d+$/.test(object.name) ||
          object.name.startsWith('needle-of-fate-projectile-') ||
          object.name.startsWith('needle-of-fate-trail-') ||
          /^needle-of-fate-impact-\d+$/.test(object.name))
      ) {
        activeRoots.push(object);
      }
    });
    const graphAfter: THREE.Object3D[] = [];
    scene.traverse((object) => graphAfter.push(object));
    expect(activeRoots).toEqual([]);
    expect(graphAfter).toEqual(graphBefore);
  });

  it('keeps all reduced-motion poses spatially static', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(20, 1, 0)],
    ]);
    const vfx = new NeedleOfFateVfx(scene, camera, anchorWriter(anchors));

    vfx.beginCast(1, 1.5);
    vfx.update(0.1, true);
    const windupEye = scene.getObjectByName('needle-of-fate-windup-eye-0');
    const windupRunes = scene.getObjectByName('needle-of-fate-windup-runes-0');
    const eyeScale = windupEye?.scale.clone();
    const runePosition = windupRunes?.position.clone();
    vfx.update(0.5, true);
    expect(windupEye?.scale).toEqual(eyeScale);
    expect(windupRunes?.position).toEqual(runePosition);

    vfx.spawn(1, 2);
    vfx.update(1 / 20, true);
    const coils = scene.getObjectByName('needle-of-fate-coils-0');
    expect(coils?.rotation.y).toBe(0);
    expect(coils?.rotation.z).toBe(0);
    const releaseOuter = scene.getObjectByName('needle-of-fate-release-outer-0');
    const releaseScale = releaseOuter?.parent?.scale.clone();

    vfx.update(1 / 20, true);
    expect(coils?.rotation.y).toBe(0);
    expect(coils?.rotation.z).toBe(0);
    expect(releaseOuter?.parent?.scale).toEqual(releaseScale);

    const impactScene = new THREE.Scene();
    const impactAnchors = new Map([
      [1, new THREE.Vector3(0, 1, 0)],
      [2, new THREE.Vector3(0.2, 1, 0)],
    ]);
    const impactVfx = new NeedleOfFateVfx(impactScene, camera, anchorWriter(impactAnchors));
    impactVfx.spawn(1, 2);
    impactVfx.update(1 / 20, true);
    const impactEye = impactScene.getObjectByName('needle-of-fate-impact-eye-0');
    const shockwave = impactScene.getObjectByName('needle-of-fate-shockwave-0');
    const impactEyeScale = impactEye?.scale.clone();
    const shockwaveScale = shockwave?.scale.clone();
    impactVfx.update(1 / 20, true);
    expect(impactEye?.scale).toEqual(impactEyeScale);
    expect(shockwave?.scale).toEqual(shockwaveScale);
  });
});
