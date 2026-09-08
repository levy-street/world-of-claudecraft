import * as THREE from 'three';
import { isProgramKnownReady } from '../linked_program_readiness';
import {
  collectLinkedPrograms,
  type LinkedProgramLike,
  type MaterialPropertiesLike,
  touchLinkedProgram,
} from '../linked_program_touch';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import { settleProgramVariants } from '../program_variant_settle';
import type { CrestKind } from './signature_shapes';

export interface CrestPrewarmHost {
  properties: MaterialPropertiesLike;
  compile(root: THREE.Object3D, offscreen: boolean): Promise<void>;
  draw(group: THREE.Group, child: THREE.Object3D): void;
}

/** Hidden carriers borrow the actual pool buffers and material. Compilation
 * alone never uploads geometry; each carrier also receives a bounded draw. */
export class CrestPrewarm {
  readonly group = new THREE.Group();
  private readonly carriers = new Map<
    CrestKind,
    THREE.Mesh<THREE.BufferGeometry, THREE.Material>
  >();
  private readonly compiled = new Map<CrestKind, LinkedProgramLike[]>();
  private readonly compiling = new Map<CrestKind, Promise<void>>();
  private readonly touched = new Set<LinkedProgramLike>();
  private readonly uploaded = new Set<CrestKind>();
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    shapes: ReadonlyMap<CrestKind, THREE.BufferGeometry>,
    material: THREE.Material,
  ) {
    this.group.name = 'signature-crest-prewarm';
    this.group.visible = false;
    this.group.userData.renderCategory = 'prewarm';
    for (const [kind, geometry] of shapes) {
      const carrier = new THREE.Mesh(geometry, material);
      carrier.name = `crest-upload:${kind}`;
      carrier.frustumCulled = false;
      carrier.userData.renderCategory = 'prewarm';
      this.group.add(carrier);
      this.carriers.set(kind, carrier);
    }
    scene.add(this.group);
  }

  ready(kind: CrestKind): boolean {
    return !this.disposed && this.uploaded.has(kind);
  }

  units(host: CrestPrewarmHost, kinds?: readonly CrestKind[]): PrewarmResumeUnit[] {
    if (this.disposed) return [];
    const units: PrewarmResumeUnit[] = [];
    for (const [kind, carrier] of this.carriers) {
      if (this.uploaded.has(kind) || (kinds && !kinds.includes(kind))) continue;
      units.push({
        id: `crest-compile:${kind}`,
        run: () => {
          if (this.disposed || this.compiled.has(kind)) return;
          const existing = this.compiling.get(kind);
          if (existing) return existing;
          // Claim only when admitted, never while constructing a queued recipe.
          const task = (async () => {
            await host.compile(carrier, true);
            if (this.disposed) return;
            const owner = this;
            const settled = await settleProgramVariants(host.properties, [carrier.material], {
              get fired() {
                return owner.disposed;
              },
            });
            if (this.disposed) return;
            if (!settled.settled) throw new Error(`Crest ${kind} has unsettled programs`);
            const programs = collectLinkedPrograms(host.properties, carrier, isProgramKnownReady);
            // This rigid, single-pass shader has canvas and offscreen colour
            // variants only. Never silently bless an unexpected third variant.
            if (programs.length < 1 || programs.length > 2)
              throw new Error(`Crest ${kind} expected one or two output programs`);
            this.compiled.set(kind, programs);
          })();
          this.compiling.set(kind, task);
          const release = () => this.compiling.delete(kind);
          void task.then(release, release);
          return task;
        },
      });
      for (let index = 0; index < 2; index++)
        units.push({
          id: `touch:crest:${kind}:${index}`,
          run: () => {
            if (this.disposed) return;
            const programs = this.compiled.get(kind);
            if (!programs) throw new Error(`Crest ${kind} was not compiled`);
            const program = programs[index];
            if (!program || this.touched.has(program)) return;
            touchLinkedProgram(program);
            if (!this.disposed) this.touched.add(program);
          },
        });
      units.push({
        id: `crest-upload:${kind}`,
        run: () => {
          if (this.disposed || this.uploaded.has(kind)) return;
          if (!this.compiled.has(kind)) throw new Error(`Crest ${kind} was not compiled`);
          if (!this.compiled.get(kind)!.every((program) => this.touched.has(program)))
            throw new Error(`Crest ${kind} has untouched programs`);
          host.draw(this.group, carrier);
          if (!this.disposed) this.uploaded.add(kind);
        },
      });
    }
    return units;
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
    for (const carrier of this.carriers.values()) {
      try {
        carrier.removeFromParent();
      } catch (error) {
        errors.push(error);
      }
    }
    this.carriers.clear();
    this.compiled.clear();
    this.compiling.clear();
    this.touched.clear();
    this.uploaded.clear();
    // The live pool alone owns and disposes the borrowed buffers/material.
    if (errors.length) throw new AggregateError(errors, 'Crest carrier cleanup failed');
  }
}
