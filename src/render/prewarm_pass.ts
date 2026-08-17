// Sequencing policy for a BACKGROUND zone prewarm (the visible-zone streaming
// lane, no loading screen). Live gameplay frames keep rendering while the
// per-template compile loop awaits idle slots below, so the prewarm groups
// MUST stay invisible for that whole window: a visible group is a grid of
// freshly built rigs with no animation mixer running, a pile of T-posed
// characters stacked next to the player. Hiding them is safe for the compile:
// three's compile()/compileAsync() prepare materials via scene.traverse (not
// traverseVisible), so hidden objects still link their programs. The groups
// turn visible one child at a time only inside its synchronous upload task, so
// no awaited frame can ever paint them.

import type { IdleSlotResult } from './idle_queue';

export interface PrewarmGroupLike {
  visible: boolean;
  children: readonly unknown[];
}

/** Retains an entry for a bounded render only when it was already live-visible. */
export function boundedPrewarmVisibility(wasVisible: boolean, retained: boolean): boolean {
  return wasVisible && retained;
}

/** Keeps newly attached scene groups hidden for an entire awaited compile window. */
export async function withHiddenPrewarmGroups<T>(
  groups: readonly PrewarmGroupLike[],
  work: () => T | Promise<T>,
): Promise<T> {
  const visibility = groups.map((group) => group.visible);
  for (const group of groups) group.visible = false;
  try {
    return await work();
  } finally {
    for (let index = 0; index < groups.length; index++) groups[index].visible = visibility[index];
  }
}

export interface BackgroundPrewarmHooks {
  /** KHR_parallel_shader_compile is available: link programs off-thread first. */
  supportsAsyncCompile: boolean;
  /** Wait for a budgeted idle slot between expensive units. */
  idleSlot: () => Promise<IdleSlotResult>;
  /**
   * Compile one prewarm template's programs (the renderer's webgl.compileAsync).
   * One template per idle slot: even compileAsync's
   * synchronous prologue is a measured multi-hundred-ms stall when handed a
   * whole zone's batch at once.
   */
  compileChild: (child: unknown) => Promise<void>;
  /** Safe texture/material preparation used when shaders cannot link async. */
  prepareChildAssets?: (child: unknown) => void;
  /** Upload one already-linked template in isolation. The caller performs a
   *  real offscreen render with only this child visible, one idle slot after
   *  compile, so geometry/textures do not accumulate into the final pass. */
  warmChild?: (group: PrewarmGroupLike, child: unknown) => void;
  /**
   * Finer-grained alternative to warmChild, preferred when both are supplied:
   * decompose one child's upload into SEVERAL units (texture batches first,
   * then the bounded render), each granted its own idle slot and arbiter unit.
   * A whole-child unit was a measured 100-345ms main-thread block; per-unit
   * splitting is what keeps any single grant under a frame budget. Visibility
   * is the units' own business (the bounded render manages scene and group
   * visibility itself; texture uploads need none).
   */
  warmChildUnits?: (
    group: PrewarmGroupLike,
    child: unknown,
  ) => Array<{ label?: string; run: () => void }>;
  /** Fallback pass used only after async compile when isolated uploads are unavailable. */
  renderWarmPass: () => void;
  /**
   * Schedules one synchronous upload/render unit on the shared GPU arbiter.
   * Visibility changes happen inside this callback after the arbiter grants
   * the unit, never while it is waiting behind another lane. The label names
   * the unit in the arbiter's per-unit timing stats.
   */
  runUpload?: (work: () => void, label?: string) => void | Promise<void>;
  /** Records the deliberate one-unit fallback after idle timeout deferrals. */
  onForcedProgress?: (phase: 'compile' | 'upload', child: unknown) => void;
}

export async function runBackgroundPrewarm(
  groups: readonly PrewarmGroupLike[],
  hooks: BackgroundPrewarmHooks,
): Promise<void> {
  for (const group of groups) group.visible = false;
  try {
    for (const group of groups) {
      for (const child of [...group.children]) {
        if (hooks.supportsAsyncCompile) {
          const compileSlot = await hooks.idleSlot();
          if (compileSlot.forcedProgress) hooks.onForcedProgress?.('compile', child);
          await hooks.compileChild(child);
        }
        if (!hooks.supportsAsyncCompile && hooks.prepareChildAssets) {
          const assetSlot = await hooks.idleSlot();
          if (assetSlot.forcedProgress) hooks.onForcedProgress?.('upload', child);
          const prepare = (): void => hooks.prepareChildAssets?.(child);
          if (hooks.runUpload) await hooks.runUpload(prepare);
          else prepare();
        } else if (hooks.supportsAsyncCompile && hooks.warmChildUnits) {
          for (const unit of hooks.warmChildUnits(group, child)) {
            const unitSlot = await hooks.idleSlot();
            if (unitSlot.forcedProgress) hooks.onForcedProgress?.('upload', child);
            if (hooks.runUpload) await hooks.runUpload(unit.run, unit.label);
            else unit.run();
          }
        } else if (hooks.supportsAsyncCompile && hooks.warmChild) {
          const uploadSlot = await hooks.idleSlot();
          if (uploadSlot.forcedProgress) hooks.onForcedProgress?.('upload', child);
          const warm = (): void => {
            group.visible = true;
            try {
              hooks.warmChild?.(group, child);
            } finally {
              group.visible = false;
            }
          };
          if (hooks.runUpload) await hooks.runUpload(warm);
          else warm();
        }
      }
    }
    // Each isolated child upload is an exact replacement for the old final
    // whole-group render. Do not submit the live world and the whole prewarm
    // grid once more after the bounded units are already warm.
    if (hooks.warmChildUnits || hooks.warmChild || hooks.prepareChildAssets) return;
    // Without parallel compile there is no safe reason to aggregate every
    // child into one synchronous live-scene pass. Leave the debt lazy instead.
    if (!hooks.supportsAsyncCompile) return;
    await hooks.idleSlot();
    const warmAll = (): void => {
      for (const group of groups) group.visible = true;
      try {
        hooks.renderWarmPass();
      } finally {
        for (const group of groups) group.visible = false;
      }
    };
    if (hooks.runUpload) await hooks.runUpload(warmAll);
    else warmAll();
  } finally {
    for (const group of groups) group.visible = false;
  }
}
