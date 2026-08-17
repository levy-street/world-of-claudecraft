// Which meshes of a body the Soul Rend prewarm must build a clone for. Pure and
// three-free on purpose: the caller owns the material cloning and the live rig,
// this only answers WHICH surfaces the mark will repaint, so the selection is
// testable without a GPU or a loaded GLB.
//
// The mark repaints exactly what the visual snapshotted as its original
// materials, plus the far-LOD mesh, and never the weapon VFX rig (its shader
// materials are owned by the weapon-skin handle and stay out of the overlay
// cycle).

export interface SoulRendPrewarmMesh {
  userData?: { weaponVfxMesh?: boolean };
}

export interface SoulRendPrewarmTarget<TMesh, TMaterial> {
  source: TMesh;
  original: TMaterial | TMaterial[];
}

export function soulRendPrewarmTargets<TMesh extends SoulRendPrewarmMesh, TMaterial>(input: {
  /** The visual's original-material snapshot, in its own iteration order. */
  originalMaterials: Iterable<[TMesh, TMaterial | TMaterial[]]>;
  farMesh?: TMesh | null;
  farMaterials?: TMaterial | TMaterial[] | null;
  /** A body torn down while the prewarm was waiting for an idle slot. */
  disposed?: boolean;
}): Array<SoulRendPrewarmTarget<TMesh, TMaterial>> {
  const targets: Array<SoulRendPrewarmTarget<TMesh, TMaterial>> = [];
  if (input.disposed) return targets;
  const add = (source: TMesh, original: TMaterial | TMaterial[]): void => {
    if (source.userData?.weaponVfxMesh) return;
    targets.push({ source, original });
  };
  for (const [mesh, original] of input.originalMaterials) add(mesh, original);
  if (input.farMesh && input.farMaterials) add(input.farMesh, input.farMaterials);
  return targets;
}
