// Fishing profession command logic, behind the SimContext seam (Professions
// 2.0; the bite minigame). startFishing begins the fishing
// session (the fishing-pole item use routes here via SimContext,
// src/sim/items.ts) and draws ONE hidden seeded bite delay; the cast
// lifecycle (src/sim/combat/casting_lifecycle.ts) fires the bite and the
// got-away miss off hidden tick deadlines; a pole RE-press inside the armed
// reel window (the reel arm in startFishing's busy gate) lands the catch
// through completeFishing's single table draw. Fishing is a full gathering
// proficiency (GATHERING_PROFESSIONS.fishing): a landed catch queues a
// proficiency grant on the tick path like any other gathering harvest, and
// the accrued proficiency selects a catch rarity band (fishingBandFor) whose
// per-zone table shifts weight out of junk/empty-hook rows and into food fish
// as skill rises. Draw contract: a normal session draws one rng
// value at cast start (the bite delay) and one more at a landed reel (the
// table); a miss stays at one; the codfather reel draws nothing (early
// return); a bags-full reel still draws the table (capacity gates after the
// roll). Band selection is pure state, not a draw, and every deny arm is
// draw-free.

import { FISHING_RARE_ID, FISHING_TABLES_BY_BAND } from '../content/items';
import { DEEPFEN_SHALLOWS_LAKE } from '../content/zone2';
import { ITEMS, zoneAt } from '../data';
import { onFishCaughtForDeeds } from '../deeds';
import { PLAYER_SWIM_DEPTH } from '../pathfind';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, type Entity, FISHING_CAST_ID, FISHING_SESSION_CAP_SEC, isConsuming } from '../types';
import { groundHeight, waterLevelAt } from '../world';
import { queueGatheringGrant } from './gathering';
import { PROFICIENCY_BAND_THRESHOLDS, proficiencyBandFor } from './proficiency_bands';
import { bestOwnedGatherToolTier, canGatherTier } from './tools';

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
// (tier 2 covers [3, 6.5], tier 3 covers [3, 5]). The reel window opens at
// the bite and lasts WINDOW plus ROD_BONUS per rod tier above 1 (tier 3
// reaches 4.5 s), re-scanning the rod at bite time. Named constants so the
// tests pin the rod synergy directly.
export const FISH_BITE_DELAY_MIN_SEC = 3;
export const FISH_BITE_DELAY_MAX_SEC = 8;
export const FISH_BITE_DELAY_ROD_REDUCTION_SEC = 1.5;
export const FISH_REEL_WINDOW_SEC = 3;
export const FISH_REEL_WINDOW_ROD_BONUS_SEC = 0.75;

// Which catch table band a given fishing proficiency selects. Pure state (no
// rng), so it never perturbs the one-draw-per-catch rng contract; NaN falls
// to band 0 (see proficiencyBandFor).
export const fishingBandFor = proficiencyBandFor;

// Per-catch proficiency gain schedule (Professions 2.0): fishing has
// no per-node tier to score against, so its gain is proficiency-relative by
// design. The effective fishing band is min(profBand, rodBand), so a
// band-appropriate catch always reduces to a function of proficiency alone;
// the breakpoints are the half-band boundaries (50 inside band 0, 150 inside
// band 1), halving-then-tapering the gain each step. Proficiency 200 (band 2)
// is a thousands-of-catches journey by design: the 0.02 trickle is the climb's
// long tail, and at or past the last row the gain is 0 (the maxSkill cap clamp
// is the real stop, not this schedule).
export const FISHING_GAIN_SCHEDULE = [
  { belowProficiency: 50, gain: 1 },
  { belowProficiency: 100, gain: 0.5 },
  { belowProficiency: 150, gain: 0.1 },
  { belowProficiency: 200, gain: 0.02 },
] as const;

// Junk catches (ItemDef kind 'junk': tangled weed, soggy boots) stop granting
// proficiency entirely once band 0 is outgrown: a seasoned angler learns
// nothing from dredging up boots.
export const FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY = 100;

// The per-catch proficiency gain: deterministic fractional amounts off the
// schedule above, NEVER a skill-up roll and never an rng draw. The first
// schedule row the proficiency sits below wins; at or past the last row the
// gain is 0.
export function fishingCatchGain(proficiency: number, isJunk: boolean): number {
  if (isJunk && proficiency >= FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY) return 0;
  for (const row of FISHING_GAIN_SCHEDULE) {
    if (proficiency < row.belowProficiency) return row.gain;
  }
  return 0;
}

function hasFishableWaterAhead(ctx: SimContext, p: Entity): boolean {
  const sin = Math.sin(p.facing);
  const cos = Math.cos(p.facing);
  return FISHING_SAMPLE_DISTANCES.some((d) => {
    const x = p.pos.x + sin * d;
    const z = p.pos.z + cos * d;
    return groundHeight(x, z, ctx.cfg.seed) < waterLevelAt(x, z) - SWIM_DEPTH;
  });
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
  if (p.inCombat) {
    ctx.error(meta.entityId, "You can't do that while in combat.");
    return;
  }
  if (ctx.isSwimming(p)) {
    ctx.error(meta.entityId, "You can't do that while swimming.");
    return;
  }
  if (p.castingAbility || isConsuming(p)) {
    // The reel: re-pressing the pole during one's own fishing
    // session, inside the armed server-authoritative reaction window, lands
    // the catch. The re-press reaches here through the same useItem fishing
    // arms as the original cast (items.ts routes them to startFishing BEFORE
    // its generic busy guard), so the wire command census is unchanged. A
    // re-press BEFORE the bite or AFTER the deadline keeps the busy error.
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
      return;
    }
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  if (!hasFishableWaterAhead(ctx, p)) {
    ctx.error(meta.entityId, 'You need to face fishable water.');
    return;
  }
  if (p.sitting) ctx.standUp(p);
  p.castingAbility = FISHING_CAST_ID;
  p.castTotal = FISHING_SESSION_CAP_SEC;
  p.castRemaining = FISHING_SESSION_CAP_SEC;
  p.castTargetId = null;
  p.channeling = false;
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
  const rodTier = bestOwnedGatherToolTier(meta.inventory, 'fishing', ITEMS);
  const effMax = Math.max(
    FISH_BITE_DELAY_MIN_SEC,
    FISH_BITE_DELAY_MAX_SEC - FISH_BITE_DELAY_ROD_REDUCTION_SEC * (rodTier - 1),
  );
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
  // band-capped catch. All of this is pure
  // state resolved before the single rng draw below, so the one-draw-per-catch
  // contract and every existing seed's catch sequence are untouched.
  const rodTier = bestOwnedGatherToolTier(meta.inventory, 'fishing', ITEMS);
  let allowedBand: 0 | 1 | 2 = 0;
  if (canGatherTier(rodTier, 2)) allowedBand = 1;
  if (canGatherTier(rodTier, 3)) allowedBand = 2;
  const profBand = fishingBandFor(meta.gatheringProficiency.fishing ?? 0);
  const bandTables = FISHING_TABLES_BY_BAND[Math.min(profBand, allowedBand) as 0 | 1 | 2];
  const table = bandTables[zoneAt(p.pos.z).id] ?? bandTables.eastbrook_vale;
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
    return;
  }
  // Capacity gate AFTER the table roll so the rng draw order never depends
  // on bag state; a catch with no room to land simply gets away.
  if (!ctx.canAddItem(caught, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
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
  ctx.addItem(caught, 1, meta.entityId);
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
  });
  // Book of Deeds: a real fish (never weeds or boots) from this zone's
  // waters feeds the per-zone first-cast mark.
  onFishCaughtForDeeds(ctx, meta, zoneAt(p.pos.z).id, caught);
  // Fishing proficiency: a landed catch accrues the fractional
  // schedule amount (fishingCatchGain above, junk cut off past band 0) through
  // the shared gathering-grant queue, draining on the tick path exactly like a
  // world-node harvest. The gain is pure state computed AFTER the single table
  // draw (zero rng draws, zero draw reordering), and a 0 gain queues nothing
  // (queueGatheringGrant drops non-positive amounts). Deliberately queued only
  // here, on the landed path: the no-bite null branch, the bags-full got-away
  // branch, and the codfather quest branch (which returns above) never accrue.
  queueGatheringGrant(
    meta,
    'fishing',
    fishingCatchGain(meta.gatheringProficiency.fishing ?? 0, ITEMS[caught]?.kind === 'junk'),
  );
}
