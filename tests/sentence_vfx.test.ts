import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { SentenceVfx } from '../src/render/sentence_vfx';
import {
  SENTENCE_BURST_SECONDS,
  SENTENCE_CATACLYSM_SECONDS,
  SENTENCE_MARK_SECONDS,
} from '../src/render/sentence_vfx_core';

const TEST_TEXTURES = {
  noise: new THREE.Texture(),
  ribbon: new THREE.Texture(),
  rune: new THREE.Texture(),
  ember: new THREE.Texture(),
  rime: new THREE.Texture(),
  crack: new THREE.Texture(),
  char: new THREE.Texture(),
  overlay: new THREE.Texture(),
} as unknown as AbilityVfxTextures;

function anchorWriter(anchors: ReadonlyMap<number, THREE.Vector3>) {
  return (id: number, heightFraction: number, out: THREE.Vector3): boolean => {
    const anchor = anchors.get(id);
    if (!anchor) return false;
    out.copy(anchor);
    out.y += heightFraction * 2;
    return true;
  };
}

function materialOf(scene: THREE.Scene, name: string): THREE.Material & { opacity: number } {
  const mesh = scene.getObjectByName(name) as THREE.Mesh | THREE.Points | THREE.Sprite | undefined;
  expect(mesh, `${name} should exist`).toBeDefined();
  expect(Array.isArray(mesh?.material)).toBe(false);
  return mesh?.material as THREE.Material & { opacity: number };
}

function colorMaterialOf(
  scene: THREE.Scene,
  name: string,
): THREE.Material & { color: THREE.Color; opacity: number } {
  return materialOf(scene, name) as THREE.Material & { color: THREE.Color; opacity: number };
}

function peakChannel(color: THREE.Color): number {
  return Math.max(color.r, color.g, color.b);
}

function rootCount(scene: THREE.Scene): number {
  let count = 0;
  scene.traverse((object) => {
    if (/^sentence-vfx-burst-\d+$/.test(object.name)) count++;
  });
  return count;
}

function ribbonMesh(scene: THREE.Scene): THREE.Mesh {
  const mesh = scene.children.find(
    (object) => object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial,
  ) as THREE.Mesh | undefined;
  expect(mesh, 'pooled curse-delivery ribbon should exist').toBeDefined();
  return mesh as THREE.Mesh;
}

function advance(vfx: SentenceVfx, seconds: number, reducedMotion = false): void {
  const step = 1 / 60;
  let remaining = seconds;
  while (remaining > 1e-6) {
    const dt = Math.min(step, remaining);
    vfx.update(dt, reducedMotion);
    remaining -= dt;
  }
}

function makeVfx(
  scene: THREE.Scene,
  camera: THREE.Camera,
  anchors: ReadonlyMap<number, THREE.Vector3>,
  lowDetail = false,
  onBurst: (sourceId: number, targetId: number, condemnation: number) => void = () => {},
): SentenceVfx {
  return new SentenceVfx(scene, camera, anchorWriter(anchors), lowDetail, onBurst, TEST_TEXTURES);
}

describe('Sentence VFX painter', () => {
  it('turns retained Fate Threads into denser lashes, waves, and impact sparks', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 0, 0)],
      [2, new THREE.Vector3(10, 0, 0)],
    ]);
    const vfx = makeVfx(scene, camera, anchors);

    expect(vfx.trigger(1, 2, 50, 3)).toBe(true);
    advance(vfx, 0.56);

    const sparks = scene.getObjectByName('sentence-vfx-sparks-0') as THREE.Points;
    const eye = scene.getObjectByName('sentence-vfx-eye-0') as THREE.Group;
    expect(sparks.geometry.drawRange.count).toBe(60);
    expect(eye.scale.x).toBeGreaterThan(eye.scale.y);
    expect(materialOf(scene, 'sentence-vfx-lashes-0').opacity).toBeGreaterThan(0.25);

    vfx.clear();
  });

  it('uses a dark horror palette with one sickly bright iris', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vfx = makeVfx(scene, camera, new Map([[2, new THREE.Vector3(0, 1, 0)]]));

    const iris = colorMaterialOf(scene, 'sentence-vfx-iris-0').color;
    const eyeOuter = colorMaterialOf(scene, 'sentence-vfx-eye-outer-0').color;
    const flash = colorMaterialOf(scene, 'sentence-vfx-detonation-flash-0').color;
    const shell = colorMaterialOf(scene, 'sentence-vfx-cataclysm-shell-0').color;
    const rupture = colorMaterialOf(scene, 'sentence-vfx-rupture-0');
    const sparks = colorMaterialOf(scene, 'sentence-vfx-sparks-0').color;
    const residue = colorMaterialOf(scene, 'sentence-vfx-residue-0');
    const sourceCore = colorMaterialOf(scene, 'sentence-vfx-invocation-core-0').color;
    const secondaryWave = colorMaterialOf(scene, 'sentence-vfx-wave-secondary-0').color;
    const starburst = scene.getObjectByName('sentence-vfx-starburst-0') as THREE.Mesh;
    const verticalHalos = scene.getObjectByName('sentence-vfx-vertical-halos-0') as THREE.Group;
    const verticalHaloMaterial = (verticalHalos.children[0] as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
    const starburstColors = starburst.geometry.getAttribute('color').array;
    let brightestStarburstChannel = 0;
    let greenDominantStarburstVertex = false;
    for (let index = 0; index < starburstColors.length; index += 3) {
      brightestStarburstChannel = Math.max(
        brightestStarburstChannel,
        starburstColors[index],
        starburstColors[index + 1],
        starburstColors[index + 2],
      );
      if (starburstColors[index + 1] > starburstColors[index + 2]) {
        greenDominantStarburstVertex = true;
      }
    }

    expect(iris.g).toBeGreaterThan(iris.r);
    expect(iris.r).toBeGreaterThan(iris.b * 2);
    expect(peakChannel(iris)).toBeGreaterThan(0.28);
    expect(peakChannel(iris)).toBeLessThan(0.36);
    expect(peakChannel(eyeOuter)).toBeLessThan(0.13);
    expect(peakChannel(iris)).toBeGreaterThan(peakChannel(eyeOuter) * 2);
    expect(peakChannel(flash)).toBeLessThan(0.24);
    expect(peakChannel(shell)).toBeLessThan(0.12);
    expect(peakChannel(rupture.color)).toBeLessThan(0.18);
    expect(peakChannel(sparks)).toBeLessThan(0.24);
    expect(peakChannel(sourceCore)).toBeLessThan(0.25);
    expect(peakChannel(secondaryWave)).toBeLessThan(0.12);
    expect(peakChannel(verticalHaloMaterial.color)).toBeLessThan(0.12);
    expect(brightestStarburstChannel).toBeLessThan(0.12);
    expect(residue.color.b).toBeGreaterThan(residue.color.g);
    expect(residue.blending).toBe(THREE.NormalBlending);
    expect((residue as THREE.MeshBasicMaterial).map).toBe(TEST_TEXTURES.rune);
    expect(greenDominantStarburstVertex).toBe(false);
    expect(rupture.blending).toBe(THREE.NormalBlending);
    expect((starburst.material as THREE.MeshBasicMaterial).blending).toBe(THREE.NormalBlending);

    vfx.clear();
  });

  it('plays invocation, pooled curse delivery, mark, payoff, and aftermath in order', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 0, 0)],
      [2, new THREE.Vector3(18, 0, 0)],
    ]);
    const onBurst = vi.fn();
    const vfx = makeVfx(scene, camera, anchors, false, onBurst);
    const sceneChildren = [...scene.children];
    const graphBefore: THREE.Object3D[] = [];
    scene.traverse((object) => graphBefore.push(object));
    const target = scene.getObjectByName('sentence-vfx-burst-0');
    const invocation = scene.getObjectByName('sentence-vfx-invocation-0');

    expect(vfx.trigger(1, 2, 100)).toBe(true);
    expect(invocation?.visible).toBe(true);
    expect(target?.visible).toBe(false);
    advance(vfx, 0.12);
    expect(materialOf(scene, 'sentence-vfx-invocation-core-0').opacity).toBeGreaterThan(0.4);
    expect(materialOf(scene, 'sentence-vfx-invocation-wisps-0').opacity).toBeGreaterThan(0.3);
    expect(target?.visible).toBe(false);
    expect(onBurst).not.toHaveBeenCalled();

    advance(vfx, 0.42);
    expect(invocation?.visible).toBe(false);
    expect(target?.visible).toBe(true);
    expect(target?.position.x).toBeCloseTo(18);
    expect(materialOf(scene, 'sentence-vfx-eye-outer-0').opacity).toBeGreaterThan(0.3);
    expect(scene.getObjectByName('sentence-vfx-cataclysm-core-0')?.visible).toBe(false);
    expect(onBurst).not.toHaveBeenCalled();

    advance(vfx, SENTENCE_MARK_SECONDS);
    expect(onBurst).toHaveBeenCalledOnce();
    expect(onBurst).toHaveBeenCalledWith(1, 2, 100);
    expect(scene.getObjectByName('sentence-vfx-cataclysm-core-0')?.visible).toBe(true);
    expect(scene.getObjectByName('sentence-vfx-detonation-flash-0')?.visible).toBe(true);
    expect(scene.getObjectByName('sentence-vfx-starburst-0')?.visible).toBe(true);
    expect(scene.getObjectByName('sentence-vfx-rupture-0')?.visible).toBe(true);
    expect(scene.getObjectByName('sentence-vfx-residue-0')?.visible).toBe(true);
    expect(scene.getObjectByName('sentence-vfx-soul-fragments-0')?.visible).toBe(true);
    expect(materialOf(scene, 'sentence-vfx-cataclysm-core-0').opacity).toBeGreaterThan(0.2);
    expect(materialOf(scene, 'sentence-vfx-detonation-flash-0').opacity).toBeGreaterThan(0.1);
    expect(materialOf(scene, 'sentence-vfx-starburst-0').opacity).toBeGreaterThan(0.1);
    expect(materialOf(scene, 'sentence-vfx-rupture-0').opacity).toBeGreaterThan(0.1);
    expect(materialOf(scene, 'sentence-vfx-residue-0').opacity).toBeGreaterThan(0.1);
    expect(materialOf(scene, 'sentence-vfx-soul-fragments-0').opacity).toBeGreaterThan(0.1);
    const verticalHalos = scene.getObjectByName('sentence-vfx-vertical-halos-0') as THREE.Group;
    expect(
      ((verticalHalos.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity,
    ).toBeGreaterThan(0.05);

    for (let cast = 0; cast < 40; cast++) {
      vfx.trigger(1, 2, 20 + (cast % 5) * 20);
      advance(vfx, 1 / 60);
    }
    expect(scene.children).toEqual(sceneChildren);
    const graphAfter: THREE.Object3D[] = [];
    scene.traverse((object) => graphAfter.push(object));
    expect(graphAfter).toEqual(graphBefore);
    expect(rootCount(scene)).toBe(8);
  });

  it('keeps the target mark readable before the maximum-only eruption', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([[2, new THREE.Vector3(0, 0, 0)]]);
    const vfx = makeVfx(scene, camera, anchors);

    expect(vfx.trigger(99, 2, 100)).toBe(true);
    advance(vfx, 0.16);
    expect(materialOf(scene, 'sentence-vfx-eye-outer-0').opacity).toBeGreaterThan(0.5);
    expect(scene.getObjectByName('sentence-vfx-cataclysm-shell-0')?.visible).toBe(false);

    advance(vfx, 0.28);
    expect(scene.getObjectByName('sentence-vfx-cataclysm-shell-0')?.visible).toBe(true);
    expect(scene.getObjectByName('sentence-vfx-cataclysm-shell-0')?.scale.x).toBeGreaterThan(2);
    expect(materialOf(scene, 'sentence-vfx-cataclysm-shell-0').opacity).toBeGreaterThan(0.05);
    expect(scene.getObjectByName('sentence-vfx-starburst-0')?.scale.x).toBeGreaterThan(2.5);
    expect(scene.getObjectByName('sentence-vfx-rupture-0')?.scale.x).toBeGreaterThan(4);
    expect(
      (scene.getObjectByName('sentence-vfx-sparks-0') as THREE.Points).geometry.drawRange.count,
    ).toBe(72);
  });

  it('keeps a forceful but cheaper low-detail sequence', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 0, 0)],
      [2, new THREE.Vector3(8, 0, 0)],
    ]);
    const vfx = makeVfx(scene, camera, anchors, true);

    expect(rootCount(scene)).toBe(8);
    expect(scene.getObjectByName('sentence-vfx-invocation-core-0')).toBeDefined();
    expect(scene.getObjectByName('sentence-vfx-invocation-wisps-0')).toBeUndefined();
    expect(scene.getObjectByName('sentence-vfx-eye-0')).toBeDefined();
    expect(scene.getObjectByName('sentence-vfx-sigils-0')).toBeUndefined();
    expect(scene.getObjectByName('sentence-vfx-crown-0')).toBeUndefined();
    expect(scene.getObjectByName('sentence-vfx-wave-secondary-0')).toBeUndefined();
    expect(scene.getObjectByName('sentence-vfx-sparks-0')).toBeUndefined();
    expect(scene.getObjectByName('sentence-vfx-soul-fragments-0')).toBeUndefined();
    expect(scene.getObjectByName('sentence-vfx-residue-0')).toBeDefined();
    expect(scene.getObjectByName('sentence-vfx-cataclysm-shell-0')).toBeUndefined();
    expect(scene.getObjectByName('sentence-vfx-starburst-0')).toBeUndefined();

    expect(vfx.trigger(1, 2, 100)).toBe(true);
    advance(vfx, 0.74);
    expect(scene.getObjectByName('sentence-vfx-burst-0')?.visible).toBe(true);
    expect(materialOf(scene, 'sentence-vfx-eye-outer-0').opacity).toBeGreaterThan(0);
    expect(scene.getObjectByName('sentence-vfx-cataclysm-core-0')?.scale.x).toBeGreaterThan(1);
    expect(materialOf(scene, 'sentence-vfx-cataclysm-core-0').opacity).toBeGreaterThan(0.2);
    expect(materialOf(scene, 'sentence-vfx-detonation-flash-0').opacity).toBeGreaterThan(0.1);
    expect(scene.getObjectByName('sentence-vfx-rupture-0')?.scale.x).toBeGreaterThan(4);
    expect(materialOf(scene, 'sentence-vfx-rupture-0').opacity).toBeGreaterThan(0.1);
    expect(materialOf(scene, 'sentence-vfx-residue-0').opacity).toBeGreaterThan(0);
  });

  it('keeps the maximum-only cataclysm hidden at 80 Condemnation', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([[2, new THREE.Vector3(0, 0, 0)]]);
    const vfx = makeVfx(scene, camera, anchors);

    expect(vfx.trigger(99, 2, 80)).toBe(true);
    advance(vfx, 0.44);

    expect(scene.getObjectByName('sentence-vfx-cataclysm-core-0')?.visible).toBe(false);
    expect(scene.getObjectByName('sentence-vfx-detonation-flash-0')?.visible).toBe(false);
    expect(scene.getObjectByName('sentence-vfx-cataclysm-shell-0')?.visible).toBe(false);
    expect(scene.getObjectByName('sentence-vfx-starburst-0')?.visible).toBe(false);
    expect(scene.getObjectByName('sentence-vfx-rupture-0')?.visible).toBe(false);
    expect(scene.getObjectByName('sentence-vfx-vertical-halos-0')?.visible).toBe(false);
    expect(scene.getObjectByName('sentence-vfx-residue-0')?.visible).toBe(true);
    expect(scene.getObjectByName('sentence-vfx-soul-fragments-0')?.visible).toBe(true);
    expect(
      (scene.getObjectByName('sentence-vfx-sparks-0') as THREE.Points).geometry.drawRange.count,
    ).toBe(42);
  });

  it('fizzles on target loss without firing the payoff and clears every pooled object', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 0, 0)],
      [2, new THREE.Vector3(20, 0, 0)],
    ]);
    const onBurst = vi.fn();
    const vfx = makeVfx(scene, camera, anchors, false, onBurst);

    expect(vfx.trigger(1, 99, 100)).toBe(false);
    expect(scene.getObjectByName('sentence-vfx-burst-0')?.visible).toBe(false);

    expect(vfx.trigger(1, 2, 100)).toBe(true);
    advance(vfx, 0.1);
    anchors.delete(2);
    advance(vfx, 0.12);
    expect(scene.getObjectByName('sentence-vfx-burst-0')?.visible).toBe(true);
    expect(materialOf(scene, 'sentence-vfx-vortex-0').opacity).toBeGreaterThan(0);
    expect(onBurst).not.toHaveBeenCalled();
    advance(vfx, 0.35);
    expect(scene.getObjectByName('sentence-vfx-burst-0')?.visible).toBe(false);
    expect(onBurst).not.toHaveBeenCalled();

    anchors.set(2, new THREE.Vector3(20, 0, 0));
    for (let index = 0; index < 8; index++) vfx.trigger(1, 2, 100);
    advance(vfx, 0.2);
    expect(ribbonMesh(scene).geometry.drawRange.count).toBeGreaterThan(0);
    vfx.clear();
    for (let index = 0; index < 8; index++) {
      expect(scene.getObjectByName(`sentence-vfx-invocation-${index}`)?.visible).toBe(false);
      expect(scene.getObjectByName(`sentence-vfx-burst-${index}`)?.visible).toBe(false);
    }
    expect(ribbonMesh(scene).geometry.drawRange.count).toBe(0);
    expect(rootCount(scene)).toBe(8);
  });

  it('expires exactly for ordinary and maximum verdicts', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([[2, new THREE.Vector3(0, 0, 0)]]);
    const vfx = makeVfx(scene, camera, anchors);

    expect(vfx.trigger(99, 2, 80)).toBe(true);
    vfx.update(SENTENCE_BURST_SECONDS - 0.001);
    expect(scene.getObjectByName('sentence-vfx-burst-0')?.visible).toBe(true);
    vfx.update(0.001);
    expect(scene.getObjectByName('sentence-vfx-burst-0')?.visible).toBe(false);

    expect(vfx.trigger(99, 2, 100)).toBe(true);
    vfx.update(SENTENCE_CATACLYSM_SECONDS - 0.001);
    expect(scene.getObjectByName('sentence-vfx-burst-1')?.visible).toBe(true);
    vfx.update(0.001);
    expect(scene.getObjectByName('sentence-vfx-burst-1')?.visible).toBe(false);
  });

  it('keeps reduced-motion invocation and delivery spatially static', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([
      [1, new THREE.Vector3(0, 0, 0)],
      [2, new THREE.Vector3(30, 0, 0)],
    ]);
    const vfx = makeVfx(scene, camera, anchors);

    expect(vfx.trigger(1, 2, 100)).toBe(true);
    advance(vfx, 0.04, true);
    const source = scene.getObjectByName('sentence-vfx-invocation-0');
    const seal = scene.getObjectByName('sentence-vfx-invocation-seal-0');
    const wisps = scene.getObjectByName('sentence-vfx-invocation-wisps-0') as THREE.Points;
    const sourceScale = scene.getObjectByName('sentence-vfx-invocation-core-0')?.scale.clone();
    const sealRotation = seal?.rotation.z;
    const wispPositions = Array.from(
      (wisps.geometry.getAttribute('position') as THREE.BufferAttribute).array,
    );

    advance(vfx, 0.08, true);
    expect(source?.position.toArray()).toEqual([0, 1.24, 0]);
    expect(scene.getObjectByName('sentence-vfx-invocation-core-0')?.scale).toEqual(sourceScale);
    expect(seal?.rotation.z).toBe(sealRotation);
    expect(
      Array.from((wisps.geometry.getAttribute('position') as THREE.BufferAttribute).array),
    ).toEqual(wispPositions);

    advance(vfx, 0.08, true);
    expect(ribbonMesh(scene).geometry.drawRange.count).toBeGreaterThan(0);
  });

  it('keeps reduced-motion impact and soul geometry spatially static', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const anchors = new Map([[2, new THREE.Vector3(0, 0, 0)]]);
    const vfx = makeVfx(scene, camera, anchors);

    vfx.trigger(99, 2, 100);
    advance(vfx, 0.4, true);
    const names = [
      'sentence-vfx-eye-0',
      'sentence-vfx-iris-0',
      'sentence-vfx-vortex-0',
      'sentence-vfx-wave-0',
      'sentence-vfx-wave-secondary-0',
      'sentence-vfx-pillar-0',
      'sentence-vfx-crown-0',
      'sentence-vfx-cataclysm-shell-0',
      'sentence-vfx-detonation-flash-0',
      'sentence-vfx-starburst-0',
      'sentence-vfx-rupture-0',
      'sentence-vfx-vertical-halos-0',
      'sentence-vfx-residue-0',
    ];
    const poses = names.map((name) => {
      const object = scene.getObjectByName(name);
      return {
        name,
        scale: object?.scale.clone(),
        rotation: object ? [object.rotation.x, object.rotation.y, object.rotation.z] : undefined,
      };
    });
    const sparks = scene.getObjectByName('sentence-vfx-sparks-0') as THREE.Points;
    const sparkPositions = Array.from(
      (sparks.geometry.getAttribute('position') as THREE.BufferAttribute).array,
    );
    const souls = scene.getObjectByName('sentence-vfx-soul-fragments-0') as THREE.Points;
    const soulPositions = Array.from(
      (souls.geometry.getAttribute('position') as THREE.BufferAttribute).array,
    );

    advance(vfx, 0.5, true);
    for (const pose of poses) {
      const object = scene.getObjectByName(pose.name);
      expect(object?.scale).toEqual(pose.scale);
      expect(
        object ? [object.rotation.x, object.rotation.y, object.rotation.z] : undefined,
      ).toEqual(pose.rotation);
    }
    expect(
      Array.from((sparks.geometry.getAttribute('position') as THREE.BufferAttribute).array),
    ).toEqual(sparkPositions);
    expect(
      Array.from((souls.geometry.getAttribute('position') as THREE.BufferAttribute).array),
    ).toEqual(soulPositions);
  });

  it('keeps fizzle static under reduced motion and frame-rate independent otherwise', () => {
    function fizzlePose(step: number, reducedMotion: boolean): { rotation: number; scale: number } {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      const anchors = new Map([
        [1, new THREE.Vector3(0, 0, 0)],
        [2, new THREE.Vector3(20, 0, 0)],
      ]);
      const vfx = makeVfx(scene, camera, anchors);
      expect(vfx.trigger(1, 2, 100)).toBe(true);
      vfx.update(0.17, reducedMotion);
      anchors.delete(2);
      vfx.update(0, reducedMotion);
      let remaining = 0.18;
      while (remaining > 1e-6) {
        const dt = Math.min(step, remaining);
        vfx.update(dt, reducedMotion);
        remaining -= dt;
      }
      const vortex = scene.getObjectByName('sentence-vfx-vortex-0') as THREE.Mesh;
      return { rotation: vortex.rotation.y, scale: vortex.scale.x };
    }

    const reduced = fizzlePose(1 / 144, true);
    expect(reduced.rotation).toBe(0);
    expect(reduced.scale).toBe(0.32);

    const atThirtyFps = fizzlePose(1 / 30, false);
    const atOneFortyFourFps = fizzlePose(1 / 144, false);
    expect(atThirtyFps.rotation).toBeCloseTo(atOneFortyFourFps.rotation, 8);
    expect(atThirtyFps.scale).toBeCloseTo(atOneFortyFourFps.scale, 8);
  });
});
