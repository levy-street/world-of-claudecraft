// Owner-only encounter pool. No shared entities, lights, profile-dependent
// visibility or per-shot GPU allocation. The entry barrier warms every mesh
// before the player can start the timed encounter.
import * as THREE from 'three';
import { CANNON_ACTIONS } from '../sim/content/cannon_encounter';
import { VEHICLE_STATIONS } from '../sim/content/vehicle_stations';
import type { VehicleSession } from '../sim/types';
import { vehicleStationById } from '../sim/vehicle_stations';
import { loadGltf } from './assets/loader';
import { timeBuildSpan } from './build_spans';
import { CannonEnemyVisuals } from './cannon_enemy_visuals';
import { CannonTacticalVisuals, cannonBarrelTemplate } from './cannon_tactical_visuals';
import { charactersReady } from './characters/assets';
import { buildDoorBody, buildRiftGateBody } from './door_portal';
import { attachSceneGroupGated } from './gated_scene_attach';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

export class CannonEncounterVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private readonly content = new THREE.Group();
  private readonly materials = worldQuestTraceMaterials();
  private readonly sphere = new THREE.SphereGeometry(1, 8, 6);
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly ring = new THREE.RingGeometry(0.86, 1, 32);
  private enemies: CannonEnemyVisuals | null = null;
  private tactics: CannonTacticalVisuals | null = null;
  private readonly shots = Array.from({ length: 4 }, () =>
    this.mesh(this.sphere, this.materials.gold),
  );
  private readonly fires = Array.from({ length: 2 }, () =>
    this.mesh(this.ring, this.materials.red),
  );
  private disposed = false;
  private stationId: string | null = null;
  private readonly markers: { mesh: THREE.Mesh; u: number; v: number }[] = [];
  private readonly portalsRoot = new THREE.Group();
  private readonly portals: { body: THREE.Group; portal?: THREE.Mesh }[] = [];

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly lowGfx = false,
  ) {
    this.group.name = 'personal-cannon-encounter';
    this.group.add(this.content);
    const field = VEHICLE_STATIONS[0].field;
    // Three marching lanes and the breach line are visible on every tier.
    for (const lane of [0.2, 0.5, 0.8]) {
      const x = field.minX + lane * (field.maxX - field.minX);
      for (let z = field.minZ; z <= field.maxZ; z += 3) {
        const marker = this.mesh(this.box, this.materials.gold);
        marker.scale.set(0.22, 0.06, 1.2);
        marker.position.set(x, groundAt(x, z) + 0.12, z);
        this.markers.push({
          mesh: marker,
          u: lane,
          v: (z - field.minZ) / (field.maxZ - field.minZ),
        });
      }
    }
    for (let x = field.minX; x <= field.maxX; x += 2) {
      const marker = this.mesh(this.box, this.materials.red);
      marker.scale.set(1.8, 0.08, 0.35);
      marker.position.set(x, groundAt(x, field.maxZ) + 0.12, field.maxZ);
      this.markers.push({ mesh: marker, u: (x - field.minX) / (field.maxX - field.minX), v: 1 });
    }
    this.portalsRoot.name = 'cannon-portals';
    this.content.add(this.portalsRoot);
    this.content.visible = false;
    this.readyForEntry = this.prepare(scene, compileGate);
  }

  private mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent = this.content,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.renderCategory = 'ui3d';
    parent.add(mesh);
    return mesh;
  }

  private async prepare(
    scene: THREE.Object3D,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ): Promise<void> {
    const [, barrel] = await Promise.all([charactersReady(), loadGltf('/models/props/barrel.glb')]);
    if (this.disposed) return;
    const template = cannonBarrelTemplate(barrel.scene);
    this.enemies = timeBuildSpan('zone:cannon-enemies', () => new CannonEnemyVisuals(template));
    this.tactics = new CannonTacticalVisuals(template, scene);
    this.content.add(this.tactics.root);
    this.content.add(this.enemies.root);
    await attachSceneGroupGated(scene, this.group, compileGate, () => this.disposed).catch(
      (error) => {
        if (!this.disposed) throw error;
      },
    );
    if (!this.disposed) this.enemies.update(null, 0, this.groundAt);
  }

  update(session: VehicleSession | null | undefined, dt = 0.05, reducedMotion = false): void {
    if (this.disposed) return;
    const station = session && vehicleStationById(session.stationId);
    if (!station) session = null;
    this.content.visible = !!session;
    this.enemies?.update(session, dt, this.groundAt, reducedMotion);
    this.tactics?.update(session, this.groundAt, reducedMotion);
    if (!reducedMotion) {
      for (const p of this.portals) {
        if (p.portal) p.portal.rotation.z += dt * 1.4;
      }
    }
    if (!session || !station) {
      if (this.stationId !== null) {
        this.stationId = null;
        this.clearPortals();
      }
      return;
    }
    if (this.stationId !== station.id) {
      this.stationId = station.id;
      const field = station.field;
      for (const { mesh, u, v } of this.markers) {
        const x = field.minX + u * (field.maxX - field.minX);
        const z = field.minZ + v * (field.maxZ - field.minZ);
        mesh.position.set(x, this.groundAt(x, z) + 0.12, z);
      }
      this.clearPortals();
      for (const lane of [0.2, 0.5, 0.8]) {
        const x = field.minX + lane * (field.maxX - field.minX);
        const z = field.minZ;
        const built =
          buildRiftGateBody(this.lowGfx, 'A') ?? buildDoorBody(true, undefined, this.lowGfx);
        built.body.name = 'cannon-rift-portal';
        if (built.portal) built.portal.name = 'cannon-rift-portal-membrane';
        built.body.scale.setScalar(0.85);
        built.body.position.set(x, this.groundAt(x, z), z);
        this.portalsRoot.add(built.body);
        this.portals.push(built);
      }
    }
    const state = session.encounter;
    for (let i = 0; i < this.shots.length; i++) {
      const mesh = this.shots[i],
        shot = state.shots[i];
      mesh.visible = !!shot;
      if (!shot) continue;
      const t = Math.max(
        0,
        Math.min(1, (state.tick - shot.firedTick) / (shot.impactTick - shot.firedTick)),
      );
      const x = station.x + (shot.x - station.x) * t;
      const z = station.z + (shot.z - station.z) * t;
      mesh.position.set(x, this.groundAt(x, z) + 2 + 24 * t * (1 - t), z);
      mesh.scale.setScalar(shot.action === 'incendiary' ? 0.65 : 0.4);
    }
    for (let i = 0; i < this.fires.length; i++) {
      const mesh = this.fires[i],
        fire = state.fires[i];
      mesh.visible = !!fire;
      if (!fire) continue;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(fire.x, this.groundAt(fire.x, fire.z) + 0.2, fire.z);
      mesh.scale.setScalar(CANNON_ACTIONS.incendiary.radius);
    }
  }

  private clearPortals(): void {
    for (const portal of this.portals) {
      portal.body.removeFromParent();
    }
    this.portals.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    this.enemies?.dispose();
    this.tactics?.dispose();
    this.clearPortals();
    this.sphere.dispose();
    this.box.dispose();
    this.ring.dispose();
    // Materials are page-lifetime prewarmed resources, owned by their cache.
  }
}
