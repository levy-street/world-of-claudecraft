import { riftInstanceOrigin } from '../data';
import { layoutColliders } from '../dungeon_layout';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { tideLaneFits } from './hoard_tide_fit';
import { hoardTidePattern } from './hoard_tide_pattern';
import { generateRiftFloor } from './rift_gen';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

const TIDE_RETRY_SEC = 1.5;

/** One VOLLEY of Crashing Tide: every lane of the set goes down at once, laid
 *  round a living player (each volley the next one, so the waves follow the fight
 *  wherever the party drags him, and nobody is reliably left alone), and the
 *  crests leave one after another. The whole set, enrage and rarity included, is
 *  fixed at its first warning. `living` is id-sorted (instancePlayers sorts).
 *
 *  A lane is only laid where everyone in it can step out sideways
 *  (hoard_tide_fit.ts): one that would fill a passage or pin someone against a
 *  wall is left out, and a volley with no lane that fits waits a moment instead. */
export function tickHoardTidePattern(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  living: readonly Entity[],
  emitCue: (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void,
): void {
  state.sweepTimer -= DT;
  if (state.sweepTimer > 0) return;
  // With nobody left to aim at it falls where he stands.
  const aim = living.length > 0 ? living[state.targetCursor++ % living.length].pos : boss.pos;
  // The floor is regenerated from the instance's seed, exactly as the run built it.
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const colliders = layoutColliders(
    generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex, inst.upgrade).layout,
  );
  const pattern = hoardTidePattern(
    inst.seed ^ state.nextCueId ^ Math.imul(state.targetCursor, 0x9e3779b1),
    inst.vault?.rarity ?? 'common',
    boss.hp <= boss.maxHp * 0.3,
  ).filter((plan) =>
    tideLaneFits(colliders, aim.x + plan.dx - origin.x, aim.z + plan.dz - origin.z, plan),
  );
  if (pattern.length === 0) {
    state.sweepTimer = TIDE_RETRY_SEC;
    return;
  }
  state.tidePattern = pattern;
  for (const plan of pattern) {
    const cue: HoardBossCue = {
      id: state.nextCueId++,
      kind: 'sweep',
      variant: 'tide-wave',
      x: aim.x + plan.dx,
      z: aim.z + plan.dz,
      facing: plan.facing,
      halfAngle: 0,
      radius: plan.radius,
      waveGap: plan.gap,
      waveSpan: plan.span,
      waveLead: plan.lead,
      remaining: plan.total,
      total: plan.total,
      hitIds: new Set(),
    };
    state.cues.push(cue);
    emitCue(ctx, inst, cue);
  }
  // The whole set is down: the clock for the next one starts when a lane ends.
  state.sequenceStep = pattern.length;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'windup',
    ability: 'Crashing Tide',
  });
}
