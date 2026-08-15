// Boss-cast synthesis: mobs and bosses never emit cast events, so the
// recorder derives a cast timeline from castingAbility transitions on every
// hostile npc tracked by an open fight. Runs after event routing each tick so
// mobs first seen this tick get their casts from the next tick on.
import type { OpenFight } from './fights';
import type { SegmenterHost } from './types';

/** A cast that vanished with more than this many seconds left was interrupted
 * (completion clears the field with essentially nothing remaining). */
const INTERRUPT_REMAINING_EPSILON_S = 0.15;

interface CastState {
  ability: string;
  lastRemaining: number;
}

export class BossCastSynthesizer {
  private readonly byFight = new Map<OpenFight, Map<number, CastState>>();

  observe(host: SegmenterHost, tick: number, fights: Iterable<OpenFight>): void {
    for (const fight of fights) {
      if (fight.mobIds.size === 0) continue;
      let states = this.byFight.get(fight);
      if (states === undefined) {
        states = new Map();
        this.byFight.set(fight, states);
      }
      for (const mobId of fight.mobIds) {
        const entity = host.sim.entities.get(mobId);
        const casting = entity?.castingAbility ?? null;
        const prev = states.get(mobId);
        if (prev === undefined) {
          if (casting !== null && entity !== undefined) {
            states.set(mobId, { ability: casting, lastRemaining: entity.castRemaining ?? 0 });
            fight.recordBossCast(tick, mobId, casting, 'start', entity.castTotal);
          }
          continue;
        }
        if (casting === null) {
          fight.recordBossCast(tick, mobId, prev.ability, this.endAction(prev));
          states.delete(mobId);
        } else if (casting !== prev.ability) {
          fight.recordBossCast(tick, mobId, prev.ability, this.endAction(prev));
          states.set(mobId, { ability: casting, lastRemaining: entity?.castRemaining ?? 0 });
          fight.recordBossCast(tick, mobId, casting, 'start', entity?.castTotal);
        } else {
          prev.lastRemaining = entity?.castRemaining ?? 0;
        }
      }
    }
  }

  release(fight: OpenFight): void {
    this.byFight.delete(fight);
  }

  private endAction(prev: CastState): 'stop' | 'interrupted' {
    return prev.lastRemaining > INTERRUPT_REMAINING_EPSILON_S ? 'interrupted' : 'stop';
  }
}
