// Whether the ability-VFX painter may draw a cast yet: every program a cast
// can need (the pooled primitives, the generic basics, the lazy spell
// stand-ins) is linked. Until then the painter draws nothing, so a first cast
// never links a program cold on a live frame; the cast bars and nameplates
// the player acts on are untouched, only the cosmetic read is skipped.
//
// Why a gate rather than an earlier link: the boot manifest's entry for these
// programs runs after its 3 s budget on the OpenGL desktops (measured
// 2026-08-28: 4.1 s of manifest on both Linux GPUs, the entry timed out on
// every run), so its programs resume as debt after the reveal, and for those
// seconds a cast would have been the cold link. Host-agnostic
// (RENDER_PURE_CORES): materials are opaque handles, the host answers whether
// one is linked.

export interface CastVfxReadinessDeps<M> {
  /** Every material a cast may draw with. Read ONCE, at the first consult
   *  after the stand-ins are staged: the pools and stand-ins are never
   *  disposed or replaced, and the per-frame consult must not walk the scene
   *  during the very seconds the programs are still linking. */
  materials: () => readonly M[];
  /** The lazy stand-ins were staged at least once: until then their set is
   *  unknown, so nothing is admitted. */
  staged: () => boolean;
  linked: (material: M) => boolean;
}

export interface CastVfxReadinessSnapshot {
  ready: boolean;
  /** Casts the painter skipped while not ready. */
  refused: number;
  /** Unlinked materials at the last check; null while the stand-ins are not staged. */
  pending: number | null;
}

export interface CastVfxReadiness {
  /** True when a cast may draw; a refusal is counted (one per cast read). */
  admit(): boolean;
  /** The same answer for a per-frame consult, uncounted. */
  ready(): boolean;
  snapshot(): CastVfxReadinessSnapshot;
}

export function createCastVfxReadiness<M>(deps: CastVfxReadinessDeps<M>): CastVfxReadiness {
  // Latched: a linked program stays linked for the life of its material, and
  // the pools and stand-ins are never disposed.
  let ready = false;
  let refused = 0;
  let pending: number | null = null;
  let materials: readonly M[] | null = null;
  const check = (): boolean => {
    if (ready) return true;
    if (!deps.staged()) {
      pending = null;
      return false;
    }
    if (materials === null) materials = deps.materials();
    let unlinked = 0;
    for (const material of materials) if (!deps.linked(material)) unlinked++;
    pending = unlinked;
    ready = unlinked === 0;
    return ready;
  };
  return {
    admit: () => {
      const ok = check();
      if (!ok) refused++;
      return ok;
    },
    ready: check,
    snapshot: () => {
      check();
      return { ready, refused, pending };
    },
  };
}
