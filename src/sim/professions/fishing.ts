// Fishing profession command logic, behind the SimContext seam (Professions
// 2.0; the bite minigame). startFishing begins the fishing
// session (the fishing-pole item use routes here via SimContext,
// src/sim/items.ts) and draws ONE hidden seeded bite delay; the cast
// lifecycle (src/sim/combat/casting_lifecycle.ts) fires the bite and the
// got-away miss off hidden tick deadlines; a pole RE-press inside the armed
// reel window (the reel arm at the top of startFishing) lands the catch
// through completeFishing's single table draw. Fishing is a full gathering
// proficiency (GATHERING_PROFESSIONS.fishing): a landed catch queues a
// proficiency grant on the tick path like any other gathering harvest, and
// the accrued proficiency selects a catch rarity band (fishingBandFor) whose
// per-zone table shifts weight out of grey-junk/empty-hook rows and into
// cooking catches as skill rises. Where a zone's water sits on that ladder,
// and which rod it takes to cast there at all, live in professions/fishing_zones.ts.
// Draw contract: a normal session draws one rng
// value at cast start (the bite delay) and one more at a landed reel (the
// table); a miss stays at one, as does an early reel (a pre-bite re-press
// ends the session empty, the anti-spam arm in startFishing); the codfather
// reel draws nothing (early return); a bags-full reel still draws the table
// (capacity gates after the roll). Band selection is pure state, not a draw,
// and every deny arm is draw-free.

import { isActionLockingFormAuraKind } from '../combat/forms';
import { FISHING_RARE_ID, FISHING_TABLES_BY_BAND, isRawCookingCatch } from '../content/items';
import { DEEPFEN_SHALLOWS_LAKE } from '../content/zone2';
import { ITEMS, zoneAt } from '../data';
import { onFishCaughtForDeeds } from '../deeds';
import { forceDismount } from '../mounts';
import { PLAYER_SWIM_DEPTH } from '../pathfind';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  DT,
  type Entity,
  FISHING_CAST_ID,
  FISHING_SESSION_CAP_SEC,
  type ItemDef,
  isConsuming,
} from '../types';
import { groundHeight, isInWaterBody, waterLevel } from '../world';
import { type FishingCatchBand, fishingCatchBandFor, fishingRodBandFor } from './fishing_bands';
import { rodTierRequiredForZone } from './fishing_zones';
import { queueGatheringGrant } from './gathering';
import {
  bestOwnedGatherToolTier,
  canGatherTier,
  hasFishingImplement,
  rarityLadderIndex,
} from './tools';

const SWIM_DEPTH = PLAYER_SWIM_DEPTH; // ground this far under the water line = deep water
// Facing-forward sample ring the fishable-water check walks. Exported so
// the bobber visual (src/render/fishing_bobber_core.ts) anchors on
// the FIRST accepted sample, so it must walk the exact same ring.
export const FISHING_SAMPLE_DISTANCES = [4, 8, 12, 16, 20, 24];
const DEEPFEN_FISHING_SHORE_MARGIN = 10;
const THE_CODFATHER_ITEM_ID = 'the_codfather';
const THE_CODFATHER_QUEST_ID = 'q_the_codfather';

// The one genuinely load-bearing delegation: src/ui/gather_tool_tooltip.ts
// imports fishingRodBandFor through this module.
export { fishingRodBandFor };

// Bite minigame timing (Professions 2.0), all in seconds. The
// hidden bite delay is ONE seeded draw in [MIN, effMax]; a better rod (tier
// above 1) pulls effMax down by ROD_REDUCTION per tier and never moves MIN
// (tier 2 covers [3, 6.5], tier 3 covers [3, 5], and tier 5 sits flat on the
// [3, 3] floor, which is the ladder's top rung by design rather than by
// accident: past tier 4.3 the reduction has nothing left to take). The reel
// window opens at the bite and lasts WINDOW plus ROD_BONUS per rod tier above
// 1 plus RARITY_BONUS per rarity rung above common (tier 3 uncommon reaches
// 4.25 s, tier 5 epic reaches 6.25 s), re-scanning the rod at bite time.
// Named constants so the tests pin the rod synergy directly.
//
// The reel window is 2.50 rather than the 3.00 it shipped at: a light trim
// only, and deliberately not the place the difficulty lives. Fishing's
// difficulty is skill versus spot (D9, professions/fishing_zones.ts), and
// every further second cut off this window is a platform tax rather than a
// skill test, since a mobile player pays 50 ms of tick quantization plus a
// network round trip out of it before their thumb has moved.
export const FISH_BITE_DELAY_MIN_SEC = 3;
export const FISH_BITE_DELAY_MAX_SEC = 8;
export const FISH_BITE_DELAY_ROD_REDUCTION_SEC = 1.5;
export const FISH_REEL_WINDOW_SEC = 2.5;
export const FISH_REEL_WINDOW_ROD_BONUS_SEC = 0.75;

// The early-reel grace (the double-press guard): a re-press inside the first
// second of a session falls through to the ordinary busy denial instead of
// ending the cast, so a bag double-click, a held key's auto-repeat, or a pad
// interact press right on the heels of the cast cannot silently burn the
// session. MUST stay strictly under FISH_BITE_DELAY_MIN_SEC: were the grace
// to reach the earliest possible bite, presses inside it would be free all
// the way to an armed reel window and the spam-click exploit would reopen
// (the derivation is pinned in tests/professions_fishing.test.ts).
export const FISH_EARLY_REEL_GRACE_SEC = 1;

// What a ROD's own rarity adds to the window, per rung above common (the
// shared ladder, tools.ts rarityLadderIndex). The land tools' rarity buys
// charges on a slotted effect instead; this is the rod half of the same
// ruling, that rarity may grant narrow bonuses which never affect access.
//
// SAY IT PLAINLY, AND THE COLLINEARITY BROKE AT masterwrought Phase 11i. For
// the four rods that shipped before it, this was a TIER bonus wearing rarity's
// coat: ironreel 2 common, silverstream 3 uncommon, stormreel 4 rare,
// tidewrought 5 epic, the pole floored at tier 1 common, so nothing could move
// one axis without the other. The tier-6 clockreel is EPIC, the same rarity as
// the tier-5 tidewrought, so the two axes now genuinely part: the apex rung
// gains 0.75 s of window from its tier rung and nothing at all from rarity.
//
// THAT IS THE RULING WORKING, not a wrinkle in it. The rule was expressed as
// rarity precisely so a rung could decline to raise it, and the apex rod
// declines deliberately (a legendary rod would be a silent throughput change
// and would widen the worst legal session against the cap). The land tools'
// charge bonus was already non-collinear (tiers 1 and 2 are both common), so
// one ladder serving both is still what keeps them from drifting into two.
//
// SIZED AGAINST THE SESSION CAP, not by feel, and the two have to be read
// together. The worst legal session is a bare-pole CAST (the delay is drawn
// against the rod held at the cast, so the pole's 8 s is the worst) into the
// widest window the rod held at the BITE opens (the window re-scans at the
// bite), plus the one tick the miss arm fires on. Before the rarity term that
// was 271 ticks: 160 of bite, the tier-5 window's 110, and the miss tick. That
// left 29 ticks against a 300-tick cap, so the epic rung's three steps had to
// fit inside 1.45 s and 0.25 buys 0.75 of it, landing the worst session at 286
// with 14 ticks still spare.
//
// THE CAP MOVED AT masterwrought Phase 11i, 15 s to 16 s, and it was FORCED
// rather than chosen. The apex rung is tier 6 epic, so its window is
// 2.5 + 0.75 x 5 + 0.25 x 3 = 7.00 s = 140 ticks, and the worst legal session
// becomes 160 + 140 + 1 = 301 ticks against the old 300. Over by exactly ONE
// TICK, which is the miss arm's: the bite and the window alone sum to exactly
// 15.00 s, so the ladder fit the old cap precisely and only the miss tick spilled
// past it. Left alone, a player in that state would have their reel window
// truncated by 50 ms, which is the cap eating a legal reel: the thing this
// budget exists to prevent.
//
// WHY THE CAP AND NOT THE ROD. Three knobs could have closed one tick and two
// of them cost more than they buy. Shipping the rod RARE clears the budget at
// 296, but it puts a RARE tier-6 rod above an EPIC tier-5 one, a rarity
// inversion every player sees in their bags. Trimming
// FISH_REEL_WINDOW_ROD_BONUS_SEC retunes all five shipped rods to fit one new
// one. The cap is a DEFENSIVE timeout that casting_lifecycle.ts's own comment
// calls unreachable in normal play, so a second on it costs a player nothing
// and is what a ladder gaining a rung should take. RECORDED AS A DEVIATION for
// the maintainer to ratify or revert: DECISION C ruled the rod epic and
// reasoned about the rarity axis alone, never about tier 6's own +0.75, so the
// ruling's arithmetic was incomplete rather than wrong.
//
// tests/fishing_zones.test.ts re-derives the whole budget rather than restating
// it, so a wider rung fails there instead of silently letting the cap eat a
// legal reel window.
export const FISH_REEL_WINDOW_RARITY_BONUS_SEC = 0.25;

// The three things a rod tier buys, as functions rather than as a formula
// every reader re-derives. The tooltip used to recompute all three and got the
// bite one wrong, promising a second the clamp does not give; a shared
// definition is the only thing that stops that happening again. All pure, all
// draw-free.

/** The longest bite delay a rod of this tier can draw, floored at MIN. */
export function fishBiteMaxSecFor(rodTier: number): number {
  return Math.max(
    FISH_BITE_DELAY_MIN_SEC,
    FISH_BITE_DELAY_MAX_SEC - FISH_BITE_DELAY_ROD_REDUCTION_SEC * (rodTier - 1),
  );
}

/** How many seconds off the worst wait a rod of this tier actually buys. The
 *  clamp is why this is not simply the reduction times the tier. */
export function fishBiteSavedSecFor(rodTier: number): number {
  return FISH_BITE_DELAY_MAX_SEC - fishBiteMaxSecFor(rodTier);
}

/** The reel window a rod of this tier and rarity opens at the bite. Unclamped
 *  by design: a wider window is the top of the ladder's whole reward.
 *
 *  THE one definition. `rodRarity` defaults to common, so a caller that has
 *  only a tier (the band arithmetic, a test walking tiers) gets the pre-rarity
 *  number unchanged rather than a compile error, and no caller has an excuse to
 *  re-derive the sum. Both former inline copies of this formula in
 *  tests/fishing_zones.test.ts now call it. */
export function fishReelWindowSecFor(
  rodTier: number,
  rodRarity: ItemDef['quality'] = 'common',
): number {
  return (
    FISH_REEL_WINDOW_SEC +
    FISH_REEL_WINDOW_ROD_BONUS_SEC * (rodTier - 1) +
    FISH_REEL_WINDOW_RARITY_BONUS_SEC * rarityLadderIndex(rodRarity)
  );
}

// Which catch table band a given fishing proficiency selects. Pure state (no
// rng), so it never perturbs the one-draw-per-catch rng contract; NaN falls
// to band 0 (see fishingCatchBandFor). fishingRodBandFor is re-exported above
// from the same leaf.
export const fishingBandFor = fishingCatchBandFor;

// The band a session actually fishes: min(proficiency band, best band the
// owned rod tier covers). THE one definition (completeFishing's table pick
// and every telemetry-bearing fishing event resolve it here), pure state,
// draw-free: a bag scan plus two ladder reads.
export function effectiveFishingBand(meta: PlayerMeta): FishingCatchBand {
  const rodTier = bestOwnedGatherToolTier(meta.inventory, 'fishing', ITEMS);
  return Math.min(
    fishingBandFor(meta.gatheringProficiency.fishing ?? 0),
    fishingRodBandFor(rodTier),
  ) as FishingCatchBand;
}

// Per-catch proficiency gain schedule. The four BOUNDARIES are frozen at
// 50 / 100 / 150 / 200 because fishingTeachingCeilingFor below DERIVES the
// per-zone teaching ceilings from them (R19); only the VALUES move, and they
// move by derivation rather than by feel.
//
// THE VALUES ARE DERIVED FROM A MEASURED CASTS-TO-200 MODEL (masterwrought
// Phase 11i, DECISION F), the same R19 discipline the farming curve gets. The
// model is restated below, and tests/professions_fishing.test.ts
// RE-RUNS it against these four literals rather than restating them. In one
// paragraph, so a reader here is not sent away:
//
//   The reference angler always fishes the water the R19 teaching ceiling
//   forces and carries the cheapest rod that water takes. A cast costs the
//   mean bite delay for that rod tier plus the shipped BASE reel window
//   (FISH_REEL_WINDOW_SEC; the extra window a better rod buys is margin, not
//   time spent) plus one tick to re-press. A cast TEACHES when it resolves
//   anything but the empty hook, minus the grey junk that stops teaching at
//   FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY, both read off the D9 cell tables in
//   content/items.ts. Four segments, four coefficients in seconds-times-gain:
//   447.22 / 447.22 / 474.03 / 389.88.
//
// WHAT WAS WRONG, measured rather than asserted: under the shipped values the
// last fifty points cost 5000 casts and 9.1 reference hours, EIGHTY-FOUR
// PERCENT of the whole climb, at 0.02 a catch with no character XP. The
// destination this phase adds at the top of that tail would still have sat at
// the top of an all-tail climb. These values keep the total where it already
// was (10.79 reference hours before, 10.94 after) and redistribute it: the
// four bands now cost 14.2 / 22.7 / 30.1 / 33.0 percent, with the tail down
// from 9.10 hours to 3.61. The early climb is the price and it is paid
// knowingly: 0 to 50 goes from about eight minutes to about ninety, which
// gates nothing (fishing's first band boundary is 100) and is what a
// one-third cap on four bands arithmetically requires.
//
// WHY THESE FOUR AND NOT A NEIGHBOUR: on the 0.01 grid exactly sixteen
// non-increasing schedules land inside the settled ten-to-twelve-hour span
// with a genuine ramp (each band costing at least the one before) and no band
// over a third. Only THREE of the sixteen are STRICTLY decreasing, which a
// real curve must be, and of those three this one both sits nearest the
// span's midpoint and keeps the early climb fastest. The search is the test's,
// not this comment's.
//
// UNTOUCHED BY DECISION F, listed so a reader does not go looking: the grey
// junk cutoff, the zero-character-XP design, fishingTeachingCeilingFor's
// derivation, and the rule that at or past the last row the gain is 0 (the
// maxSkill cap clamp is the real stop, not this schedule).
export const FISHING_GAIN_SCHEDULE = [
  { belowProficiency: 50, gain: 0.08 },
  { belowProficiency: 100, gain: 0.05 },
  { belowProficiency: 150, gain: 0.04 },
  { belowProficiency: 200, gain: 0.03 },
] as const;

// Grey fishing junk (tangled weed, soggy boots: kind junk and NOT a raw cooking
// catch) stops granting proficiency entirely once band 0 is outgrown: a
// seasoned angler learns nothing from dredging up boots. Raw cooking catches
// are also kind junk but still teach like any other water catch.
export const FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY = 100;

// The per-catch proficiency gain: deterministic fractional amounts off the
// schedule above, NEVER a skill-up roll and never an rng draw. The first
// schedule row the proficiency sits below wins; at or past the last row the
// gain is 0.
//
// GRANT SITES DO NOT BELONG HERE (R19): this is the schedule HALF only,
// with no water ceiling, kept exported for the derivation tests. Any code
// granting proficiency must call fishingCatchGainAt below, or a grant site
// silently reintroduces uncapped zone-1 fishing gain (the tools.ts
// ownership-scan banner's sibling).
export function fishingCatchGain(proficiency: number, isJunk: boolean): number {
  if (isJunk && proficiency >= FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY) return 0;
  for (const row of FISHING_GAIN_SCHEDULE) {
    if (proficiency < row.belowProficiency) return row.gain;
  }
  return 0;
}

// The teaching ceiling one water can carry an angler to (R19): DERIVED from
// the schedule's own row boundaries rather than a second constant set, so
// the two halves of the model cannot drift. Tier-1 water teaches through the
// schedule's first two rows and grays at 100; tier-2 through the third row
// to 150; tier-3 and up to the last boundary, the cap itself. The zone tier
// here is the same zone-progression column the rod gate reads
// (fishing_zones.ts; the v0.32.0 starter zones are all explicit tier 1, so
// their water teaches to 100 until a future content pass re-tiers them).
export function fishingTeachingCeilingFor(zoneTier: number): number {
  const row = Math.max(1, Math.min(zoneTier, FISHING_GAIN_SCHEDULE.length - 1));
  return FISHING_GAIN_SCHEDULE[row].belowProficiency;
}

// The full R19 gain model: the schedule amount, zeroed at or past the
// water's teaching ceiling. Pure and draw-free like both halves; a graying
// water returns 0, which queueGatheringGrant drops.
export function fishingCatchGainAt(proficiency: number, isJunk: boolean, zoneTier: number): number {
  if (proficiency >= fishingTeachingCeilingFor(zoneTier)) return 0;
  return fishingCatchGain(proficiency, isJunk);
}

/** The first facing-forward ring sample with fishable-depth water, or null.
 *  THE one walk for the sim: startFishing's water check and its rod-zone
 *  read consume the returned point. The bobber visual
 *  (src/render/fishing_bobber_core.ts) deliberately mirrors the same ring
 *  and depth rule with its own allocation-free walk (render per-frame
 *  discipline); tests/fishing_bobber_core.test.ts pins the two walks in
 *  lockstep so they cannot drift. Pure and draw-free.
 *
 *  DECLARED water bodies only, by design: the open sea became swimmable
 *  with the water overhaul (waterLevelAt answers a finite surface there),
 *  but the ocean stays unfishable, so this walk gates on isInWaterBody
 *  rather than waterLevelAt (tests/fishing_zones.test.ts pins the seaward
 *  deny). Author fishable sea water and both walks change together. */
export function firstFishableSampleAhead(
  x: number,
  z: number,
  facing: number,
  seed: number,
): { x: number; z: number; water: number } | null {
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  for (const d of FISHING_SAMPLE_DISTANCES) {
    const sx = x + sin * d;
    const sz = z + cos * d;
    if (!isInWaterBody(sx, sz)) continue;
    const water = waterLevel();
    if (groundHeight(sx, sz, seed) < water - SWIM_DEPTH) return { x: sx, z: sz, water };
  }
  return null;
}

function isAtDeepfenShallowsFishingSpot(p: Entity): boolean {
  const d = Math.hypot(p.pos.x - DEEPFEN_SHALLOWS_LAKE.x, p.pos.z - DEEPFEN_SHALLOWS_LAKE.z);
  return d <= DEEPFEN_SHALLOWS_LAKE.radius + DEEPFEN_FISHING_SHORE_MARGIN;
}

function shouldCatchCodfather(ctx: SimContext, p: Entity, meta: PlayerMeta): boolean {
  const qp = meta.questLog.get(THE_CODFATHER_QUEST_ID);
  return (
    qp?.state === 'active' &&
    ctx.countItem(THE_CODFATHER_ITEM_ID, meta.entityId) === 0 &&
    isAtDeepfenShallowsFishingSpot(p)
  );
}

export function startFishing(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  // The reel: re-pressing the pole during one's own fishing
  // session, inside the armed server-authoritative reaction window, lands
  // the catch. The re-press reaches here through the same useItem fishing
  // arms as the original cast (items.ts routes them to startFishing BEFORE
  // its generic busy guard), so the wire command census is unchanged. The
  // arm sits ABOVE the in-combat denial on purpose: casting stays
  // combat-gated below, but a bite answered inside the window lands even if
  // something aggroed during the wait. Proximity aggro sets inCombat with no
  // landed hit, so a valid armed reel plus inCombat is an ordinary state; a
  // LANDED hit cancels the session outright (combat/damage.ts), which zeroes
  // fishReelDeadlineTick and makes this arm unsatisfiable. The condition
  // fully self-guards (only an armed fishing session passes), so hoisting it
  // cannot swallow any other busy state. The hoist also puts the reel above
  // the SWIMMING denial, and that skip is deliberate too: no reachable path
  // leaves an armed session on a swimming angler, and the OPERATIVE
  // guarantee is the deep-water clamp every displacement walker carries
  // (the follow walk, applyKnockback, and the leap landing all refuse
  // ground below waterLevel minus PLAYER_SWIM_DEPTH, the same threshold
  // isSwimming reads), with self-movement cancelling and every landed hit,
  // blocked or fully absorbed, cancelling too. A future displacement that
  // omits that clamp must either keep it or re-check the swim gate here.
  // A re-press BEFORE the bite ends the session empty (the early-reel arm
  // below), except inside the first FISH_EARLY_REEL_GRACE_SEC where it stays
  // the busy denial (the double-press guard); a re-press AFTER the deadline
  // falls through to the busy error (the miss arm owns that tick).
  // Boundary contract (pinned): the reel is valid while ctx.tickCount <=
  // fishReelDeadlineTick; the miss fires at deadline + 1 in the tick phase.
  if (
    p.castingAbility === FISHING_CAST_ID &&
    p.fishReelDeadlineTick > 0 &&
    ctx.tickCount <= p.fishReelDeadlineTick
  ) {
    p.castingAbility = null;
    p.castRemaining = 0;
    p.fishBiteAtTick = 0;
    p.fishReelDeadlineTick = 0;
    ctx.emit({ type: 'castStop', entityId: p.id, success: true });
    completeFishing(ctx, p, meta);
    // Cleared AFTER completeFishing on purpose: the completion reads the
    // pinned zone for the table and the deed credit.
    p.fishCastZoneId = '';
    return;
  }
  // The early reel: a pole re-press during one's own session BEFORE the bite
  // (fishBiteAtTick is still armed; the bite arm zeroes it when it fires)
  // pulls the line in empty and ends the session. This arm is what keeps the
  // bite a reaction test: it used to fall through to the free busy no-op
  // below, which made spam-pressing a guaranteed catch, since one press
  // always fell inside the armed reel window while every earlier press cost
  // nothing. Now a press either answers the bite (the reel arm above) or
  // ends the cast, so spamming casts and cancels forever and never lands a
  // fish. Hoisted ABOVE the combat denial for the same reason the reel arm
  // is: were the denial to win, an in-combat spammer would keep the free
  // no-ops and the exploit. Fully self-guarded (only a LIVE pre-bite fishing
  // session of one's own passes; the parity drives that direct-assign
  // castingAbility leave fishBiteAtTick 0 and keep the busy denial), and
  // draw-free on every path: the session's one bite-delay draw is simply
  // abandoned, zoneId/band resolve from pure state like the miss arm's.
  // Costs nothing but the ended cast; recast immediately.
  //
  // The grace: inside the first FISH_EARLY_REEL_GRACE_SEC of the session a
  // re-press falls through to the ordinary denials below (busy, or combat)
  // instead of ending the cast, so an accidental double-press never burns
  // the session. Session age is the count of elapsed casting ticks read off
  // the castTotal/castRemaining pair (updateCasting subtracts DT once per
  // tick; the half-tick epsilon keeps the float accumulation from moving
  // the boundary tick). Safe against the exploit because the grace ends two
  // full seconds before the earliest possible bite: every press a spammer
  // lands past it still cancels long before a window can arm. NOTE the age
  // clock counts CASTING ticks (updateCasting calls) while fishBiteAtTick
  // counts absolute ticks; they stay in lockstep only because no live
  // fishing session can skip an updateCasting call today. If casting can
  // ever pause while a session stays live, re-derive this age off
  // ctx.tickCount (a stored cast-start tick) instead.
  if (
    p.castingAbility === FISHING_CAST_ID &&
    p.fishBiteAtTick > 0 &&
    p.castTotal - p.castRemaining >= FISH_EARLY_REEL_GRACE_SEC - DT / 2
  ) {
    const zoneId = p.fishCastZoneId || zoneAt(p.pos.x, p.pos.z).id;
    const band = effectiveFishingBand(meta);
    p.castingAbility = null;
    p.castRemaining = 0;
    p.fishBiteAtTick = 0;
    p.fishReelDeadlineTick = 0;
    p.fishCastZoneId = '';
    ctx.emit({ type: 'fishingEarlyReel', pid: p.id, zoneId, band });
    ctx.emit({ type: 'castStop', entityId: p.id, success: false });
    return;
  }
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  if (ctx.isSwimming(p)) {
    ctx.error(meta.entityId, "You can't do that while swimming.");
    return;
  }
  if (p.castingAbility || isConsuming(p)) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  // Action-locked shapeshift forms refuse casting a line, the exact gate and
  // literal castAbility applies to the normal kit. Sits BELOW the reel arm
  // (unreachable-different: a mid-session shapeshift is refused by the
  // castAbility busy guard, so an armed reel can never arrive shapeshifted)
  // and ABOVE the implement gate, so a denial stays rng-free.
  if (p.auras.some((a) => isActionLockingFormAuraKind(a.kind))) {
    ctx.error(meta.entityId, "You can't do that while shapeshifted.");
    return;
  }
  // Implement gate (#2343, the always-require-a-tool rule's fishing arm):
  // casting a line needs a fishing implement in bags: the simple pole
  // (use.type 'fishing') or any fishing-profession gatherTool rod. Sits
  // AFTER the busy/reel arm (a valid reel must never be eaten; the reel
  // re-press itself already proves ownership through useItem's countItem
  // gate) and BEFORE the water check and the one bite-delay draw, so a
  // denial is rng-free and starts nothing. Text-free denial (the
  // gatherDenied idiom): the client composes its own localized copy.
  if (!hasFishingImplement(meta.inventory, ITEMS)) {
    ctx.emit({
      type: 'gatherDenied',
      pid: meta.entityId,
      surface: 'fishing',
      professionId: 'fishing',
      requiredTier: 1,
    });
    return;
  }
  const probe = firstFishableSampleAhead(p.pos.x, p.pos.z, p.facing, ctx.cfg.seed);
  if (!probe) {
    ctx.error(meta.entityId, 'You need to face fishable water.');
    return;
  }
  // Zone rod gate (D9, the skill-versus-spot axis): each zone's water names
  // the rod tier it takes (professions/fishing_zones.ts), read through the
  // same canGatherTier comparator every node gate uses. Draw-free like every
  // arm above it, so where it sits changes no seed; it sits AFTER the water
  // check on purpose, so it only ever answers a real attempt to fish. Ahead
  // of it a player facing dry ground in the peaks would be told to go and buy
  // a better rod when the thing actually missing is the water.
  //
  // The gate reads the WATER'S zone at the probe point (the first accepted
  // ring sample, up to 24 yd out), never the caster's: a cross-boundary
  // cast answers to the zone the fish actually come from, so standing on
  // the cheap side of a line cannot dodge the far side's rod tier.
  // completeFishing resolves its catch table and the deed credit from the
  // SAME zone, pinned on the session at cast start (fishCastZoneId), so a
  // player is never gated for one zone's requirement and then fished
  // against another zone's table. Mid-session displacement cannot un-pin
  // it: movement cancels a fishing cast (sim/player_motion.ts), a landed
  // hit cancels it even when a shield absorbs all of it (combat/damage.ts),
  // teleports and a /follow tow across a zone line cancel it through the
  // shared displacement helper (professions/session_teardown.ts), and the
  // arena family clears sessions in its own placement resets. What does
  // NOT cancel is a displacement with no hit and no teleport (a hostile
  // damage-free knockback, a leap or charge already in flight): the PIN is
  // what makes those harmless, because the table, deed credit, and
  // telemetry stay on the zone the gate validated no matter where the body
  // ends up. Turning in place moves the probe but never the pinned zone,
  // which is exactly why the pin exists.
  //
  // zoneAt SATURATES at the world edges (any z past the north end resolves
  // to the northmost zone), and instanced spaces are laid out along z, so a
  // dungeon slot would inherit whatever zone its origin lands in. Harmless
  // today because the probe walk accepts declared water bodies only and
  // every lake is in the overworld, so the water check above refuses first.
  // Author fishable water inside an instance and this needs a real answer.
  const probeZoneId = zoneAt(probe.x, probe.z).id;
  const requiredRodTier = rodTierRequiredForZone(probeZoneId);
  const ownedRodTier = bestOwnedGatherToolTier(meta.inventory, 'fishing', ITEMS);
  if (!canGatherTier(ownedRodTier, requiredRodTier)) {
    ctx.emit({
      type: 'gatherDenied',
      pid: meta.entityId,
      surface: 'fishing',
      professionId: 'fishing',
      requiredTier: requiredRodTier,
    });
    return;
  }
  // Casting a line is a deliberate action and breaks stealth (rng-free),
  // AFTER every deny arm above: a refused attempt never reveals the player.
  ctx.breakStealth(p);
  if (p.sitting) ctx.standUp(p);
  // Auto-dismount family (the castStart arm in combat/casting_lifecycle.ts):
  // casting a line is a deliberate cast, so a mounted angler dismounts and an
  // in-flight summon channel is dropped, exactly as any ability cast does.
  // Draw-free, AFTER every deny arm, so a refused attempt never dismounts.
  if (p.mountKey !== '') forceDismount(ctx, p);
  if (p.mountCastKey !== '') {
    p.mountCastRemaining = 0;
    p.mountCastKey = '';
  }
  p.castingAbility = FISHING_CAST_ID;
  p.castTotal = FISHING_SESSION_CAP_SEC;
  p.castRemaining = FISHING_SESSION_CAP_SEC;
  p.castTargetId = null;
  p.channeling = false;
  // Drop any GCD-held queued spell press (fresh-start path only; the reel
  // arm above ends a session rather than starting one): a session's end
  // paths never call fireQueuedCast, so a slot that survived into the
  // session would fire unprompted one tick after it ends.
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  p.fishCastZoneId = probeZoneId;
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: FISHING_CAST_ID,
    time: FISHING_SESSION_CAP_SEC,
  });
  // The ONE bite-delay draw, AFTER every deny arm above (a denial draws
  // nothing and starts nothing): a hidden seeded delay in [MIN, effMax], the
  // rod pulling the max down only. Stored in TICKS on hidden Entity state
  // (ceil, the lockpick deadline precedent), NEVER on castTotal/castRemaining:
  // those broadcast in dynamicFields and must carry no bite information.
  const effMax = fishBiteMaxSecFor(ownedRodTier);
  const delaySec = FISH_BITE_DELAY_MIN_SEC + ctx.rng.next() * (effMax - FISH_BITE_DELAY_MIN_SEC);
  p.fishBiteAtTick = ctx.tickCount + Math.ceil(delaySec / DT);
  p.fishReelDeadlineTick = 0;
}

export function completeFishing(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (shouldCatchCodfather(ctx, p, meta)) {
    // Deliberately NOT capacity-gated: this once-ever quest catch is guarded
    // to a single copy by shouldCatchCodfather, and losing it to full bags
    // could soft-lock the quest chain. Force-add (over-capacity tolerated).
    ctx.addItem(THE_CODFATHER_ITEM_ID, 1, meta.entityId);
    return;
  }
  // The catch depends on which zone's water you're fishing and how skilled you
  // are: each zone has its own weighted table per rarity band, and the player's
  // fishing proficiency picks the band (fishingBandFor). Band selection is pure
  // state, resolved before the single rng draw below, so the draw order never
  // depends on it. Fall back to the Vale table for any spot without its own
  // (e.g. fishable water inside a dungeon zone), per band.
  // Rod gating: catch band b requires tool tier b + 1 (the shared
  // canGatherTier comparator), so band 0, the shipped table, is always
  // reachable: the simple pole and bare hands both resolve to effective tier 1
  // via bestOwnedGatherToolTier's bare-hands floor. Effective band =
  // min(proficiency band, best band the owned rod tier covers). The cap is
  // SILENT by design: no event and no denial, the cast still lands a
  // band-capped catch (the effective band does ride the owner's own outcome
  // events for the telemetry, so "silent" means no denial, not secret). All
  // of this is pure state resolved before the single rng draw below, so the
  // one-draw-per-catch contract and every existing seed's catch sequence are
  // untouched.
  //
  // TWO ROD RULES, KEPT SEPARATE ON PURPOSE, because they answer different
  // questions and a player reads them differently. The zone gate in
  // startFishing decides ACCESS and DENIES out loud (no cast, a named tier in
  // the toast). This cap decides QUALITY and stays silent (the cast lands, one
  // band lower). Folding them into one rule breaks whichever half it adopts: a
  // silent zone gate would leave a player casting forever into water that can
  // never pay them, and a loud quality cap would refuse the cast of anyone
  // whose proficiency has outrun their rod in their OWN water, which is the
  // ordinary state of every angler mid-climb. What keeps them from overlapping
  // is that the zone gate already forces rodTier >= the zone's tier, so the
  // effective band can only fall short of the zone's own band through
  // PROFICIENCY. In other words the silent cap can only ever cost a player
  // who is over-rodded for where they stand, never one whose rod is illegal
  // for the water: that case was already refused, in words, before the cast.
  const band = effectiveFishingBand(meta);
  const bandTables = FISHING_TABLES_BY_BAND[band];
  // The zone the rod gate validated, pinned at cast start; the position
  // fallback keeps direct test/parity drives (no startFishing) working.
  const zoneId = p.fishCastZoneId || zoneAt(p.pos.x, p.pos.z).id;
  const table = bandTables[zoneId] ?? bandTables.eastbrook_vale;
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  let roll = ctx.rng.next() * total;
  let caught: string | null = null;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) {
      caught = entry.itemId;
      break;
    }
  }
  if (caught === null) {
    ctx.emit({ type: 'log', text: 'No fish are biting.', color: '#999', pid: p.id });
    // Telemetry-only structured sibling of the log line above (the
    // empty-hook rate cannot be derived from a text event). Draw-free.
    ctx.emit({ type: 'fishingEmptyHook', pid: p.id, zoneId, band });
    return;
  }
  // Capacity gate AFTER the table roll so the rng draw order never depends
  // on bag state; a catch with no room to land simply gets away, and the
  // got-away event carries that truth (the table draw was spent).
  if (!ctx.canAddItem(caught, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    ctx.emit({ type: 'fishingGotAway', pid: p.id, zoneId, band });
    return;
  }
  if (caught === FISHING_RARE_ID) {
    ctx.emit({
      type: 'log',
      text: 'A rare catch! Something gleams on your line.',
      color: '#1eff00',
      pid: p.id,
    });
  }
  // silent + callerLogs: the fishingResult event below owns BOTH halves of
  // the player feedback for a landed catch. It plays the reel cue
  // (audio.fishReel), so the generic loot ding stacked a second cue on top of
  // it, and it logs the quality-colored, item-linked reel-in line, so the
  // hub's "You receive:" line was a second line for the one catch. Together
  // with the bite line that made a catch three lines and two cues (#2430).
  // The Codfather quest grant above deliberately passes NEITHER: it returns
  // before the emit below, so the hub line and cue are its only feedback.
  ctx.addItem(caught, 1, meta.entityId, { silent: true, callerLogs: true });
  // Catch feedback event (Professions 2.0): personal (pid = the
  // angler), text-free on purpose (the gatherResult idiom): the client logs
  // its own localized reel-in line colored by the caught item's quality.
  // Emitted ONLY here on the landed-catch path (never on the no-bite null
  // branch, the bags-full got-away branch, or the codfather quest branch)
  // and draws no rng, so the one-draw-per-catch contract is unaffected.
  ctx.emit({
    type: 'fishingResult',
    pid: meta.entityId,
    itemId: caught,
    quality: ITEMS[caught]?.quality ?? 'common',
    zoneId,
    band,
  });
  // Book of Deeds: a real fish (never weeds or boots) from this zone's
  // waters feeds the per-zone first-cast mark.
  onFishCaughtForDeeds(ctx, meta, zoneId, caught);
  // Character XP: fishing deliberately grants NONE, on every branch above and
  // below. It is the only UNCAPPED gathering faucet (a catch needs no node and
  // no per-player respawn timer), so at the per-action XP a world-node harvest
  // pays it would be worth several times the XP per hour of every other
  // gathering profession. The sim's grantXp sites (mob kill, quest turn-in,
  // delve clear, craft, and the node harvest in gathering.ts) do not include
  // this file, and that absence is the design, not an oversight: fishing pays
  // fishing proficiency and loot, never levels. Pinned by the zero-XP test in
  // tests/professions_fishing.test.ts.
  // Fishing proficiency: a landed catch accrues the fractional
  // schedule amount (fishingCatchGainAt above: the schedule, junk cut off
  // past band 0, zeroed at or past the WATER'S teaching ceiling per R19)
  // through the shared gathering-grant queue, draining on the tick path
  // exactly like a world-node harvest. The zone tier is the SAME `zoneId`
  // local the catch table resolved above (the rod-gate-validated cast zone,
  // with the position fallback for direct drives), so the table, the deed
  // credit, the telemetry, and the gain all read one water. The gain is pure
  // state computed AFTER the single table draw (zero rng draws, zero draw
  // reordering), and a 0 gain queues nothing (queueGatheringGrant drops
  // non-positive amounts). Deliberately queued only here, on the landed
  // path: the no-bite null branch, the bags-full got-away branch, and the
  // codfather quest branch (which returns above) never accrue.
  // Grey vendor trash on the tables (weed/boot) is junk and not a cooking
  // catch; raw cooking catches are also kind junk but still teach.
  const isGreyFishingJunk = ITEMS[caught]?.kind === 'junk' && !isRawCookingCatch(caught);
  queueGatheringGrant(
    meta,
    'fishing',
    fishingCatchGainAt(
      meta.gatheringProficiency.fishing ?? 0,
      isGreyFishingJunk,
      rodTierRequiredForZone(zoneId),
    ),
  );
}
