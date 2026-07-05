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

export interface LootRollReconcileState {
  // rollIds the server still lists this player as able to answer (the mirror).
  open: number[];
  // rollIds currently displayed locally.
  shown: number[];
  // rollIds answered or expired locally; suppressed so reconcile cannot re-show them.
  dismissed: number[];
  // shown rollIds already observed in a prior mirror (so their later absence is real).
  confirmed: number[];
}

export interface LootRollReconcileDecision {
  // open rolls not yet shown and not dismissed: show them now.
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
  const dismissedSet = new Set(state.dismissed);
  const confirmedSet = new Set(state.confirmed);

  const toShow = state.open.filter((id) => !shownSet.has(id) && !dismissedSet.has(id));
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
