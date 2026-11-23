// Trick-or-treat: talk to one of the event's townsfolk once per reset day and
// say the words. A treat hands over sweets (the event currency); a trick plays a
// short harmless cosmetic transformation and still leaves one sweet. There are no
// doors in this world, so the knock is a talk.
//
// Server-authoritative on every host: the client only offers the gossip row and
// sends the request (IWorldSeasonal.trickOrTreat); the sim decides the outcome
// with the world rng, so the same seed and the same knocks draw the same treats.

import { bagsFullError } from '../bags';
import {
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TRICKS,
  TRICK_OR_TREAT,
  TRICK_OR_TREAT_NPC_IDS,
  TRICK_OR_TREAT_QUEST_EVENT,
} from '../content/gourdlight_eve';
import { onQuestEventForQuests } from '../quests/quest_credit';
import type { SimContext } from '../sim_context';
import { dist2d } from '../types';
import { creditTownKnock } from './gourdlight_dailies';
import { markGourdlightKnock } from './gourdlight_deed_marks';
import { playTrick } from './seasonal_cosmetics';
import { activeSeasonalEventOf, knockedToday } from './seasonal_state';

/** Whether an NPC template answers a knock (whatever the day's ledger says). */
export function isTrickOrTreatNpc(templateId: string): boolean {
  return TRICK_OR_TREAT_NPC_IDS.has(templateId);
}

export type TrickOrTreatOutcome =
  | { kind: 'treat'; sweets: number }
  | { kind: 'trick'; sweets: number; trick: string }
  | { kind: 'refused'; reason: 'notActive' | 'alreadyKnocked' | 'tooFar' | 'invalid' | 'bagsFull' };

/** Knock on NPC entity `npcId` for player `pid`. Every refusal draws no rng. */
export function trickOrTreat(ctx: SimContext, npcId: number, pid?: number): TrickOrTreatOutcome {
  const r = ctx.resolve(pid);
  if (!r) return { kind: 'refused', reason: 'invalid' };
  const { meta, e: player } = r;
  const npc = ctx.entities.get(npcId);
  if (!npc || npc.kind !== 'npc' || npc.dead || !isTrickOrTreatNpc(npc.templateId) || player.dead) {
    return { kind: 'refused', reason: 'invalid' };
  }
  const notice = (what: 'notActive' | 'alreadyKnocked' | 'tooFar') =>
    ctx.emit({ type: 'seasonal', what, npc: npc.templateId, pid: meta.entityId });
  if (activeSeasonalEventOf(ctx.seasonal) === null) {
    notice('notActive');
    return { kind: 'refused', reason: 'notActive' };
  }
  if (dist2d(player.pos, npc.pos) > TRICK_OR_TREAT.range) {
    notice('tooFar');
    return { kind: 'refused', reason: 'tooFar' };
  }
  const knocked = knockedToday(meta, ctx.resetDay);
  if (knocked.has(npc.templateId)) {
    notice('alreadyKnocked');
    return { kind: 'refused', reason: 'alreadyKnocked' };
  }
  // The most a knock can hand over decides the bag check, before any roll, so a
  // full bag refuses without spending the door or drawing the dice.
  if (!ctx.canAddItem(GOURDLIGHT_SWEET_ID, TRICK_OR_TREAT.treatSweets, meta.entityId)) {
    bagsFullError(ctx, meta.entityId, GOURDLIGHT_SWEET_ID);
    return { kind: 'refused', reason: 'bagsFull' };
  }
  knocked.add(npc.templateId);
  const treat = ctx.rng.chance(TRICK_OR_TREAT.treatChance);
  let outcome: TrickOrTreatOutcome;
  if (treat) {
    outcome = { kind: 'treat', sweets: TRICK_OR_TREAT.treatSweets };
  } else {
    const index = ctx.rng.int(0, GOURDLIGHT_TRICKS.length - 1);
    const trick = playTrick(ctx, player, index, npc.id);
    outcome = { kind: 'trick', sweets: TRICK_OR_TREAT.trickSweets, trick };
  }
  ctx.addItem(GOURDLIGHT_SWEET_ID, outcome.sweets, meta.entityId);
  ctx.emit({
    type: 'seasonal',
    what: outcome.kind,
    npc: npc.templateId,
    sweets: outcome.sweets,
    ...(outcome.kind === 'trick' ? { trick: outcome.trick } : {}),
    pid: meta.entityId,
  });
  onQuestEventForQuests(ctx, meta, TRICK_OR_TREAT_QUEST_EVENT);
  // ...and for the towns errand, its town's own knock (gourdlight_dailies.ts)
  creditTownKnock(ctx, meta, npc.templateId);
  // ...and the whole-event checklist's door (Book of Deeds, gourdlight_deed_marks.ts)
  markGourdlightKnock(ctx, meta, npc.templateId);
  meta.wireRev++;
  return outcome;
}
