// Away-status transitions (/afk, /dnd), factored out so the meta<->entity sync
// has ONE source of truth. `PlayerMeta.away` is the authoritative presence
// state (it carries the mode and the auto-reply message); `Entity.afk` is a
// display mirror that rides the wire (`ak`) so other clients can tag the
// nameplate and color the social presence dot. Keeping both in step here means
// no call site can set one without the other and drift.
//
// Host-agnostic: no DOM/Three/i18n. Runs identically offline, on the server,
// and in the headless env. Consumers: src/sim/social/chat.ts (the /afk + /dnd
// command arms and the clear-on-chat path) and src/sim/sim.ts (clear-on-move).

import type { AwayStatus, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** Set (or clear, with `null`) a player's away status, mirroring the `afk`
 *  display bit onto the entity. `afk` is true only for the `afk` mode, never
 *  for `dnd`, so a Do Not Disturb player carries no public nameplate tag. */
export function setAwayState(e: Entity, meta: PlayerMeta, away: AwayStatus | null): void {
  meta.away = away;
  e.afk = away?.mode === 'afk';
}

/** Classic behavior: moving under your own input clears an AFK flag (Do Not
 *  Disturb is deliberate and survives movement). Emits the same "no longer
 *  Away From Keyboard" notice as toggling /afk off; a no-op unless the player
 *  is currently AFK, so it is safe to call every movement tick. */
export function clearAfkOnMove(ctx: SimContext, meta: PlayerMeta, e: Entity): void {
  if (meta.away?.mode !== 'afk') return;
  setAwayState(e, meta, null);
  ctx.emit({
    type: 'log',
    text: 'You are no longer Away From Keyboard.',
    color: '#ffd100',
    pid: meta.entityId,
  });
}
