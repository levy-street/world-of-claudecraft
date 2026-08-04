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
// table); a miss stays at one; the codfather reel draws nothing (early
// return); a bags-full reel still draws the table (capacity gates after the
// roll). Band selection is pure state, not a draw, and every deny arm is
// draw-free.

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
import { groundHeight, waterLevelAt } from '../world';
import { rodTierRequiredForZone } from './fishing_zones';
import { queueGatheringGrant } from './gathering';
import { PROFICIENCY_BAND_THRESHOLDS, proficiencyBandFor } from './proficiency_bands';
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

// Catch rarity ladder band boundaries (Professions 2.0): the minimum
// fishing proficiency for each of the three catch tables. The
// ladder itself lives in proficiency_bands.ts (gathering.ts shares it for the
// gather-cast duration); these exports delegate so every existing import and
// test pin keeps resolving with identical values.
export const FISHING_BAND_THRESHOLDS = PROFICIENCY_BAND_THRESHOLDS;

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

// What a ROD's own rarity adds to the window, per rung above common (the
// shared ladder, tools.ts rarityLadderIndex). The land tools' rarity buys
// charges on a slotted effect instead; this is the rod half of the same
// ruling, that rarity may grant narrow bonuses which never affect access.
//
// SAY IT PLAINLY: for every rod that ships, this is a TIER bonus wearing
// rarity's coat. Rod rarity is perfectly collinear with rod tier (ironreel 2
// common, silverstream 3 uncommon, stormreel 4 rare, tidewrought 5 epic, and
// the pole floors at tier 1 common), so nothing in the world today can move
// one without the other, and a reader comparing this to
// FISH_REEL_WINDOW_ROD_BONUS_SEC should understand the two as one ladder read
// twice rather than as two independent axes. It is expressed as rarity anyway
// because the RULING is about rarity, and because the land tools' charge bonus
// is genuinely NOT collinear (tiers 1 and 2 are both common), so one ladder
// serving both is what keeps them from drifting into two.
//
// SIZED BY THE SESSION CAP, not by feel. The cap is 300 ticks
// (FISHING_SESSION_CAP_SEC at DT) and the worst legal session before this was
// 271: a worst bite of 160 ticks, the tier-5 window of 110, and the one tick
// the miss arm fires on. That left 29 ticks, so the epic rung's three steps had
// to fit inside 1.45 s and 0.25 buys 0.75 of it, landing the worst session at
// 286 with 14 ticks still spare. tests/fishing_zones.test.ts re-derives that
// budget rather than restating it, so a wider rung fails there instead of
// silently letting the cap eat a legal reel window.
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

/** The highest catch band a rod of this tier unlocks. Band b takes tool tier
 *  b + 1, and there are three bands, so tier 3 reaches the last one and every
 *  tier above it unlocks nothing further. The engine's own cap below reads
 *  this, so the tooltip and the table can never disagree about where the
 *  ladder ends. */
export function fishingRodBandFor(rodTier: number): 0 | 1 | 2 {
  let band: 0 | 1 | 2 = 0;
  if (canGatherTier(rodTier, 2)) band = 1;
  if (canGatherTier(rodTier, 3)) band = 2;
  return band;
}

// Which catch table band a given fishing proficiency selects. Pure state (no
// rng), so it never perturbs the one-draw-per-catch rng contract; NaN falls
// to band 0 (see proficiencyBandFor).
export const fishingBandFor = proficiencyBandFor;

// The band a session actually fishes: min(proficiency band, best band the
// owned rod tier covers). THE one definition (completeFishing's table pick
// and every telemetry-bearing fishing event resolve it here), pure state,
// draw-free: a bag scan plus two ladder reads.
export function effectiveFishingBand(meta: PlayerMeta): 0 | 1 | 2 {
  const rodTier = bestOwnedGatherToolTier(meta.inventory, 'fishing', ITEMS);
  return Math.min(
    fishingBandFor(meta.gatheringProficiency.fishing ?? 0),
    fishingRodBandFor(rodTier),
  ) as 0 | 1 | 2;
}

// Per-catch proficiency gain schedule (Professions 2.0): the breakpoints are
// the half-band boundaries (50 inside band 0, 150 inside band 1),
// halving-then-tapering the gain each step. Proficiency 200 (band 2) is a
// thousands-of-catches journey by design: the 0.02 trickle is the climb's
// long tail, and at or past the last row the gain is 0 (the maxSkill cap
// clamp is the real stop, not this schedule).
//
// The schedule is only HALF the model since R19: the water's ZONE TIER caps
// how far a given water teaches (fishingTeachingCeilingFor below), the same
// shape the land curve gets from node tiers. Before R19 fishing gain was
// proficiency-relative alone, which made zone-1 water the mathematically
// optimal grind spot all the way to the 200 cap; now the climb itself pulls
// an angler to better water, while the catch tables keep paying whatever the
// zone pays. R19 is the packet's one authorized extension of the D12
// no-gain-changes scope, and the schedule VALUES are deliberately untouched:
// the ceiling composes with them, so every gain a legal water grants is the
// number this table always granted.
export const FISHING_GAIN_SCHEDULE = [
  { belowProficiency: 50, gain: 1 },
  { belowProficiency: 100, gain: 0.5 },
  { belowProficiency: 150, gain: 0.1 },
  { belowProficiency: 200, gain: 0.02 },
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
 *  lockstep so they cannot drift. Pure and draw-free. */
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
    const water = waterLevelAt(sx, sz);
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
  // A re-press BEFORE the bite or AFTER
  // the deadline falls through to the busy error below.
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
  // today because waterLevelAt returns -Infinity outside a declared lake and
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
