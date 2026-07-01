// Raid-warning telegraphs: the sim emits a one-shot `bossWarn` event a few
// seconds before a timer-based boss mechanic resolves so the client raid-warnings
// panel (src/ui/bossmods.ts) can count it down. Purely informational: it never
// touches entity state or the RNG, so determinism is preserved. Shared by the
// mob locomotion mechanics (pulse/stomp/stoneskin/terrify), the boss-threshold
// mechanics on Sim (mend/enrage/adds/death-throes), and the Nythraxis encounter.
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';

// Lead time (seconds) between the telegraph and the mechanic firing.
export const BOSS_WARN_LEAD = 4;

// Emit a one-shot warning the tick `timer` crosses BOSS_WARN_LEAD going down
// (~BOSS_WARN_LEAD s before the mechanic fires). `timer` is the post-decrement
// value; `timer + DT` is the pre-decrement value, so the crossing fires exactly
// once per cast.
export function telegraph(ctx: SimContext, mob: Entity, timer: number, mechanic: string): void {
  if (timer <= BOSS_WARN_LEAD && timer + DT > BOSS_WARN_LEAD) {
    ctx.emit({ type: 'bossWarn', entityId: mob.id, mechanic, eta: Math.max(0, timer) });
  }
}
