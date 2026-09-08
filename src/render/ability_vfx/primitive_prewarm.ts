import type * as THREE from 'three';
import type { PrewarmResumeUnit } from '../prewarm_resume';
import type { CrestPrewarmHost } from './crest_prewarm';
import {
  abilityVfxTexturePrewarmSteps,
  collectAbilityVfxCompileTargets,
  persistentClassVfxCompileTargets,
} from './prewarm';

interface PrimitivePrewarmHost extends CrestPrewarmHost {
  scene: THREE.Scene;
  spawn(): void;
  stageMaterials(): void | Promise<void>;
  materialUnits(): readonly PrewarmResumeUnit[];
  geometryUnits(host: CrestPrewarmHost): readonly PrewarmResumeUnit[];
  texture(texture: THREE.Texture): void;
  materialTextures(material: THREE.Material | THREE.Material[]): void;
  withinDeadline(): boolean;
}

/** The loading entry and its small invisible resume units share the same
 * geometry preparation. Visible primitive spawns remain loading-window only. */
export function abilityPrimitivePrewarmEntry(host: PrimitivePrewarmHost) {
  const geometry = () => host.geometryUnits(host);
  const resumeUnits = (): readonly PrewarmResumeUnit[] => [
    ...abilityVfxTexturePrewarmSteps().map((step) => ({
      id: `texture:${step.id}`,
      run: () => {
        for (const texture of step.build()) host.texture(texture);
      },
    })),
    ...host.materialUnits(),
    ...collectAbilityVfxCompileTargets(host.scene)
      .concat(persistentClassVfxCompileTargets())
      .map((target) => ({
        id: `program:${target.id}`,
        run: () => host.compile(target.object, false),
      })),
    ...geometry(),
  ];
  let done = 0;
  let planned = 0;
  return {
    id: 'vfx.ability-primitives',
    category: 'vfx' as const,
    priority: 62,
    required: false,
    resumeUnits,
    resumePartialUnits: geometry,
    run: async () => {
      host.spawn();
      await host.stageMaterials();
      host.scene.traverse((child) => {
        const material = (child as THREE.Mesh).material;
        if (child.userData.renderCategory === 'vfx' && material) host.materialTextures(material);
      });
      const units = geometry();
      planned = units.length;
      done = 0;
      for (const unit of units) {
        if (!host.withinDeadline()) break;
        await unit.run();
        done++;
      }
    },
    progress: () => ({ done, planned, trimmed: done < planned }),
  };
}
