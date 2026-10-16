// Heroic: the howdah's second rider and his drum (great_saurian.ts, the rework
// of 2026-10-14). While the drum beats, the Earthshaking Stomp's clock runs
// twice as fast. The group's answer is the totems (saurian_totems.ts): a
// broken totem's backlash knocks the drummer off his beat for 6 s. The drum
// goes down with the howdah at half health.
//
// The drummer is never a body: he cannot be targeted or killed, only
// silenced, so the heroic layer asks nothing new of the group, only that it
// answer the totems faster. The price of the faster Stomp stands beside
// SAURIAN_TUNING (ids.ts).
//
// Deterministic and draw-free. Every visible state rides the Saurian: the
// Howdah Drum aura while it beats, the Drum Silenced aura (its `remaining`
// the silence left) while it does not, and one `spellfx` a beat.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type SaurianFightState } from '../../types';
import { dropAuraById } from './claim';
import {
  SAURIAN_DRUM_BEAT,
  SAURIAN_DRUM_SILENCED,
  SAURIAN_WAR_DRUM,
  SAURIAN_TUNING as T,
} from './ids';

/** Does this claim's Saurian carry the drummer (heroic only)? */
export function drumAboard(inst: InstanceSlot): boolean {
  return inst.difficulty === 'heroic';
}

/** The drum starts with the pull, beating. */
export function startDrum(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  st.drum = { silenced: 0, beat: T.drumBeatEvery };
  paintDrum(ctx, saurian, st);
}

/** Is the drum beating right now (aboard and not silenced)? */
export function drumBeating(st: SaurianFightState): boolean {
  return st.drum !== null && st.drum.silenced <= 1e-9;
}

/** Keep the Saurian's two drum auras on the drum's state. */
function paintDrum(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  const drum = st.drum;
  if (!drum || saurian.dead) {
    dropAuraById(saurian, SAURIAN_WAR_DRUM);
    dropAuraById(saurian, SAURIAN_DRUM_SILENCED);
    return;
  }
  if (drum.silenced > 1e-9) {
    dropAuraById(saurian, SAURIAN_WAR_DRUM);
    const have = saurian.auras.find((a) => a.id === SAURIAN_DRUM_SILENCED);
    if (have) {
      have.remaining = drum.silenced;
      return;
    }
    ctx.applyAura(saurian, {
      id: SAURIAN_DRUM_SILENCED,
      name: 'Drum Silenced',
      // A mark of the rule: it carries no stat.
      kind: 'buff_dr',
      remaining: drum.silenced,
      duration: T.drumSilence,
      value: 0,
      sourceId: saurian.id,
      school: 'physical',
      undispellable: true,
    });
    return;
  }
  dropAuraById(saurian, SAURIAN_DRUM_SILENCED);
  if (saurian.auras.some((a) => a.id === SAURIAN_WAR_DRUM)) return;
  ctx.applyAura(saurian, {
    id: SAURIAN_WAR_DRUM,
    name: 'Howdah Drum',
    // A mark of the rule: the Stomp's clock is the encounter's.
    kind: 'buff_dr',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: 0,
    sourceId: saurian.id,
    school: 'physical',
    undispellable: true,
  });
}

/** A totem's backlash (or the dev trigger) knocks the drummer off his beat. */
export function silenceDrum(ctx: SimContext, saurian: Entity, st: SaurianFightState): boolean {
  if (!st.drum) return false;
  st.drum.silenced = T.drumSilence;
  st.drum.beat = T.drumBeatEvery;
  paintDrum(ctx, saurian, st);
  return true;
}

/** The drum goes down with the howdah (or the pull ends). */
export function stopDrum(ctx: SimContext, saurian: Entity, st: SaurianFightState): void {
  st.drum = null;
  paintDrum(ctx, saurian, st);
}

/**
 * One tick of the drum. Returns how fast the Stomp's clock runs this tick (1
 * with no drum, or a silenced one).
 */
export function stepDrum(ctx: SimContext, saurian: Entity, st: SaurianFightState): number {
  const drum = st.drum;
  if (!drum) return 1;
  if (drum.silenced > 1e-9) {
    drum.silenced = Math.max(0, drum.silenced - DT);
    paintDrum(ctx, saurian, st);
    if (drum.silenced > 1e-9) return 1;
    drum.beat = 0;
  }
  drum.beat -= DT;
  if (drum.beat <= 1e-9) {
    drum.beat += T.drumBeatEvery;
    ctx.emit({
      type: 'spellfx',
      sourceId: saurian.id,
      targetId: saurian.id,
      school: 'physical',
      fx: 'nova',
      ability: SAURIAN_DRUM_BEAT,
    });
  }
  return T.drumStompRate;
}
