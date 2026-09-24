// Storm Surge (Tempest Vharok, the Buried Hoard storm boss). Tempest Judgment
// leaves a wide field of charged ground. While Vharok stands inside his own
// field he drinks it: every HOARD_STORM_SURGE_EVERY_SEC he gains a stack, each
// worth more damage and a visibly larger body, up to the cap. Dragged out of
// the field, the stacks bleed off one at a time. The counterplay is positional:
// whoever holds him walks him OUT of the glow, and the field is large enough
// that it takes a deliberate move, not a sidestep.
//
// State rides HoardBossState (stormSurge*); the stack count rides the boss as a
// `buff_dmg_done` aura, so it shows on the target frame, reaches online clients
// on the ordinary aura wire, and the renderer reads it for the charged look.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import {
  HOARD_STORM_SURGE_DAMAGE_PER_STACK,
  HOARD_STORM_SURGE_DECAY_SEC,
  HOARD_STORM_SURGE_EVERY_SEC,
  HOARD_STORM_SURGE_MAX_STACKS,
  HOARD_STORM_SURGE_SCALE_PER_STACK,
} from './hoard_boss_kits';
import type { HoardBossState } from './types';

export const HOARD_STORM_SURGE_AURA_ID = 'hoard_storm_surge';

/** Whether the boss stands inside any live charged-ground field. */
export function bossInStormField(boss: Entity, state: HoardBossState): boolean {
  return state.cues.some((cue) => {
    if (cue.kind !== 'mark' || cue.variant !== 'storm-field' || cue.phase !== 'hazard')
      return false;
    const dx = boss.pos.x - cue.x;
    const dz = boss.pos.z - cue.z;
    return dx * dx + dz * dz <= cue.radius * cue.radius;
  });
}

function applyStacks(ctx: SimContext, boss: Entity, state: HoardBossState): void {
  const stacks = state.stormSurgeStacks ?? 0;
  const base = state.stormSurgeBaseScale ?? boss.scale;
  boss.scale = base * (1 + stacks * HOARD_STORM_SURGE_SCALE_PER_STACK);
  boss.auras = boss.auras.filter((aura) => aura.id !== HOARD_STORM_SURGE_AURA_ID);
  if (stacks <= 0) return;
  ctx.applyAura(boss, {
    id: HOARD_STORM_SURGE_AURA_ID,
    name: 'Storm Surge',
    kind: 'buff_dmg_done',
    // An honest timer: how long the charge would last if he left the ground
    // right now (one stack bleeds off per HOARD_STORM_SURGE_DECAY_SEC).
    remaining: stacks * HOARD_STORM_SURGE_DECAY_SEC,
    duration: stacks * HOARD_STORM_SURGE_DECAY_SEC,
    value: stacks * HOARD_STORM_SURGE_DAMAGE_PER_STACK,
    stacks,
    sourceId: boss.id,
    school: 'nature',
    encounterOwned: true,
  });
}

/** One tick of the surge. Called only while the storm boss is engaged. */
export function tickHoardStormSurge(ctx: SimContext, boss: Entity, state: HoardBossState): void {
  state.stormSurgeBaseScale ??= boss.scale;
  state.stormSurgeStacks ??= 0;
  state.stormSurgeTimer ??= 0;
  const inField = bossInStormField(boss, state);
  if (inField !== (state.stormSurgeInField ?? false)) {
    state.stormSurgeInField = inField;
    state.stormSurgeTimer = 0;
  }
  state.stormSurgeTimer += DT;
  if (inField) {
    // Standing in it keeps the charge topped up, so the timer never runs down
    // while the stacks are in fact safe.
    const surge = boss.auras.find((aura) => aura.id === HOARD_STORM_SURGE_AURA_ID);
    if (surge) surge.remaining = surge.duration;
    if (
      state.stormSurgeTimer < HOARD_STORM_SURGE_EVERY_SEC ||
      state.stormSurgeStacks >= HOARD_STORM_SURGE_MAX_STACKS
    )
      return;
    state.stormSurgeTimer = 0;
    state.stormSurgeStacks++;
    applyStacks(ctx, boss, state);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'nature',
      fx: 'nova',
    });
    if (state.stormSurgeStacks === 1)
      ctx.emit({
        type: 'log',
        text: `${boss.name} drinks the charged ground. Drag him out of it!`,
        color: '#8de8ff',
        entityId: boss.id,
      });
    return;
  }
  if (state.stormSurgeStacks <= 0 || state.stormSurgeTimer < HOARD_STORM_SURGE_DECAY_SEC) return;
  state.stormSurgeTimer = 0;
  state.stormSurgeStacks--;
  applyStacks(ctx, boss, state);
}

/** Restore the boss's authored size (the fight reset or ended). */
export function clearHoardStormSurge(boss: Entity | undefined, state: HoardBossState): void {
  if (boss && state.stormSurgeBaseScale !== undefined) {
    boss.scale = state.stormSurgeBaseScale;
    boss.auras = boss.auras.filter((aura) => aura.id !== HOARD_STORM_SURGE_AURA_ID);
  }
  state.stormSurgeStacks = 0;
}
