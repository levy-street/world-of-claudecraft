// Thin Three.js painter for the Undermount's actionable encounter decals.
// Every cue is present at every graphics tier and under reduced motion.

import * as THREE from 'three';
import type { Entity } from '../sim/types';
import type { ActiveUndermountVent } from '../world_api';
import {
  UNDERMOUNT_DECAL,
  undermountDecalColor,
  undermountEntityDecalMask,
} from './undermount_decals_core';

const SEGMENTS = 64;
const FLOOR_LIFT = 0.09;
const MARK_LIFT = 2.8;
const ERUPTION_TELEGRAPH_S = 3;
const ERUPTION_RING_RADIUS = 34;

interface VentVisual {
  group: THREE.Group;
  seenAt: number;
}

interface EntityVisual {
  group: THREE.Group;
  forgeheat: THREE.Mesh;
  scorched: THREE.LineLoop;
  chilled: THREE.LineLoop;
  seenAt: number;
}

function lineMaterial(color: number, opacity = 0.95): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
  });
}

function glyphGeometry(points: ReadonlyArray<readonly [number, number]>): THREE.BufferGeometry {
  return new THREE.BufferGeometry().setFromPoints(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
  );
}

export class UndermountDecals {
  private readonly vents = new Map<string, VentVisual>();
  private readonly entities = new Map<number, EntityVisual>();
  private generation = 0;

  private readonly ventRingGeometry = new THREE.RingGeometry(0.82, 1, SEGMENTS).rotateX(
    -Math.PI / 2,
  );
  private readonly ventCoreGeometry = new THREE.CircleGeometry(0.76, SEGMENTS).rotateX(
    -Math.PI / 2,
  );
  private readonly forgeheatGeometry = new THREE.RingGeometry(0.92, 1, SEGMENTS).rotateX(
    -Math.PI / 2,
  );
  private readonly scorchedGeometry = glyphGeometry([
    [0, 0.85],
    [-0.72, -0.62],
    [0.72, -0.62],
  ]);
  private readonly chilledGeometry = glyphGeometry([
    [0, 0.9],
    [-0.7, 0],
    [0, -0.9],
    [0.7, 0],
  ]);
  private readonly eruptionGeometry = new THREE.RingGeometry(0.9, 1, SEGMENTS).rotateX(
    -Math.PI / 2,
  );
  private readonly eruptionMaterial = new THREE.MeshBasicMaterial({
    color: undermountDecalColor('eruption'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  private readonly eruptionRing = new THREE.Mesh(this.eruptionGeometry, this.eruptionMaterial);
  private eruptionElapsed = ERUPTION_TELEGRAPH_S;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    this.eruptionRing.name = 'undermount-eruption-telegraph';
    this.eruptionRing.renderOrder = 12;
    this.eruptionRing.visible = false;
    this.eruptionRing.frustumCulled = false;
    this.scene.add(this.eruptionRing);
  }

  syncVents(vents: readonly ActiveUndermountVent[]): void {
    const generation = ++this.generation;
    for (const vent of vents) {
      let visual = this.vents.get(vent.id);
      if (!visual) {
        visual = this.createVent();
        this.vents.set(vent.id, visual);
      }
      visual.seenAt = generation;
      visual.group.position.set(vent.x, this.groundY(vent.x, vent.z) + FLOOR_LIFT, vent.z);
      visual.group.scale.setScalar(vent.radius);
    }
    for (const [id, visual] of this.vents) {
      if (visual.seenAt === generation) continue;
      this.scene.remove(visual.group);
      this.disposeMaterialTree(visual.group);
      this.vents.delete(id);
    }
  }

  syncEntities(
    entities: Iterable<Entity>,
    views: { get(id: number): { group: THREE.Object3D } | undefined },
    camera: THREE.Camera,
  ): void {
    const generation = ++this.generation;
    for (const entity of entities) {
      const mask = undermountEntityDecalMask(entity.auras);
      if (mask === 0) continue;
      const view = views.get(entity.id);
      if (!view?.group.visible) continue;
      let visual = this.entities.get(entity.id);
      if (!visual) {
        visual = this.createEntityVisual();
        this.entities.set(entity.id, visual);
      }
      visual.seenAt = generation;
      const position = view.group.position;
      visual.group.position.copy(position);
      visual.forgeheat.visible = (mask & UNDERMOUNT_DECAL.forgeheat) !== 0;
      visual.scorched.visible = (mask & UNDERMOUNT_DECAL.scorched) !== 0;
      visual.chilled.visible = (mask & UNDERMOUNT_DECAL.chilled) !== 0;
      visual.forgeheat.position.y = FLOOR_LIFT;
      visual.forgeheat.scale.setScalar(1.55 * entity.scale);
      for (const glyph of [visual.scorched, visual.chilled]) {
        glyph.position.y = MARK_LIFT * entity.scale;
        glyph.scale.setScalar(0.72 * entity.scale);
        glyph.quaternion.copy(camera.quaternion);
      }
    }
    for (const [id, visual] of this.entities) {
      if (visual.seenAt === generation) continue;
      this.scene.remove(visual.group);
      this.disposeMaterialTree(visual.group);
      this.entities.delete(id);
    }
  }

  beginEruption(x: number, z: number): void {
    this.eruptionElapsed = 0;
    this.eruptionRing.position.set(x, this.groundY(x, z) + FLOOR_LIFT * 1.5, z);
    this.eruptionRing.scale.setScalar(ERUPTION_RING_RADIUS);
    this.eruptionRing.visible = true;
  }

  update(dt: number): void {
    if (this.eruptionElapsed >= ERUPTION_TELEGRAPH_S) return;
    this.eruptionElapsed += dt;
    const t = Math.min(1, this.eruptionElapsed / ERUPTION_TELEGRAPH_S);
    this.eruptionMaterial.opacity = 0.42 + 0.48 * (0.5 + 0.5 * Math.sin(t * Math.PI * 10));
    if (t >= 1) this.eruptionRing.visible = false;
  }

  dispose(): void {
    for (const visual of this.vents.values()) {
      this.scene.remove(visual.group);
      this.disposeMaterialTree(visual.group);
    }
    for (const visual of this.entities.values()) {
      this.scene.remove(visual.group);
      this.disposeMaterialTree(visual.group);
    }
    this.vents.clear();
    this.entities.clear();
    this.scene.remove(this.eruptionRing);
    this.eruptionMaterial.dispose();
    this.ventRingGeometry.dispose();
    this.ventCoreGeometry.dispose();
    this.forgeheatGeometry.dispose();
    this.scorchedGeometry.dispose();
    this.chilledGeometry.dispose();
    this.eruptionGeometry.dispose();
  }

  private createVent(): VentVisual {
    const group = new THREE.Group();
    group.name = 'undermount-vent-decal';
    const core = new THREE.Mesh(
      this.ventCoreGeometry,
      new THREE.MeshBasicMaterial({
        color: undermountDecalColor('ventCore'),
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const ring = new THREE.Mesh(
      this.ventRingGeometry,
      new THREE.MeshBasicMaterial({
        color: undermountDecalColor('ventRing'),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    core.renderOrder = 9;
    ring.renderOrder = 10;
    group.add(core, ring);
    this.scene.add(group);
    return { group, seenAt: this.generation };
  }

  private createEntityVisual(): EntityVisual {
    const group = new THREE.Group();
    group.name = 'undermount-entity-decals';
    const forgeheat = new THREE.Mesh(
      this.forgeheatGeometry,
      new THREE.MeshBasicMaterial({
        color: undermountDecalColor('forgeheat'),
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    forgeheat.renderOrder = 11;
    const scorched = new THREE.LineLoop(
      this.scorchedGeometry,
      lineMaterial(undermountDecalColor('scorched')),
    );
    const chilled = new THREE.LineLoop(
      this.chilledGeometry,
      lineMaterial(undermountDecalColor('chilled')),
    );
    scorched.renderOrder = 12;
    chilled.renderOrder = 12;
    group.add(forgeheat, scorched, chilled);
    this.scene.add(group);
    return { group, forgeheat, scorched, chilled, seenAt: this.generation };
  }

  private disposeMaterialTree(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      const material = object.material;
      if (Array.isArray(material)) {
        for (const entry of material) entry.dispose();
      } else {
        material.dispose();
      }
    });
  }
}
