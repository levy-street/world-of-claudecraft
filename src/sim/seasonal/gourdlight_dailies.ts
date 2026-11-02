// Gourdlight Eve's rotating dailies (the records: content/gourdlight_eve_dailies.ts).
//
// WHICH errand Hester offers is the realm's reset day, never a clock: the host feeds
// `ctx.resetDay` (the server's calendar online, the client's offline), its civil day
// number picks the pool entry, so every world on one realm day offers the same one and
// two days running never repeat. The other errands of the pool join the repeat-blocked
// set every host already shares (seasonal_quests.ts), so only the day's one is offered;
// an errand already in the log stays finishable after the day rolls.
//
// This module also owns the errands' world pieces (the stray patch pumpkins and the
// cursed candles, raised while the event runs under reserved ids that never touch the
// entity allocator or the rng) and the costumed fright: say BOO to a townsperson while
// wearing a costume, and they start (a gesture everyone nearby sees) and the errand
// counts them, once a day per townsperson. No rng anywhere here.

import {
  GOURDLIGHT_EVE_ID,
  TRICK_OR_TREAT,
  TRICK_OR_TREAT_NPC_IDS,
  TRICK_OR_TREAT_NPCS,
} from '../content/gourdlight_eve';
import {
  CURSED_CANDLE_ID,
  GOURDLIGHT_BOO_COSTUME_AURAS,
  GOURDLIGHT_BOO_LEDGER_PREFIX,
  GOURDLIGHT_BOO_QUEST_EVENT,
  GOURDLIGHT_BOO_STARTLE,
  GOURDLIGHT_DAILY_BOO_QUEST_ID,
  GOURDLIGHT_DAILY_POOL,
  GOURDLIGHT_TOWN_KNOCK_EVENTS,
  PATCH_PUMPKIN_ID,
} from '../content/gourdlight_eve_dailies';
import { createGroundObject } from '../entity';
import { onQuestEventForQuests } from '../quests/quest_credit';
import { gourdlightDailySites } from '../seasonal_daily_sites';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d } from '../types';
import { civilDayNumber } from '../world_quest_rotation';
import { markGourdlightFright } from './gourdlight_deed_marks';
import { activeSeasonalEventOf, knockedToday } from './seasonal_state';

// Reserved entity ids (the haunted pumpkins' scheme, haunted_pumpkins.ts -910000):
// negative, below every allocator id, one block per errand.
const PATCH_ENTITY_BASE = -912000;
const CANDLE_ENTITY_BASE = -913000;

/** The errand the pool offers on `resetDay` ('' or malformed: the first one). */
export function gourdlightDailyForDay(resetDay: string): string {
  const day = civilDayNumber(resetDay);
  const n = GOURDLIGHT_DAILY_POOL.length;
  const index = day === null ? 0 : ((day % n) + n) % n;
  return GOURDLIGHT_DAILY_POOL[index];
}

/** The errand open today: the /dev pick when one is set, else the day's. */
export function gourdlightDailyToday(resetDay: string, devDaily: string | null): string {
  return devDaily !== null && GOURDLIGHT_DAILY_POOL.includes(devDaily)
    ? devDaily
    : gourdlightDailyForDay(resetDay);
}

/** The pool's errands that are NOT today's (empty while the event is closed: its own
 *  close already blocks every one of them). */
export function offDayDailyQuestIds(
  activeEvent: string | null,
  resetDay: string,
  devDaily: string | null,
): readonly string[] {
  if (activeEvent !== GOURDLIGHT_EVE_ID) return [];
  const today = gourdlightDailyToday(resetDay, devDaily);
  return GOURDLIGHT_DAILY_POOL.filter((id) => id !== today);
}

function syncObjects(
  ctx: SimContext,
  active: boolean,
  base: number,
  itemId: string,
  name: string,
  sites: readonly { x: number; z: number; yaw: number }[],
): void {
  sites.forEach((site, i) => {
    const id = base - i;
    const existing = ctx.entities.get(id);
    if (!active) {
      if (existing?.objectItemId === itemId) ctx.dropEntity(id);
      return;
    }
    if (existing) return;
    const obj = createGroundObject(id, itemId, name, ctx.groundPos(site.x, site.z));
    obj.facing = site.yaw;
    obj.prevFacing = site.yaw;
    ctx.addEntity(obj);
  });
}

/** Raise the errands' world pieces when the event opens and clear them when it closes
 *  (called on the seasonal tick's open/close edge). */
export function updateGourdlightDailyObjects(ctx: SimContext, active: string | null): void {
  const open = active === GOURDLIGHT_EVE_ID;
  const sites = gourdlightDailySites(ctx.cfg.seed);
  syncObjects(ctx, open, PATCH_ENTITY_BASE, PATCH_PUMPKIN_ID, 'Patch Pumpkin', sites.patch);
  syncObjects(ctx, open, CANDLE_ENTITY_BASE, CURSED_CANDLE_ID, 'Cursed Candle Stub', sites.candles);
}

/** The town a trick-or-treat townsperson lives in (zone id), or null. */
export function trickOrTreatTownOf(templateId: string): string | null {
  for (const [zoneId, ids] of Object.entries(TRICK_OR_TREAT_NPCS)) {
    if (ids.includes(templateId)) return zoneId;
  }
  return null;
}

/** An accepted knock also counts for the towns errand (its town's own event). */
export function creditTownKnock(ctx: SimContext, meta: PlayerMeta, npcTemplateId: string): void {
  const town = trickOrTreatTownOf(npcTemplateId);
  const eventId = town ? GOURDLIGHT_TOWN_KNOCK_EVENTS[town] : undefined;
  if (eventId) onQuestEventForQuests(ctx, meta, eventId);
}

/** The ledger key a fright takes in the day's knock ledger. */
export function booLedgerKey(npcTemplateId: string): string {
  return `${GOURDLIGHT_BOO_LEDGER_PREFIX}${npcTemplateId}`;
}

/** Whether a body wears a look that counts as a costume for a fright. */
export function wearsGourdlightCostume(auras: readonly { id: string }[]): boolean {
  return auras.some((a) => GOURDLIGHT_BOO_COSTUME_AURAS.includes(a.id));
}

export type BooOutcome =
  | 'frightened'
  | 'notActive'
  | 'notOnErrand'
  | 'noCostume'
  | 'alreadyFrightened'
  | 'tooFar'
  | 'invalid';

/** Say BOO to NPC entity `npcId` as player `pid`. Every outcome draws no rng. */
export function booTownsfolk(ctx: SimContext, npcId: number, pid?: number): BooOutcome {
  const r = ctx.resolve(pid);
  if (!r) return 'invalid';
  const { meta, e: player } = r;
  const npc = ctx.entities.get(npcId);
  if (
    !npc ||
    npc.kind !== 'npc' ||
    npc.dead ||
    !TRICK_OR_TREAT_NPC_IDS.has(npc.templateId) ||
    player.dead
  )
    return 'invalid';
  const notice = (
    what: 'notActive' | 'booNotOnErrand' | 'booNoCostume' | 'booAlready' | 'tooFar',
  ) => ctx.emit({ type: 'seasonal', what, npc: npc.templateId, pid: meta.entityId });
  if (activeSeasonalEventOf(ctx.seasonal) !== GOURDLIGHT_EVE_ID) {
    notice('notActive');
    return 'notActive';
  }
  if (meta.questLog.get(GOURDLIGHT_DAILY_BOO_QUEST_ID)?.state !== 'active') {
    notice('booNotOnErrand');
    return 'notOnErrand';
  }
  if (dist2d(player.pos, npc.pos) > TRICK_OR_TREAT.range) {
    notice('tooFar');
    return 'tooFar';
  }
  if (!wearsGourdlightCostume(player.auras)) {
    notice('booNoCostume');
    return 'noCostume';
  }
  const ledger = knockedToday(meta, ctx.resetDay);
  const key = booLedgerKey(npc.templateId);
  if (ledger.has(key)) {
    notice('booAlready');
    return 'alreadyFrightened';
  }
  ledger.add(key);
  // the start: the townsperson throws up their hands where everyone nearby can see
  npc.overheadEmoteId = GOURDLIGHT_BOO_STARTLE.gesture;
  npc.overheadEmoteUntil = ctx.time + GOURDLIGHT_BOO_STARTLE.seconds;
  npc.overheadEmoteSeq += 1;
  ctx.emit({ type: 'seasonal', what: 'boo', npc: npc.templateId, pid: meta.entityId });
  onQuestEventForQuests(ctx, meta, GOURDLIGHT_BOO_QUEST_EVENT);
  // the whole-event checklist's town (Book of Deeds, gourdlight_deed_marks.ts)
  markGourdlightFright(ctx, meta, npc.templateId);
  meta.wireRev++;
  return 'frightened';
}
