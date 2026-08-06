import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isNameplateScreenAnchorVisible,
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from '../src/render/nameplate_projection';

describe('nameplate projection', () => {
  function camera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    cam.position.set(0, 2, 10);
    cam.lookAt(0, 2, 0);
    cam.updateMatrixWorld();
    return cam;
  }

  it('keeps anchors in front of the camera visible', () => {
    const cam = camera();
    const scratch = new THREE.Vector3();

    expect(isProjectedNameplateAnchorVisible(cam, new THREE.Vector3(0, 2, 0), scratch)).toBe(true);
  });

  it('hides anchors behind the camera before their projected coordinates can leak on-screen', () => {
    const cam = camera();
    const scratch = new THREE.Vector3();

    expect(isProjectedNameplateAnchorVisible(cam, new THREE.Vector3(0, 2, 12), scratch)).toBe(
      false,
    );
  });

  it('keeps sub-pixel screen transforms so nameplates do not snap while moving', () => {
    expect(nameplateScreenTransform(123.456, 78.123)).toBe(
      'translate3d(123.46px, 78.12px, 0) translate(-50%, -100%)',
    );
  });

  it('rejects anchors outside the viewport before decluttering and painting them', () => {
    expect(isNameplateScreenAnchorVisible(640, 360, 1280, 720)).toBe(true);
    // Keep a bounded gutter so a wide plate or an emote can remain partially visible.
    expect(isNameplateScreenAnchorVisible(-119, 360, 1280, 720)).toBe(true);
    expect(isNameplateScreenAnchorVisible(-121, 360, 1280, 720)).toBe(false);
    expect(isNameplateScreenAnchorVisible(1401, 360, 1280, 720)).toBe(false);
    expect(isNameplateScreenAnchorVisible(640, -121, 1280, 720)).toBe(false);
    expect(isNameplateScreenAnchorVisible(640, 841, 1280, 720)).toBe(false);
  });
});
