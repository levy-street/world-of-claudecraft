// What /spectate does to the moderator's own body: nothing but make it idle.
// The body stays exactly where it stands, a full part of the world (visible,
// targetable, attackable unless the character is a GM in its own right,
// counted by presence systems such as King of the Hill); only the camera and
// the snapshot anchor follow the target. While spectating the server drops the
// moderator's movement input, so on entry the body stops: movement intent
// cleared, auto-attack off, any live profession session torn down (a
// spectating moderator must not keep gathering unattended).
import { cancelProfessionSessionOnDisplacement } from '../src/sim/professions/session_teardown';
import type { Sim } from '../src/sim/sim';
import { type Entity, emptyMoveInput } from '../src/sim/types';

export function idleSpectatorBody(sim: Sim, entity: Entity): void {
  cancelProfessionSessionOnDisplacement(sim.ctx, entity);
  sim.stopAutoAttack(entity.id);
  const meta = sim.meta(entity.id);
  if (meta) Object.assign(meta.moveInput, emptyMoveInput());
}
