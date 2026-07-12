// Thin, cold-path DOM builder for the shared window frame.
//
// The consumer half of the pure-core + thin-consumer split: it paints a
// window's chrome (titlebar, tab rail, body region, footer action row) from the
// structured WindowFrameModel (window_frame_view.ts) and wires the close /
// tab-change callbacks. It owns no state and never imports Hud; a window module
// calls it to stamp the shared anatomy, then fills the returned body element
// with its own content.
//
// Cold path (window open / rebuild), so innerHTML is allowed; every interpolated
// string passes through esc(), and every visible label / accessible name is a
// t() key carried on the model. Callbacks arrive through the injected deps.

import { esc } from './esc';
import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import { svgIcon } from './ui_icons';
import { buildWindowFrameModel, type WindowFrameDescriptor } from './window_frame_view';

/** Hud-supplied callbacks. Both optional: a non-closable or tab-less window omits the one it does not need. */
export interface WindowFrameDeps {
  /** Fired when the close control is activated. */
  onClose?: () => void;
  /** Fired with the tab id fragment when a tab is activated. */
  onTabChange?: (tabId: string) => void;
}

/** The live nodes the caller fills after the chrome is stamped. */
export interface WindowFrameParts {
  root: HTMLElement;
  /** The scrollable content region (`.window-body`). */
  body: HTMLElement;
  /** The sticky footer action row, or null when the window has no footer. */
  footer: HTMLElement | null;
  /** The tab buttons in descriptor order (empty when the window has no tabs). */
  tabButtons: HTMLButtonElement[];
}

/**
 * Stamp the shared window chrome onto `el` and wire its callbacks.
 *
 * Sets the dialog role / aria-labelledby on the root, builds the titlebar (with
 * an optional close control), the optional tab rail, an empty body region, and
 * an optional footer, then returns the body / footer / tab nodes so the caller
 * paints its own content into them.
 */
export function renderWindowFrame(
  el: HTMLElement,
  descriptor: WindowFrameDescriptor,
  deps: WindowFrameDeps = {},
  activeTabId?: string,
): WindowFrameParts {
  const model = buildWindowFrameModel(descriptor, activeTabId);

  el.classList.add(model.className);
  el.setAttribute('role', model.role);
  el.setAttribute('aria-labelledby', model.labelledBy);
  if (model.ariaModal) el.setAttribute('aria-modal', 'true');

  // The chrome carries its i18n KEYS as data attributes (data-title-key /
  // data-label-key) so relocalizeWindowFrame below can re-resolve the stamped
  // text after a live language switch: the reuse paths (ensureWindowFrame and
  // the per-window ensureFrame copies) never re-run this builder, so without
  // the re-stamp the chrome would keep the open-time language for the session.
  const closeHtml = model.close
    ? `<button type="button" class="${model.close.className}" id="${esc(model.close.id)}" data-window-close data-label-key="${esc(model.close.labelKey)}" aria-label="${esc(t(model.close.labelKey))}">${svgIcon('close')}</button>`
    : '';
  const titlebar =
    `<div class="${model.titlebarClassName}">` +
    `<span class="${model.titleClassName}" id="${esc(model.titleId)}" data-title-key="${esc(model.titleKey)}">${esc(t(model.titleKey))}</span>` +
    `${closeHtml}</div>`;

  let tabRail = '';
  if (model.tablist) {
    // Only the SELECTED tab paints aria-controls: the body is the one tabpanel
    // node and it carries the active tab's panel id, so an unselected tab's
    // derived panel id resolves to nothing (a dangling idref, an axe failure).
    // Every tab carries its derived panel id as data-panel-id so the tab-change
    // paths (the click handler below, and a Hud-driven applyActiveWindowTab)
    // can move aria-controls and re-point the body.
    const tabs = model.tablist.tabs
      .map(
        (tab) =>
          `<button type="button" class="tab" role="tab" id="${esc(tab.tabId)}" ` +
          `data-window-tab="${esc(tab.key)}" data-panel-id="${esc(tab.panelId)}" ` +
          `data-label-key="${esc(tab.labelKey)}" ` +
          `${tab.selected ? `aria-controls="${esc(tab.panelId)}" ` : ''}` +
          `aria-selected="${tab.selected}" tabindex="${tab.tabIndex}">` +
          `${esc(t(tab.labelKey))}</button>`,
      )
      .join('');
    tabRail =
      `<div class="${model.tablist.className}" role="tablist" ` +
      `aria-labelledby="${esc(model.tablist.labelledBy)}" id="${esc(model.tablist.id)}">${tabs}</div>`;
  }

  // With tabs, the body IS the tabpanel: it carries role="tabpanel", the ACTIVE
  // tab's panel id (the model derives it) so the selected tab's aria-controls
  // points at a real node, and aria-labelledby naming it by its tab.
  const bodyRole = model.bodyRole ? ` role="${model.bodyRole}"` : '';
  const bodyLabelledBy = model.bodyLabelledBy
    ? ` aria-labelledby="${esc(model.bodyLabelledBy)}"`
    : '';
  const body = `<div class="${model.bodyClassName}"${bodyRole}${bodyLabelledBy} id="${esc(model.bodyId)}"></div>`;
  const footer = model.footer
    ? `<div class="${model.footer.className}" id="${esc(model.footer.id)}"></div>`
    : '';

  el.innerHTML = `${titlebar}${tabRail}${body}${footer}`;

  el.querySelector('[data-window-close]')?.addEventListener('click', () => deps.onClose?.());
  const bodyEl = el.querySelector<HTMLElement>('.window-body') as HTMLElement;
  const tabButtons = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-window-tab]'));
  for (const btn of tabButtons) {
    btn.addEventListener('click', () => {
      // Re-point the aria state before notifying the consumer, so the selected
      // tab's aria-controls always names the live body node even if the
      // consumer only repaints the body contents. This listener is attached at
      // build time, so it runs before any consumer-attached tab handler.
      applyActiveWindowTab(tabButtons, bodyEl, btn.dataset.windowTab ?? '');
      deps.onTabChange?.(btn.dataset.windowTab ?? '');
    });
  }

  return {
    root: el,
    body: bodyEl,
    footer: el.querySelector<HTMLElement>('.window-footer'),
    tabButtons,
  };
}

/**
 * Force the tab rail + body to reflect the tab named by `activeKey` (the
 * descriptor tab id fragment): aria-selected + the roving tabindex on every
 * tab, aria-controls ONLY on the selected tab, and the body's tabpanel id +
 * aria-labelledby re-pointed to it. The frame's own click handler routes
 * through this; a consumer whose active tab is Hud-held calls it on repaint to
 * re-affirm the state against a reused frame. Cold path, idempotent.
 */
export function applyActiveWindowTab(
  tabButtons: readonly HTMLButtonElement[],
  body: HTMLElement,
  activeKey: string,
): void {
  for (const btn of tabButtons) {
    const selected = btn.dataset.windowTab === activeKey;
    btn.setAttribute('aria-selected', String(selected));
    btn.tabIndex = selected ? 0 : -1;
    if (!selected) {
      btn.removeAttribute('aria-controls');
      continue;
    }
    const panelId = btn.dataset.panelId;
    if (panelId) {
      btn.setAttribute('aria-controls', panelId);
      body.id = panelId;
    }
    body.setAttribute('aria-labelledby', btn.id);
  }
}

/**
 * Re-resolve the frame chrome's stamped t() text (title, tab labels, the close
 * control's aria-label) from the key data attributes the builder painted, for
 * a live language switch: every ensureFrame reuse path returns the cached
 * chrome without re-running the builder, so without this the chrome would keep
 * the open-time language for the session (including across close/reopen).
 * A window that interpolates its title (vendor, quest log, ...) re-stamps the
 * title in its own render, which the Hud fan-out runs after this. Cold path.
 */
export function relocalizeWindowFrame(frame: HTMLElement): void {
  const title = frame.querySelector<HTMLElement>('.window-title');
  const titleKey = title?.dataset.titleKey;
  if (title && titleKey) setChromeText(title, t(titleKey as TranslationKey));
  const close = frame.querySelector<HTMLElement>('[data-window-close]');
  const closeKey = close?.dataset.labelKey;
  if (close && closeKey) close.setAttribute('aria-label', t(closeKey as TranslationKey));
  for (const tab of frame.querySelectorAll<HTMLElement>('[data-window-tab]')) {
    const labelKey = tab.dataset.labelKey;
    if (labelKey) setChromeText(tab, t(labelKey as TranslationKey));
  }
}

/**
 * Replace only the leading text node of a chrome element, preserving any
 * consumer-added element children (the talents tab keeps its .tt-pts pip, a
 * rich title keeps its subtitle span; both live AFTER the builder's text).
 */
function setChromeText(el: HTMLElement, text: string): void {
  const first = el.firstChild;
  if (first && first.nodeType === Node.TEXT_NODE) {
    first.nodeValue = text;
    return;
  }
  el.insertBefore(el.ownerDocument.createTextNode(text), el.firstChild);
}
