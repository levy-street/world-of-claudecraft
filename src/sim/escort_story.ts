// Optional escort storytelling. All cursors and deadlines belong to the live
// run, so retries and simultaneous Sim instances cannot share narrative state.
import { emitMobYell } from './mob/yells';
import type { SimContext } from './sim_context';
import type { Entity, EscortDef, EscortRunState } from './types';

type Run = NonNullable<EscortRunState['run']>;

export function emitEscortSpeech(ctx: SimContext, def: EscortDef, npc: Entity, text: string): void {
  // Preserve the caravan entity id for the bubble and interest routing while
  // attributing the chat line to its driver. No world entity is mutated.
  emitMobYell(ctx, def.story ? { ...npc, name: def.story.speaker } : npc, text);
}

export function startEscortStory(ctx: SimContext, def: EscortDef, run: Run): void {
  if (!def.story) return;
  run.story = { nextLine: 0, nextSpeechAt: ctx.time + def.story.lineSpacingSeconds };
}

export function interruptEscortStory(ctx: SimContext, def: EscortDef, run: Run, npc: Entity): void {
  if (!def.story || !run.story) return;
  emitEscortSpeech(ctx, def, npc, def.story.ambushText);
  run.story.nextSpeechAt = ctx.time + def.story.lineSpacingSeconds;
}

// Called only after the escort driver has checked that every ambusher is down.
// At arrival the driver stays visible while the conclusion is being read.
// Returns true once the complete story has had its reading time.
export function updateEscortStory(ctx: SimContext, def: EscortDef, run: Run, npc: Entity): boolean {
  const story = def.story;
  const state = run.story;
  if (!story || !state) return true;
  if (npc.inCombat || ctx.time < state.nextSpeechAt) return false;
  const line = story.lines[state.nextLine];
  if (line) {
    if (run.waypointIndex <= line.atWaypoint) return false;
    emitEscortSpeech(ctx, def, npc, line.text);
    state.nextLine++;
    state.nextSpeechAt = ctx.time + story.lineSpacingSeconds;
    return false;
  }
  if (run.waypointIndex < def.waypoints.length) return false;
  if (state.finaleAt !== undefined) return true;
  emitEscortSpeech(ctx, def, npc, def.successText);
  state.finaleAt = ctx.time;
  state.nextSpeechAt = ctx.time + story.lineSpacingSeconds;
  return false;
}
