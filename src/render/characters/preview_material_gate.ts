// Late body atlases and effect materials can arrive after the preview's open
// warm. Keep their hidden twins behind the same link/upload/touch proof in
// this context; the already prepared live material remains the stand-in.
//
// The same gate also holds what has NO stand-in: a head file or a first armor
// file that lands late is hidden until this gate settles (CharacterVisual
// revealOnCompile), and a preview body draws nothing at all until its head is
// live. So a warm the context rejects is REPORTED, once per target, as a
// settle that is not ready, and its caller decides: such a node is shown
// (linking on its first draw beats a preview with nobody in it); the body
// atlas swap keeps its stand-in and asks again (woc_atlas_swap.ts), as a
// replacement armor file does; an effect swap takes its clones on any settle,
// as it does behind the world gate (CharacterVisual.stageEffectSwap). A target
// whose warm fails AGAIN is not reported a second time: only a caller with a
// stand-in asks twice, and that stand-in then simply keeps drawing.
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
  /** Targets whose rejected warm was already reported to their caller. */
  const reported = new WeakSet<THREE.Object3D>();
  return (target, settle) => {
    // Disposed/rebuilt visuals and superseded atlas twins must never touch a
    // released context or commit into a different selection.
    const isCancelled = () => !host.isCurrent() || target.parent === null;
    // this ask was answered (a caller that throws out of its settle is not asked twice)
    let vouched = false;
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
      if (isCancelled()) return;
      vouched = true;
      settle();
    };
    // A failed warm keeps the last prepared material visible. Never commit
    // the cold atlas merely because its compile or upload was rejected: the
    // first failure is reported not ready (see the header), a repeat is not.
    void prepare().catch((err) => {
      if (isCancelled()) return;
      console.warn('[preview] material warm failed', err);
      if (vouched || reported.has(target)) return;
      reported.add(target);
      // nothing follows this handler: a caller that throws must not surface as an
      // unhandled rejection
      try {
        settle(() => false);
      } catch (settleErr) {
        console.warn('[preview] material settle failed', settleErr);
      }
    });
  };
}
