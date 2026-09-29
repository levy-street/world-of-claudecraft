// `/dev turret [leave]`: takes the player from the open world to the Fire and Fly
// tower in their own arena and seats them, or leaves it (back where they stood).
// Dev-channel text, English.

import type { SimContext } from './sim_context';
import { seatTurret, type TurretSeatRefusal } from './turret_defense_session';
import { leaveVehicle } from './vehicles';

const TURRET_COMMAND = /^\/dev\s+turret(?:\s+(leave))?\s*$/i;

const REFUSAL_TEXT: Readonly<Record<TurretSeatRefusal, string>> = {
  missing: 'no player to seat',
  leaving: 'you are leaving the world',
  dead: 'you are dead',
  seated: 'you are already seated in a vehicle',
  combat: 'you are in combat',
  match: 'you are in a match or a duel',
  instance: 'you are not in the open world',
  busy: 'another activity owns your movement',
  water: 'you are swimming or aboard a ship',
  cargo: 'you are carrying freight',
  full: 'every Fire and Fly arena is taken',
};

function devLog(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', pid, text });
}

function refuse(ctx: SimContext, pid: number, refusal: TurretSeatRefusal): void {
  devLog(ctx, pid, `[dev] Turret refused: ${REFUSAL_TEXT[refusal]}.`);
}

/** True when `raw` is a `/dev turret` command, handled or refused. */
export function handleDevTurretChat(ctx: SimContext, raw: string, pid: number): boolean {
  const match = TURRET_COMMAND.exec(raw);
  if (!match) return false;
  if (!ctx.devCommands) return true;
  const resolved = ctx.resolve(pid);
  if (!resolved) return true;
  if (match[1]) {
    const seated = resolved.meta.vehicle?.kind === 'turret';
    if (seated) leaveVehicle(ctx, pid);
    devLog(ctx, pid, seated ? '[dev] Turret left.' : '[dev] Not seated in the turret.');
    return true;
  }
  // A server player (the only kind with a database character id) has no turret wire yet: a
  // seat there would lock them in a session their client cannot see or leave.
  if (resolved.meta.characterId !== undefined) {
    devLog(ctx, pid, '[dev] Turret refused: offline only until online play lands.');
    return true;
  }
  const refusal = seatTurret(ctx, pid);
  if (refusal) {
    refuse(ctx, pid, refusal);
    return true;
  }
  devLog(
    ctx,
    pid,
    '[dev] Turret seated in your Fire and Fly arena; /dev turret leave returns you.',
  );
  return true;
}
