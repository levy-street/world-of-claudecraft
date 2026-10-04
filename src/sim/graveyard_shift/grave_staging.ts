// The Graveyard Shift's way in and out, on the offline host: the glowing grave
// by the Hollow Crypt (spawned only while the offline player is eligible, so an
// ineligible player simply has no grave), Tibbs the union rep who climbs out of
// it when the grave is touched and offers the shift, and the end of every grave
// shift back in front of him, with his report and, on the win (the shift can be
// won once), the Boss for a Day deed. Tibbs' summoner and summon tick ride his own entity. The run start
// itself stays in run_lifecycle.ts (which calls in here); nothing here imports
// it. Draws no rng.

import { NPCS } from '../data';
import { grantDeed } from '../deeds';
import { createGroundObject, createNpc } from '../entity';
import { formatMoney } from '../format_money';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { settleTeleportArrival } from '../teleport_arrival';
import { dist2d, type Entity, TICK_RATE } from '../types';
import {
  BOSS_FOR_A_DAY_DEED_ID,
  GRAVE_ENTITY_ID,
  GRAVE_INTERACT_RADIUS,
  GRAVE_ITEM_ID,
  GRAVE_POS,
  GRAVEYARD_SHIFT_PAYOUT_COPPER,
  graveReturnSpot,
  isGraveyardShiftEligible,
  TIBBS_ENTITY_ID,
  TIBBS_IDLE_SECONDS,
  TIBBS_LEAVE_RADIUS,
  TIBBS_NPC_ID,
  tibbsSpot,
  withinGrave,
} from './grave_entry';
import type { GraveyardShiftOutcome, GraveyardShiftRun } from './run_state';

const GRAVE_NAME = 'Glowing Grave';
const SAY_KEY = 'devCommand.graveyardShift.tibbs.say';

// English fallbacks for Tibbs' keyed lines (the client renders the catalog).
const TIBBS_LINES = {
  accept: 'Wonderful. Mind the bones on the way down. Some of them are colleagues.',
  busy: 'Come back when you are not so busy. Union rules.',
  covered: 'Your shift is covered. Morthen is back at work, and he says thank you.',
} as const;
export type TibbsLine = keyof typeof TIBBS_LINES;

// A run owner is pinned to Morthen's level: the real one is parked on the run.
function eligibleMeta(ctx: SimContext, meta: PlayerMeta): boolean {
  const e = ctx.entities.get(meta.entityId);
  const parkedLevel = ctx.graveyardShiftRuns.get(meta.entityId)?.parked.level;
  return (
    !!e &&
    isGraveyardShiftEligible({
      level: parkedLevel ?? e.level,
      deedsEarned: meta.deedsEarned,
      questsDone: meta.questsDone,
    })
  );
}

function anyEligible(ctx: SimContext): boolean {
  for (const meta of ctx.players.values()) if (eligibleMeta(ctx, meta)) return true;
  return false;
}

/** Whether this player may take the shift from Tibbs (the same rule as the
 *  grave: a won shift closes it, though Tibbs stays up a while for his report). */
export function graveyardShiftEligibleFor(ctx: SimContext, pid: number): boolean {
  const meta = ctx.players.get(pid);
  return !!meta && eligibleMeta(ctx, meta);
}

/** The grave stands while an offline player is eligible, and sinks back once
 *  nobody is (the shift won) as soon as Tibbs has gone down. Every tick, cheap. */
export function ensureGraveyardShiftGrave(ctx: SimContext): void {
  if (!ctx.cfg.offlineHost) return;
  if (ctx.entities.has(GRAVE_ENTITY_ID)) {
    // Never mid-shift: the shift ends back at this grave.
    const quiet = !ctx.entities.has(TIBBS_ENTITY_ID) && ctx.graveyardShiftRuns.size === 0;
    if (quiet && !anyEligible(ctx)) ctx.dropEntity(GRAVE_ENTITY_ID);
    return;
  }
  if (!anyEligible(ctx)) return;
  const grave = createGroundObject(
    GRAVE_ENTITY_ID,
    GRAVE_ITEM_ID,
    GRAVE_NAME,
    ctx.groundPos(GRAVE_POS.x, GRAVE_POS.z),
  );
  ctx.addEntity(grave);
}

/** Tibbs speaks aloud, heard by one player (his say line and bubble). */
export function tibbsSay(ctx: SimContext, pid: number, line: TibbsLine): void {
  const tibbs = ctx.entities.get(TIBBS_ENTITY_ID);
  if (!tibbs) return;
  ctx.emit({
    type: 'chat',
    fromPid: tibbs.id,
    from: tibbs.name,
    text: TIBBS_LINES[line],
    textKey: `${SAY_KEY}.${line}`,
    channel: 'say',
    entityId: tibbs.id,
    pid,
  });
}

/** Tibbs climbs out of his grave beside it, facing whoever called him. */
function raiseTibbs(ctx: SimContext, summoner: Entity): Entity | null {
  const existing = ctx.entities.get(TIBBS_ENTITY_ID);
  if (existing) {
    existing.gshiftSummonerPid = summoner.id;
    existing.gshiftSummonedTick = ctx.tickCount;
    return existing;
  }
  const def = NPCS[TIBBS_NPC_ID];
  if (!def) return null;
  const spot = tibbsSpot();
  const tibbs = createNpc(TIBBS_ENTITY_ID, def, ctx.groundPos(spot.x, spot.z));
  tibbs.facing = Math.atan2(summoner.pos.x - spot.x, summoner.pos.z - spot.z);
  tibbs.prevFacing = tibbs.facing;
  tibbs.gshiftSummonerPid = summoner.id;
  tibbs.gshiftSummonedTick = ctx.tickCount;
  ctx.addEntity(tibbs);
  // The dust he climbs out of.
  ctx.emit({ type: 'spellfxAt', x: spot.x, z: spot.z, school: 'shadow', fx: 'nova' });
  return tibbs;
}

/** Tibbs goes back down (no one is targeting him afterwards). */
export function dismissTibbs(ctx: SimContext): void {
  if (!ctx.entities.has(TIBBS_ENTITY_ID)) return;
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === TIBBS_ENTITY_ID) e.targetId = null;
  }
  ctx.dropEntity(TIBBS_ENTITY_ID);
}

// pickUpObject's branch for the grave. An ineligible toucher (online, a party
// member offline) gets nothing: the grave is just a grave.
export function touchGraveyardShiftGrave(ctx: SimContext, p: Entity, meta: PlayerMeta): boolean {
  if (!ctx.cfg.offlineHost || !eligibleMeta(ctx, meta)) return false;
  if (!withinGrave(p.pos, GRAVE_INTERACT_RADIUS)) return false;
  const tibbs = raiseTibbs(ctx, p);
  if (!tibbs) return false;
  ctx.emit({ type: 'graveyardShiftOffer', npcId: tibbs.id, pid: p.id });
  return true;
}

/** Whether a targeted interact on this entity is an answer to Tibbs' offer. */
export function isTibbs(e: Entity | undefined): boolean {
  return e?.kind === 'npc' && e.templateId === TIBBS_NPC_ID;
}

// Tibbs goes back down once his caller walks off, sits down to a shift, or
// leaves him standing too long; the grave appears once someone qualifies.
export function updateGraveyardShiftGrave(ctx: SimContext): void {
  ensureGraveyardShiftGrave(ctx);
  const tibbs = ctx.entities.get(TIBBS_ENTITY_ID);
  if (!tibbs) return;
  const caller =
    tibbs.gshiftSummonerPid !== undefined ? ctx.entities.get(tibbs.gshiftSummonerPid) : undefined;
  const idle = ctx.tickCount - (tibbs.gshiftSummonedTick ?? 0) >= TIBBS_IDLE_SECONDS * TICK_RATE;
  if (!caller || ctx.graveyardShiftRuns.has(caller.id) || idle) dismissTibbs(ctx);
  else if (dist2d(caller.pos, tibbs.pos) > TIBBS_LEAVE_RADIUS) dismissTibbs(ctx);
}

// A grave shift hands its owner back in front of the grave, where Tibbs waits
// with his report and the pay (win) or his consolation and a fresh offer
// (loss), in the client's NPC dialog. An aborted shift says nothing. Runs
// after the identity and the pools are restored.
export function endShiftAtGrave(
  ctx: SimContext,
  run: GraveyardShiftRun,
  outcome: GraveyardShiftOutcome,
  report: { sent: number; saved: number },
  leaving = false,
): void {
  const p = ctx.entities.get(run.ownerPid);
  const meta = ctx.players.get(run.ownerPid);
  if (!p || !meta || p.dead) return;
  const spot = graveReturnSpot();
  p.pos = ctx.groundPos(spot.x, spot.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = Math.atan2(GRAVE_POS.x - spot.x, GRAVE_POS.z - spot.z);
  p.prevFacing = p.facing;
  settleTeleportArrival(p);
  // A leaver (logout, a dropped connection, jail) gets no Tibbs: nobody to talk to.
  if (outcome === 'aborted' || leaving) return;
  if (!raiseTibbs(ctx, p)) return;
  // The pay went out with the deed at the win; his report shows it.
  const copper = outcome === 'won' ? GRAVEYARD_SHIFT_PAYOUT_COPPER : 0;
  ctx.emit({
    type: 'graveyardShiftOffer',
    npcId: TIBBS_ENTITY_ID,
    pid: p.id,
    report: { outcome, sent: report.sent, saved: report.saved, copper },
  });
}

/** The deed and Tibbs' pay for a won grave shift, the moment the fight is won:
 *  the deed's banner and sound mark the end, and one save carries both, so a
 *  crash or a logout before the walk back loses neither. */
export function payBossForADay(ctx: SimContext, run: GraveyardShiftRun): void {
  const meta = ctx.players.get(run.ownerPid);
  if (run.entry !== 'grave' || !meta) return;
  meta.copper += GRAVEYARD_SHIFT_PAYOUT_COPPER;
  ctx.emit({
    type: 'loot',
    text: `You receive ${formatMoney(GRAVEYARD_SHIFT_PAYOUT_COPPER)}.`,
    pid: run.ownerPid,
  });
  grantDeed(ctx, meta, BOSS_FOR_A_DAY_DEED_ID);
}
