// Stateful cursor for entry-scene texture initialization. The renderer can
// spend one indivisible upload in compile-loop gaps, then continue the same
// ordered set in the texture manifest entry without uploading anything twice.

import type * as THREE from 'three';
import { collectObjectTextures } from './material_texture_slots';
import type { PrewarmResumeUnit } from './prewarm_resume';
import { texturePieceLabel } from './texture_prep_lane';

export interface InitialSceneTextureProgress {
  initialized: number;
  planned: number;
  trimmed: boolean;
}

export function initialPresentationViewRoots<T extends { group: THREE.Object3D }>(
  views: ReadonlyMap<number, T>,
  selfId: number,
  targetId: number | null,
): THREE.Object3D[] {
  const roots: THREE.Object3D[] = [];
  const self = views.get(selfId);
  if (self) roots.push(self.group);
  if (targetId !== null && targetId !== selfId) {
    const target = views.get(targetId);
    if (target) roots.push(target.group);
  }
  return roots;
}

/** Collect visible scene textures plus explicitly prioritized hidden roots. */
export function collectInitialSceneTextures(
  scene: THREE.Object3D,
  priorityRoots: Iterable<THREE.Object3D>,
): THREE.Texture[] {
  const textures = collectObjectTextures(scene, true);
  for (const root of priorityRoots) collectObjectTextures(root, false, textures);
  return [...textures];
}

export function collectInitialPresentationTextures<T extends { group: THREE.Object3D }>(
  scene: THREE.Object3D,
  views: ReadonlyMap<number, T>,
  selfId: number,
  targetId: number | null,
): THREE.Texture[] {
  return collectInitialSceneTextures(scene, initialPresentationViewRoots(views, selfId, targetId));
}

export function initialSceneTextureResumeUnits(
  idPrefix: string,
  textures: readonly THREE.Texture[],
  upload: (texture: THREE.Texture) => void,
): PrewarmResumeUnit[] {
  return [...new Set(textures)].map((texture) => ({
    id: texturePieceLabel(`upload:${idPrefix}`, texture),
    run: () => upload(texture),
  }));
}

export class InitialSceneTextureAdmission<T> {
  private readonly textures: readonly T[];
  private cursor = 0;

  constructor(
    textures: readonly T[],
    private readonly upload: (texture: T) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly yieldSlice: () => Promise<void> = () =>
      new Promise((resolve) => setTimeout(resolve, 0)),
  ) {
    this.textures = [...new Set(textures)];
  }

  /** Admit at most one indivisible texture before the absolute deadline. */
  admitOneBefore(deadlineMs: number): boolean {
    if (this.cursor >= this.textures.length || this.now() >= deadlineMs) return false;
    // Commit the cursor only after a successful upload. A transient GPU error
    // must leave this texture in remaining() so the explicit manifest resume
    // lane can retry it rather than paying the cold upload on a live draw.
    this.upload(this.textures[this.cursor]);
    this.cursor++;
    return true;
  }

  /** Continue from the shared cursor, yielding between bounded batches. */
  async drainBefore(deadlineMs: number, batchSize: number): Promise<InitialSceneTextureProgress> {
    const batch = Math.max(1, Math.floor(batchSize));
    while (this.cursor < this.textures.length && this.now() < deadlineMs) {
      let admitted = 0;
      while (admitted < batch && this.admitOneBefore(deadlineMs)) admitted++;
      if (this.cursor < this.textures.length && this.now() < deadlineMs) await this.yieldSlice();
    }
    return this.progress();
  }

  progress(): InitialSceneTextureProgress {
    return {
      initialized: this.cursor,
      planned: this.textures.length,
      trimmed: this.cursor < this.textures.length,
    };
  }

  /** Snapshot only the tail that has not already been admitted. */
  remaining(): readonly T[] {
    return this.textures.slice(this.cursor);
  }
}
