// Whether the ability-VFX painter may draw a cast yet: every program of each
// family the cast draws from (cast_vfx_family.ts, the cast's requirement mask
// from ability_vfx/cast_requirements.ts) is linked. Until then the painter
// draws nothing of that cast, so a first cast never links a program cold on a
// live frame; the cast bars and nameplates the player acts on are untouched,
// only the cosmetic read is skipped. One ready bit per family, so a Mage cast
// waits on the engine alone and never on the Warrior kit.
// The per-frame path is wider than the cast draws alone (while the engine is
// not ready a held entity is slept, so its ground aura, shell, orbit and glow
// sleep with it), with ONE read that survives: the hard-CC band, re-held
// right after the sleep that deleted it, because a stun, fear or root is
// information the player acts on and only a frustum-culled rig may drop it.
// The other actionable reads are elsewhere: the rig's windup clip, the
// terrain-draped area ring, the cast bar, the nameplate and the HUD debuffs,
// with the deadline below bounding the whole window. The band's overlay
// program and the ring's program are linked and proved in their own
// deadline-exempt boot entry, ahead of the cast pools (castVfxFirstReadsEntry,
// cast_vfx_prewarm.ts), so drawing them through a closed family is no cold
// link once it ran; a boot that reaches it past the hard deadline resumes it
// as program debt ahead of the cast pools'.
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
// The Warrior control marks and the Bloodletting recovery bloom drew ungated
// before the per-cast gate and are gated now, decided out loud for the same
// reason as the shell: each is an in-world duplicate of a read the HUD keeps
// whole and unheld. Pummel's lockout (pummel_lockout) and Hamstring's slow
// (hamstring_slow) are auras of their victim, listed on the target frame's
// aura strip; the Sunder armor status (kind sunder, which the Rogue's Armor
// Breach shares) is on the same strip with its stack badge
// (src/ui/auras_view.ts); and the recovery heal is the Warrior's own health
// on the player frame plus its floating heal number and combat log line
// (src/ui/heal_landing_feedback_core.ts), all driven by the heal event, never
// by the bloom.
//
// Why a gate rather than an earlier link: the boot manifest's entry for these
// programs runs after its 3 s budget on the OpenGL desktops (measured
// 2026-08-28: 4.1 s of manifest on both Linux GPUs, the entry timed out on
// every run), so its programs resume as debt after the reveal, and for those
// seconds a cast would have been the cold link. Host-agnostic
// (RENDER_PURE_CORES): materials are opaque handles, the host answers whether
// one is linked.

export interface CastVfxFamilyDeps<M> {
  id: string;
  bit: number;
  /** Every material a cast drawing from this family may draw with. Read ONCE,
   *  at the family's first read: the pools are built before it and never
   *  disposed or replaced, and the per-frame consult must not walk the scene
   *  during the very seconds the programs are still linking. */
  materials: () => readonly M[];
  /** The device refused this family's assets outright (the Warrior kit on
   *  constrained memory): the family never holds a cast and is never forced,
   *  and its pools never draw. A device decision, so the core latches it at
   *  the first read that answers true. */
  declined?: () => boolean;
}

export interface CastVfxReadinessDeps<M> {
  /** The clock the deadline runs on; injected so the core stays pure. */
  now: () => number;
  /** A stamp that changes between rendered frames: the walk over the unready
   *  families runs at most once per stamp, however many entities consult. */
  frame: () => number;
  /** How long a family may hold before it opens on its own, from the first
   *  consult that asked for it. Every sibling hold in this subsystem is
   *  bounded: a family latches only when every material is linked, so a
   *  boot entry the budget dropped whose resume never lands (a page
   *  backgrounded through the whole resume, a starved resume queue, a link
   *  that rejects) would leave the painter drawing none of its casts for the
   *  rest of the session, with nothing to say so. The asymmetry decides the
   *  value: opening early costs ONE cold link, never opening costs the whole
   *  session, so the bound is deliberately far past any legitimate resume. */
  deadlineMs: number;
  families: readonly CastVfxFamilyDeps<M>[];
  /** The program a settle has PROVED linked for this material, or null when
   *  its current one is not proved (the host reads the settle record, never
   *  the driver: a per-frame consult must not issue a GPU-process round
   *  trip). A HANDLE rather than a boolean because the record answers per
   *  PROGRAM while the question is asked per material, and a material's
   *  current program can change before the family opens. Typed as a handle or
   *  null, never `unknown`: a host written the boolean way would compile and
   *  its `false` would read as a proof. */
  linked: (material: M) => object | null;
}

export interface CastVfxFamilySnapshot {
  id: string;
  ready: boolean;
  forced: boolean;
  declined: boolean;
  /** Unlinked materials at the last read; null before the family was read. */
  pending: number | null;
  /** Refused casts that asked for this family while it was not ready. */
  refused: number;
  /** Spawns a pool of this family skipped because it was not ready: a cast
   *  admitted on a requirement that missed the family. Zero when every
   *  requirement is right. */
  requirementMiss: number;
}

export interface CastVfxReadinessSnapshot {
  /** Every family admits (ready, forced or declined). */
  ready: boolean;
  /** Casts the painter skipped while a family they need was not ready. */
  refused: number;
  /** Unlinked materials over the families not yet ready; null when no read
   *  has touched a family. */
  pending: number | null;
  /** A family opened on its deadline rather than on its programs: its resume
   *  never landed, and the readout says so instead of the session going quiet. */
  forced: boolean;
  requirementMiss: number;
  families: CastVfxFamilySnapshot[];
}

export interface CastVfxReadiness {
  /** True when a cast needing every family in `mask` may draw; a refusal is
   *  counted (one per cast read). Starts the deadline clock of each family
   *  in `mask`. */
  admit(mask: number): boolean;
  /** The same answer for a per-frame consult, uncounted. */
  ready(mask: number): boolean;
  /** The pool-side check (CastVfxSpawnGate): the family itself is ready. An
   *  unready family counts a requirement miss; a declined one refuses
   *  silently. Starts no clock and walks nothing. */
  spawnAllowed(bit: number): boolean;
  /** Diagnostics: never starts a clock, so a readout taken at construction
   *  does not shorten the deadline. */
  snapshot(): CastVfxReadinessSnapshot;
}

interface FamilyState<M> {
  deps: CastVfxFamilyDeps<M>;
  materials: readonly M[] | null;
  firstConsultAt: number | null;
  pending: number | null;
  forced: boolean;
  refused: number;
  miss: number;
}

export function createCastVfxReadiness<M>(deps: CastVfxReadinessDeps<M>): CastVfxReadiness {
  const families: FamilyState<M>[] = deps.families.map((family) => ({
    deps: family,
    materials: null,
    firstConsultAt: null,
    pending: null,
    forced: false,
    refused: 0,
    miss: 0,
  }));
  // Latched per family once every material answered on a proved program (or
  // its deadline passed): the pools are never disposed, and a family that has
  // opened is not asked to close over a later swap.
  let readyBits = 0;
  // Latched like readyBits: a declined family answers on the fast path.
  let declinedBits = 0;
  let refused = 0;
  let refreshedAt = Number.NaN;

  const declined = (family: FamilyState<M>): boolean => family.deps.declined?.() === true;

  const read = (family: FamilyState<M>, now: number, deadlines: boolean): void => {
    const bit = family.deps.bit;
    if (deadlines && family.firstConsultAt !== null) {
      if (now - family.firstConsultAt >= deps.deadlineMs) {
        family.forced = true;
        readyBits |= bit;
        return;
      }
    }
    if (family.materials === null) family.materials = family.deps.materials();
    let unlinked = 0;
    // Asked per read, never latched per material: the record answers for
    // the program the material carries NOW, and a material handed a program
    // no settle has proved (a clone, a key change) is pending again however
    // its earlier one answered. The host's answer is a property lookup and a
    // record read, never a driver query, so the walk stays a live frame's
    // work; the per-family latch is what ends it.
    for (const material of family.materials) {
      if (deps.linked(material) === null) unlinked++;
    }
    family.pending = unlinked;
    if (unlinked === 0) readyBits |= bit;
  };

  const refresh = (mask: number, force: boolean): void => {
    const now = deps.now();
    for (const family of families) {
      if ((mask & family.deps.bit) !== 0 && family.firstConsultAt === null) {
        family.firstConsultAt = now;
      }
    }
    const frame = deps.frame();
    if (!force && frame === refreshedAt) return;
    if (!force) refreshedAt = frame;
    for (const family of families) {
      const bit = family.deps.bit;
      if (((readyBits | declinedBits) & bit) !== 0) continue;
      if (declined(family)) {
        declinedBits |= bit;
        continue;
      }
      read(family, now, true);
    }
  };

  const open = (mask: number): boolean => (mask & ~(readyBits | declinedBits)) === 0;

  return {
    admit: (mask) => {
      // Steady state: every family the cast asks for latched, nothing to walk.
      if (open(mask)) return true;
      refresh(mask, false);
      if (open(mask)) return true;
      refused++;
      for (const family of families) {
        const bit = family.deps.bit;
        if ((mask & bit) !== 0 && ((readyBits | declinedBits) & bit) === 0) family.refused++;
      }
      return false;
    },
    ready: (mask) => {
      if (open(mask)) return true;
      refresh(mask, false);
      return open(mask);
    },
    spawnAllowed: (bit) => {
      if ((readyBits & bit) !== 0) return true;
      for (const family of families) {
        if (family.deps.bit !== bit) continue;
        if ((declinedBits & bit) === 0 && !declined(family)) family.miss++;
        break;
      }
      return false;
    },
    snapshot: () => {
      refresh(0, true);
      let pending: number | null = null;
      let forced = false;
      let miss = 0;
      const rows = families.map((family) => {
        const bit = family.deps.bit;
        const isReady = (readyBits & bit) !== 0;
        const isDeclined = !isReady && (declinedBits & bit) !== 0;
        const familyPending = isReady ? 0 : isDeclined ? null : family.pending;
        if (familyPending !== null) pending = (pending ?? 0) + familyPending;
        forced ||= family.forced;
        miss += family.miss;
        return {
          id: family.deps.id,
          ready: isReady,
          forced: family.forced,
          declined: isDeclined,
          pending: familyPending,
          refused: family.refused,
          requirementMiss: family.miss,
        };
      });
      return {
        ready: families.every((family) => ((readyBits | declinedBits) & family.deps.bit) !== 0),
        refused,
        pending,
        forced,
        requirementMiss: miss,
        families: rows,
      };
    },
  };
}
