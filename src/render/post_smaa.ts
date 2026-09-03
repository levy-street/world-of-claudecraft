import { UnsignedByteType, type WebGLRenderTarget } from 'three';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

// r185 constructs SMAA's two intermediates as HalfFloat, and @types/three still
// declares them under their pre-r185 public names, so reach them through one
// typed view that accepts either spelling (the same shape post_bloom.ts uses
// for the bloom pass's renamed quad).
interface SMAAPassTargets {
  _edgesRT?: WebGLRenderTarget;
  _weightsRT?: WebGLRenderTarget;
  edgesRT?: WebGLRenderTarget;
  weightsRT?: WebGLRenderTarget;
}

/**
 * The pass's edges and weights targets, whichever field names this three
 * carries. Best-effort by design: if a future three renames the fields again
 * both lookups miss and nothing is re-typed, which would leave
 * `post_plan_core.ts` declaring rgba8 for HalfFloat targets. The length
 * assertion in the SMAA case of `tests/post_pipeline.test.ts` is what catches
 * that, so keep it decisive.
 */
export function smaaIntermediateTargets(pass: SMAAPass): WebGLRenderTarget[] {
  const view = pass as unknown as SMAAPassTargets;
  const edges = view._edgesRT ?? view.edgesRT;
  const weights = view._weightsRT ?? view.weightsRT;
  const targets: WebGLRenderTarget[] = [];
  if (edges) targets.push(edges);
  if (weights) targets.push(weights);
  return targets;
}

/**
 * SMAA with 8-bit intermediates.
 *
 * Both intermediates carry values the algorithm defines on [0,1]: edges is a
 * two-channel boolean-ish mask and weights is the four blend weights, which the
 * reference SMAA implementation stores as RG8 and RGBA8 respectively. Three
 * allocates them as HalfFloat, so at 4K the two targets alone cost 66 MB of the
 * post chain's storage and every edge and weight write moves twice the bytes,
 * for precision the shaders never use. Re-typing them is byte-for-byte the
 * reference configuration, so the anti-aliased result is unchanged.
 *
 * The type is set before anything renders and before the first setSize, so
 * three allocates the GL texture straight into RGBA8; nothing is reallocated.
 */
export class ByteTargetSMAAPass extends SMAAPass {
  constructor() {
    super();
    for (const target of smaaIntermediateTargets(this)) {
      target.texture.type = UnsignedByteType;
    }
  }
}
