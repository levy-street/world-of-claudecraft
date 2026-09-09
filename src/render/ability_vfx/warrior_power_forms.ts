import * as THREE from 'three';
import { modulateEmissiveByVertexColor } from '../vertex_color_emissive';
import type { WarriorPowerAnchor } from '../warrior_power_anchor';
import {
  WARRIOR_POWER_COUNTS,
  type WarriorPowerIntent,
  type WarriorPowerKind,
  type WarriorPowerPiece,
  warriorPowerPiece,
} from '../warrior_power_core';
import type { CrestPrewarmHost } from './crest_prewarm';
import { GuardPrewarm } from './guard_prewarm';
import { warriorBloodTexture, warriorSteelTexture } from './production_assets';
import type { AbilityVfxRibbons, RibbonAnchor } from './ribbons';
import { warriorAvatarBracerShape } from './warrior_avatar_bracer';
import { warriorAvatarChestShape } from './warrior_avatar_shape';
import { warriorPowerGeometry } from './warrior_power_geometry';
import { animateWarriorRage } from './warrior_rage_material';

interface State {
  stamp: number;
  age: number;
  remaining: number;
  nextDetail: number;
}
interface Wearer {
  id: number;
  priority: boolean;
  intent: WarriorPowerIntent;
  states: [State, State];
}
const WEARERS = 64,
  SOLIDS = 16;
const PIECE_MESH = [0, 2, 2, 3, 3] as const;
const CAPACITY = [SOLIDS, SOLIDS * 6, SOLIDS * 2, SOLIDS * 2] as const;

/** Offensive forms own four instanced draws, never attack or guard
 * slots. A cold/full pool retains one full shoulder/crown outline per wearer.
 * Actual aura elapsed time prevents camera reentry from replaying assembly. */
export class WarriorPowerForms {
  readonly meshes: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  readonly preparation: GuardPrewarm[] = [];
  private readonly wearers = new Map<number, Wearer>();
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly boneMatrices = Array.from({ length: 5 }, () => new THREE.Matrix4());
  private readonly position = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly points = Array.from({ length: 3 }, () => new THREE.Vector3());
  private readonly piece: WarriorPowerPiece = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    roll: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    color: 0,
  };
  private readonly used = [0, 0, 0, 0];
  private disposed = false;
  private readonly rageTime = { value: 0 };
  private readonly rageMotion = { value: 1 };
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    for (let kind = 0; kind < 4; kind++) {
      const blood = kind === 1;
      const material = modulateEmissiveByVertexColor(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          map: blood ? warriorBloodTexture() : warriorSteelTexture(),
          roughness: blood ? 0.42 : 0.82,
          metalness: blood ? 0.08 : 0.18,
          emissive: 0xffffff,
          emissiveIntensity: blood ? 0.85 : 0.78,
        }),
      );
      if (blood) animateWarriorRage(material, this.rageTime, this.rageMotion);
      const geometry =
        kind === 0
          ? warriorAvatarChestShape()
          : kind === 2
            ? warriorAvatarBracerShape()
            : warriorPowerGeometry(blood);
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY[kind]);
      mesh.name = [
        'warrior-avatar-chest',
        'warrior-reckless-crown',
        'warrior-avatar-bracers',
        'warrior-avatar-shins',
      ][kind];
      mesh.userData.renderCategory = 'vfx';
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < CAPACITY[kind]; i++) {
        mesh.setMatrixAt(i, this.matrix);
        mesh.setColorAt(i, this.color.setHex(0xffffff));
      }
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.preparation.push(new GuardPrewarm(scene, mesh));
    }
  }

  units(host: CrestPrewarmHost) {
    if (this.disposed) return [];
    return this.preparation.flatMap((prep, kind) =>
      prep.ready()
        ? []
        : [
            {
              id: `power-${kind}:bind`,
              run: () => {
                if (this.disposed) return;
                const texture = kind === 1 ? warriorBloodTexture() : warriorSteelTexture();
                if (!texture) throw Error('Warrior power texture is not prepared');
                const material = this.meshes[kind].material;
                if (material.map !== texture) {
                  material.map = texture;
                  material.needsUpdate = true;
                }
              },
            },
            ...prep.units(host).map((unit) => ({ id: `power-${kind}:${unit.id}`, run: unit.run })),
          ],
    );
  }

  hold(
    id: number,
    kind: WarriorPowerKind,
    aura: { remaining?: number; duration?: number },
    intent: WarriorPowerIntent,
    frame: number,
    priority: boolean,
  ): void {
    const remaining = aura.remaining ?? 0;
    if (this.disposed || !Number.isFinite(remaining) || remaining <= 0) return;
    let wearer = this.wearers.get(id);
    if (!wearer) {
      if (this.wearers.size >= WEARERS) {
        if (!priority) return;
        for (const [otherId, other] of this.wearers)
          if (!other.priority) {
            this.wearers.delete(otherId);
            break;
          }
      }
      wearer = {
        id,
        priority,
        intent,
        states: [
          { stamp: -1, age: 0, remaining: 0, nextDetail: 0 },
          { stamp: -1, age: 0, remaining: 0, nextDetail: 0 },
        ],
      };
      this.wearers.set(id, wearer);
    }
    wearer.priority = priority;
    wearer.intent = intent;
    const state = wearer.states[kind];
    const elapsed =
      Number.isFinite(aura.duration) && aura.duration! > 0
        ? Math.max(0, aura.duration! - remaining)
        : 0.32;
    if (state.stamp < frame - 1 || state.remaining <= 0 || remaining > state.remaining + 0.1) {
      state.age = elapsed;
      state.nextDetail = elapsed + 0.24;
    } else state.age = Math.max(state.age, elapsed);
    state.stamp = frame;
    state.remaining = remaining;
  }

  draw(
    frame: number,
    dt: number,
    reduced: boolean,
    anchor: RibbonAnchor,
    facing: (id: number) => number | null,
    ribbons: AbilityVfxRibbons,
    detail?: (kind: number, x: number, y: number, z: number) => void,
    bodyAnchor?: WarriorPowerAnchor,
  ): void {
    if (this.disposed) return;
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.rageTime.value = reduced ? 0 : this.elapsed;
    this.rageMotion.value = reduced ? 0 : 1;
    this.used.fill(0);
    for (const [id, wearer] of this.wearers) {
      let live = false;
      for (const state of wearer.states)
        if (state.stamp === frame) {
          live = true;
          state.age += dt;
        }
      if (!live) this.wearers.delete(id);
    }
    let rank = 0;
    for (let priority = 1; priority >= 0; priority--)
      for (const wearer of this.wearers.values()) {
        if (Number(wearer.priority) !== priority || !anchor(wearer.id, 0.46, this.at)) continue;
        const solidRank = rank++ < SOLIDS;
        this.frameMatrix.makeRotationY(facing(wearer.id) ?? 0).setPosition(this.at);
        for (let kind = 0; kind < 2; kind++) {
          const state = wearer.states[kind];
          if (state.stamp !== frame) continue;
          let solid = solidRank && this.preparation[kind].ready();
          if (solid && kind === 0) {
            solid = !!bodyAnchor && this.preparation[2].ready() && this.preparation[3].ready();
            // A missing joint keeps the complete outline, never partial armor.
            if (solid)
              for (let i = 0; i < 5; i++)
                if (!bodyAnchor!(wearer.id, i, this.boneMatrices[i])) {
                  solid = false;
                  break;
                }
          }
          if (solid && !reduced && detail && state.age >= state.nextDetail) {
            // One bounded breath, no catch-up burst after a slow frame or
            // camera reentry. Borrow the particle pool; allocate nothing here.
            state.nextDetail = state.age + (kind === 0 ? 0.72 : 0.24);
            const side = Math.floor(state.age * 4) % 2 ? -1 : 1;
            this.position
              .set(side * 0.95, kind === 0 ? 0.7 : 1.15, -0.4)
              .applyMatrix4(this.frameMatrix);
            detail(kind, this.position.x, this.position.y, this.position.z);
          }
          if (solid)
            for (let i = 0; i < WARRIOR_POWER_COUNTS[kind]; i++) {
              const nativeBone = kind === 0;
              const p = warriorPowerPiece(
                this.piece,
                kind as WarriorPowerKind,
                wearer.intent,
                i,
                state.age,
                reduced,
                nativeBone,
              );
              this.position.set(p.x, p.y, p.z);
              this.scale.set(p.sx, p.sy, p.sz);
              this.rotation.setFromEuler(this.euler.set(0, p.yaw, p.roll));
              this.matrix
                .compose(this.position, this.rotation, this.scale)
                .premultiply(nativeBone ? this.boneMatrices[i] : this.frameMatrix);
              const meshIndex = nativeBone ? PIECE_MESH[i] : 1;
              const mesh = this.meshes[meshIndex];
              mesh.setMatrixAt(this.used[meshIndex], this.matrix);
              mesh.setColorAt(this.used[meshIndex]++, this.color.setHex(p.color));
            }
          else {
            // Both states retain their complete silhouette: six vertices each.
            this.points[0].set(-1.25, 0.25, -0.15);
            this.points[1].set(0, kind === 0 ? 2.1 : 0.65, -0.5);
            this.points[2].set(1.25, 0.25, -0.15);
            if (kind === 1) {
              this.points[0].y = 1.9;
              this.points[2].y = 1.9;
            }
            for (const point of this.points) point.applyMatrix4(this.frameMatrix);
            ribbons.appendHeld(
              this.points,
              3,
              kind === 0 ? 0.16 : 0.13,
              kind === 0 ? 0xd3c1a2 : 0xf32c48,
              1.35,
            );
          }
        }
      }
    for (let kind = 0; kind < 4; kind++) {
      const mesh = this.meshes[kind],
        used = this.used[kind];
      mesh.count = used;
      mesh.visible = used > 0;
      if (!used) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, used * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, used * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
  }
  sleep(id: number): void {
    this.wearers.delete(id);
  }
  clear(): void {
    this.wearers.clear();
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.visible = false;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [],
      release = (fn: () => void) => {
        try {
          fn();
        } catch (error) {
          errors.push(error);
        }
      };
    for (const prep of this.preparation) release(() => prep.dispose());
    for (const mesh of this.meshes) {
      release(() => mesh.removeFromParent());
      release(() => mesh.geometry.dispose());
      release(() => mesh.material.dispose());
      release(() => mesh.dispose());
    }
    if (errors.length) throw new AggregateError(errors, 'Warrior power cleanup failed');
  }
}
