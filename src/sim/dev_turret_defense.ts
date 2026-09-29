// `/dev turret [scenario | leave]`: takes the player from the open world to the
// Fire and Fly tower in their own arena and seats them for a run of the named
// scenario (Standard when none is named), or leaves it (back where they stood).
// Dev-channel text, English.

import { TURRET_DEFAULT_SCENARIO, TURRET_SCENARIOS } from './content/fire_and_fly_scenarios';
import type { SimContext } from './sim_context';
import { seatTurret, type TurretSeatRefusal } from './turret_defense_session';
import type { TurretScenarioDef } from './types';
import { leaveVehicle } from './vehicles';

const TURRET_COMMAND = /^\/dev\s+turret(?:\s+([a-z_][a-z0-9_]*))?\s*$/i;

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

/** A scenario by its board key or its id. */
function scenarioNamed(name: string): TurretScenarioDef | null {
  return TURRET_SCENARIOS.find((s) => s.boardKey === name || s.id === name) ?? null;
}

/** True when `raw` is a `/dev turret` command, handled or refused. */
export function handleDevTurretChat(ctx: SimContext, raw: string, pid: number): boolean {
  const match = TURRET_COMMAND.exec(raw);
  if (!match) return false;
  if (!ctx.devCommands) return true;
  const resolved = ctx.resolve(pid);
  if (!resolved) return true;
  const word = match[1]?.toLowerCase();
  if (word === 'leave') {
    const seated = resolved.meta.vehicle?.kind === 'turret';
    if (seated) leaveVehicle(ctx, pid);
    devLog(ctx, pid, seated ? '[dev] Turret left.' : '[dev] Not seated in the turret.');
    return true;
  }
  const scenario = word === undefined ? TURRET_DEFAULT_SCENARIO : scenarioNamed(word);
  if (!scenario) {
    const known = TURRET_SCENARIOS.map((s) => s.boardKey).join(', ');
    devLog(ctx, pid, `[dev] Unknown turret scenario "${word}"; try one of: ${known}.`);
    return true;
  }
  const refusal = seatTurret(ctx, pid, scenario);
  if (refusal) {
    refuse(ctx, pid, refusal);
    return true;
  }
  devLog(
    ctx,
    pid,
    `[dev] Turret seated in your Fire and Fly arena (${scenario.boardKey}); /dev turret leave returns you.`,
  );
  return true;
}
