// Fishing profession command logic, behind the SimContext seam (Professions
// 2.0 Phase 11): startFishing begins the fishing cast (the fishing-pole item
// use routes here via SimContext, src/sim/items.ts) and completeFishing
// resolves the catch when that cast finishes (the cast lifecycle routes here,
// src/sim/combat/casting_lifecycle.ts). Fishing is a full gathering proficiency
// (GATHERING_PROFESSIONS.fishing): a landed catch queues a proficiency grant on
// the tick path like any other gathering harvest, and the accrued proficiency
// selects a catch rarity band (fishingBandFor) whose per-zone table shifts
// weight out of junk/empty-hook rows and into food fish as skill rises. The rng
// draw order is preserved exactly (one ctx.rng draw per normal catch, zero on
// the codfather early-return path, and zero in startFishing): band selection is
// pure state, not a draw, so at band 0 (proficiency < 100) the resolved rows
// stay the shipped rows and every existing seed reproduces its catch sequence,
// keeping the parity goldens byte-identical.

import { FISHING_RARE_ID, FISHING_TABLES_BY_BAND } from '../content/items';
import { DEEPFEN_SHALLOWS_LAKE } from '../content/zone2';
import { ITEMS, zoneAt } from '../data';
import { onFishCaughtForDeeds } from '../deeds';
import { PLAYER_SWIM_DEPTH } from '../pathfind';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, FISHING_CAST_ID, FISHING_CAST_TIME, isConsuming } from '../types';
import { groundHeight, waterLevelAt } from '../world';
import { queueGatheringGrant } from './gathering';
import { bestOwnedGatherToolTier, canGatherTier } from './tools';

const SWIM_DEPTH = PLAYER_SWIM_DEPTH; // ground this far under the water line = deep water
const FISHING_SAMPLE_DISTANCES = [4, 8, 12, 16, 20, 24];
const DEEPFEN_FISHING_SHORE_MARGIN = 10;
const THE_CODFATHER_ITEM_ID = 'the_codfather';
const THE_CODFATHER_QUEST_ID = 'q_the_codfather';

// Catch rarity ladder band boundaries (Professions 2.0 Phase 11): the minimum
// fishing proficiency for each of the three catch tables. The thirds of the
// Fishing maxSkill (300) line up with the shipped 100-proficiency deed
// milestones: band 0 covers 0-99, band 1 covers 100-199, band 2 covers 200+.
// Exported so tests can pin the boundaries.
export const FISHING_BAND_THRESHOLDS = [0, 100, 200] as const;

// Which catch table band a given fishing proficiency selects. Pure state (no
// rng), so it never perturbs the one-draw-per-catch rng contract. A NaN
// proficiency falls through both comparisons to band 0, matching the
// proficiency-0 default.
export function fishingBandFor(proficiency: number): 0 | 1 | 2 {
  if (proficiency >= FISHING_BAND_THRESHOLDS[2]) return 2;
  if (proficiency >= FISHING_BAND_THRESHOLDS[1]) return 1;
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
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  if (!hasFishableWaterAhead(ctx, p)) {
    ctx.error(meta.entityId, 'You need to face fishable water.');
    return;
  }
  if (p.sitting) ctx.standUp(p);
  p.castingAbility = FISHING_CAST_ID;
  p.castTotal = FISHING_CAST_TIME;
  p.castRemaining = FISHING_CAST_TIME;
  p.castTargetId = null;
  p.channeling = false;
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: FISHING_CAST_ID,
    time: FISHING_CAST_TIME,
  });
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
  // Phase 12 rod gating: catch band b requires tool tier b + 1 (the shared
  // canGatherTier comparator), so band 0, the shipped table, is always
  // reachable: the simple pole and bare hands both resolve to effective tier 1
  // via bestOwnedGatherToolTier's bare-hands floor. Effective band =
  // min(proficiency band, best band the owned rod tier covers). The cap is
  // SILENT by design: no event and no denial, the cast still lands a
  // band-capped catch (Phase 12b adds the rod-synergy UX). All of this is pure
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
  // Catch feedback event (Professions 2.0 Phase 11): personal (pid = the
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
  // Fishing proficiency: a landed catch (fish AND junk alike) accrues one point
  // through the shared gathering-grant queue, draining on the tick path exactly
  // like a world-node harvest. Deliberately queued only here, on the landed
  // path: the no-bite null branch, the bags-full got-away branch, and the
  // codfather quest branch (which returns above) never accrue.
  queueGatheringGrant(meta, 'fishing', 1);
}
