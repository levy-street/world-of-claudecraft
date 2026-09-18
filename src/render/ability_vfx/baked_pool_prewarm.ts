import type * as THREE from 'three';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import { type CrestPrewarmHost, GuardPrewarm } from './guard_prewarm';

type BakedMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
const DRAW_UNIFORMS = [
  'uMap',
  'uNormal',
  'uFlow',
  'uLighting',
  'uAuthored',
  'uGutter',
  'uOpacity',
] as const;

/** Borrows each existing slot, without allocating another geometry or material.
 * The caller uploads preparedTexture before scheduling these units. Both
 * Harvest and Warrior Shear use this same authored sprite shader and buffers. */
export class BakedPoolPrewarm {
  private readonly slots: { mesh: BakedMesh; preparation: GuardPrewarm }[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene, meshes: readonly BakedMesh[]) {
    try {
      for (const mesh of meshes) {
        this.slots.push({ mesh, preparation: new GuardPrewarm(scene, mesh) });
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  ready(index: number): boolean {
    return !this.disposed && (this.slots[index]?.preparation.ready() ?? false);
  }

  units(host: CrestPrewarmHost, preparedTexture: THREE.Texture): PrewarmResumeUnit[] {
    if (this.disposed) return [];
    return this.slots.flatMap(({ mesh, preparation }, index) =>
      preparation
        .units({
          ...host,
          draw: (group, carrier) => {
            // No await: live slots must never retain preparation-only uniforms
            // between frames, including when the bounded upload throws.
            const uniforms = DRAW_UNIFORMS.map((name) => {
              const uniform = mesh.material.uniforms[name];
              if (!uniform) throw new Error(`Baked preparation missing ${name}`);
              return uniform;
            });
            const previous = uniforms.map((uniform) => uniform.value);
            try {
              for (let i = 0; i < 4; i++) uniforms[i].value = preparedTexture;
              uniforms[4].value = 1;
              uniforms[5].value = 4 / 256;
              uniforms[6].value = 1;
              host.draw(group, carrier);
            } finally {
              for (let i = 0; i < uniforms.length; i++) uniforms[i].value = previous[i];
            }
          },
        })
        // The scheduler learns costs from the prefix before the first colon.
        // Keep compile, reflection and upload in separate cost families.
        .map((unit) => ({
          id: `baked-${unit.id.slice('guard-'.length)}:slot:${index}`,
          run: unit.run,
        })),
    );
  }

  /** Retire carriers before the owning pool disposes its live resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const { preparation } of this.slots) {
      try {
        preparation.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.slots.length = 0;
    if (errors.length) throw new AggregateError(errors, 'Baked carrier cleanup failed');
  }
}
