// One morph target list for a set of parts about to be merged.
//
// A merged BufferGeometry carries ONE `morphAttributes.position` list, and
// three drives a target by INDEX, so parts that carry different targets can
// only merge once every one of them is padded to the same list: the union of
// their target names, with an all-zero delta wherever a part does not have
// that target (the identity for a relative morph, so a slider that reaches
// only the head moves only the head's vertices inside the merged buffer).
//
// Names, never indices. The composed library's parts each ship the subset of
// the head's shape keys that actually reaches them (the hands carry two body
// sliders, the head seventeen face ones), so `M_Head` target 3 and `M_HandL`
// target 3 are unrelated. `applyMorphs` already drives by name off each mesh's
// own dictionary; this plan is the same rule pushed into the geometry.
//
// Three-free by design: the merge's one hard decision is decided by a plain
// Vitest, not by building a rig.

/** The union list plus, per part, where each output slot reads from. */
export interface MorphUnionPlan {
  /** Target names in output order: first-seen across the parts, so the plan is
   *  a function of the input order alone and two composes of one part set
   *  produce the same buffer. */
  readonly names: readonly string[];
  /** `sourceIndex[part][slot]` is that slot's index in the part's OWN target
   *  list, or -1 when the part does not carry it. */
  readonly sourceIndex: readonly (readonly number[])[];
}

/**
 * The union plan for parts whose own target names are `partTargets[i]`.
 *
 * A part with no targets contributes nothing and gets an all -1 row, which is
 * how a morph-free hair style joins the brows it shares a material with.
 */
export function morphUnionPlan(partTargets: readonly (readonly string[])[]): MorphUnionPlan {
  const names: string[] = [];
  const slotOf = new Map<string, number>();
  for (const targets of partTargets) {
    for (const name of targets) {
      if (slotOf.has(name)) continue;
      slotOf.set(name, names.length);
      names.push(name);
    }
  }
  const sourceIndex = partTargets.map((targets) => {
    const row = new Array<number>(names.length).fill(-1);
    // Last writer wins on a repeated name inside ONE part: three's own
    // dictionary has the same shape (one index per name), so this matches what
    // `applyMorphs` would have driven on the unmerged part.
    for (let i = 0; i < targets.length; i++) {
      const slot = slotOf.get(targets[i]);
      if (slot !== undefined) row[slot] = i;
    }
    return row;
  });
  return { names, sourceIndex };
}

/** The name-to-index dictionary a merged mesh needs for `applyMorphs` (and for
 *  every other by-name driver: the hair sway, the earring reseat). */
export function morphTargetDictionaryOf(names: readonly string[]): Record<string, number> {
  const dict: Record<string, number> = {};
  for (let i = 0; i < names.length; i++) dict[names[i]] = i;
  return dict;
}
