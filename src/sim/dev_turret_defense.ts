// `/dev turret [x z | leave]`: seats the player in the Fire and Fly tank where they
// stand (or after the dev teleport to x z), or leaves it. Dev-channel text, English.

import { displacePlayerForDev } from './dev/dev_displace';
import type { SimContext } from './sim_context';
import { seatTurret, type TurretSeatRefusal, turretSeatRefusal } from './turret_defense_session';
import { leaveVehicle } from './vehicles';

const TURRET_COMMAND =
  /^\/dev\s+turret(?:\s+(leave)|\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?))?\s*$/i;

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
  const early = turretSeatRefusal(ctx, resolved.meta, resolved.e);
  if (early) {
    refuse(ctx, pid, early);
    return true;
  }
  if (match[2] !== undefined && match[3] !== undefined) {
    displacePlayerForDev(ctx, resolved.e, Number(match[2]), Number(match[3]));
  }
  const refusal = seatTurret(ctx, pid);
  if (refusal) {
    refuse(ctx, pid, refusal);
    return true;
  }
  const at = resolved.e.pos;
  devLog(
    ctx,
    pid,
    `[dev] Turret seated at ${at.x.toFixed(1)}, ${at.z.toFixed(1)}; /dev turret leave ends it.`,
  );
  return true;
}
