// The page's context-restore registries (context_restore_core.ts owns the
// mechanics): every owner of a "this GPU work is done" record registers its
// reset here, next to the record, and every owner of a render target or baked
// texture that a restore leaves EMPTY registers how to render it again. The
// world renderer's restore host (context_restore.ts) runs the resets before
// anything is prepared again and the re-bakes as paced queue units under the
// restore hold.
//
// The ids are a closed list on purpose: tests/context_restore_registry.test.ts
// scans src/render for record shapes (a Set or flag named prepared, warmed,
// uploaded, linked, ready, ...) and fails on one that neither names an id
// here nor carries an exemption with its reason, so a new record cannot ship
// without an answer to "what happens to it on a restore".

import { createContextRestoreRegistry } from './context_restore_core';

export const CONTEXT_RESTORE_RESET_IDS = [
  'renderer.zone-programs',
  'texture-residency',
  'cast-vfx-readiness',
  'reveal-gate',
  'occluder-fade-gate',
  'guard-prewarm',
  'crest-prewarm',
  'active-kit',
  'vfx-cloud',
  'overlay-sprites',
  'ribbons',
  'spirit-apparitions',
  'character-visual',
  'form-adornments',
  'self-spirit',
  'interior-encounter-prewarm',
  'post-shed',
] as const;

export type ContextRestoreResetId = (typeof CONTEXT_RESTORE_RESET_IDS)[number];

export const CONTEXT_RESTORE_REBAKE_IDS = [
  'environment-maps',
  'grass-ground-bake',
  'impostor-atlas',
  'scene-sampling',
] as const;

export type ContextRestoreRebakeId = (typeof CONTEXT_RESTORE_REBAKE_IDS)[number];

const resets = createContextRestoreRegistry();
const rebakes = createContextRestoreRegistry();

export function registerContextRestoreReset<T extends object>(
  id: ContextRestoreResetId,
  owner: T,
  reset: (owner: T) => void,
): void {
  resets.register(id, owner, reset);
}

/** `rebake` renders the owner's target again on the restored context. It runs
 *  inside one queue unit, so it must be one bounded piece of GPU work. */
export function registerContextRestoreRebake<T extends object>(
  id: ContextRestoreRebakeId,
  owner: T,
  rebake: (owner: T) => void,
): void {
  rebakes.register(id, owner, rebake);
}

function warnFailure(kind: string): (id: string, error: unknown) => void {
  return (id, error) => {
    console.warn(`[context-restore] ${kind} ${id} failed`, error);
  };
}

export function runContextRestoreResets() {
  return resets.run(warnFailure('reset'));
}

/** One entry per live re-bake owner; the host runs each as a queue unit. */
export function contextRestoreRebakeUnits(): { id: string; run: () => void }[] {
  return rebakes.bound();
}

export function contextRestoreResetCounts(): Map<string, number> {
  return resets.counts();
}

export function contextRestoreRebakeCounts(): Map<string, number> {
  return rebakes.counts();
}

export function resetContextRestoreRegistriesForTest(): void {
  resets.clear();
  rebakes.clear();
}
