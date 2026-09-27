import * as THREE from 'three';
import { surfaceMat } from './gfx';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { markOwnedMaterial } from './shared_resource';

export const WISP_GUARDIAN_COLORS = [0xeb6354, 0xb879ec, 0x59baff, 0x70dba4, 0xf0c04a] as const;
/** One actor per authored spawn post; the hard profile fills all of them. */
export const WISP_GUARDIAN_COUNT = WISP_GUARDIAN_COLORS.length;

/** The colour the hunters turn while the wisp's light frightens them. */
const FRIGHTENED_COLOR = 0xd9f8ff;
const EYE_COLOR = 0xfff1c4;

type GuardianMaterial = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;

/**
 * The maze hunters: hooded wraiths that drift after the thief, one per spawn
 * post. Every actor shares one silhouette language (a tapering cloak, a hood,
 * two lit eyes, reaching arms) so "that thing is chasing me" reads at a glance,
 * and each carries one distinguishing crest so the five stay tellable apart
 * without relying on tint alone. Frightened hunters blanch and their eyes dim.
 */
export class WispMazeGuardians {
  readonly group = new THREE.Group();
  readonly actors: THREE.Group[] = [];
  private readonly cloak = new THREE.ConeGeometry(0.5, 1.5, 7, 1, true);
  private readonly hood = new THREE.SphereGeometry(0.4, 9, 7);
  private readonly eye = new THREE.SphereGeometry(0.085, 6, 5);
  private readonly arm = new THREE.BoxGeometry(0.16, 0.16, 0.7);
  private readonly horn = new THREE.ConeGeometry(0.12, 0.45, 5);
  private readonly ring = new THREE.TorusGeometry(0.62, 0.06, 5, 14);
  private readonly materials: GuardianMaterial[] = [];
  private readonly eyes: GuardianMaterial[] = [];

  constructor() {
    for (let index = 0; index < WISP_GUARDIAN_COUNT; index++) {
      const color = WISP_GUARDIAN_COLORS[index];
      const material = markOwnedMaterial(
        cloneMaterialWithHooks(surfaceMat({ color, emissive: color, emissiveIntensity: 0.35 })),
      ) as GuardianMaterial;
      const eyeMaterial = markOwnedMaterial(
        cloneMaterialWithHooks(
          surfaceMat({ color: EYE_COLOR, emissive: EYE_COLOR, emissiveIntensity: 1 }),
        ),
      ) as GuardianMaterial;
      this.materials.push(material);
      this.eyes.push(eyeMaterial);
      const root = new THREE.Group();
      root.name = `wisp-guardian-${index}`;
      const part = (
        geometry: THREE.BufferGeometry,
        x: number,
        y: number,
        z: number,
        sx = 1,
        sy = 1,
        sz = 1,
        mat: GuardianMaterial = material,
      ) => {
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        root.add(mesh);
        return mesh;
      };
      // The shared body: an inverted cloak that tapers to nothing above the
      // ground, a hood, two eyes set into its shadow, and arms reaching forward.
      part(this.cloak, 0, 0.95, 0).rotation.x = Math.PI;
      part(this.hood, 0, 1.72, 0, 1, 0.92, 1);
      for (const side of [-1, 1]) {
        part(this.eye, side * 0.15, 1.7, 0.32, 1, 1, 1, eyeMaterial);
        const arm = part(this.arm, side * 0.42, 1.25, 0.38);
        arm.rotation.y = side * -0.35;
        arm.rotation.x = -0.25;
      }
      // One crest per hunter.
      if (index === 0) {
        for (const side of [-1, 1]) {
          part(this.horn, side * 0.28, 2.08, 0).rotation.z = side * -0.45;
        }
      } else if (index === 1) {
        part(this.horn, 0, 2.25, 0, 1.6, 1.4, 1.6);
      } else if (index === 2) {
        part(this.ring, 0, 1.55, 0, 1.15, 1.15, 1.15).rotation.x = Math.PI / 2;
      } else if (index === 3) {
        for (const angle of [0, 1.05, 2.1, 3.14, 4.19, 5.24]) {
          const spike = part(
            this.horn,
            Math.sin(angle) * 0.3,
            2.02,
            Math.cos(angle) * 0.3,
            0.7,
            0.6,
            0.7,
          );
          spike.rotation.z = -Math.sin(angle) * 0.6;
          spike.rotation.x = Math.cos(angle) * 0.6;
        }
      } else {
        // The hard-profile hunter: broader, taller, and ringed twice at the hem.
        root.scale.setScalar(1.18);
        for (const y of [0.35, 0.6]) {
          part(this.ring, 0, y, 0, 0.9, 0.9, 0.9).rotation.x = Math.PI / 2;
        }
      }
      this.actors.push(root);
      this.group.add(root);
    }
  }

  setFrightened(index: number, frightened: boolean): void {
    const material = this.materials[index];
    const color = frightened ? FRIGHTENED_COLOR : WISP_GUARDIAN_COLORS[index];
    material.color.setHex(color);
    material.emissive.setHex(color);
    material.emissiveIntensity = frightened ? 0.7 : 0.35;
    this.eyes[index].emissiveIntensity = frightened ? 0.2 : 1;
  }

  dispose(): void {
    this.cloak.dispose();
    this.hood.dispose();
    this.eye.dispose();
    this.arm.dispose();
    this.horn.dispose();
    this.ring.dispose();
    for (const material of this.materials) material.dispose();
    for (const material of this.eyes) material.dispose();
  }
}
