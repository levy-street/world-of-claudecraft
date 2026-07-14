// Pure, host-agnostic renderer for the character window's OVERVIEW tab
// "Milestones" block (Phase 5, docs/char-equipment/). It renders ONLY the
// content the Equipment tab's Progression panel (char_panels_view.ts
// buildProgressionPanel) does NOT show: unlocked milestone badges, plus, at
// the level cap, the opt-in Prestige action. Total XP / Virtual Level /
// Prestige Rank are DELIBERATELY absent here (they live on the Equipment tab),
// so the same progression data is never shown twice across the two tabs.
//
// DOM-free and i18n-free: the caller (hud.ts progressionHtml) resolves every
// player-visible string (the heading, the milestone names, the none-state
// copy, the prestige action label + hint) and passes them in, so this module
// only assembles a plain HTML string from already-localized text. That keeps
// the trim decision (which rows exist, which heading key) testable directly in
// tests/milestones_overview_view.test.ts against the empty / populated / at-cap
// / eligible states, instead of only through stubs.

/** One unlocked milestone badge: its already-localized name plus the kind that
 *  drives the `.ms-<kind>` CSS variant (mirrors `MilestoneDef.kind` in
 *  src/sim/types.ts: 'title' | 'border'). */
export interface MilestoneBadge {
  kind: string;
  name: string;
}

/** The at-cap Prestige action row. Present only when the player is at the
 *  level cap; below the cap the caller passes `null` and no row renders. */
export interface PrestigeAction {
  /** Disabled + hinted until the server's post-cap XP gate is met. The server
   *  re-checks authoritatively regardless, so a forged click does nothing. */
  ready: boolean;
  /** The Prestige button label, already carrying any "(star N)" rank suffix. */
  actionText: string;
  /** The "N more lifetime XP to prestige" requirement line, or null when the
   *  player is already eligible (button enabled, no hint shown). */
  hint: string | null;
}

export interface MilestonesOverviewModel {
  /** Section heading, resolved from `game.progression.milestones`
   *  ("Milestones"), NOT `game.progression.heading` ("Progression"): the
   *  Equipment tab already owns the "Progression" panel, so a distinct heading
   *  keeps the two tabs from stamping the same title over different content. */
  headingText: string;
  /** Unlocked milestones in display order; empty renders the none-state copy. */
  badges: readonly MilestoneBadge[];
  /** The "None yet" copy, resolved from `game.progression.none`. */
  noneText: string;
  /** The Prestige action row, or null below the level cap. */
  prestige: PrestigeAction | null;
}

/** Assemble the OVERVIEW tab's Milestones block HTML from a fully-resolved
 *  model. The class grammar (`.char-progression` / `.cp-title` /
 *  `.cp-milestones` / `.ms-badge` / `.cp-actions` / `.cp-hint`) matches the
 *  pre-Phase-2 sheet's styling verbatim, so no CSS changed when this rendering
 *  moved out of hud.ts. Milestone names and the prestige texts are trusted
 *  localized strings (t() output), never user input, so no escaping is applied
 *  (matching the pre-Phase-2 progressionHtml exactly). */
export function renderMilestonesOverview(model: MilestonesOverviewModel): string {
  const badges = model.badges
    .map((b) => `<span class="ms-badge ms-${b.kind}">${b.name}</span>`)
    .join('');
  let html = `<div class="cp-title">${model.headingText}</div>`;
  html += `<div class="cp-milestones">${badges || `<span class="cp-none">${model.noneText}</span>`}</div>`;
  const { prestige } = model;
  if (prestige) {
    html += `<div class="cp-actions"><button class="btn" data-act="prestige"${prestige.ready ? '' : ' disabled'}>${prestige.actionText}</button>`;
    if (prestige.hint) html += `<span class="cp-hint">${prestige.hint}</span>`;
    html += `</div>`;
  }
  return `<div class="char-progression">${html}</div>`;
}
