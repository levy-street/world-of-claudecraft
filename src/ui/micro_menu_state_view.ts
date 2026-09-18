// The micro-menu rail's live state: which launcher's window is currently open (the
// gold ring the ui-icon-btn primitive paints on `.is-on` / `[aria-pressed="true"]`)
// and which launcher carries a count badge.
//
// Host-agnostic on purpose: the caller supplies the open-window predicate and the
// counts, so the whole decision is unit-testable without a DOM. The state object is
// allocated once and mutated in place (the pure-view idiom), so a repaint
// on the HUD's tick band allocates nothing.

/** One launcher and the window whose open state lights its ring. */
export interface MicroMenuLauncherSpec {
  readonly selector: string;
  readonly windowId: string;
}

/**
 * Every micro-menu launcher that OPENS A WINDOW, paired with that window's element
 * id. The ring means exactly one thing, "this button's window is open", which is why
 * the rail's other buttons are deliberately absent: `#mm-music` toggles audio and
 * keeps its own `mm-on` gold, `#mm-emote` opens the emote wheel (not a `.window`),
 * and `#mm-wiki` / `#mm-discord` leave the game entirely.
 */
export const MICRO_MENU_LAUNCHERS: readonly MicroMenuLauncherSpec[] = [
  { selector: '#mm-char', windowId: 'char-window' },
  { selector: '#mm-spell', windowId: 'spellbook' },
  { selector: '#mm-talents', windowId: 'talents-window' },
  { selector: '#mm-town-focus', windowId: 'town-focus-window' },
  { selector: '#mm-quest', windowId: 'quest-log-window' },
  { selector: '#mm-deeds', windowId: 'deeds-window' },
  { selector: '#mm-reliquary', windowId: 'reliquary-window' },
  { selector: '#mm-loot-explorer', windowId: 'loot-explorer-window' },
  { selector: '#mm-cosmetics', windowId: 'cosmetics-window' },
  { selector: '#mm-professions', windowId: 'professions-window' },
  { selector: '#mm-harvest-journal', windowId: 'harvest-journal-window' },
  // The one launcher whose window ships in no markup entry: the Perfecting
  // painter mints #perfecting-window on first open (still a .window.panel, so
  // Hud's window observer stamps data-window-open on it like any other).
  { selector: '#mm-perfecting', windowId: 'perfecting-window' },
  { selector: '#mm-map', windowId: 'map-window' },
  { selector: '#mm-bag', windowId: 'bags' },
  { selector: '#mm-crafting', windowId: 'crafting-window' },
  { selector: '#mm-arena', windowId: 'arena-window' },
  { selector: '#mm-dfinder', windowId: 'dungeon-finder-window' },
  { selector: '#mm-cardduel', windowId: 'card-duel-window' },
  { selector: '#mm-leaderboard', windowId: 'leaderboard-window' },
  { selector: '#mm-wocmarket', windowId: 'woc-market-window' },
  { selector: '#mm-social', windowId: 'social-window' },
  { selector: '#mm-options', windowId: 'options-menu' },
];

/** Which count a badge shows. One member per shipped badge. */
export type MicroMenuBadgeKind = 'talentPoints';

/** One launcher that carries a corner count badge. */
export interface MicroMenuBadgeSpec {
  readonly selector: string;
  readonly kind: MicroMenuBadgeKind;
}

/** The launchers that carry a count badge, in rail order. */
export const MICRO_MENU_BADGES: readonly MicroMenuBadgeSpec[] = [
  { selector: '#mm-talents', kind: 'talentPoints' },
];

/** The live counts behind the badges above. */
export type MicroMenuBadgeCounts = Record<MicroMenuBadgeKind, number>;

/** One launcher's ring state. */
export interface MicroMenuLauncherState {
  selector: string;
  on: boolean;
}

/** One launcher's badge state. A count at or below zero renders empty text, which
 *  is what hides the badge: `.mm-badge:empty` is display:none, so the painter needs
 *  exactly one write per badge and the elision cache stays uncontended. */
export interface MicroMenuBadgeState {
  selector: string;
  count: number;
  text: string;
  visible: boolean;
}

export interface MicroMenuState {
  launchers: readonly MicroMenuLauncherState[];
  badges: readonly MicroMenuBadgeState[];
}

export interface MicroMenuStateView {
  tick(isWindowOpen: (windowId: string) => boolean, counts: MicroMenuBadgeCounts): MicroMenuState;
}

/**
 * Build the rail's state view. `formatCount` localizes a badge value (the HUD passes
 * `formatNumber`). It runs on every tick rather than behind a value memo on purpose:
 * the formatting is locale-dependent, so a memo would freeze the rendered digits
 * across a language switch. The painter's elided setText is what keeps the DOM
 * untouched when the resulting text is unchanged.
 */
export function createMicroMenuStateView(
  formatCount: (value: number) => string,
): MicroMenuStateView {
  const launchers: MicroMenuLauncherState[] = MICRO_MENU_LAUNCHERS.map((spec) => ({
    selector: spec.selector,
    on: false,
  }));
  const badges: MicroMenuBadgeState[] = MICRO_MENU_BADGES.map((spec) => ({
    selector: spec.selector,
    count: 0,
    text: '',
    visible: false,
  }));
  const state: MicroMenuState = { launchers, badges };

  return {
    tick(isWindowOpen, counts) {
      for (let i = 0; i < launchers.length; i++) {
        launchers[i].on = isWindowOpen(MICRO_MENU_LAUNCHERS[i].windowId);
      }
      for (let i = 0; i < badges.length; i++) {
        const badge = badges[i];
        const count = Math.max(0, Math.floor(counts[MICRO_MENU_BADGES[i].kind]));
        badge.count = count;
        badge.visible = count > 0;
        badge.text = badge.visible ? formatCount(count) : '';
      }
      return state;
    },
  };
}
