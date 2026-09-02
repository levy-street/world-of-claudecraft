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
// The SHELL is the one of those four worth deciding out loud, because "this
// target has an absorb up" IS a read a player acts on: it stays in the sleep
// because the HUD carries the same information whole and unheld. The target
// frame's aura strip shows EVERY aura of the current target, buffs included,
// at full rate on every graphics tier (src/ui/hud.ts, the `all` targetAurasView
// feeding #tf-debuffs and the target-auras window); the local player's own
// shield is on the buff bar; and a party member's remaining absorb is a number
// on the party frame (partyFrameAbsorb, src/sim/party_frame_info.ts). So the
// slept shell drops an in-world DUPLICATE of a read the HUD keeps, which is
// the cosmetic trade the rest of the sleep makes, and no carve-out is owed.
// A shielded enemy that is NOT the current target is the case the target
// frame does not answer, and it is accepted for the same three reasons the
// rest of the sleep is: the shell is the only read of it, so nothing is
// contradicted, only absent; the deadline bounds the window to the seconds
// the cast programs are still linking; and a frustum-culled or far-LOD
// entity already drops that shell today, so no player was ever owed it
// off-target. Reading it would mean holding the pools awake for every
// shielded body on screen, which is the whole cost the sleep exists to
// avoid.
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
  /** The program a settle has PROVED linked for this material, or null when
   *  its current one is not proved (the host reads the settle record, never
   *  the driver: a per-frame consult must not issue a GPU-process round
   *  trip). A HANDLE rather than a boolean because the record answers per
   *  PROGRAM while the question is asked per material, and a material's
   *  current program can change before the gate opens. */
  linked: (material: M) => unknown;
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
  // Latched once every material answered on a proved program: the pools and
  // stand-ins are never disposed, and a gate that has opened is not asked to
  // close over a later swap.
  let ready = false;
  let forced = false;
  let refused = 0;
  let pending: number | null = null;
  let materials: readonly M[] | null = null;
  // From the first consult, not from the staging: the failure this bounds
  // includes the one where the stand-ins are never staged at all.
  let firstConsultAt: number | null = null;
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
    // Asked per consult, never latched per material: the record answers for
    // the program the material carries NOW, and a material handed a program
    // no settle has proved (a clone, a key change) is pending again however
    // its earlier one answered. The host's answer is a property lookup and a
    // record read, never a driver query, so the walk stays a live frame's
    // work; the whole-gate latch below is what ends it.
    for (const material of materials) {
      const program = deps.linked(material);
      if (program === null || program === undefined) unlinked++;
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
