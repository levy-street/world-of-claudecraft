import * as THREE from 'three';
import { SHADOW_GUARDS, SHADOW_QUEST_ID } from '../sim/content/world_quest_shadow';
import { shadowGuardDetects } from '../sim/world_quest_shadow_patrol';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import {
  SHADOW_RING_SEGMENTS,
  shadowDetectionVisible,
  writeShadowRing,
} from './shadow_detection_core';

function strip(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array((SHADOW_RING_SEGMENTS + 1) * 6), 3),
  );
  const indices: number[] = [];
  for (let i = 0; i < SHADOW_RING_SEGMENTS; i++) {
    const at = i * 2;
    indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
  }
  geometry.setIndex(indices);
  return geometry;
}

/** Personal, tier-independent warnings. Positions and radii are authoritative game data. */
export class ShadowInfiltrationVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private ready = false;
  private disposed = false;
  private readonly zones = SHADOW_GUARDS.map((guard) => {
    const edge = new THREE.Mesh(
      strip(),
      new THREE.MeshBasicMaterial({
        color: 0xffbd49,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const fill = new THREE.Mesh(
      strip(),
      new THREE.MeshBasicMaterial({
        color: 0xff842d,
        transparent: true,
        opacity: guard.sentry ? 0.15 : 0.06,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    edge.frustumCulled = fill.frustumCulled = false;
    edge.renderOrder = 5;
    fill.renderOrder = 4;
    return { guard, edge, fill, x: Number.NaN, z: Number.NaN };
  });
  // Lantern wedges, one pair per cone guard, appended AFTER every ring so the ring
  // child order (pinned by tests/shadow_detection.test.ts) is unchanged.
  private readonly wedges = SHADOW_GUARDS.filter((guard) => guard.cone).map((guard) => {
    const edge = new THREE.Mesh(
      strip(),
      new THREE.MeshBasicMaterial({
        color: 0xffbd49,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const fill = new THREE.Mesh(
      strip(),
      new THREE.MeshBasicMaterial({
        color: 0xff842d,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    edge.frustumCulled = fill.frustumCulled = false;
    edge.renderOrder = 5;
    fill.renderOrder = 4;
    return { guard, edge, fill, x: Number.NaN, z: Number.NaN, facing: Number.NaN };
  });

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.group.name = 'shadow-infiltration-detection';
    this.group.visible = false;
    for (const zone of this.zones) {
      this.group.add(zone.fill, zone.edge);
      this.position(zone, zone.guard.npc.pos.x, zone.guard.npc.pos.z);
    }
    for (const wedge of this.wedges) {
      this.group.add(wedge.fill, wedge.edge);
      this.aim(wedge, wedge.guard.npc.pos.x, wedge.guard.npc.pos.z, wedge.guard.npc.facing);
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.group, compileGate, () => this.disposed)
      .then(() => {
        this.ready = true;
        this.group.visible = false;
      })
      .catch(() => {
        if (!this.disposed) this.ready = true;
      });
  }

  private position(zone: (typeof this.zones)[number], x: number, z: number): void {
    const radius = zone.guard.detectionRadius;
    for (const [mesh, inner] of [
      [zone.fill, 0],
      [zone.edge, Math.max(0, radius - 0.12)],
    ] as const) {
      const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      writeShadowRing(attribute.array as Float32Array, x, z, inner, radius, this.groundAt);
      attribute.needsUpdate = true;
    }
    zone.x = x;
    zone.z = z;
  }

  private aim(wedge: (typeof this.wedges)[number], x: number, z: number, facing: number): void {
    const cone = wedge.guard.cone;
    if (!cone) return;
    const start = facing - cone.halfAngle;
    const sweep = cone.halfAngle * 2;
    for (const [mesh, inner] of [
      [wedge.fill, 0],
      [wedge.edge, Math.max(0, cone.radius - 0.12)],
    ] as const) {
      const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      writeShadowRing(
        attribute.array as Float32Array,
        x,
        z,
        inner,
        cone.radius,
        this.groundAt,
        start,
        sweep,
      );
      attribute.needsUpdate = true;
    }
    wedge.x = x;
    wedge.z = z;
    wedge.facing = facing;
  }

  update(world: IWorld): void {
    const progress = world.worldQuestLog.get(SHADOW_QUEST_ID);
    this.group.visible =
      this.ready && !this.disposed && shadowDetectionVisible(progress, world.player.dead);
    if (!this.group.visible) return;
    for (const zone of this.zones) {
      const guard = world.entities.get(zone.guard.entityId);
      zone.edge.visible = zone.fill.visible = !!guard && !guard.dead;
      if (!guard || guard.dead) continue;
      if (zone.x !== guard.pos.x || zone.z !== guard.pos.z)
        this.position(zone, guard.pos.x, guard.pos.z);
      const stolen = progress?.creditedObjects?.includes(String(guard.id)) ?? false;
      const inside = shadowGuardDetects(zone.guard, guard, world.player.pos);
      zone.edge.material.color.setHex(inside ? 0xff4438 : stolen ? 0x73e6a4 : 0xffbd49);
      zone.fill.material.color.copy(zone.edge.material.color);
    }
    for (const wedge of this.wedges) {
      const guard = world.entities.get(wedge.guard.entityId);
      wedge.edge.visible = wedge.fill.visible = !!guard && !guard.dead;
      if (!guard || guard.dead) continue;
      if (wedge.x !== guard.pos.x || wedge.z !== guard.pos.z || wedge.facing !== guard.facing)
        this.aim(wedge, guard.pos.x, guard.pos.z, guard.facing);
      const inside = shadowGuardDetects(wedge.guard, guard, world.player.pos);
      wedge.edge.material.color.setHex(inside ? 0xff4438 : 0xffbd49);
      wedge.fill.material.color.copy(wedge.edge.material.color);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    for (const zone of [...this.zones, ...this.wedges]) {
      zone.edge.geometry.dispose();
      zone.fill.geometry.dispose();
      zone.edge.material.dispose();
      zone.fill.material.dispose();
    }
  }
}
