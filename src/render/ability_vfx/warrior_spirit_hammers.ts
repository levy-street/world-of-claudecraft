import * as THREE from 'three';
import {
  CAST_VFX_KIT,
  type CastVfxSpawnGate,
  OPEN_CAST_VFX_SPAWN_GATE,
  tagCastVfxKit,
} from '../cast_vfx_family';
import { modulateEmissiveByVertexColor } from '../vertex_color_emissive';
import type { CrestPrewarmHost } from './crest_prewarm';
import { GuardPrewarm } from './guard_prewarm';
import { warriorSpiritHammerShape } from './warrior_spirit_hammer_shape';

const CAPACITY = 8;

/** Immediate-mode solid heads borrow the live ribbon's position and lifetime.
 * Cold/full capacity keeps the atlas fallback. No second projectile clock. */
export class WarriorSpiritHammers {
  /** Set by AbilityVfxFx: the fail-closed family check at spawn. */
  spawnGate: CastVfxSpawnGate = OPEN_CAST_VFX_SPAWN_GATE;
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly preparation: GuardPrewarm;
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly matrix = new THREE.Matrix4();
  private disposed = false;

  constructor(scene: THREE.Scene) {
    const material = modulateEmissiveByVertexColor(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        color: 0xffffff,
        roughness: 0.38,
        metalness: 0.35,
        emissive: 0xffffff,
        emissiveIntensity: 0.75,
      }),
    );
    this.mesh = new THREE.InstancedMesh(warriorSpiritHammerShape(), material, CAPACITY);
    this.mesh.name = 'warrior-spirit-hammers';
    tagCastVfxKit(this.mesh);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < CAPACITY; i++) {
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, white);
    }
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.preparation = new GuardPrewarm(scene, this.mesh);
  }

  units(host: CrestPrewarmHost) {
    return this.preparation
      .units(host)
      .map((unit) => ({ ...unit, id: `spirit-hammer:${unit.id}` }));
  }

  beginFrame(): void {
    this.mesh.count = 0;
  }

  draw(
    x: number,
    y: number,
    z: number,
    size: number,
    yaw: number,
    time: number,
    reduced: boolean,
  ): boolean {
    if (this.disposed || !this.preparation.ready() || this.mesh.count >= CAPACITY) return false;
    if (!this.spawnGate.allows(CAST_VFX_KIT)) return false;
    this.position.set(x, y, z);
    this.scale.setScalar(size);
    this.euler.set(reduced ? 0.5 : time * Math.PI * 6, yaw, -0.12);
    this.rotation.setFromEuler(this.euler);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.mesh.setMatrixAt(this.mesh.count++, this.matrix);
    return true;
  }

  endFrame(): void {
    this.mesh.visible = !this.disposed && this.mesh.count > 0;
    if (!this.mesh.visible) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.mesh.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    for (const release of [
      () => this.preparation.dispose(),
      () => this.mesh.removeFromParent(),
      () => this.mesh.dispose(),
      () => this.mesh.geometry.dispose(),
      () => this.mesh.material.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Spirit hammer cleanup failed');
  }
}
