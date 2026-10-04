// The Fire and Fly cannon tower, drawn: the stone tower of hex_tower_cannon.glb
// at the session centre, at the sim's own scale so its roof is where the sim
// seats the player. Only the head turns (toward the aim, eased) and hops on its
// mount when the Shockwave slams; the barrel,
// its child, lifts to the elevation of the shot it fires, and the weapon
// (cannon_shell_visuals.ts) takes its muzzle and kicks its recoil from it.
// Loaded and built at the commitment (the first frame seen seated), then
// attached behind the compile gate; its one named material is its own, so the
// kit's shared materials never change for anyone else. No light; it casts and
// takes shadows like the arena's other stones. The pure half is
// turret_tower_core.ts.
import * as THREE from 'three';
import { FIRE_AND_FLY_TOWER } from '../sim/fire_and_fly_field';
import { loadGltf } from './assets/loader';
import { timeBuildSpan } from './build_spans';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX } from './gfx';
import {
  stepTurretHeadYaw,
  TURRET_BARREL,
  TURRET_TOWER_MODEL,
  turretHeadHop,
  turretRestPitch,
} from './turret_tower_core';

type CompileGate = (target: THREE.Object3D) => Promise<unknown>;
/** The tower's scene graph as authored; the visual draws a clone of it. */
export type TurretTowerSource = () => Promise<THREE.Object3D>;

export const TURRET_TOWER_NAME = 'fire-and-fly-tower';
export const TURRET_TOWER_MATERIAL_PREFIX = 'fireAndFly:tower:';

const loadTowerModel: TurretTowerSource = () =>
  loadGltf(TURRET_TOWER_MODEL.url).then((gltf) => gltf.scene);

export class TurretTowerVisual {
  /** Placed at the session centre: the tower's foot. */
  readonly group = new THREE.Group();
  private head: THREE.Object3D | null = null;
  private barrel: THREE.Object3D | null = null;
  private readonly materials: THREE.Material[] = [];
  private state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private disposed = false;
  private yaw = 0;
  private pitch = turretRestPitch();
  /** The head's seat in its parent's space, and the parent's units per yard. */
  private headRestY = 0;
  private headUnits = 1;
  private hopAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly compileGate?: CompileGate,
    private readonly source: TurretTowerSource = loadTowerModel,
  ) {
    this.group.name = TURRET_TOWER_NAME;
  }

  /** The build started (the model may still be on its way). */
  get prepared(): boolean {
    return this.state !== 'idle';
  }

  /** The barrel node the weapon fires from, once the model is built. */
  get barrelNode(): THREE.Object3D | null {
    return this.barrel;
  }

  /** The head's drawn yaw (x += sin, z += cos). */
  get headYaw(): number {
    return this.yaw;
  }

  get barrelPitch(): number {
    return this.pitch;
  }

  /** Loads and builds the tower once, then attaches it under `parent` behind the compile gate.
   *  A load that fails leaves the tower unprepared and calls `onUnavailable`, so the caller
   *  can try again later; a model without its head or barrel stays failed. */
  prepare(parent: THREE.Object3D, onReady?: () => void, onUnavailable?: () => void): void {
    if (this.state !== 'idle' || this.disposed) return;
    this.state = 'loading';
    this.source().then(
      (scene) => {
        if (this.disposed) return;
        if (!timeBuildSpan('zone:turret-tower', () => this.build(scene))) {
          this.state = 'failed';
          console.error('Fire and Fly tower model lost its head or its barrel, no tower drawn');
          return;
        }
        this.state = 'ready';
        void attachSceneGroupGated(parent, this.group, this.compileGate, () => this.disposed).catch(
          () => {},
        );
        onReady?.();
      },
      (error) => {
        if (this.disposed) return;
        this.state = 'idle';
        console.error('Fire and Fly tower model unavailable, no tower drawn for now', error);
        onUnavailable?.();
      },
    );
  }

  /** Stands the tower on the session centre: its roof platform at the seated feet `roofY`. */
  place(cx: number, roofY: number, cz: number): void {
    this.group.position.set(cx, roofY - FIRE_AND_FLY_TOWER.roofY, cz);
  }

  /** A new seat: the head faces `yaw` at once, sits on its mount, and the barrel lies at rest. */
  reset(yaw: number): void {
    if (Number.isFinite(yaw)) this.yaw = yaw;
    this.pitch = turretRestPitch();
    this.hopAt = Number.NEGATIVE_INFINITY;
    this.pose();
    this.hop(0);
  }

  /** The Shockwave slams at frame seconds `time`: the head hops on its mount. */
  slam(time: number): void {
    this.hopAt = time;
  }

  /** The head's hop at frame seconds `time` (it rests on its mount outside one). */
  hop(time: number): void {
    if (this.head) {
      this.head.position.y = this.headRestY + turretHeadHop(time - this.hopAt) * this.headUnits;
    }
  }

  /** One frame of the head's eased turn toward `targetYaw`; the barrel holds its elevation. */
  aim(targetYaw: number, dt: number): void {
    this.yaw = stepTurretHeadYaw(this.yaw, targetYaw, dt);
    this.pose();
  }

  /** A shot leaves: the head and the barrel lie on it at once, under the muzzle flash. */
  fireAt(yaw: number, pitch: number): void {
    if (Number.isFinite(yaw)) this.yaw = yaw;
    if (Number.isFinite(pitch)) {
      this.pitch = Math.min(TURRET_BARREL.maxPitch, Math.max(TURRET_BARREL.minPitch, pitch));
    }
    this.pose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    // The geometries and the atlas belong to the loader's cache, shared with the kit.
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.head = null;
    this.barrel = null;
  }

  private pose(): void {
    if (this.head) this.head.rotation.y = this.yaw;
    // Three's +x rotation takes +z down: a nose-up elevation is a negative angle.
    if (this.barrel) this.barrel.rotation.x = -this.pitch;
  }

  private build(source: THREE.Object3D): boolean {
    const root = source.clone(true);
    const head = root.getObjectByName(TURRET_TOWER_MODEL.headNode) ?? null;
    const barrel = head?.getObjectByName(TURRET_TOWER_MODEL.barrelNode) ?? null;
    if (!head || !barrel) return false;
    root.scale.setScalar(FIRE_AND_FLY_TOWER.scale);
    const owned = new Map<THREE.Material, THREE.Material>();
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const swap = (material: THREE.Material): THREE.Material => {
        let mine = owned.get(material);
        if (!mine) {
          mine = towerMaterial(material);
          owned.set(material, mine);
          this.materials.push(mine);
        }
        return mine;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    this.group.add(root);
    this.head = head;
    this.barrel = barrel;
    this.headRestY = head.position.y;
    const scale = new THREE.Vector3();
    root.updateWorldMatrix(false, true);
    head.parent?.getWorldScale(scale);
    this.headUnits = scale.y > 1e-9 ? 1 / scale.y : 1;
    this.pose();
    return true;
  }
}

/** The kit's palette atlas on this tier's surface family, dielectric (the kit's metalness is an export slip). */
function towerMaterial(source: THREE.Material): THREE.Material {
  const s = source as THREE.MeshStandardMaterial;
  const color = s.color?.clone() ?? new THREE.Color(0xffffff);
  const map = s.map ?? null;
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color,
        map,
        roughness: s.isMeshStandardMaterial ? s.roughness : 0.9,
        metalness: 0,
      })
    : new THREE.MeshLambertMaterial({ color, map });
  material.name = `${TURRET_TOWER_MATERIAL_PREFIX}${s.name || 'surface'}`;
  return material;
}
