// A dungeon guide's voice: the speech queue and its rules. Each line is
// spoken at most once per run; lines wait `spacing` seconds apart so each can
// be read; the most urgent waiting line speaks first (response, boss,
// farewell, area, creature, other), ties in the order they were queued; a
// queued area or creature line older than `staleAfter` is dropped (the moment
// has passed); a line about a boss before its fight is dropped once that
// fight starts; while a boss is in its fight only the lines marked for it
// speak. Every line goes to every player in the claim as an id-only event.
// Draws no rng.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import type { DungeonGuideDef, DungeonGuideRun, GuideLineDef, GuideLinePriority } from './types';

const RANK: Readonly<Record<GuideLinePriority, number>> = {
  response: 5,
  boss: 4,
  farewell: 3,
  area: 2,
  creature: 1,
  other: 0,
};

/** How long a spoken line's gesture plays on the guide's body. */
export const GUIDE_GESTURE_SECONDS = 3.2;
/** The gesture a spoken line plays when its record names none. */
export const GUIDE_TALK_GESTURE = 'point' as const;

export function lineById(def: DungeonGuideDef, id: string): GuideLineDef | undefined {
  return def.lines.find((l) => l.id === id);
}

/** Can this line speak at all in this run (its variant chosen, its
 *  difficulty met, not spoken yet, not already waiting)? */
export function lineEligible(run: DungeonGuideRun, line: GuideLineDef, heroic: boolean): boolean {
  if (run.done.has(line.id)) return false;
  if (line.heroicOnly && !heroic) return false;
  if (line.variant && run.chosen[line.variant] !== line.id) return false;
  return !run.queue.some((q) => q.id === line.id);
}

/** Queue every eligible line whose trigger matches `match`. */
export function enqueueWhere(
  def: DungeonGuideDef,
  run: DungeonGuideRun,
  heroic: boolean,
  now: number,
  match: (line: GuideLineDef) => boolean,
): void {
  for (const line of def.lines) {
    if (!match(line) || !lineEligible(run, line, heroic)) continue;
    run.queue.push({ id: line.id, at: now });
  }
}

/** The line that speaks now, if any, after dropping the stale ones. */
export function pickLine(
  def: DungeonGuideDef,
  run: DungeonGuideRun,
  now: number,
  bossFight: boolean,
  bossStarted: (bossId: string) => boolean,
): GuideLineDef | null {
  const keep: typeof run.queue = [];
  for (const q of run.queue) {
    const line = lineById(def, q.id);
    if (!line) continue;
    const stale =
      (line.priority === 'area' || line.priority === 'creature') &&
      now - q.at > def.speech.staleAfter;
    if (stale || (line.beforeBoss && bossStarted(line.beforeBoss))) {
      run.done.add(line.id);
      continue;
    }
    keep.push(q);
  }
  run.queue = keep;
  if (now < run.nextSpeechAt) return null;
  let best: GuideLineDef | null = null;
  for (const q of run.queue) {
    const line = lineById(def, q.id);
    if (!line || (bossFight && !line.inBossCombat)) continue;
    if (!best || RANK[line.priority] > RANK[best.priority]) best = line;
  }
  return best;
}

/** Speak one line: an id-only event to each listener, the guide's gesture,
 *  and the chain lines that follow it join the queue. */
export function speakLine(
  ctx: SimContext,
  def: DungeonGuideDef,
  run: DungeonGuideRun,
  npc: Entity,
  line: GuideLineDef,
  listeners: readonly Entity[],
  heroic: boolean,
): void {
  run.queue = run.queue.filter((q) => q.id !== line.id);
  run.done.add(line.id);
  run.nextSpeechAt = ctx.time + def.speech.spacing - DT * 0.5;
  for (const p of listeners) {
    ctx.emit({
      type: 'dungeonGuideLine',
      guideId: def.id,
      lineId: line.id,
      npcId: npc.id,
      pid: p.id,
    });
  }
  if (!line.emote) {
    npc.overheadEmoteId = line.gesture ?? GUIDE_TALK_GESTURE;
    npc.overheadEmoteUntil = ctx.time + GUIDE_GESTURE_SECONDS;
    npc.overheadEmoteSeq += 1;
  }
  enqueueWhere(
    def,
    run,
    heroic,
    ctx.time,
    (l) => l.trigger.kind === 'follows' && l.trigger.lines.includes(line.id),
  );
}
