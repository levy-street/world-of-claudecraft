// Pure, DOM-free decision logic for reconciling the locally shown loot-roll
// prompts against the server's authoritative open-roll list (the `lroll` self
// snapshot mirror). Lifted out of hud.ts so the three-way decision (open vs
// shown vs dismissed -> show / retire / prune) is unit-testable without a DOM,
// following the repo's pure-core + thin-consumer pattern (see unit_portrait.ts).
//
// Why a "confirmed" set is needed for retirement:
//   A `lootRoll` SimEvent shows a prompt a frame or two BEFORE that roll lands
//   in the mirror, so "retire any shown roll absent from the mirror" would race
//   and instantly kill a just-shown prompt. We instead only retire a roll once
//   it has been mirror-confirmed (observed in the open list at least once); a
//   roll that was only ever shown from the transient event and never reached the
//   mirror is left to the resolution event / local timeout, exactly as before.
//
// Why a re-show grace is needed:
//   Answering a roll is a local intent: the prompt is removed and the command
//   sent, but the authoritative self mirror keeps listing the roll open until the
//   server records the choice (one round trip, longer on a mobile network).
//   Re-showing any still-open roll immediately would flash the just-answered
//   prompt back with live buttons every frame until the mirror caught up. So a
//   dismissed roll is only re-shown once it has stayed open past a short grace
//   (LOOT_ROLL_REGRACE_MS): a normal answer clears the mirror well within the
//   window and never re-appears, while a genuinely dropped submit (still open
//   after the window) still restores its retryable buttons.

// Grace before a locally dismissed roll (answered or expired) may be re-shown
// from the still-open mirror. Chosen a touch above a typical mobile round trip.
export const LOOT_ROLL_REGRACE_MS = 2000;

export interface LootRollReconcileState {
  // rollIds the server still lists this player as able to answer (the mirror).
  open: number[];
  // rollIds currently displayed locally.
  shown: number[];
  // rollIds answered or expired locally. Retained until the server drops them,
  // but never allowed to override an authoritative still-open mirror entry, and
  // held back from an immediate re-show by the grace above.
  dismissed: number[];
  // shown rollIds already observed in a prior mirror (so their later absence is real).
  confirmed: number[];
  // wall-clock ms (same clock as `nowMs`) at which each dismissed roll was
  // answered or expired locally. A missing entry is treated as past-grace, so
  // omitting this (as the pure unit tests do) preserves the immediate-recover
  // behavior; the live HUD always supplies it to get the flash-free grace.
  dismissedAt?: Record<number, number>;
  // current wall-clock ms; when omitted the grace is treated as already elapsed.
  nowMs?: number;
}

export interface LootRollReconcileDecision {
  // open rolls not yet shown: show them now, even if a local tap previously
  // dismissed them. The server mirror is authoritative and a dropped command
  // must restore retryable buttons.
  toShow: number[];
  // mirror-confirmed shown rolls the server has since dropped: retire them.
  toRetire: number[];
  // dismissed rolls the server has dropped: stop suppressing (forget them).
  toPrune: number[];
  // the next "confirmed" set to persist: current open rolls plus still-relevant
  // prior confirmations, minus anything just retired.
  confirmed: number[];
}

export function reconcileLootRolls(state: LootRollReconcileState): LootRollReconcileDecision {
  const openSet = new Set(state.open);
  const shownSet = new Set(state.shown);
  const confirmedSet = new Set(state.confirmed);
  const dismissedSet = new Set(state.dismissed);
  const dismissedAt = state.dismissedAt ?? {};
  const { nowMs } = state;

  const toShow = state.open.filter((id) => {
    if (shownSet.has(id)) return false;
    if (!dismissedSet.has(id)) return true;
    // A locally dismissed roll the server still lists open: re-show it only once
    // it has stayed open past the grace, so a normal answer (the mirror drops it
    // within a round trip) never re-flashes but a dropped submit still recovers.
    const at = dismissedAt[id];
    if (at === undefined || nowMs === undefined) return true; // unknown timing: recover
    return nowMs - at >= LOOT_ROLL_REGRACE_MS;
  });
  // Only retire rolls we have positively seen in the mirror before: this is the
  // guard against the event-before-mirror race described above.
  const toRetire = state.shown.filter((id) => confirmedSet.has(id) && !openSet.has(id));
  const toPrune = state.dismissed.filter((id) => !openSet.has(id));

  const retireSet = new Set(toRetire);
  // Carry forward confirmations for rolls still in play (currently open, or
  // shown and not just retired); newly open rolls become confirmed for next tick.
  const next = new Set<number>();
  for (const id of state.open) next.add(id);
  for (const id of confirmedSet) {
    if (!retireSet.has(id) && (shownSet.has(id) || openSet.has(id))) next.add(id);
  }
  for (const id of retireSet) next.delete(id);

  return { toShow, toRetire, toPrune, confirmed: [...next] };
}
