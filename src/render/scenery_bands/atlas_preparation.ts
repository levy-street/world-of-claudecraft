import type * as THREE from 'three';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from '../background_gpu_queue';
import { type CompileArmHost, linkColorPrograms } from '../compile_arms';
import { CompileGateQueue } from '../compile_gate';
import { linkPieceWork } from '../compile_gate_pieces';
import { runWorldGateTouchLane } from '../linked_program_touch_lane';
import { pieceProgramSettle } from '../program_variant_settle';
import { runPiecesWarmed } from '../shader_warm_gate';
import { runTexturePrepLane } from '../texture_prep_lane';

/** The atlas has its own lights and linear target. Prepare that exact variant
 * through the shared lanes before any cell draws. Await outside a queue unit:
 * the link, texture uploads and program touches each submit their own units. */
export async function prepareSceneryAtlas(
  queue: Pick<BackgroundGpuQueue, 'run'>,
  webgl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
): Promise<void> {
  const depthMaterials = new Map<string, THREE.MeshDepthMaterial>();
  const arms: CompileArmHost = {
    webgl: () => webgl,
    context: () => webgl.getContext(),
    camera: () => camera,
    scene: () => scene,
    shadowCamera: () => camera,
    offscreen: () => true,
    offscreenTarget: () => target,
    depthMaterials: () => depthMaterials,
    shadowArm: () => false,
  };
  const priority = GPU_WORK_PRIORITY.VISIBLE_PREWARM;
  const gates = new CompileGateQueue(queue);
  const pieces = linkPieceWork(
    scene,
    (root) => linkColorPrograms(arms, root, false),
    async () => undefined,
    pieceProgramSettle(webgl.properties, depthMaterials),
  );
  const gate = await runPiecesWarmed(arms, scene, pieces, {
    priority,
    imminent: false,
    submit: (work, firstIndex) =>
      gates.runPieces(work, 1500, { priority, label: 'scenery-giant:link' }, firstIndex),
  });
  if (gate.failed) throw new Error('Giant scenery atlas preparation failed');
  await runTexturePrepLane(queue, webgl.properties, webgl, scene, priority);
  await runWorldGateTouchLane(queue, webgl.properties, scene, priority, gate);
}
