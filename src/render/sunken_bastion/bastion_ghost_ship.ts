// Optional broadside art loads independently of every gameplay tell. Its
// own scene sibling is compile-gated only after all ship materials exist.
import * as THREE from 'three';
import { GHOST_BROADSIDE_SHIP } from '../../sim/encounters/sunken_bastion/ghost_captain_ids';
import type { IWorld } from '../../world_api';
import { loadGltf } from '../assets/loader';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import { ghostCueProgress, ghostShipOpacity, ghostShipPoseInto } from './bastion_ghost_fx_core';
import { inBastionClaim } from './bastion_trash_fx_core';

export const GHOST_SHIP_URL = '/models/props/bastion_ghost_ship.glb';
// Deliberately absent from the global preload registry: optional art must
// never keep assetsReady, dungeon entry or an authoritative tell pending.

export class BastionGhostShip {
  readonly ready: Promise<void>;
  private readonly root = new THREE.Group();
  private disposed = false;
  private loaded = false;
  private markerId = -1;
  private scan = 0;
  private readonly materials: THREE.Material[] = [];
  private readonly pose = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(
    parent: THREE.Object3D,
    private readonly world?: IWorld,
    private readonly reducedMotion: () => boolean = () => false,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'bastion-spectral-broadside-ship';
    this.root.visible = false;
    this.ready = loadGltf(GHOST_SHIP_URL)
      .then(async (gltf) => {
        if (this.disposed) return;
        const ship = gltf.scene.clone(true);
        const clones = new Map<THREE.Material, THREE.Material>();
        const spectral = (source: THREE.Material): THREE.Material => {
          let clone = clones.get(source);
          if (!clone) {
            clone = cloneMaterialWithHooks(source);
            clone.transparent = true;
            clone.opacity = 0.58;
            clone.depthWrite = false;
            clones.set(source, clone);
            this.materials.push(clone);
          }
          return clone;
        };
        ship.traverse((node) => {
          if (node instanceof THREE.Mesh)
            node.material = Array.isArray(node.material)
              ? node.material.map(spectral)
              : spectral(node.material);
        });
        this.root.add(ship);
        await attachSceneGroupGated(parent, this.root, compileGate, () => this.disposed);
        if (this.disposed) return;
        this.root.visible = false;
        this.loaded = true;
        this.update(0);
      })
      .catch(() => {
        // Authoritative lanes remain visible if art fails to load.
        if (!this.disposed) console.warn('Ghost broadside ship failed to load', GHOST_SHIP_URL);
      });
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || !this.loaded || this.disposed) return;
    if (!inBastionClaim(world.player.pos.x)) {
      this.root.visible = false;
      this.markerId = -1;
      return;
    }
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.1;
      this.markerId = -1;
      for (const e of world.entities.values()) {
        if (
          e.templateId === GHOST_BROADSIDE_SHIP &&
          !e.dead &&
          Math.abs(e.pos.x - world.player.pos.x) < 180 &&
          Math.abs(e.pos.z - world.player.pos.z) < 240
        ) {
          this.markerId = e.id;
          break;
        }
      }
    }
    const e = world.entities.get(this.markerId);
    this.root.visible = !!e && !e.dead;
    if (!e || e.dead) return;
    // The marker is the centre cannon's locked firing origin. The starboard
    // muzzle is authored at X=2.705, Y=2.1, Z=0; all five align to the lanes.
    const fill = ghostCueProgress(e.castRemaining, e.castTotal);
    const pose = ghostShipPoseInto(
      this.pose,
      e.pos.x,
      e.pos.y,
      e.pos.z,
      e.facing,
      fill,
      this.reducedMotion(),
    );
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
    for (const m of this.materials) m.opacity = ghostShipOpacity(fill);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.clear();
    for (const m of this.materials) m.dispose();
  }
}
