// /dev graveyardshift: the Graveyard Shift's playtest shortcut, skipping the grave
// and Tibbs (ALLOW_DEV_COMMANDS or the offline dev client only: reached through
// the ctx.devCommands gate like every /dev branch, and the run start refuses a
// dev entry without dev commands too).
//
//   /dev graveyardshift [start]   cover Morthen's shift in a private Crypt
//   /dev graveyardshift end       end the shift and walk out to the Crypt door
//   /dev graveyardshift status    whether a shift is running

import { graveyardShiftRunFor, startGraveyardShift } from '../graveyard_shift';
import type { SimContext } from '../sim_context';

function devLog(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text: `[dev] ${text}`, pid });
}

export function handleGraveyardShiftDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/(?:dev\s+graveyardshift|devgraveyardshift)(?:\s+(start|end|status))?\s*$/i.exec(
    raw,
  );
  if (!m) return false;
  const verb = (m[1] ?? 'start').toLowerCase();
  const run = graveyardShiftRunFor(ctx, pid);
  if (verb === 'status') {
    devLog(ctx, pid, run ? 'Graveyard Shift: on shift.' : 'Graveyard Shift: off shift.');
  } else if (verb === 'end') {
    if (run) run.pendingOutcome = 'aborted';
    else devLog(ctx, pid, 'You are not on shift.');
  } else {
    const refusal = startGraveyardShift(ctx, pid);
    devLog(ctx, pid, refusal ?? 'Graveyard Shift started.');
  }
  return true;
}
