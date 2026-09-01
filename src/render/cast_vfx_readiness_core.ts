// Whether the ability-VFX painter may draw a cast yet: every program a cast
// can need (the pooled primitives, the generic basics, the lazy spell
// stand-ins) is linked. Until then the painter draws nothing, so a first cast
// never links a program cold on a live frame; the cast bars and nameplates
// the player acts on are untouched, only the cosmetic read is skipped.
// The per-frame path is wider than the cast draws alone (a held entity is
// slept, so its ground aura, shell, orbit and glow sleep with it), with ONE
// read that survives the closed gate: the hard-CC band, re-held right after
// the sleep that deleted it, because a stun, fear or root is information the
// player acts on and only a frustum-culled rig may drop it. The other
// actionable reads are elsewhere: the rig's windup clip, the terrain-draped
// area ring, the cast bar, the nameplate and the HUD debuffs, with the
// deadline below bounding the whole window. The band's overlay program is one
// of the gated set, so drawing it through the closed gate may link that one
// program cold once (the trade the area ring makes too); its unit then settles
// as a hit and records it like the rest.
//
// Why a gate rather than an earlier link: the boot manifest's entry for these
// programs runs after its 3 s budget on the OpenGL desktops (measured
// 2026-08-28: 4.1 s of manifest on both Linux GPUs, the entry timed out on
// every run), so its programs resume as debt after the reveal, and for those
// seconds a cast would have been the cold link. Host-agnostic
// (RENDER_PURE_CORES): materials are opaque handles, the host answers whether
// one is linked.

export interface CastVfxReadinessDeps<M> {
  /** The clock the deadline runs on; injected so the core stays pure. */
  now: () => number;
  /** How long the gate may hold before it opens on its own. Every sibling
   *  hold in this subsystem is bounded and this one was not: `ready` latches
   *  only when the stand-ins are staged AND every material is linked, so a
   *  boot entry the budget dropped whose resume never lands (a page
   *  backgrounded through the whole resume, a starved resume queue, a link
   *  that rejects) left the painter drawing NO cast for the rest of the
   *  session, with nothing to say so. The asymmetry decides the value: opening
   *  early costs ONE cold link, never opening costs the whole session, so the
   *  bound is deliberately far past any legitimate resume. */
  deadlineMs: number;
  /** Every material a cast may draw with. Read ONCE, at the first consult
   *  after the stand-ins are staged: the pools and stand-ins are never
   *  disposed or replaced, and the per-frame consult must not walk the scene
   *  during the very seconds the programs are still linking. */
  materials: () => readonly M[];
  /** The lazy stand-ins were staged at least once: until then their set is
   *  unknown, so nothing is admitted. */
  staged: () => boolean;
  /** Whether a settle has PROVED this material's program linked (the host
   *  reads the settle record, never the driver: a per-frame consult must not
   *  issue a GPU-process round trip). */
  linked: (material: M) => boolean;
}

export interface CastVfxReadinessSnapshot {
  ready: boolean;
  /** Casts the painter skipped while not ready. */
  refused: number;
  /** Unlinked materials at the last check; null while the stand-ins are not staged. */
  pending: number | null;
  /** The gate opened on its deadline rather than on its programs: the resume
   *  never landed, and the readout says so instead of the session going quiet. */
  forced: boolean;
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
  let forced = false;
  let refused = 0;
  let pending: number | null = null;
  let materials: readonly M[] | null = null;
  // From the first consult, not from the staging: the failure this bounds
  // includes the one where the stand-ins are never staged at all.
  let firstConsultAt: number | null = null;
  // Per material, the same latch: one that answered linked is never asked
  // again, so the walk shrinks to the materials still pending.
  const linkedMaterials = new Set<M>();
  const check = (): boolean => {
    if (ready) return true;
    const now = deps.now();
    if (firstConsultAt === null) firstConsultAt = now;
    if (now - firstConsultAt >= deps.deadlineMs) {
      ready = true;
      forced = true;
      return true;
    }
    if (!deps.staged()) {
      pending = null;
      return false;
    }
    if (materials === null) materials = deps.materials();
    let unlinked = 0;
    for (const material of materials) {
      if (linkedMaterials.has(material)) continue;
      if (deps.linked(material)) linkedMaterials.add(material);
      else unlinked++;
    }
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
      return { ready, refused, pending, forced };
    },
  };
}
