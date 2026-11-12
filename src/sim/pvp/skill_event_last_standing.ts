// The win rule the heart events share (Riposte, Footprints in Ash, Bankshot):
// the last fighter with hearts left wins, if they took at least one heart
// themselves, so outlasting a fight you never joined wins nothing. When nobody
// is left the event ends with no winner.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { ActiveSkillEvent } from './skill_events';

/** A participant still in the heart fight: alive, a player, hearts left. */
export function heartFighting(ev: ActiveSkillEvent, e: Entity | undefined): e is Entity {
  return !!e && !e.dead && e.kind === 'player' && (ev.hearts.get(e.id) ?? 0) > 0;
}

/** The once-a-second win check of a heart event. */
export function lastFighterStandingTick(ctx: SimContext, ev: ActiveSkillEvent): void {
  if (ev.hearts.size < 2) return;
  let standing: number | null = null;
  let count = 0;
  for (const pid of ev.hearts.keys()) {
    if (heartFighting(ev, ctx.entities.get(pid))) {
      standing = pid;
      count++;
    }
  }
  if (count === 1 && standing !== null && (ev.heartsTaken.get(standing) ?? 0) > 0) {
    ev.winner = standing;
  } else if (count === 0) {
    ev.endsAt = Math.min(ev.endsAt, ctx.time);
  }
}
