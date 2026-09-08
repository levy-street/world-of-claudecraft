import * as THREE from 'three';
import { isProgramKnownReady } from '../linked_program_readiness';
import {
  collectLinkedPrograms,
  type LinkedProgramLike,
  touchLinkedProgram,
} from '../linked_program_touch';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import { settleProgramVariants } from '../program_variant_settle';
import type { CrestPrewarmHost } from './crest_prewarm';

export type { CrestPrewarmHost };

/** Hidden InstancedMesh carrier borrows the actual pool buffers and material.
 * Compilation alone never uploads geometry; the upload unit triggers the
 * bounded draw. The actual mesh must have instanceColor before construction. */
export class GuardPrewarm {
  readonly group = new THREE.Group();
  private readonly carrier: THREE.InstancedMesh;
  private compiled: LinkedProgramLike[] | null = null;
  private compiling: Promise<void> | null = null;
  private readonly touched = new Set<LinkedProgramLike>();
  private uploaded = false;
  private disposed = false;

  constructor(scene: THREE.Scene, mesh: THREE.InstancedMesh) {
    if (!mesh.instanceColor) {
      throw new Error('GuardPrewarm: mesh must have instanceColor before construction');
    }
    const count = mesh.instanceMatrix.count;
    const carrier = new THREE.InstancedMesh(mesh.geometry, mesh.material as THREE.Material, count);
    carrier.instanceMatrix = mesh.instanceMatrix;
    carrier.instanceColor = mesh.instanceColor;
    carrier.name = 'guard-upload';
    carrier.frustumCulled = false;
    carrier.userData.renderCategory = 'prewarm';
    this.carrier = carrier;
    this.group.name = 'guard-prewarm';
    this.group.visible = false;
    this.group.userData.renderCategory = 'prewarm';
    this.group.add(carrier);
    scene.add(this.group);
  }

  ready(): boolean {
    return !this.disposed && this.uploaded;
  }

  units(host: CrestPrewarmHost): PrewarmResumeUnit[] {
    if (this.disposed || this.uploaded) return [];
    const carrier = this.carrier;
    return [
      {
        id: 'guard-compile',
        run: () => {
          if (this.disposed || this.compiled !== null) return;
          if (this.compiling) return this.compiling;
          const owner = this;
          const task = (async () => {
            await host.compile(carrier, true);
            if (this.disposed) return;
            const ownMaterials = Array.isArray(carrier.material)
              ? carrier.material
              : [carrier.material as THREE.Material];
            const settled = await settleProgramVariants(host.properties, ownMaterials, {
              get fired() {
                return owner.disposed;
              },
            });
            if (this.disposed) return;
            if (!settled.settled) throw new Error('Guard has unsettled programs');
            const programs = collectLinkedPrograms(host.properties, carrier, isProgramKnownReady);
            if (!programs.length) throw new Error('Guard expected at least one output program');
            this.compiled = programs;
          })();
          this.compiling = task;
          const release = () => {
            this.compiling = null;
          };
          void task.then(release, release);
          return task;
        },
      },
      {
        id: 'guard-touch',
        run: () => {
          if (this.disposed) return;
          const programs = this.compiled;
          if (programs === null) throw new Error('Guard was not compiled');
          if (programs.length < 1) throw new Error('Guard expected at least one output program');
          for (const program of programs) {
            if (this.touched.has(program)) continue;
            touchLinkedProgram(program);
            if (!this.disposed) this.touched.add(program);
          }
        },
      },
      {
        id: 'guard-upload',
        run: () => {
          if (this.disposed || this.uploaded) return;
          if (this.compiled === null) throw new Error('Guard was not compiled');
          if (!this.compiled.every((p) => this.touched.has(p)))
            throw new Error('Guard has untouched programs');
          host.draw(this.group, carrier);
          if (!this.disposed) this.uploaded = true;
        },
      },
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    try {
      this.group.removeFromParent();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.carrier.removeFromParent();
    } catch (error) {
      errors.push(error);
    }
    this.compiled = null;
    this.compiling = null;
    this.touched.clear();
    // The live pool alone owns and disposes the borrowed buffers and material.
    if (errors.length) throw new AggregateError(errors, 'Guard carrier cleanup failed');
  }
}
