import * as THREE from 'three';
import { modulateEmissiveByVertexColor } from '../vertex_color_emissive';
import {
  type WarriorFuryStateAura,
  type WarriorFuryStateKind,
  warriorEchoCount,
  warriorFuryStateAge,
} from '../warrior_fury_state_core';
import type { WarriorPowerAnchor } from '../warrior_power_anchor';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import type { CrestPrewarmHost } from './crest_prewarm';
import type { AbilityVfxTextures } from './fx_textures';
import { GuardPrewarm } from './guard_prewarm';
import { warriorBloodTexture, warriorSteelTexture } from './production_assets';
import { AbilityVfxRibbons, type RibbonAnchor } from './ribbons';
import { warriorFuryStateShape } from './warrior_fury_state_shapes';
import { animateWarriorRage } from './warrior_rage_material';

interface State {
  stamp: number;
  age: number;
  remaining: number;
  count: number;
}
interface Wearer {
  id: number;
  priority: boolean;
  states: State[];
  samples: (WeaponAnchorSampler | null)[];
  retry: number[];
}
const WEARERS = 32,
  COUNTS = [2, 1, 2] as const;

/** Three bounded draws own weapon fire, defensive stitching and blade charges.
 * A separate instance of the already-prepared ribbon family supplies cold/missing
 * attachment silhouettes, so fallback can never consume attack-contact capacity. */
export class WarriorFuryStates {
  readonly meshes: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  readonly preparation: GuardPrewarm[] = [];
  private readonly wearers = new Map<number, Wearer>();
  private readonly fallback: AbilityVfxRibbons;
  private readonly matrix = new THREE.Matrix4();
  private readonly frameMatrix = new THREE.Matrix4();
  private readonly at = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly color = new THREE.Color();
  private readonly used = [0, 0, 0];
  private readonly time = { value: 0 };
  private readonly motion = { value: 1 };
  private elapsed = 0;
  private disposed = false;
  private lineCount = 0;
  private readonly lines = Array.from({ length: WEARERS * 5 }, () => ({
    points: Array.from({ length: 6 }, () => new THREE.Vector3()),
    count: 3,
    color: 0xff5470,
  }));
  private readonly drawFallback = () => {
    for (let i = 0; i < this.lineCount; i++) {
      const line = this.lines[i];
      this.fallback.appendHeld(line.points, line.count, 0.075, line.color, 1.2);
    }
  };
  constructor(scene: THREE.Scene, anchor: RibbonAnchor, textures: AbilityVfxTextures) {
    this.fallback = new AbilityVfxRibbons(scene, anchor, textures);
    for (let k = 0; k < 3; k++) {
      const kind = k as WarriorFuryStateKind;
      const material = modulateEmissiveByVertexColor(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          map: k === 2 ? warriorSteelTexture() : warriorBloodTexture(),
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          roughness: 0.65,
          metalness: 0.12,
          emissive: 0xffffff,
          emissiveIntensity: k === 1 ? 3.4 : 0.8,
        }),
      );
      if (k === 0) animateWarriorRage(material, this.time, this.motion);
      const mesh = new THREE.InstancedMesh(
        warriorFuryStateShape(kind),
        material,
        WEARERS * COUNTS[kind],
      );
      mesh.name = [
        'warrior-mayhem-weapon-fire',
        'warrior-mending-stitches',
        'warrior-echo-charges',
      ][k];
      mesh.userData.renderCategory = 'vfx';
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < WEARERS * COUNTS[kind]; i++) {
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
    return this.preparation.flatMap((prep, k) =>
      prep.ready()
        ? []
        : [
            {
              id: `fury-state-${k}:bind`,
              run: () => {
                if (this.disposed) return;
                const texture = k === 2 ? warriorSteelTexture() : warriorBloodTexture();
                if (!texture) throw Error('Warrior Fury state texture is not prepared');
                const material = this.meshes[k].material;
                if (material.map !== texture) {
                  material.map = texture;
                  material.needsUpdate = true;
                }
              },
            },
            ...prep.units(host).map((u) => ({ id: `fury-state-${k}:${u.id}`, run: u.run })),
          ],
    );
  }
  hold(
    id: number,
    kind: WarriorFuryStateKind,
    aura: WarriorFuryStateAura,
    frame: number,
    priority: boolean,
  ): void {
    if (this.disposed || !Number.isFinite(aura.remaining) || !(aura.remaining! > 0)) return;
    let wearer = this.wearers.get(id);
    if (!wearer) {
      if (this.wearers.size >= WEARERS) {
        if (!priority) return;
        let replaced = false;
        for (const [otherId, other] of this.wearers)
          if (!other.priority) {
            this.wearers.delete(otherId);
            replaced = true;
            break;
          }
        if (!replaced) return;
      }
      wearer = {
        id,
        priority,
        states: Array.from({ length: 3 }, () => ({ stamp: -1, age: 0, remaining: 0, count: 0 })),
        samples: [null, null],
        retry: [0, 0],
      };
      this.wearers.set(id, wearer);
    }
    wearer.priority = priority;
    const state = wearer.states[kind];
    state.stamp = frame;
    state.age = warriorFuryStateAge(aura);
    state.remaining = aura.remaining!;
    state.count = kind === 2 ? warriorEchoCount(aura.charges) : COUNTS[kind];
  }
  draw(
    frame: number,
    dt: number,
    reduced: boolean,
    anchor: RibbonAnchor,
    weapon: ((id: number, hand: 0 | 1) => WeaponAnchorSampler | null) | undefined,
    body: WarriorPowerAnchor | undefined,
    camera: THREE.Camera,
    cameraPosition: THREE.Vector3,
  ): void {
    if (this.disposed) return;
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.time.value = reduced ? 0 : this.elapsed;
    this.motion.value = reduced ? 0 : 1;
    this.used.fill(0);
    this.lineCount = 0;
    for (const [id, wearer] of this.wearers) {
      if (
        wearer.states[0].stamp !== frame &&
        wearer.states[1].stamp !== frame &&
        wearer.states[2].stamp !== frame
      ) {
        this.wearers.delete(id);
        continue;
      }
      if (!anchor(id, 0.52, this.at)) continue;
      for (let k = 0; k < 3; k++) {
        const state = wearer.states[k];
        if (state.stamp !== frame || state.count === 0) continue;
        for (let piece = 0; piece < state.count; piece++) {
          let ready = this.preparation[k].ready();
          if (k === 1) ready = ready && !!body?.(id, 0, this.frameMatrix);
          else {
            const hand = (k === 2 ? 0 : piece) as 0 | 1;
            if (!wearer.samples[hand] && this.elapsed >= wearer.retry[hand]) {
              wearer.samples[hand] = weapon?.(id, hand) ?? null;
              wearer.retry[hand] = this.elapsed + 0.25;
            }
            const sample = wearer.samples[hand];
            const valid = k === 2 ? sample?.(this.position) : sample?.frame?.(this.frameMatrix);
            if (!valid) {
              // A missing sampler must reach its scheduled retry. Only a
              // previously live attachment failure starts a new delay.
              if (sample) {
                wearer.samples[hand] = null;
                wearer.retry[hand] = this.elapsed + 0.25;
              }
              ready = false;
            } else if (k === 2) {
              // Camera-right separation makes the exact count legible even when
              // the real blades overlap. Both marks remain rooted at the blade.
              const spread = (piece - (state.count - 1) * 0.5) * 0.48;
              this.position.addScaledVector(
                this.at.set(1, 0, 0).applyQuaternion(camera.quaternion),
                spread,
              );
              this.position.y += 0.18;
              this.frameMatrix.compose(this.position, camera.quaternion, this.scale);
              anchor(id, 0.52, this.at);
            }
          }
          if (ready) {
            const mesh = this.meshes[k],
              index = this.used[k]++;
            mesh.setMatrixAt(index, this.frameMatrix);
            mesh.setColorAt(index, this.color.setHex(0xffffff));
          } else {
            const line = this.lines[this.lineCount++],
              side = piece ? 1 : -1;
            line.color = k === 2 ? 0xffb6bd : k === 1 ? 0xf94869 : 0xf32950;
            const spread = k === 1 ? 0.48 : 0.65;
            this.position.set(1, 0, 0).applyQuaternion(camera.quaternion);
            line.points[0].copy(this.at).addScaledVector(this.position, side * spread);
            line.points[0].y -= 0.15;
            line.points[1].copy(this.at).addScaledVector(this.position, side * (spread + 0.14));
            line.points[1].y += k === 0 ? 0.65 : 0.2;
            line.points[2].copy(this.at).addScaledVector(this.position, side * (spread + 0.27));
            line.points[2].y += k === 0 ? 0.4 : -0.03;
            line.count = 3;
          }
        }
      }
    }
    this.fallback.update(reduced ? 0 : dt, cameraPosition, reduced, this.drawFallback);
    for (let k = 0; k < 3; k++) {
      const mesh = this.meshes[k],
        n = this.used[k];
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, n * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
  }
  sleep(id: number): void {
    this.wearers.delete(id);
  }
  clear(): void {
    this.wearers.clear();
    this.fallback.clear();
    for (const m of this.meshes) {
      m.count = 0;
      m.visible = false;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    const release = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        errors.push(e);
      }
    };
    release(() => this.fallback.dispose());
    for (const p of this.preparation) release(() => p.dispose());
    for (const m of this.meshes) {
      release(() => m.removeFromParent());
      release(() => m.geometry.dispose());
      release(() => m.material.dispose());
      release(() => m.dispose());
    }
    if (errors.length) throw new AggregateError(errors, 'Warrior Fury state cleanup failed');
  }
}
