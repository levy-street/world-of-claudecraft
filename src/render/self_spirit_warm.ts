// The local player's own ghost (spirit) variants, warmed ahead of death, as
// two units on the GPU queue with the worker's hold BETWEEN them: the dry
// assembly under the ghost swap (undone on the same frame), the hold, then
// the colour arm's link under the swap again. The scheduler that decides
// WHEN (self_spirit_prewarm.ts) calls this once per distinct local look.
//
// One unit for both would wait for the worker inside a released-tail unit:
// the link's synchronous prologue would land after the unit's first await,
// in the tail the budget cannot price, and the unit would hold one of the
// two released-tail slots for the whole hold. The player's state is re-read
// at every step: a spirit released during the hold keeps its ghost look, the
// swap is never undone on a body that should be ghosted.

import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import type { CompileArmHost } from './compile_arms';
import { type HoldOutcome, holdRootWarm, requestRootWarm } from './shader_warm_lane';

/** A kind of its own (the label up to the first colon), so the budget prices
 *  the dry assembly apart from the link that follows it. */
export const SELF_SPIRIT_WARM_LABEL = 'self-spirit-warm:body';
export const SELF_SPIRIT_LINK_LABEL = 'self-spirit';

export interface SelfSpiritVisual {
  root: THREE.Object3D;
  setGhost(on: boolean): void;
}

export interface SelfSpiritWarmDeps {
  /** True while no warm may run: async compile unsupported, or the player is
   *  a ghost (the ghost look is the live one then; it must not be undone). */
  blocked(): boolean;
  /** The current self visual, re-read at the warm. */
  visual(): SelfSpiritVisual | null;
  arms: CompileArmHost;
  /** The GPU queue. */
  run<T>(
    work: () => T | Promise<T>,
    priority: number,
    label: string,
    options?: { releaseTail?: boolean },
  ): Promise<T>;
  /** The colour arm's link of the root under its current materials. */
  link(root: THREE.Object3D): Promise<void>;
  hold?(warm: Promise<boolean>): Promise<HoldOutcome>;
}

/** Resolves true only when the link actually ran. Never throws for a refused
 *  warm unit: the link then runs cold, as before the worker. */
export async function warmSelfSpiritPrograms(deps: SelfSpiritWarmDeps): Promise<boolean> {
  if (deps.blocked()) return false;
  const visual = deps.visual();
  if (!visual) return false;
  const request: { warm: Promise<boolean> | null } = { warm: null };
  try {
    await deps.run(
      () => {
        if (deps.blocked()) return;
        visual.setGhost(true);
        try {
          request.warm = requestRootWarm(deps.arms, visual.root, GPU_WORK_PRIORITY.VISIBLE_PREWARM);
        } finally {
          visual.setGhost(false);
        }
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      SELF_SPIRIT_WARM_LABEL,
    );
  } catch {
    request.warm = null;
  }
  if (request.warm) await (deps.hold ?? holdRootWarm)(request.warm);
  if (deps.blocked()) return false;
  // The visual is re-read after the hold: a look rebuilt meanwhile replaced
  // it, and linking the detached one would be wasted work.
  if (deps.visual() !== visual) return false;
  return deps.run(
    () => {
      if (deps.blocked()) return false;
      // The link's prologue runs before its first await, so the swap is
      // undone before the link is awaited: no frame draws the ghost.
      let link: Promise<void>;
      visual.setGhost(true);
      try {
        link = deps.link(visual.root);
      } finally {
        visual.setGhost(false);
      }
      return link.then(() => true);
    },
    GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    SELF_SPIRIT_LINK_LABEL,
    { releaseTail: true },
  );
}
