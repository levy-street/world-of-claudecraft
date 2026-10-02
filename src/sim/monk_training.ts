// The Blossom Temple trainees' drill: each trainee NPC loops the kata emote
// three times, then bows, then starts over, staggered so the courtyard never
// moves in lockstep. Cosmetic only: it writes the same overhead-emote fields a
// player's emote does (social/chat.ts playEmote), so both worlds render it
// through the existing emote path. Draws NO rng and reads only the sim clock.
import { MONK_TRAINEE_IDS } from './content/blossom_temple';
import type { SimContext } from './sim_context';
import type { Entity, OverheadEmoteId } from './types';

/** How long one drill step holds (matches social/chat.ts OVERHEAD_EMOTE_DURATION). */
export const MONK_DRILL_STEP_SECONDS = 3.2;
/** A short breath between steps so each one-shot finishes before the next. */
export const MONK_DRILL_GAP_SECONDS = 0.6;
/** Per-trainee start offset (seconds) so the four do not strike together. */
export const MONK_DRILL_STAGGER_SECONDS = 0.9;
/** Scan cadence in ticks (the drill only needs a few updates a second). */
const SCAN_EVERY_TICKS = 5;

const TRAINEES: ReadonlySet<string> = new Set(MONK_TRAINEE_IDS);

/** The step a trainee performs given how many steps it has done: kata x3, then a bow. */
export function monkDrillStep(seq: number): OverheadEmoteId {
  return seq % 4 === 3 ? 'bow' : 'kata';
}

/** Advance one trainee's drill if its current step has finished. Pure over the entity. */
export function advanceMonkDrill(e: Entity, time: number, index: number): boolean {
  if (e.dead) return false;
  if (e.overheadEmoteSeq === 0 && time < index * MONK_DRILL_STAGGER_SECONDS) return false;
  if (time < e.overheadEmoteUntil + MONK_DRILL_GAP_SECONDS) return false;
  e.overheadEmoteId = monkDrillStep(e.overheadEmoteSeq);
  e.overheadEmoteUntil = time + MONK_DRILL_STEP_SECONDS;
  e.overheadEmoteSeq += 1;
  return true;
}

export function updateMonkTraining(ctx: SimContext): void {
  if (ctx.tickCount % SCAN_EVERY_TICKS !== 0) return;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'npc' || !TRAINEES.has(e.templateId)) continue;
    advanceMonkDrill(e, ctx.time, MONK_TRAINEE_IDS.indexOf(e.templateId as never));
  }
}
