import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundPointProjector } from '../src/render/ground_point_projector';

describe('GroundPointProjector', () => {
  it('projects relative to the canvas bounds rather than the window', () => {
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const projector = new GroundPointProjector(
      {
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 100 }) as DOMRect,
      },
      camera,
    );

    const hit = projector.project(200, 100, 0);
    expect(hit?.x).toBeCloseTo(0, 5);
    expect(hit?.z).toBeCloseTo(0, 5);
  });

  it('fails safely when the canvas has no drawable area', () => {
    const projector = new GroundPointProjector(
      {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect,
      },
      new THREE.PerspectiveCamera(),
    );
    expect(projector.project(0, 0, 0)).toBeNull();
  });
});
