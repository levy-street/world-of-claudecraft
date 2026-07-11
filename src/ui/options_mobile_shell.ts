// Thin DOM painter for the dedicated mobile settings shell (spec section 9 v1.1).
//
// Under body.mobile-touch the Esc menu abandons the desktop two-pane grid and
// presents as a full-screen BACK-STACK shell fed by the same view-model as the
// desktop rail. This painter owns only the shell CHROME: a per-level sticky
// header (Settings + close on the landing; a back chevron + title + close on a
// pushed page), the landing's stacked category list, and a sticky Done bar (the
// gamepad legend renders above it while a pad is connected). Every settings row
// body is delegated back to the OptionsWindow renderers through the injected deps
// (renderCategoryDetail / renderSystem / renderBugReport / the Overview pieces),
// so the row dispatch stays byte-identical to desktop. The navigation reducer,
// the env-gated category list, and the landing section order live in the pure
// options_mobile_shell_view core.
//
// Cold path (window open / level change), so createElement + innerHTML for the
// trusted svg glyphs is allowed; every visible label is a t() key and every
// category name comes from t(row.nameKey) (no player text is interpolated).
// Tokens only: the shell carries no literal color/size in TS (the .opt-mshell-*
// grammar lives in the extracted stylesheet).

import { formatNumber, t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import type { CategoryId } from './options_ia';
import {
  currentLevel,
  MOBILE_LANDING_ORDER,
  type MobileLevel,
  type MobileNavState,
  mobileCategoryRows,
} from './options_mobile_shell_view';
import type { RailEnv } from './options_view';
import { svgIcon } from './ui_icons';

/**
 * OptionsWindow-supplied glue. The shell renders no settings rows itself; it
 * reaches every body piece through these closures, which reuse the OptionsWindow
 * private renderers (so the dispatch is the shared, byte-identical path). The
 * changed-count / conflict callbacks feed the stacked category list, mirroring
 * how the desktop rail wires them.
 */
export interface MobileShellDeps {
  /** The render environment (touch:true on the mobile shell) for the category list. */
  env(): RailEnv;
  onClose(): void;
  /** Pop one level, or close at the landing (consults popClosesMenu). */
  onBack(): void;
  onSelectCategory(id: CategoryId): void;
  changedCount(id: CategoryId): number;
  hasConflict(id: CategoryId): boolean;
  /** Rail glyph HTML for a category icon slug (OptionsWindow owns the map). */
  categoryIconHtml(slug: string): string;
  /** The header title for the current pushed page (category / sub-view name). */
  headerTitle(): string;
  /** True while the global search field carries a query (results replace the list). */
  searchActive(): boolean;
  /** The persistent landing search field; `onInput` re-fills only the lower region
   *  (so the field keeps focus/caret while typing). */
  buildSearchField(onInput: () => void): HTMLElement;
  /** Reset every setting to its default (the grid's action tile). */
  onResetAll(): void;
  /** Log out / return to the title screen (the grid's action tile). */
  onLogout(): void;
  appendLandingAlerts(parent: HTMLElement): void;
  appendPins(parent: HTMLElement): void;
  appendStatus(parent: HTMLElement): void;
  appendSearchResults(parent: HTMLElement): void;
  /** Render the current category / sub-view body (renderCategoryDetail etc.). */
  appendContentBody(parent: HTMLElement): void;
  /** The controller legend strip, or null when no pad is connected. */
  buildLegend(): HTMLElement | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function closeButton(deps: MobileShellDeps): HTMLButtonElement {
  const btn = el('button', 'window-close opt-mshell-close');
  btn.type = 'button';
  // data-close: the focus trap's open-focus skips dismiss affordances and its
  // preferred-close flows target them (focus_manager focusFirst), so the shell's
  // own chrome must carry the marker the shared frame X does.
  btn.setAttribute('data-close', '');
  btn.setAttribute('aria-label', t('hud.options.returnToGame'));
  btn.innerHTML = svgIcon('close');
  btn.addEventListener('click', () => deps.onClose());
  return btn;
}

function backButton(deps: MobileShellDeps): HTMLButtonElement {
  const btn = el('button', 'window-close opt-mshell-back');
  btn.type = 'button';
  // A dismiss affordance like the close X: skipped by focus-first on open.
  btn.setAttribute('data-close', '');
  btn.setAttribute('aria-label', t('hud.options.back'));
  btn.innerHTML = svgIcon('prev');
  btn.addEventListener('click', () => deps.onBack());
  return btn;
}

/** The per-level sticky header: "Settings" + close on the landing; a back chevron
 *  + the pushed page title + close on a category / sub-view page. */
function buildHeader(level: MobileLevel, deps: MobileShellDeps): HTMLElement {
  const header = el('div', 'opt-mshell-header');
  const title = el('span', 'opt-mshell-title');
  if (level.kind === 'landing') {
    title.textContent = t('hud.options.gameMenu');
    header.append(title, closeButton(deps));
  } else {
    title.textContent = deps.headerTitle();
    header.append(backButton(deps), title, closeButton(deps));
  }
  return header;
}

/** One stacked category row: icon + label (+ muted subhead) + changed count +
 *  conflict dot + chevron; the whole row is the tap target that pushes the page. */
function categoryRow(
  row: ReturnType<typeof mobileCategoryRows>[number],
  deps: MobileShellDeps,
): HTMLButtonElement {
  const name = t(row.nameKey);
  const btn = el('button', 'opt-mshell-cat');
  btn.type = 'button';
  btn.setAttribute('aria-label', name);
  const icon = el('span', 'opt-mshell-cat-icon');
  icon.innerHTML = deps.categoryIconHtml(row.iconSlug);
  const text = el('span', 'opt-mshell-cat-text');
  const label = el('span', 'opt-mshell-cat-label');
  label.textContent = name;
  const sub = el('span', 'opt-mshell-cat-sub');
  sub.textContent = t(row.subheadKey);
  text.append(label, sub);
  btn.append(icon, text);
  if (row.hasConflict) {
    const dot = el('span', 'opt-tab-dot');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', t('hudChrome.options.conflictDot'));
    btn.appendChild(dot);
  }
  if (row.changedCount > 0) {
    const count = el('span', 'opt-tab-count');
    const n = formatNumber(row.changedCount, { maximumFractionDigits: 0 });
    count.textContent = n;
    count.setAttribute('aria-label', t('hudChrome.options.changed', { count: n }));
    btn.appendChild(count);
  }
  const chevron = el('span', 'opt-mshell-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = svgIcon('next');
  btn.appendChild(chevron);
  btn.addEventListener('click', () => deps.onSelectCategory(row.id));
  return btn;
}

/** A grid action tile (Reset to Defaults / Logout): the category-tile shape with
 *  the danger tint, so the two destructive actions live in the grid instead of a
 *  separate button row that crowded the landing. */
function actionTile(
  labelKey: TranslationKey,
  iconName: 'swap' | 'prev',
  onActivate: () => void,
): HTMLButtonElement {
  const label = t(labelKey);
  const btn = el('button', 'opt-mshell-cat is-danger');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  const icon = el('span', 'opt-mshell-cat-icon');
  icon.innerHTML = svgIcon(iconName);
  const text = el('span', 'opt-mshell-cat-text');
  const name = el('span', 'opt-mshell-cat-label');
  name.textContent = label;
  text.appendChild(name);
  btn.append(icon, text);
  btn.addEventListener('click', () => onActivate());
  return btn;
}

/** The landing's lower region (everything below the persistent search field):
 *  either the search results (when a query is live) or the category grid +
 *  alerts + pins + status, in the pinned order. */
function fillLandingLower(lower: HTMLElement, deps: MobileShellDeps): void {
  const searching = deps.searchActive();
  for (const section of MOBILE_LANDING_ORDER) {
    if (section === 'search') continue; // rendered above (persistent field)
    // While searching, the results view replaces every browse section but the
    // category-list slot (which hosts the results), so nothing else stacks under it.
    if (searching && section !== 'categoryList') continue;
    switch (section) {
      case 'alerts':
        deps.appendLandingAlerts(lower);
        break;
      case 'pins':
        deps.appendPins(lower);
        break;
      case 'categoryList':
        if (searching) {
          deps.appendSearchResults(lower);
        } else {
          // The settings front page: a 5-column card grid (icon over label), one
          // tile per env-visible category plus the Reset to Defaults and Logout
          // action tiles (10 tiles, 5 + 5). No Return-to-Game tile or Done bar:
          // the header X is the one close control.
          const grid = el('div', 'opt-mshell-grid');
          const rows = mobileCategoryRows(deps.env(), deps.changedCount, deps.hasConflict);
          for (const row of rows) grid.appendChild(categoryRow(row, deps));
          grid.appendChild(actionTile('hud.options.resetToDefaults', 'swap', deps.onResetAll));
          grid.appendChild(actionTile('hud.options.logout', 'prev', deps.onLogout));
          lower.appendChild(grid);
        }
        break;
      case 'status':
        deps.appendStatus(lower);
        break;
    }
  }
}

/** Build the level-0 landing body: the persistent global search field over a
 *  re-fillable lower region (so typing keeps the field focused). */
function buildLanding(deps: MobileShellDeps): HTMLElement {
  const content = el('div', 'opt-mshell-content');
  const lower = el('div', 'opt-mshell-lower');
  const refill = () => {
    lower.replaceChildren();
    fillLandingLower(lower, deps);
  };
  content.appendChild(deps.buildSearchField(refill));
  content.appendChild(lower);
  fillLandingLower(lower, deps);
  return content;
}

/**
 * Paint the mobile back-stack shell into `container` (which the caller clears).
 * Called on every full level change (open, category select, back); the landing's
 * search typing re-fills only its lower region in place, never this whole rebuild.
 */
export function renderMobileShell(
  container: HTMLElement,
  nav: MobileNavState,
  deps: MobileShellDeps,
): void {
  const level = currentLevel(nav);
  const shell = el('div', 'opt-mshell');
  shell.appendChild(buildHeader(level, deps));

  if (level.kind === 'landing') {
    shell.appendChild(buildLanding(deps));
  } else {
    const content = el('div', 'opt-mshell-content');
    deps.appendContentBody(content);
    shell.appendChild(content);
  }

  // Sticky bottom bar: ONLY the gamepad legend, and only while a pad is
  // connected. The Done button is gone (live feedback): the header X is the one
  // close control, so with no pad the shell has no bottom bar at all and the
  // content region keeps the full height.
  const legend = deps.buildLegend();
  if (legend) {
    const bar = el('div', 'opt-mshell-bar');
    bar.appendChild(legend);
    shell.appendChild(bar);
  }

  container.appendChild(shell);
}
