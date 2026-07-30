// Thin Three.js drawing adapter for deterministic cinematic gizmo geometry.

import * as THREE from 'three';
import type {
  CinematicFramingGizmo,
  CinematicGizmo,
  CinematicGizmoFrame,
  CinematicGizmoState,
  CinematicHullGizmo,
  CinematicSupportGizmo,
} from '../cinematic_gizmo_core';

const NEUTRAL_COLOR = 0x45c9e8;
const VIOLATION_COLOR = 0xff3434;
const GIZMO_RENDER_ORDER = 50;

export class CinematicGizmoLayer {
  private readonly group = new THREE.Group();
  private readonly materials: Record<CinematicGizmoState, THREE.LineBasicMaterial> = {
    neutral: lineMaterial(NEUTRAL_COLOR),
    violation: lineMaterial(VIOLATION_COLOR),
  };

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'editor-cinematic-gizmos';
    this.scene.add(this.group);
  }

  update(frame: CinematicGizmoFrame): void {
    this.clear();
    for (const gizmo of frame.gizmos) {
      const object = this.objectFor(gizmo);
      object.renderOrder = GIZMO_RENDER_ORDER;
      object.frustumCulled = false;
      this.group.add(object);
    }
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
    this.materials.neutral.dispose();
    this.materials.violation.dispose();
  }

  private objectFor(gizmo: CinematicGizmo): THREE.LineSegments {
    switch (gizmo.kind) {
      case 'hull':
        return this.hullObject(gizmo);
      case 'support':
        return this.supportObject(gizmo);
      case 'framing':
        return this.framingObject(gizmo);
    }
  }

  private hullObject(gizmo: CinematicHullGizmo): THREE.LineSegments {
    const box = new THREE.BoxGeometry(gizmo.size.x, gizmo.size.y, gizmo.size.z);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const lines = new THREE.LineSegments(edges, this.materials[gizmo.state]);
    lines.position.set(gizmo.center.x, gizmo.center.y, gizmo.center.z);
    lines.rotation.y = gizmo.yaw;
    return lines;
  }

  private supportObject(gizmo: CinematicSupportGizmo): THREE.LineSegments {
    return new THREE.LineSegments(
      segmentsGeometry([[gizmo.from, gizmo.to]]),
      this.materials[gizmo.state],
    );
  }

  private framingObject(gizmo: CinematicFramingGizmo): THREE.LineSegments {
    const [topLeft, topRight, bottomRight, bottomLeft] = gizmo.corners;
    return new THREE.LineSegments(
      segmentsGeometry([
        [gizmo.camera, topLeft],
        [gizmo.camera, topRight],
        [gizmo.camera, bottomRight],
        [gizmo.camera, bottomLeft],
        [topLeft, topRight],
        [topRight, bottomRight],
        [bottomRight, bottomLeft],
        [bottomLeft, topLeft],
      ]),
      this.materials[gizmo.state],
    );
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.LineSegments) child.geometry.dispose();
    }
  }
}

function lineMaterial(color: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
  });
}

function segmentsGeometry(
  segments: readonly (readonly [
    { readonly x: number; readonly y: number; readonly z: number },
    { readonly x: number; readonly y: number; readonly z: number },
  ])[],
): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (const [start, end] of segments) {
    points.push(
      new THREE.Vector3(start.x, start.y, start.z),
      new THREE.Vector3(end.x, end.y, end.z),
    );
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}
