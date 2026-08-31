// The interact affordance for the one ambiguous farming press: a placed feast
// and a garden bed both in reach. It names which of the two the press takes
// (the feast, ruling 11b-R3c-1) and what the bed would have done, so a player
// who walked to their crop and found a feast dropped on top of it can predict
// the outcome instead of discovering it by eating.
//
// WHY THIS IS A *_controller.ts AND NOT A *_painter.ts. The painter gate
// (tests/hud_perf_budget.test.ts) sorts every `*_painter.ts` into HOT_PAINTERS
// or CANVAS_PAINTERS, and HOT membership brings the full per-frame write
// contract plus a buildHarnesses block in that suite. This surface changes
// state only when the player walks in or out of a dual-reach spot, so it is
// COLD by cadence and by contract: it holds the cold rules (no forced-reflow
// layout read, no repeating driver of its own, zero allowances) and the
// `*_controller.ts` suffix is what the gate sweeps to hold it to them. Do not
// rename this to `*_painter.ts` for symmetry with the sibling painters: that
// would silently take on a HOT obligation this module does not need and does
// not meet.
//
// WHY THERE IS NO SIGNATURE MEMO AND NO relocalize(). Of the two elision
// idioms in src/ui/CLAUDE.md this deliberately takes the FIRST: every write
// goes through the PainterHost facet, which compares the RESOLVED value it is
// about to write, so an unchanged poll writes nothing and a LANGUAGE SWITCH
// moves the comparison by itself. A `lastTarget`-style repaint signature would
// digest the DATA instead, which a locale change cannot move, and would then
// owe a `relocalize()` plus its arm in Hud.refreshLocalizedDynamicUi; the
// surface is one short line, so the memo would buy nothing and cost a fan-out
// obligation. The only per-poll cost this shape carries is re-resolving the
// sentence through `deps.text`, a single catalog lookup, and only while the
// ambiguity is actually on screen.
//
// The COPY is injected rather than resolved here (`deps.text`), which keeps the
// module free of a catalog dependency of its own: it unit-tests without the
// i18n bootstrap, and the one t() call site sits with the rest of the HUD's key
// spelling. The keys it is wired to are
// `hudChrome.farming.pressTarget.feastOverHarvest` and `...feastOverPlant`.
//
// The module reaches no browser global (every DOM touch rides `deps.root()`,
// the farming_plant_sheet_window shape), so it needs no UI_DOM_MODULES row.

import type { FarmPressTarget } from '../../../game/farm_press_target_core';
import type { PainterHostWriters } from '../../painter_host';

/** The class that reveals the notice (`#interact-affordance.is-shown` in
 *  hud.css). Exported so the stylesheet pin and the painter cannot drift. */
export const FARM_PRESS_AFFORDANCE_SHOWN_CLASS = 'is-shown';

export interface FarmPressAffordanceDeps {
  /** The notice element (`#interact-affordance`). Null on a document that does
   *  not carry it, which the controller treats as "nothing to paint" rather
   *  than an error: the HUD boots against two entry documents. */
  root(): HTMLElement | null;
  /** Hud's shared write-elision facet. Narrowed to the two writers this uses so
   *  the dependency says exactly what the module touches. */
  writers: Pick<PainterHostWriters, 'setText' | 'toggleClass'>;
  /** The localized one-line notice for a resolved press target. */
  text(target: FarmPressTarget): string;
}

export class FarmPressAffordanceController {
  constructor(private readonly deps: FarmPressAffordanceDeps) {}

  /** Paint the resolved ambiguity, or hide the notice when there is none.
   *  Safe to call on every poll: both writes elide when nothing changed.
   *
   *  Visibility rides `toggleClass` rather than `setDisplay` because the
   *  facet's four single-slot writers share ONE (kind, value) cache entry per
   *  element: writing text AND display to this same node would flip that entry
   *  on every poll and elide nothing at all. The class cache is keyed per
   *  (element, class), so the two writes here elide independently. */
  paint(target: FarmPressTarget | null): void {
    const el = this.deps.root();
    if (!el) return;
    // Text first, so the notice is already carrying its sentence in the same
    // poll that reveals it; while hidden the copy is not resolved at all.
    if (target !== null) this.deps.writers.setText(el, this.deps.text(target));
    this.deps.writers.toggleClass(el, FARM_PRESS_AFFORDANCE_SHOWN_CLASS, target !== null);
  }
}
