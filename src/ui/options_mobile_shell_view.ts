// Pure, host-agnostic view-model for the dedicated mobile settings shell.
//
// Under body.mobile-touch the Esc menu abandons the desktop two-pane grid and
// presents as a full-screen BACK-STACK shell (spec section 9, v1.1): a level-0
// landing (Overview quick actions + pinned mirrors + a stacked category list),
// level-1 category pages pushed full-screen, and level-2 sub-views (the bug
// report). This module owns the DECLARATIVE navigation model the painter drives:
// the back-stack reducer (push/pop, level-0 pop closes), the env-gated category
// list, the landing section order, and the level -> (category, sub-view) mapping
// the shared desktop body renderers read. The DOM, i18n runtime, and the row
// dispatch all live in options_mobile_shell.ts + options_window.ts.
//
// DOM/Three/i18n-runtime-free: it reuses the pure options_view.renderRailModel
// (which consumes the options_ia tree) and the options_ia CategoryId type, so
// the mobile category list can never drift from the desktop rail. Registered in
// tests/architecture.test.ts UI_PURE_CORES (the *_view sweep would fail on a
// missing registration).

import type { TranslationKey } from './i18n.catalog';
import type { CategoryId } from './options_ia';
import { type RailEnv, renderRailModel } from './options_view';

// ---------------------------------------------------------------------------
// Back-stack levels + navigation state
// ---------------------------------------------------------------------------

/** The one sub-view kind the mobile shell pushes to level 2. The keybind-capture
 *  sub-view of the desktop spec never applies on touch (the Keybinds category is
 *  env-hidden on mobile), so bug report is the only level-2 page. */
export type MobileSubView = 'bugreport';

/** One back-stack level. `stack[0]` is ALWAYS the landing; a category pushes a
 *  level-1 page and a sub-view pushes a level-2 page over its parent category. */
export type MobileLevel =
  | { readonly kind: 'landing' }
  | { readonly kind: 'category'; readonly id: CategoryId }
  | { readonly kind: 'subview'; readonly view: MobileSubView; readonly parent: CategoryId };

export interface MobileNavState {
  /** Never empty; `stack[0]` is always the landing level. */
  readonly stack: readonly MobileLevel[];
}

/** The immutable landing level (level 0). */
export const LANDING_LEVEL: MobileLevel = { kind: 'landing' };

/** A fresh nav state rooted at the landing (the menu always opens here). */
export function initialNav(): MobileNavState {
  return { stack: [LANDING_LEVEL] };
}

/** The level currently on top of the stack (falls back to the landing). */
export function currentLevel(nav: MobileNavState): MobileLevel {
  return nav.stack[nav.stack.length - 1] ?? LANDING_LEVEL;
}

/** The back-stack depth: 0 at the landing, 1 at a category page, 2 at a sub-view. */
export function depth(nav: MobileNavState): number {
  return Math.max(0, nav.stack.length - 1);
}

/** True at the landing (level 0), where a back/pop request closes the menu. */
export function atRoot(nav: MobileNavState): boolean {
  return nav.stack.length <= 1;
}

/** Push a level onto the stack (returns a NEW state; the input is untouched). */
export function pushLevel(nav: MobileNavState, level: MobileLevel): MobileNavState {
  return { stack: [...nav.stack, level] };
}

/** Open a category as its level-1 page. Selecting a category is always a single
 *  level-1 page regardless of the prior depth (a rail tap never stacks pages), so
 *  this resets to [landing, category] rather than pushing onto a deeper stack. */
export function openCategory(_nav: MobileNavState, id: CategoryId): MobileNavState {
  return { stack: [LANDING_LEVEL, { kind: 'category', id }] };
}

/** Push a sub-view (bug report) over its parent category as a level-2 page. */
export function openSubView(
  _nav: MobileNavState,
  view: MobileSubView,
  parent: CategoryId,
): MobileNavState {
  return {
    stack: [LANDING_LEVEL, { kind: 'category', id: parent }, { kind: 'subview', view, parent }],
  };
}

/** Pop one level. At the landing it is a no-op (the caller closes the menu; see
 *  popClosesMenu), so the stack is never emptied below the landing. */
export function popLevel(nav: MobileNavState): MobileNavState {
  if (nav.stack.length <= 1) return nav;
  return { stack: nav.stack.slice(0, -1) };
}

/** True when a back/pop request at the current level should CLOSE the menu (only
 *  at the landing). Controller B and the on-screen back chevron both consult this
 *  so level-0 pop closes and any deeper pop steps back one page. */
export function popClosesMenu(nav: MobileNavState): boolean {
  return atRoot(nav);
}

/** Map the current level to the (activeCategory, subView) pair the shared desktop
 *  body renderers read, so the mobile shell reuses renderCategoryDetail /
 *  renderSystem / renderBugReport verbatim (byte-identical dispatch). */
export function levelSelection(level: MobileLevel): {
  category: CategoryId;
  subView: 'none' | MobileSubView;
} {
  if (level.kind === 'landing') return { category: 'overview', subView: 'none' };
  if (level.kind === 'category') return { category: level.id, subView: 'none' };
  return { category: level.parent, subView: level.view };
}

/** Rebuild a back-stack nav from a desktop (activeCategory, subView) selection,
 *  the inverse of levelSelection over every representable back-stack shape. A live
 *  wide->narrow switch reads the desktop selection (the two-pane's source of
 *  truth) and re-seeds the shell's stack from it, so the visible page survives the
 *  layout change. Lossless because openCategory / openSubView / initialNav only
 *  ever produce the three canonical stack shapes this reconstructs. */
export function navForSelection(
  category: CategoryId,
  subView: 'none' | MobileSubView,
): MobileNavState {
  if (subView !== 'none') return openSubView(initialNav(), subView, category);
  if (category === 'overview') return initialNav();
  return openCategory(initialNav(), category);
}

// ---------------------------------------------------------------------------
// Render mode: the touch settings menu picks its layout by viewport width
// ---------------------------------------------------------------------------

/** The touch settings layout. Only the back-stack shell remains: a grid landing
 *  (the settings "front page") that pushes full-screen category pages. The old
 *  desktop-style rail two-pane was retired on touch (it rendered a cramped,
 *  duplicated-header layout in landscape); the game is landscape-only on mobile,
 *  so the single shell now serves every touch width. Kept as a one-value union so
 *  the render-mode branch and its tests read intentionally, not as a bare string. */
export type MobileSettingsMode = 'backstack';

/** The touch settings layout, for every mobile width (see MobileSettingsMode).
 *  Pure so the render-mode branch is unit-tested directly and a live rotate can
 *  re-evaluate it without a DOM. Takes the width for call-site symmetry with the
 *  desktop/rail selection it replaced, though the shell no longer varies by it. */
export function mobileSettingsMode(_viewportWidth: number): MobileSettingsMode {
  return 'backstack';
}

// ---------------------------------------------------------------------------
// The env-gated stacked category list (the landing's navigation)
// ---------------------------------------------------------------------------

/** One stacked category row on the landing (icon + label + changed count +
 *  conflict dot + chevron). Overview is EXCLUDED (it IS the landing). */
export interface MobileCategoryRow {
  id: CategoryId;
  iconSlug: string;
  nameKey: TranslationKey;
  subheadKey: TranslationKey;
  changedCount: number;
  hasConflict: boolean;
}

/** The mobile category list: the desktop rail model flattened into a single
 *  stacked list (Overview dropped, since it is the landing), env-gated so the
 *  desktop-only Keybinds category never appears on touch and the touch-only Touch
 *  category does. `changedCount` / `hasConflict` are supplied by the painter (live
 *  settings + the keybind aggregate), exactly as the desktop rail wires them. */
export function mobileCategoryRows(
  env: RailEnv,
  changedCount: (id: CategoryId) => number,
  hasConflict: (id: CategoryId) => boolean,
): MobileCategoryRow[] {
  const rail = renderRailModel(env, changedCount);
  const rows: MobileCategoryRow[] = [];
  for (const group of rail.groups) {
    for (const tab of group.tabs) {
      rows.push({
        id: tab.id,
        iconSlug: tab.iconSlug,
        nameKey: tab.nameKey,
        subheadKey: tab.subheadKey,
        changedCount: tab.changedCount,
        hasConflict: hasConflict(tab.id),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Landing section order
// ---------------------------------------------------------------------------

/** The mobile landing's section slots, in render order. */
export type LandingSection = 'search' | 'alerts' | 'pins' | 'categoryList' | 'status';

/** The landing section order: the global search field directly beneath the
 *  header, then the category GRID (the settings front page: the primary content a
 *  player scans first, matching the reference mock; Reset to Defaults and Logout
 *  ride the grid as action tiles, so there is no separate quick-action button
 *  row), then the alert rows, pinned-essentials mirrors, and the status readout.
 *  While a search query is live the grid slot hosts the results instead. */
export const MOBILE_LANDING_ORDER: readonly LandingSection[] = [
  'search',
  'categoryList',
  'alerts',
  'pins',
  'status',
];
