// Per-tick hunter state the Sim loop runs for every player beside the druid
// engine's combat-state pass (sim.ts). One entry point keeps the sim.ts
// coordinator at a single call. Each step is a cheap aura scan, draws no rng,
// and does nothing for players without the aura it looks for.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { fieldcraftCombatState, TRAILBREAK_AIRBORNE_ID } from './hunter_fieldcraft';
import { playDeadTick } from './hunter_play_dead';

export const TRAILBREAK_LANDING_ID = 'trailbreak_landing';
/** Landing from Trailbreak: 50% movement speed for 3 sec. */
export const TRAILBREAK_LANDING_SPEED = 1.5;
export const TRAILBREAK_LANDING_DURATION = 3;

function trailbreakLandingTick(ctx: SimContext, hunter: Entity): void {
  if (!hunter.onGround) return;
  const index = hunter.auras.findIndex((aura) => aura.id === TRAILBREAK_AIRBORNE_ID);
  if (index < 0) return;
  hunter.auras.splice(index, 1);
  ctx.applyAura(hunter, {
    id: TRAILBREAK_LANDING_ID,
    name: 'Trailbreak',
    kind: 'buff_speed',
    remaining: TRAILBREAK_LANDING_DURATION,
    duration: TRAILBREAK_LANDING_DURATION,
    value: TRAILBREAK_LANDING_SPEED,
    sourceId: hunter.id,
    school: 'physical',
  });
}

export function updateHunterTick(ctx: SimContext, player: Entity): void {
  fieldcraftCombatState(ctx, player);
  playDeadTick(ctx, player);
  trailbreakLandingTick(ctx, player);
}
