import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { projectionScalePixels } from '../src/render/perceptual_lod_core';
import {
  CAMPFIRE_EMBER_MIN_PROJECTED_PIXELS,
  updateSceneryFlame,
} from '../src/render/scenery_flame';

const cameraPosition = new THREE.Vector3();
const viewForward = new THREE.Vector3(0, 0, 1);

function flame(color: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1, 6),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.z = z;
  return mesh;
}

describe('production scenery flame cadence', () => {
  it('pins the ember threshold at exactly 10 projected pixels', () => {
    expect(CAMPFIRE_EMBER_MIN_PROJECTED_PIXELS).toBe(10);
    expect(
      updateSceneryFlame(flame(0xff8800, 10), 0, 1, cameraPosition, viewForward, 100)?.emitsEmber,
    ).toBe(true);
    expect(
      updateSceneryFlame(flame(0xff8800, 10), 0, 1, cameraPosition, viewForward, 99.99)?.emitsEmber,
    ).toBe(false);
  });

  it('samples visible far flicker at elapsed-time cadence and suppresses sub-10px embers', () => {
    const mesh = flame(0xff8800, 80);
    const projectionPixels = projectionScalePixels(1 / Math.tan(Math.PI / 6), 720);
    const first = updateSceneryFlame(mesh, 2, 1, cameraPosition, viewForward, projectionPixels);
    expect(first).not.toBeNull();
    expect(first?.emitsEmber).toBe(false);
    const firstScale = mesh.scale.clone();

    const skipped = updateSceneryFlame(
      mesh,
      2,
      1.01,
      cameraPosition,
      viewForward,
      projectionPixels,
      first ?? undefined,
    );
    expect(skipped).toBe(first);
    expect(mesh.scale).toEqual(firstScale);

    updateSceneryFlame(
      mesh,
      2,
      1.05,
      cameraPosition,
      viewForward,
      projectionPixels,
      first ?? undefined,
    );
    expect(mesh.scale).not.toEqual(firstScale);
  });

  it('emits only warm, visible, front-facing flames that remain at least 10 pixels', () => {
    const projectionPixels = projectionScalePixels(1 / Math.tan(Math.PI / 6), 720);
    expect(
      updateSceneryFlame(flame(0xff8800, 40), 0, 1, cameraPosition, viewForward, projectionPixels)
        ?.emitsEmber,
    ).toBe(true);
    expect(
      updateSceneryFlame(flame(0x66ffff, 40), 0, 1, cameraPosition, viewForward, projectionPixels)
        ?.emitsEmber,
    ).toBe(false);

    const hiddenParent = new THREE.Group();
    hiddenParent.visible = false;
    const hidden = flame(0xff8800, 40);
    hiddenParent.add(hidden);
    expect(
      updateSceneryFlame(hidden, 0, 1, cameraPosition, viewForward, projectionPixels),
    ).toBeNull();
    const behind = flame(0xff8800, -40);
    const behindState = updateSceneryFlame(
      behind,
      0,
      1,
      cameraPosition,
      viewForward,
      projectionPixels,
    );
    expect(behindState?.active).toBe(false);
    expect(behindState?.emitsEmber).toBe(false);
    expect(
      updateSceneryFlame(
        behind,
        0,
        2,
        cameraPosition,
        viewForward,
        projectionPixels,
        behindState ?? undefined,
      ),
    ).toBe(behindState);
  });

  it('uses the live camera FOV to decide the same flame projected size', () => {
    const mesh = flame(0xff8800, 80);
    const narrowCamera = new THREE.PerspectiveCamera(45, 16 / 9);
    const wideCamera = new THREE.PerspectiveCamera(90, 16 / 9);
    const narrow = projectionScalePixels(narrowCamera.projectionMatrix.elements[5], 720);
    const wide = projectionScalePixels(wideCamera.projectionMatrix.elements[5], 720);

    const narrowState = updateSceneryFlame(mesh, 0, 1, cameraPosition, viewForward, narrow);
    const wideState = updateSceneryFlame(mesh, 0, 1, cameraPosition, viewForward, wide);
    expect(narrowState?.emitsEmber).toBe(true);
    expect(wideState?.emitsEmber).toBe(false);
  });
});
