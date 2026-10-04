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
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, TICK_RATE } from '../types';
import {
  BOSS_FOR_A_DAY_DEED_ID,
  GRAVE_ENTITY_ID,
  GRAVE_INTERACT_RADIUS,
  GRAVE_ITEM_ID,
  GRAVE_POS,
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

const GRAVE_NAME = 'Weathered Grave';
const SAY_KEY = 'devCommand.graveyardShift.tibbs.say';
// Tibbs' second line after a shift follows the first by this long.
export const TIBBS_FOLLOW_UP_SECONDS = 4;

// English fallbacks for Tibbs' keyed lines (the client renders the catalog).
const TIBBS_LINES = {
  accept: 'Wonderful. Mind the bones on the way down. Some of them are colleagues.',
  busy: 'Come back when you are not so busy. Union rules.',
  report:
    'Shift report! Adventurers sent home: {sent}. Colleagues saved: {saved}. Trousers not handed out: 1.',
  payout: "Good job and thank you for your help, adventurer. Here's your payout.",
  consolation: 'Do not worry. They kill us every day. Welcome to the job.',
  anotherShift: 'Another shift? They certainly will.',
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
export function tibbsSay(
  ctx: SimContext,
  pid: number,
  line: TibbsLine,
  values?: Record<string, string | number>,
  delaySeconds = 0,
): void {
  const tibbs = ctx.entities.get(TIBBS_ENTITY_ID);
  if (!tibbs) return;
  let text: string = TIBBS_LINES[line];
  for (const [k, v] of Object.entries(values ?? {})) text = text.replace(`{${k}}`, String(v));
  const event = {
    type: 'chat' as const,
    fromPid: tibbs.id,
    from: tibbs.name,
    text,
    textKey: `${SAY_KEY}.${line}`,
    textValues: values,
    channel: 'say' as const,
    entityId: tibbs.id,
    pid,
  };
  if (delaySeconds <= 0) ctx.emit(event);
  // A follow-up line waits its turn (the first bubble stays readable), and is
  // dropped if Tibbs went back down meanwhile.
  else {
    ctx.delayedEvents.push({
      at: ctx.time + delaySeconds,
      event,
      guard: () => ctx.entities.has(TIBBS_ENTITY_ID),
    });
  }
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
// with his report (win) or his consolation (loss). An aborted shift says
// nothing. Runs after the identity and the pools are restored.
export function endShiftAtGrave(
  ctx: SimContext,
  run: GraveyardShiftRun,
  outcome: GraveyardShiftOutcome,
  report: { sent: number; saved: number },
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
  if (outcome === 'aborted') return;
  if (!raiseTibbs(ctx, p)) return;
  if (outcome === 'won') {
    tibbsSay(ctx, p.id, 'report', report);
    grantDeed(ctx, meta, BOSS_FOR_A_DAY_DEED_ID);
    tibbsSay(ctx, p.id, 'payout', undefined, TIBBS_FOLLOW_UP_SECONDS);
  } else {
    tibbsSay(ctx, p.id, 'consolation');
    tibbsSay(ctx, p.id, 'anotherShift', undefined, TIBBS_FOLLOW_UP_SECONDS);
  }
}
