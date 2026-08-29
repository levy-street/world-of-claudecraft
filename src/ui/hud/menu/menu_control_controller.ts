// Builds and wires Quick Actions: the single seat that replaces the old
// five-button row, plus the ten-item strip it opens (Phase 4 of the touch
// rework). The row it replaces sat 365 to 443px from the nearer thumb, the least
// reachable chrome in the HUD, and buried Mount two taps behind the More modal
// (issue #2739); the strip puts Mount at the shortest gesture on the control.
//
// Nothing here reimplements an action, and the control itself runs none: every
// strip item is a REAL button the touch HUD already binds, so a pick activates
// that button and the action runs through its existing handler, while the
// control's own tap only opens the row. Chat is one of those items now (the tray
// button it used to run keeps the press-and-hold log peek), which is why this
// module takes no default-action callback at all.
//
// The ANCHOR'S ACCESSIBLE NAME depends on the MODE, which is why this module
// owns it rather than the static markup alone. A touch device has no hover to
// discover the gesture with, so the name teaches it; under settings.touchTapMenus
// the row is opened and chosen from with separate taps, so the swipe sentence
// would teach a screen-reader user something the control does not do. It is
// rewritten on the settings broadcast and again after a language switch, because
// the shell's data-i18n-aria pass re-stamps the gesture-mode name on every locale
// change.
//
// The static markup lives in index.html / play.html (#mobile-menu-anchor,
// #mobile-menu-strip). On a build that omits it, buildMobileMenuControl returns
// null and the control silently stays unbuilt, exactly like the ring.

import { SETTINGS_CHANGE_EVENT } from '../../../game/settings';
import { type TranslationKey, t } from '../../i18n';
import { makeWriterFacet, type PainterHostWriters } from '../../painter_host';
import { tapMenusEnabled } from '../tap_menu';
import { MENU_STRIP_ITEMS } from './menu_strip_core';
import { MenuStripGesture } from './menu_strip_gesture_controller';
import { MenuStripPainter } from './menu_strip_painter';

const ANCHOR_ID = 'mobile-menu-anchor';
const STRIP_ID = 'mobile-menu-strip';
const CANCEL_ID = 'mobile-menu-cancel';
const CAPTION_ID = 'mobile-menu-caption';
const CAPTION_TEXT_SELECTOR = '.tt-title';
const ARIA_LABEL_ATTR = 'aria-label';
/** The left-handed HUD mirror, which reseats the control against the opposite
 *  screen edge (hud.mobile.css). Read as the CLASS rather than as the setting so
 *  the row can only ever grow the way the anchor was actually placed. */
const LEFT_HANDED_CLASS = 'mobile-left-handed';
/** The two accessible names, one per mode. The gesture one is also the static
 *  markup's `data-i18n-aria`, so an unbuilt control still says something true. */
const GESTURE_ARIA_KEY: TranslationKey = 'hudChrome.mobile.quickActionsAria';
const TAP_ARIA_KEY: TranslationKey = 'hudChrome.mobile.quickActionsAriaTap';

export interface MobileMenuControlDeps {
  /** The player opened the strip and chose nothing. */
  onCancel?(): void;
  /**
   * Optional writer facet. The control is gesture-driven cold chrome with no
   * per-frame HUD paint behind it, and its composition point (MobileControls,
   * built in src/main.ts) has no facet to hand down, so it owns a small one of
   * its own by default. The exception is recorded in src/ui/hud/CLAUDE.md next to
   * the "do not create a second write cache" rule; nothing it writes is on a
   * frame band and its elements are static, so no cache entry is ever stranded.
   */
  writers?: PainterHostWriters;
}

export interface MobileMenuControl {
  gesture: MenuStripGesture;
  anchor: HTMLButtonElement;
}

function ownWriters(): PainterHostWriters {
  return makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {},
    () => {},
  );
}

/** Build the control, or return null when the markup is absent. */
export function buildMobileMenuControl(deps: MobileMenuControlDeps = {}): MobileMenuControl | null {
  const anchor = document.getElementById(ANCHOR_ID) as HTMLButtonElement | null;
  const strip = document.getElementById(STRIP_ID);
  const cancel = document.getElementById(CANCEL_ID);
  const caption = document.getElementById(CAPTION_ID);
  const captionText = caption?.querySelector<HTMLElement>(CAPTION_TEXT_SELECTOR) ?? null;
  if (!anchor || !strip || !cancel || !caption || !captionText) return null;
  const items = MENU_STRIP_ITEMS.map((item) => document.getElementById(item.elementId));
  if (items.some((el) => el === null)) return null;
  const itemEls = items as HTMLElement[];

  const writers = deps.writers ?? ownWriters();
  const painter = new MenuStripPainter(writers, {
    strip,
    items: itemEls,
    cancel,
    caption,
    captionText,
  });

  const gesture = new MenuStripGesture({
    anchor,
    // The row's geometry tokens live on the overlay, which is a sibling of the
    // anchor so its items are seated in viewport coordinates rather than inside
    // the anchor's own scaled box.
    metricsHost: strip,
    items: itemEls,
    cancel,
    writers,
    tapMenus: () => tapMenusEnabled(),
    leftHanded: () => document.body.classList.contains(LEFT_HANDED_CLASS),
    pick: (index, source) => {
      // A gesture release never touched the item, so activating the real button
      // is what runs the action, through the handler the old row or the More
      // tray already bound to it, haptics included. A pick made BY clicking the
      // item has already run that handler, and clicking it again ran the action
      // twice (a tap on the seated More button opened the tray and immediately
      // closed it).
      if (source === 'gesture') itemEls[index]?.click();
      anchor.blur();
    },
    onCancel: () => deps.onCancel?.(),
    repaint: () => {
      const open = gesture.openState();
      const live = open?.live ?? -1;
      const item = live >= 0 ? MENU_STRIP_ITEMS[live] : undefined;
      painter.paint(open === null ? null : { ...open, caption: item ? t(item.captionKey) : '' });
    },
  });
  gesture.attach();

  // Deliberately NOT the elided writer: the shell's translatePage() pass writes
  // this same attribute from data-i18n-aria without going through any facet, so
  // an elided writer's cache would disagree with the DOM and skip the correction.
  // A cold path either way (a settings flip, a language switch), never a frame.
  const syncAnchorName = (): void => {
    anchor.setAttribute(ARIA_LABEL_ATTR, t(tapMenusEnabled() ? TAP_ARIA_KEY : GESTURE_ARIA_KEY));
  };
  syncAnchorName();
  window.addEventListener(SETTINGS_CHANGE_EVENT, syncAnchorName);
  // After the shell's own translatePage() pass, which re-stamps the gesture-mode
  // name from data-i18n-aria and would otherwise leave tap mode mislabelled.
  document.addEventListener('woc:languagechange', syncAnchorName);
  return { gesture, anchor };
}
