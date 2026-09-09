import * as THREE from 'three';
import { modulateEmissiveByVertexColor } from '../vertex_color_emissive';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import type { CrestPrewarmHost } from './crest_prewarm';
import { GuardPrewarm } from './guard_prewarm';
import { warriorSteelTexture } from './production_assets';
import type { AbilityVfxRibbons, RibbonAnchor } from './ribbons';
import { warriorGuardGeometry } from './warrior_guard_geometry';

export type WarriorGuardKind = 0 | 1 | 2 | 3;
export interface WarriorGuardAura {
  id: string;
  kind?: string;
  remaining?: number;
  duration?: number;
  value?: number;
}
export function warriorGuardKind(aura: WarriorGuardAura): WarriorGuardKind | null {
  if (aura.id === 'raised_guard_dr' && aura.kind === 'buff_dr_phys') return 0;
  if (aura.id === 'iron_resolve' && aura.kind === 'absorb') return 1;
  if (aura.id === 'die_by_sword' && aura.kind === 'die_by_sword') return 2;
  if (aura.id === 'intervene' && aura.kind === 'absorb') return 3;
  return null;
}
interface GuardState {
  stamp: number;
  age: number;
  remaining: number;
  value: number;
  hitAge: number;
}
interface Wearer {
  id: number;
  priority: boolean;
  states: GuardState[];
  shield: WeaponAnchorSampler | null;
  blade: WeaponAnchorSampler | null;
  retry: number;
}
const WEARERS = 64,
  SOLID_WEARERS = 16,
  PLATES = 6;
const COLORS = [0xd8e6ed, 0xe3ecf3, 0xe8f7ff, 0x91cce6];
const UP = new THREE.Vector3(0, 1, 0);

/** Separate from attack crests: defenses cannot occupy their eight burst slots.
 * Up to 64 defenders retain an immediate outline when the solid pool is busy
 * or cold, including the local player, who ranks first. Never guesses initial capacity. */
export class WarriorGuardPlates {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly preparation: GuardPrewarm;
  private readonly wearers = new Map<number, Wearer>();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly bladeTip = new THREE.Vector3();
  private readonly inverseFrame = new THREE.Matrix4();
  private readonly bladeRotation = new THREE.Matrix4();
  private readonly points = Array.from({ length: 6 }, () => new THREE.Vector3());
  private used = 0;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      warriorGuardGeometry(),
      modulateEmissiveByVertexColor(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.4,
          metalness: 0.2,
          emissive: 0xffffff,
          emissiveIntensity: 0.55,
        }),
      ),
      SOLID_WEARERS * PLATES,
    );
    this.mesh.name = 'warrior-held-guard-plates';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < SOLID_WEARERS * PLATES; i++) {
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, this.color.setHex(0xffffff));
    }
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.preparation = new GuardPrewarm(scene, this.mesh);
  }

  units(host: CrestPrewarmHost) {
    if (this.disposed || this.preparation.ready()) return [];
    return [
      {
        id: 'guard-bind-steel',
        run: () => {
          if (this.disposed) return;
          // Both enclosing recipes upload this shared texture before geometry.
          const texture = warriorSteelTexture();
          if (!texture) throw new Error('Warrior guard steel has not been prepared');
          if (this.mesh.material.map !== texture) {
            this.mesh.material.map = texture;
            this.mesh.material.needsUpdate = true;
          }
        },
      },
      ...this.preparation.units(host),
    ];
  }

  hold(
    id: number,
    kind: WarriorGuardKind,
    aura: WarriorGuardAura,
    frame: number,
    priority: boolean,
  ): void {
    if (
      this.disposed ||
      !((aura.remaining ?? 0) > 0) ||
      ((kind === 1 || kind === 3) && !((aura.value ?? 0) > 0))
    )
      return;
    let wearer = this.wearers.get(id);
    if (!wearer) {
      if (this.wearers.size >= WEARERS) {
        if (!priority) return;
        for (const [otherId, other] of this.wearers) {
          if (!other.priority) {
            this.wearers.delete(otherId);
            break;
          }
        }
      }
      wearer = {
        id,
        priority,
        states: Array.from({ length: 4 }, () => ({
          stamp: -1,
          age: 0,
          remaining: 0,
          value: 0,
          hitAge: 1,
        })),
        shield: null,
        blade: null,
        retry: 0,
      };
      this.wearers.set(id, wearer);
    }
    wearer.priority = priority;
    const state = wearer.states[kind];
    const remaining = aura.remaining!,
      value = aura.value ?? 0;
    if (state.remaining <= 0 || state.stamp < frame - 1 || remaining > state.remaining + 0.1) {
      state.age = 0;
      state.hitAge = 1;
    } else if ((kind === 1 || kind === 3) && value < state.value) state.hitAge = 0;
    state.stamp = frame;
    state.remaining = remaining;
    state.value = value;
  }

  sleep(id: number): void {
    this.wearers.delete(id);
  }
  clear(): void {
    this.wearers.clear();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Called within the existing ribbon prefix callback, before ordinary trails. */
  draw(
    frame: number,
    dt: number,
    reduced: boolean,
    anchor: RibbonAnchor,
    facing: (id: number) => number | null,
    equipment: ((id: number, hand: 0 | 1) => WeaponAnchorSampler | null) | undefined,
    ribbons: AbilityVfxRibbons,
  ): void {
    if (this.disposed) return;
    this.used = 0;
    for (const [id, wearer] of this.wearers) {
      let live = false;
      for (const state of wearer.states) {
        if (state.stamp !== frame) continue;
        live = true;
        state.age += dt;
        state.hitAge += dt;
      }
      if (!live) this.wearers.delete(id);
    }
    let rank = 0;
    for (let priority = 1; priority >= 0; priority--) {
      for (const wearer of this.wearers.values()) {
        if (Number(wearer.priority) !== priority || !anchor(wearer.id, 0.46, this.at)) continue;
        const solid = this.preparation.ready() && rank++ < SOLID_WEARERS;
        wearer.retry -= dt;
        let kinds = 0;
        for (const state of wearer.states) if (state.stamp === frame) kinds++;
        for (let kind = 0; kind < 4; kind++) {
          const state = wearer.states[kind];
          if (state.stamp !== frame) continue;
          const angle = facing(wearer.id) ?? 0;
          this.frameMatrix.makeRotationY(angle).setPosition(this.at);
          if (wearer.retry <= 0 && equipment) {
            if (kind === 0 && !wearer.shield) wearer.shield = equipment(wearer.id, 1);
            if (kind === 2 && !wearer.blade) wearer.blade = equipment(wearer.id, 0);
          }
          const sample = kind === 0 ? wearer.shield : kind === 2 ? wearer.blade : null;
          const attached = sample?.frame?.(this.frameMatrix) === true;
          if (sample?.frame && !attached) {
            if (kind === 0) wearer.shield = null;
            if (kind === 2) wearer.blade = null;
          }
          // The face frame intentionally removes equipment scale. Recover the
          // actual blade span from its live tip instead of inventing long rails.
          let bladeHalf = 0.42;
          if (kind === 2 && attached && sample?.(this.bladeTip)) {
            this.bladeTip.applyMatrix4(this.inverseFrame.copy(this.frameMatrix).invert());
            const span = Math.hypot(this.bladeTip.x, this.bladeTip.y);
            if (span > 0.04) {
              bladeHalf = Math.min(0.85, span);
              this.bladeRotation.makeRotationZ(-Math.atan2(this.bladeTip.x, this.bladeTip.y));
              this.frameMatrix.multiply(this.bladeRotation);
            }
          }
          // Iron Resolve always keeps its two opposing shields while reserve
          // remains. Four concurrent states divide as 1/2/1/2; the sword keeps
          // its primary spine and both paired protections retain their shape.
          const available =
            kinds === 4 ? (kind === 0 || kind === 2 ? 1 : 2) : Math.floor(PLATES / kinds);
          const count =
            kind === 0 ? Math.min(available, kinds === 1 ? 3 : 2) : Math.min(available, 2);
          const assembly = reduced ? 1 : Math.min(1, state.age / 0.24);
          for (let plate = 0; plate < count; plate++) {
            let x = 0,
              y = 0,
              z = 0,
              yaw = 0,
              roll = 0,
              sx = 1,
              sy = 1;
            if (kind === 0) {
              x = (plate - (count - 1) / 2) * 0.53;
              y = plate === 1 && count === 3 ? 0.09 : -0.05;
              z = 0.09 + Math.abs(x) * 0.12;
              yaw = x * -0.3;
              sx = count === 3 && plate === 1 ? 0.92 : 0.62;
              sx *= 1.15;
              sy = 1.42;
              if (!attached) {
                x -= 0.45;
                z += 0.62;
              }
            } else if (kind === 1) {
              // Two opposing shields orbit outside the body with a readable
              // gap. Reduced motion parks the same pair beside the shoulders.
              const arc = Math.PI / 2 + plate * Math.PI + (reduced ? 0 : state.age * 0.65);
              const contact = reduced ? 0 : Math.max(0, 1 - state.hitAge / 0.16) * 0.055;
              x = Math.sin(arc) * (1.65 - contact);
              z = Math.cos(arc) * (1.65 - contact);
              y = -0.15;
              yaw = arc;
              sx = 0.95;
              sy = 0.82;
            } else if (kind === 3) {
              // A companion's two broad shoulder guards reach forward around
              // the wearer, separate from Iron Resolve's orbiting pair.
              const side = plate ? 1 : -1;
              x = side * 0.78;
              y = 0.26;
              z = 0.34;
              roll = side * -0.9;
              yaw = side * -0.38;
              sx = 0.72;
              sy = 1.25;
              if (!reduced) z += Math.max(0, 1 - state.hitAge / 0.16) * 0.12;
            } else {
              // Steel locks onto the real blade: one bright central spine and
              // a short overlapping heel, never two detached parallel weapons.
              y = plate ? -bladeHalf * 0.5 : 0;
              z = plate ? 0.04 : 0.012;
              sx = plate ? 0.24 : 0.15;
              sy = plate ? bladeHalf * 0.55 : bladeHalf * 1.42;
              if (!attached) {
                x = 0.34;
                y -= 0.12;
                z += 0.32;
                roll = -0.35;
              }
            }
            const settle = 1 - (1 - assembly) ** 3;
            const fitted = kind === 1 || kind === 2;
            this.position.set(
              fitted ? x : x * (1.55 - settle * 0.55),
              y - (1 - settle) * (fitted ? 0.06 : 0.35),
              z + (1 - settle) * (fitted ? 0.025 : 0.26),
            );
            this.rotation.setFromAxisAngle(UP, yaw);
            if (roll) this.rotation.multiply(this.rollRotation(roll));
            this.scale.set(
              sx * Math.max(0.03, settle),
              sy,
              kind === 2 ? 0.18 : kind === 1 ? 0.45 : 1,
            );
            this.matrix
              .compose(this.position, this.rotation, this.scale)
              .premultiply(this.frameMatrix);
            if (solid && this.used < SOLID_WEARERS * PLATES) {
              this.mesh.setMatrixAt(this.used, this.matrix);
              this.color.setHex(COLORS[kind]);
              if ((kind === 1 || kind === 3) && state.hitAge < 0.16)
                this.color.lerp(this.flash, (1 - state.hitAge / 0.16) * 0.65);
              this.mesh.setColorAt(this.used++, this.color);
            }
            // A quiet bright seam keeps the material legible against dark scenery.
            // Cold/overflow uses a complete kite outline in the same exact frame.
            // Both orbiting shields remain readable while cold. Five full
            // outlines bound all 64 four-protection wearers to 3200 vertices.
            if (plate === 0 || kind === 1) this.outline(ribbons, solid, COLORS[kind]);
          }
        }
        if (wearer.retry <= 0) wearer.retry = 0.5;
      }
    }
    this.mesh.count = this.used;
    this.mesh.visible = this.used > 0;
    if (this.used) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.used * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.clearUpdateRanges();
      this.mesh.instanceColor!.addUpdateRange(0, this.used * 3);
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }
  private readonly flash = new THREE.Color(0xffe1af);
  private readonly roll = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private rollRotation(angle: number): THREE.Quaternion {
    return this.roll.setFromAxisAngle(this.forward, angle);
  }
  private outline(ribbons: AbilityVfxRibbons, solid: boolean, color: number): void {
    this.points[0].set(0, -0.65, 0.19);
    this.points[1].set(0.5, 0.25, 0.19);
    this.points[2].set(0, 0.67, 0.19);
    this.points[3].set(-0.5, 0.25, 0.19);
    this.points[4].copy(this.points[0]);
    for (let i = 0; i < 5; i++) this.points[i].applyMatrix4(this.matrix);
    ribbons.appendHeld(this.points, solid ? 3 : 5, solid ? 0.035 : 0.09, color, solid ? 0.75 : 1.4);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    const release = (action: () => void) => {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    };
    release(() => this.preparation.dispose());
    release(() => this.mesh.removeFromParent());
    release(() => this.mesh.geometry.dispose());
    release(() => this.mesh.material.dispose());
    release(() => this.mesh.dispose());
    if (errors.length) throw new AggregateError(errors, 'Warrior guard cleanup failed');
  }
}
