// What a save taken during a Graveyard Shift writes: the owner's REAL
// character, never Morthen. Every save path reads serializeCharacter (the
// periodic autosave, a dropped socket's flush, logout, shutdown, the deed
// unlock's immediate save, the roster and leaderboard level), so overriding its
// result here covers them all, the way meta.fiestaRestore does for a Fiesta
// bout. Without it a save would write Morthen's level, an emptied talent build,
// the Dread pool as the real resource and Morthen's health, and shed cooldowns
// and sicknesses for free. The run's teardown hands the same character back
// live; this only keeps a save taken before it honest. Draws no rng.

import type { CharacterState } from '../character_state';
import { cloneAllocation } from '../content/talents';
import { serializeCooldowns } from '../cooldown_persist';
import { RESURRECTION_SICKNESS_ID, UNSTUCK_SICKNESS_ID } from '../resurrection';
import type { SimContext } from '../sim_context';
import { restoreCooldownsPreservingUnstuck } from '../unstuck_cooldown';
import { GRAVE_POS, graveReturnSpot } from './grave_entry';
import { graveyardShiftDoorDrop } from './run_layout';

export function graveyardShiftSaveState(
  ctx: SimContext,
  pid: number,
  state: CharacterState,
): CharacterState {
  const run = ctx.graveyardShiftRuns.size > 0 ? ctx.graveyardShiftRuns.get(pid) : undefined;
  const e = run ? ctx.entities.get(pid) : undefined;
  if (!run || !e) return state;
  const { pools } = run;
  // A grave shift ends in front of the grave, a dev one at the Crypt door.
  const pos = run.entry === 'grave' ? graveReturnSpot() : graveyardShiftDoorDrop();
  const facing =
    run.entry === 'grave' ? Math.atan2(GRAVE_POS.x - pos.x, GRAVE_POS.z - pos.z) : state.facing;
  return {
    ...state,
    level: run.parked.level,
    talents: cloneAllocation(run.parked.talents),
    hp: pools.hp,
    resource: run.savedResource,
    // The carried-in cooldowns, plus any unstuck timer the run opened (the
    // teardown's own restore rule), so a mid-run save sheds nothing.
    cooldowns: serializeCooldowns(
      restoreCooldownsPreservingUnstuck(e.cooldowns, pools.cooldowns),
      e.potionCooldownUntil,
      ctx.time,
      pools.abilityCharges,
    ),
    resSickness: pools.sickness?.id === RESURRECTION_SICKNESS_ID ? pools.sickness.remaining : null,
    unstuckSickness: pools.sickness?.id === UNSTUCK_SICKNESS_ID ? pools.sickness.remaining : null,
    pos: { x: pos.x, z: pos.z },
    facing,
    dead: false,
    ghost: false,
    corpsePos: null,
  };
}
