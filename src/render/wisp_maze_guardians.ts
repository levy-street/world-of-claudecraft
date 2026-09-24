import * as THREE from 'three';
import { surfaceMat } from './gfx';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { markOwnedMaterial } from './shared_resource';
import type { WispMazeKit } from './wisp_maze_kit';
import { WISP_GUARDIAN_CRESTS, wispGuardianMotion, wispGuardianScale } from './wisp_maze_kit_core';

export const WISP_GUARDIAN_COLORS = [0xeb6354, 0xb879ec, 0x59baff, 0x70dba4, 0xf0c04a] as const;
/** One actor per authored spawn post; the hard profile fills all of them. */
export const WISP_GUARDIAN_COUNT = WISP_GUARDIAN_COLORS.length;

/** The colour the hunters turn while the wisp's light frightens them. */
export const WISP_GUARDIAN_FRIGHTENED_COLOR = 0xd9f8ff;
const EYE_COLOR = 0xfff1c4;

type GuardianMaterial = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;

/**
 * The maze hunters: garden spirits of leaves, twigs and withered flowers that
 * drift after the thief, one per spawn post. Every actor shares one body from
 * the maze kit (a hunched cloak of leaves over trailing vines, a leaf hood
 * around a hollow face with two lit eyes, twig arms reaching forward), its
 * leaves dyed in the hunter's own colour, and each wears its own crest
 * (antlers, a withered bloom, a twig hoop, a crown of thorns, a great leaf
 * fan) so the five stay tellable apart without relying on tint alone.
 * Frightened hunters blanch and their eyes dim. Every part draws on every
 * graphics tier: where a hunter is, and which one, is what the player acts on.
 */
export class WispMazeGuardians {
  readonly group = new THREE.Group();
  readonly actors: THREE.Group[] = [];
  private readonly bodies: THREE.Group[] = [];
  private readonly tints: GuardianMaterial[] = [];
  private readonly eyes: GuardianMaterial[] = [];
  private readonly motion = { hover: 0, sway: 0 };

  constructor(kit: WispMazeKit, solid: THREE.Material) {
    const spirit = kit.get('Spirit');
    for (let index = 0; index < WISP_GUARDIAN_COUNT; index++) {
      const color = WISP_GUARDIAN_COLORS[index];
      const tint = markOwnedMaterial(
        cloneMaterialWithHooks(
          surfaceMat({ color, emissive: color, emissiveIntensity: 0.35, vertexColors: true }),
        ),
      ) as GuardianMaterial;
      const eyeMaterial = markOwnedMaterial(
        cloneMaterialWithHooks(
          surfaceMat({ color: EYE_COLOR, emissive: EYE_COLOR, emissiveIntensity: 1 }),
        ),
      ) as GuardianMaterial;
      this.tints.push(tint);
      this.eyes.push(eyeMaterial);
      const root = new THREE.Group();
      root.name = `wisp-guardian-${index}`;
      // The sway and the hard hunter's size ride an inner group, so the root
      // carries only the sim's position and facing.
      const body = new THREE.Group();
      body.scale.setScalar(wispGuardianScale(index));
      root.add(body);
      const add = (
        geometry: THREE.BufferGeometry | null | undefined,
        material: THREE.Material,
        name: string,
      ) => {
        if (!geometry) return;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        body.add(mesh);
      };
      add(spirit?.tint, tint, `wisp-guardian-leaves-${index}`);
      add(spirit?.solid, solid, `wisp-guardian-twigs-${index}`);
      add(spirit?.glow, eyeMaterial, `wisp-guardian-eyes-${index}`);
      const crest = kit.get(WISP_GUARDIAN_CRESTS[index]);
      add(crest?.tint, tint, `wisp-guardian-crest-${index}`);
      add(crest?.solid, solid, `wisp-guardian-crest-twigs-${index}`);
      this.bodies.push(body);
      this.actors.push(root);
      this.group.add(root);
    }
  }

  /** The drift the sim does not own: sets the sway, returns the hover height. */
  pose(index: number, tick: number, reducedMotion: boolean): number {
    const motion = wispGuardianMotion(tick, index, reducedMotion, this.motion);
    this.bodies[index].rotation.z = motion.sway;
    return motion.hover;
  }

  setFrightened(index: number, frightened: boolean): void {
    const material = this.tints[index];
    const color = frightened ? WISP_GUARDIAN_FRIGHTENED_COLOR : WISP_GUARDIAN_COLORS[index];
    material.color.setHex(color);
    material.emissive.setHex(color);
    material.emissiveIntensity = frightened ? 0.7 : 0.35;
    this.eyes[index].emissiveIntensity = frightened ? 0.2 : 1;
  }

  /** The kit geometry is shared; only the per-hunter materials are this owner's. */
  dispose(): void {
    for (const material of this.tints) material.dispose();
    for (const material of this.eyes) material.dispose();
  }
}
