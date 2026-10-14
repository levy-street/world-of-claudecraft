import type { CustomMap } from './custom_map';

/** The narrow viewport surface used when the editor changes documents. */
export interface EditorViewportMapTarget {
  reload(map: CustomMap): Promise<void>;
  switchDocumentPreservingTerrain(map: CustomMap): boolean;
}

/**
 * Apply a new editor document to the 3D viewport. Collision Master can swap
 * its scratch placement scene in without destroying the world's resident
 * terrain chunks. A viewport that is still booting declines that fast path,
 * so ordinary reload remains the safe fallback.
 *
 * `null` means the synchronous, terrain-preserving path was used.
 */
export function transitionEditorViewport(
  viewport: EditorViewportMapTarget,
  map: CustomMap,
  preserveTerrain: boolean,
): Promise<void> | null {
  if (preserveTerrain && viewport.switchDocumentPreservingTerrain(map)) return null;
  return viewport.reload(map);
}
