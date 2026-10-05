// Late body atlases and effect materials can arrive after the preview's open
// warm. Keep their hidden twins behind the same link/upload/touch proof in
// this context; the already prepared live material remains the stand-in.
import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from '../background_gpu_queue';
import {
  type LinkedProgramTouchQueue,
  PREVIEW_LINKED_PROGRAM_TOUCH_LABEL,
  runLinkedProgramTouchLane,
} from '../linked_program_touch_lane';
import { collectPrewarmTextures, uploadTexturesInSlices } from '../texture_prewarm';
import type { FarBakeGate } from './visual';

interface PreviewMaterialHost {
  renderer: Pick<THREE.WebGLRenderer, 'compileAsync' | 'initTexture' | 'properties'>;
  scene: THREE.Scene;
  camera: THREE.Camera;
  touchQueue(): LinkedProgramTouchQueue | null;
  yieldToMain(): Promise<void>;
  isCurrent(): boolean;
}

export function previewMaterialGate(host: PreviewMaterialHost): FarBakeGate {
  return (target, settle) => {
    // Disposed/rebuilt visuals and superseded atlas twins must never touch a
    // released context or commit into a different selection.
    const isCancelled = () => !host.isCurrent() || target.parent === null;
    const prepare = async () => {
      if (isCancelled()) return;
      // The third argument keeps the live preview's lights/environment while
      // compiling only this hidden target (three traverses its meshes even
      // when invisible), so the shown material keeps the linked variant.
      await host.renderer.compileAsync(target, host.camera, host.scene);
      if (isCancelled()) return;
      const textures = new Set<THREE.Texture>();
      collectPrewarmTextures(target, textures);
      await uploadTexturesInSlices(host.renderer, textures, {
        yieldToMain: host.yieldToMain,
        isCancelled,
      });
      if (isCancelled()) return;
      const queue = host.touchQueue();
      await runLinkedProgramTouchLane(
        {
          run: async (work, priority, label) => {
            const guarded = () => {
              if (isCancelled()) throw new Error('preview material superseded');
              return work();
            };
            if (queue) return queue.run(guarded, priority, label);
            // Landing previews have no world queue. Still yield between
            // program touches so the whole tail cannot block one frame.
            await host.yieldToMain();
            return guarded();
          },
        },
        host.renderer.properties,
        target,
        GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
        { label: PREVIEW_LINKED_PROGRAM_TOUCH_LABEL, settled: true },
      );
      if (!isCancelled()) settle();
    };
    // A failed warm keeps the last prepared material visible. Never commit
    // the cold atlas merely because its compile or upload was rejected.
    void prepare().catch((err) => {
      if (!isCancelled()) console.warn('[preview] material warm failed', err);
    });
  };
}
