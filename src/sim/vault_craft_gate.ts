// Where a craft may reach into the Materials Vault, and where it may not.
//
// PURPOSE-BUILT for ONE question: may this player's craft (or enchant) draw
// reagents out of their Materials Vault from where they are standing right
// now? The vault is a TOWN service (its four command bodies are all
// nearBanker-gated, materials_vault.ts), and the two-pool crafting mechanic
// deliberately relaxes that for the CRAFT path only: you may spend stockpiled
// material anywhere the vault is conceptually reachable. THE OPEN WORLD IS THE
// ONLY ALLOWED CONTEXT. Every instanced context refuses, so a party cannot
// resupply a raid consumable from an infinite-feeling pocket stockpile
// mid-clear, and a rated bout cannot be decided by who banked more reagents.
//
// The predicate is FAIL CLOSED, through two KINDS of arm. Be precise about
// which context gets which, because it is not uniform:
//
// - MEMBERSHIP arms (battleground, arena, delve) answer logical presence.
//   They are keyed by player id, so they still refuse in the frames where the
//   player's POSITION does not yet (or no longer) says where they are: a match
//   formed but not teleported into, a delve run whose room was already torn
//   down, the gap between a run ending and the exit teleport landing.
// - GEOMETRY arms answer physical presence. Dungeon, raid and rift have ONLY
//   these: a player staged at a dungeon door is standing in the open world and
//   may legitimately draw, so there is no membership arm to add for them and
//   none is missing.
//
// The band backstop is a THIRD thing again, and it is what makes the whole
// predicate safe rather than merely correct: it refuses anywhere on the
// instance plane even when no live record can be found at all (a slot freed
// the instant a wipe resolved, a hand-edited save parked in a band with no
// run). It provably subsumes the two position scans for today's layout, which
// is also why it runs AHEAD of them: every registered footprint opens east of
// the threshold, so an east position answers at one comparison instead of
// walking the slot pools. The scans are kept anyway because they are
// layout-INDEPENDENT, and the layout is not (the Yumi band's own header
// records that its absolute x already had to move once, when the world grid
// landed).
//
// NEW INSTANCED CONTENT MUST BE ADDED HERE. Nothing about this is automatic: a
// future band placed WEST of DUNGEON_X_THRESHOLD slips past the backstop, and
// a context with no per-player registry has no membership arm to add. Ship the
// content without touching this file and you have shipped a vault-fed
// instance.
//
// NEVER reuse colliders.ts isInstancedRegion for this. That predicate is the
// PHYSICS SOLVER's dispatch switch (which collider set to scan), it deliberately
// excludes the battleground band (Thornhollow Fields carries real sculpted
// terrain and registers its colliders into the open-world spatial grid), and a
// vault gate built on it would hand every battleground team an infinite pocket
// stockpile.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now. This module draws NO rng and mutates nothing.

import { DUNGEON_X_THRESHOLD, DUNGEONS, instanceOriginX, isRiftPos, RIFT_BAND_X_MIN } from './data';
import {
  INSTANCE_FOOTPRINT_HALF_WIDTH,
  instanceInfoAt,
  WIDE_CLAIM_DUNGEON_ID,
} from './instances/dungeons';
import { riftInstanceAtPos } from './rift/runs';
import type { SimContext } from './sim_context';
import { NYTHRAXIS_ROOM_RADIUS } from './types';

/** How far WEST of its band origin a dungeon def's claim footprint can reach.
 *  Built from the SAME exported symbols instances/dungeons.ts builds its two
 *  claim shapes from (the generic INSTANCE_FOOTPRINT_HALF_WIDTH envelope
 *  everywhere, plus the WIDE_CLAIM_DUNGEON_ID arena's wider circle,
 *  NYTHRAXIS_ROOM_RADIUS around a spawn offset), so widening either shape
 *  moves this estimate with it instead of silently under-estimating and
 *  failing the gate open. The arena reach is taken over ALL of that def's
 *  spawns rather than resolving the boss id, which is conservative in the
 *  only safe direction here: overestimating reach can only disable the fast
 *  path below (paying the pool scan), never admit a claim. Exported for the
 *  derived coverage case in tests/craft_from_vault.test.ts, which probes the
 *  real claim read (instanceInfoAt) one yard west of the edge this predicts
 *  for every registered def. */
export function claimWestReach(def: { id: string; spawns: readonly { x: number }[] }): number {
  if (def.id !== WIDE_CLAIM_DUNGEON_ID) return INSTANCE_FOOTPRINT_HALF_WIDTH;
  let reach = INSTANCE_FOOTPRINT_HALF_WIDTH;
  for (const spawn of def.spawns) reach = Math.max(reach, NYTHRAXIS_ROOM_RADIUS - spawn.x);
  return reach;
}

// The DERIVED premise behind the geometry fast path: can any REGISTERED
// dungeon def's claim footprint sit at or west of DUNGEON_X_THRESHOLD? For
// the shipped layout the answer is false (the westernmost def, index 0, opens
// its envelope 180 yards east of the threshold), so the fast path below skips
// the pool scans for every real open-world position. Register a def whose
// footprint can cross the threshold and the answer flips TRUE on the next
// evaluation, the fast path disables itself, and the pool scan runs for west
// positions too: the layout-independence the scans provide is DERIVED from
// the live defs rather than hand-kept (tests/vault_craft_gate.test.ts's
// synthetic west dungeon pins exactly this flip). Deliberately computed
// inline on EVERY call, never memoized: DUNGEONS is not frozen, so any cache
// key (a def count, say) goes stale fail-OPEN under a count-preserving
// mutation, and precomputed views of it (DUNGEON_LIST is built once at module
// load) go stale fail-open under the runtime def registration the synthetic
// west-dungeon test exercises, so the walk reads DUNGEONS itself. It is also
// ALLOCATION-FREE, probed every snapshot per connected session: a plain
// for-in (no Object.values array, no closure) over instanceOriginX (no
// origin object), with Object.hasOwn keeping the exact own-keys semantics
// Object.values had (a polluted prototype must never feed the walk).
// Measured ~64ns per call over the 9 shipped defs (the retired Object.values
// shape measured ~68ns), against the ~2.4us instance-slot walk the fast path
// exists to skip; the one spawn walk, the arena's, is bounded by its
// authored spawn list. No clock, no rng.
function dungeonClaimsCanSitWestOfThreshold(): boolean {
  for (const id in DUNGEONS) {
    if (!Object.hasOwn(DUNGEONS, id)) continue;
    const def = DUNGEONS[id];
    if (instanceOriginX(def.index) - claimWestReach(def) <= DUNGEON_X_THRESHOLD) return true;
  }
  return false;
}

/** The composed fast-path predicate, OUTSIDE vaultDrawBlocked's body so the
 *  one-occurrence-per-arm source pin in tests/vault_craft_gate.test.ts keeps
 *  seeing exactly ONE threshold comparison inside the predicate (the hoisted
 *  backstop): true when `x` is west of the threshold AND no registered claim
 *  can sit there. The dungeon half is derived from the live defs above; the
 *  RIFT half is the static band term (RIFT_BAND_X_MIN east of the
 *  threshold): every rift floor origin's x is pinned to the band, so a rift
 *  band MOVED west of the threshold disables the fast path by existing
 *  instead of being silently skipped past. */
function vaultGateWestFastPath(x: number): boolean {
  return (
    x <= DUNGEON_X_THRESHOLD &&
    RIFT_BAND_X_MIN > DUNGEON_X_THRESHOLD &&
    !dungeonClaimsCanSitWestOfThreshold()
  );
}

/**
 * True when vault reagent draw is REFUSED for `pid` where they stand: the
 * craft falls back to carried materials alone, exactly as it behaved before
 * the two-pool mechanic landed.
 *
 * An unresolvable pid (no meta, no entity, or both) refuses, the fail-closed
 * direction: a draw we cannot place is a draw we do not perform.
 */
export function vaultDrawBlocked(ctx: SimContext, pid: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return true;
  const pos = r.e.pos;
  // A non-finite coordinate is a corrupt position, not the open world. BOTH
  // axes are checked because both are consumed: a NaN z alone would still
  // read as open world, since the band comparison below only looks at x while
  // the two region reads (which do look at z) answer null for a NaN the same
  // way they answer null for a real open-world position. Every comparison
  // against NaN is false, so a corrupt coordinate that is not refused here is
  // refused nowhere.
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return true;
  // Battleground (Thornhollow Fields, social/battleground.ts): keyed per
  // participant pid, so it closes the pre-teleport and post-match frames.
  if (ctx.bgMatches.has(pid)) return true;
  // Arena (the Ashen Coliseum, social/arena.ts), which also carries the 2v2,
  // fiesta and Protect Yumi formats on the same match map. A DELIBERATE sixth
  // context beyond the five-context ruling: ranked arena postdates that
  // ruling, and competitive parity is the rationale the ruling itself gives.
  if (ctx.arenaMatches.has(pid)) return true;
  // Delve (I2a private party instances): the run registry is per player, so a
  // run torn down a tick before the exit teleport still refuses.
  if (ctx.delveRunForPlayer(pid) !== null) return true;
  // THE GEOMETRY FAST PATH: for a west-side position, skip the two pool
  // scans below whenever the DERIVED flag proves no registered dungeon claim
  // can sit there (dungeonClaimsCanSitWestOfThreshold above). Running the
  // scans first made every craft-context evaluation pay a full instance-slot
  // walk in the common case (measured ~2.4us/call, 89% in instanceInfoAt;
  // the server now probes this gate EVERY snapshot as the cvault wire
  // signature's cheap half, server/vault_wire.ts, which is exactly why the
  // fast path must stay cheap). Because the skip is derived
  // from the live defs rather than hand-asserted, a future dungeon band
  // placed west of the threshold re-enables the scans by existing, and the
  // layout-independence pin in tests/vault_craft_gate.test.ts stays green
  // against this exact line.
  //
  // The rift arm's layout-independence is CONDITIONAL on the fast path's
  // static band term (RIFT_BAND_X_MIN east of the threshold): isRiftPos moves
  // with the band, but a band moved west of the threshold reaches its arm
  // below only because that term disables this skip.
  if (vaultGateWestFastPath(pos.x)) return false;
  // THE GEOMETRY BACKSTOP, one arm rather than seven, HOISTED ahead of the
  // two pool scans below. The hoist is behavior-identical: this comparison is
  // true for EVERY finite x east of the threshold (the non-finite guard above
  // already refused NaN, and exact equality is the west side of a strict >),
  // and east of the threshold every path through the scans also ended in true
  // (a scan hit refused, and a miss fell through to this same comparison when
  // it sat at the bottom), so running it first changes no answer, only the
  // cost. That cost is what the round-4 review measured: with the 4 Hz cvault
  // cadence gone this gate runs on every broadcast pass per session
  // (server/vault_wire.ts), and a session standing INSIDE a dungeon or raid
  // paid a full instance-slot walk (one origin object allocated per slot via
  // instanceOriginOf) on its way to an answer this comparison already knew.
  //
  // Every instanced band in the game sits on the far-east instance plane, and
  // every one of them opens at least 3575 yards EAST of this threshold, so
  // this single comparison provably subsumes all seven band predicates in
  // data.ts. Measured from INSTANCE_X_BASE, with DUNGEON_X_THRESHOLD at +600:
  // the dungeon band opens at +900 (instanceOrigin) and its overflow arm at
  // +15000; ARENA_X_MIN at +4175 (ARENA_X +4200 less DUNGEON_WALL_X 23 +
  // DUNGEON_WALL_HW 1 + 1); DELVE_BAND_X_MIN at +4773; VC_PRACTICE_BAND_X_MIN
  // at +6000; RIFT_BAND_X_MIN at +8960; YUMI_BAND_X_MIN at +10000;
  // BG_BAND_X_MIN at +30000. So isArenaPos/isDelvePos/isVcPracticePos/
  // isRiftPos/isYumiMazePos/isBgPos and the dungeon band arm are each dropped
  // as provably subsumed, NOT as unimportant.
  //
  // It also covers what none of them do: the far-east VOID between and beyond
  // the bands, which is where a half-finished teleport or a hand-edited save
  // parks a character. No legitimate open-world position is ever out here (the
  // whole instance plane was moved to INSTANCE_X_BASE precisely so real zones
  // could keep growing east without standing in it).
  //
  // ONE dependency worth naming: pre-grid saves carry instance positions in
  // the OLD bands, west of INSTANCE_X_BASE and therefore west of this
  // threshold. They read as open world here, and the only reason that is safe
  // is that data.ts migrateLegacyInstancePos remaps every one of them to a
  // door position at load, so no live entity ever sits there. A load path that
  // skipped that migration would need its own arm.
  if (pos.x > DUNGEON_X_THRESHOLD) return true;
  // The two pool scans are reachable only WEST of the threshold now (the
  // backstop above owns the east), and only when the fast path has disabled
  // itself because a registered claim or the rift band can sit out here: they
  // are the layout-independence arms, deciding exactly when the layout has
  // moved under the backstop.
  //
  // Dungeon AND raid: instanceInfoAt is the canonical claim-footprint read
  // over the live slot pool (the raid instances are ordinary slots carrying a
  // RAID_ALLOWED_DUNGEON_IDS dungeon id, so one arm covers both). It is
  // position-keyed and does NOT filter freed slots, which is the fail-closed
  // direction here.
  if (instanceInfoAt(ctx, pos) !== null) return true;
  // Rift (procedural floors): the floor-region read over the live rift pool,
  // band-guarded as above.
  if (isRiftPos(pos.x) && riftInstanceAtPos(ctx, pos) !== null) return true;
  // West of the threshold with no live claim: the open world.
  return false;
}

/**
 * The LIVE vault stock a reagent draw may spend for `pid` here, or null when
 * this player draws from their bags alone (unresolvable, or
 * `vaultDrawBlocked`). Null is the "behaves exactly like before the two-pool
 * mechanic" answer that every caller branches on. In practice null means
 * BLOCKED OR UNRESOLVABLE and nothing else: `PlayerMeta.vault` is
 * non-optional and every player is constructed with `{ stock: {}, upgrades:
 * 0 }`, so a resolvable open-world player always gets a record (an empty one
 * plans no takes, which is the same byte-identical outcome). The `?? null`
 * arm below is defensive against a meta-less pid only. Consumers must never
 * read null as "has no vault".
 *
 * THE RETURNED RECORD IS THE LIVE `PlayerMeta.vault.stock` REFERENCE, not a
 * clone, and that carries obligations:
 *
 * - SIM-INTERNAL ONLY. It must never be handed across the IWorld seam, put on
 *   a snapshot, or returned from a world-api member. `materials_vault.ts`
 *   `craftVaultStockFor` is the ONLY boundary shape; every consumer outside
 *   the sim takes that clone.
 * - READ-ONLY to its consumers. Nothing may write to it directly. The one
 *   sanctioned mutation is `consumeVaultStock`, which owns the drawable rule
 *   and the delete-at-zero write shape.
 *
 * It is live rather than cloned because the consume path plans nothing it does
 * not immediately spend: a second reagent naming the same material must see
 * the first one's spend, and a snapshot would let both claim the same units.
 *
 * Ungated the same way `consumeVaultStock` is (no rung, no nearBanker, no dead
 * check), for the same reasons: this is the read half of that primitive, and
 * `vaultDrawBlocked` above is the gate that actually applies here.
 *
 * DO NOT short-circuit a locked or empty vault to null ahead of the gate: the
 * null-vs-empty-record distinction is load-bearing on the client. hud.ts
 * derives its "vault draw blocked here" note from `craftVaultStock === null`
 * (the buildCraftingView `vaultBlocked` argument), so answering null for an
 * open-world player who merely has nothing banked would paint the blocked
 * note across the whole open world. The gate's threshold fast path already
 * makes the common case a few map probes plus one comparison.
 */
export function vaultDrawStock(ctx: SimContext, pid: number): Record<string, number> | null {
  if (vaultDrawBlocked(ctx, pid)) return null;
  return ctx.players.get(pid)?.vault?.stock ?? null;
}
