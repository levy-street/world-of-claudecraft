// /dev season: open or close a seasonal event by hand for a playtest or a
// screenshot (ALLOW_DEV_COMMANDS only: handleDevChat is reached through the
// ctx.devCommands gate like every /dev branch, so none of this exists in
// production). It moves only the dev override on the world's seasonal state; the
// host calendar keeps feeding underneath and `auto` hands control back to it.
//
//   /dev season                 what is running and why
//   /dev season on [event]      force an event open (default: Gourdlight Eve)
//   /dev season off             force every event closed
//   /dev season auto            follow the host calendar again
//   /dev season knocks          forget today's trick-or-treat knocks
import { GOURDLIGHT_EVE_ID } from '../content/gourdlight_eve';
import type { SimContext } from '../sim_context';
import { activeSeasonalEventOf } from './seasonal_state';
import { KNOWN_SEASONAL_EVENTS } from './seasonal_tick';

const USAGE = '[dev] Usage: /dev season [on [event]|off|auto|knocks].';

/** True when the line was a /dev season command (handled or refused). */
export function handleSeasonalDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+season(?:\s+(\S+))?(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const log = (text: string) => ctx.emit({ type: 'log', text, pid });
  const state = ctx.seasonal;
  if (verb === '') {
    const active = activeSeasonalEventOf(state);
    const source = state.devOverride !== undefined ? 'the dev override' : 'the host calendar';
    log(
      `[dev] Seasonal event: ${active ?? 'none'} (from ${source}; host says ${state.hostEventId ?? 'none'}).`,
    );
    return true;
  }
  if (verb === 'on') {
    const eventId = (m[2] ?? GOURDLIGHT_EVE_ID).toLowerCase();
    if (!KNOWN_SEASONAL_EVENTS.includes(eventId)) {
      ctx.error(pid, `[dev] Unknown seasonal event. Known: ${KNOWN_SEASONAL_EVENTS.join(', ')}.`);
      return true;
    }
    state.devOverride = eventId;
    log(`[dev] Seasonal event forced open: ${eventId}. /dev season auto restores the calendar.`);
    return true;
  }
  if (verb === 'off') {
    state.devOverride = null;
    log('[dev] Every seasonal event forced closed. /dev season auto restores the calendar.');
    return true;
  }
  if (verb === 'auto') {
    state.devOverride = undefined;
    log(`[dev] Seasonal events follow the host calendar again (${state.hostEventId ?? 'none'}).`);
    return true;
  }
  if (verb === 'knocks') {
    const meta = ctx.players.get(pid);
    if (meta) {
      meta.seasonalKnocked.clear();
      meta.wireRev++;
    }
    log("[dev] Today's trick-or-treat knocks forgotten.");
    return true;
  }
  ctx.error(pid, USAGE);
  return true;
}
