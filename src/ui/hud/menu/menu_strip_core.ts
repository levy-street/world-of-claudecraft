// Pure, DOM-free decision core for the touch menu control: the strip roster, what
// a release means, when the row comes up, and where the live item's caption is
// parked. The geometry itself is reused from radial_action_core.ts
// (placeConsumableStrip / resolveStripIndex), so the menu strip and the
// consumables row share one tested implementation. Registered in
// tests/architecture.test.ts UI_PURE_CORES.
//
// The control (Quick Actions) replaces the old five-button row (Chat, Social,
// Quests, Settings, More), which sat further from either thumb than anything else
// in the HUD. It runs NO action of its own: a tap opens the ten-item strip, and a
// hold or a rightward swipe opens it and picks in one gesture.
//
// The roster is ordered by how often a player reaches for it, because swipe
// distance IS the cost: item 0 is one flick away, item 9 is the length of the row.
// Mount leads it, which is the answer to issue #2739 (mount used to be two taps
// behind the More modal, and here it is the shortest gesture on the control), and
// Chat follows it, the action a player reaches for mid-session more than the rest
// and the one the control's own tap used to run.

import type { TranslationKey } from '../../i18n';
import {
  STRIP_CAPTION_HALF_PX,
  STRIP_PITCH_PX,
  type StripCaptionInput,
  type StripDirection,
  shouldRevealStrip,
  stripCancelIsLive,
  stripCaptionCenterX,
} from '../action_bar/radial_action_core';

/** The strip roster's stable ids. Order is load-bearing (it IS the row order). */
export type MenuActionId =
  | 'mount'
  | 'chat'
  | 'map'
  | 'bags'
  | 'social'
  | 'quest'
  | 'char'
  | 'spellbook'
  | 'settings'
  | 'more';

export interface MenuStripItem {
  id: MenuActionId;
  /**
   * The id of the REAL button the strip seats. Three of them are the old row's own
   * buttons and the rest are promotions out of the More tray, but every one is a
   * button the touch HUD already binds, so a pick routes through the existing
   * handler instead of a second copy of the action. Chat is seated by its own
   * strip button rather than the tray's #mobile-chat: that button carries the
   * press-and-hold log peek on its pointer handlers, which the synthesized click
   * a swipe pick routes through would never reach.
   */
  elementId: string;
  /** The caption shown while the finger is over the item. */
  captionKey: TranslationKey;
}

export const MENU_STRIP_ITEMS: readonly MenuStripItem[] = [
  { id: 'mount', elementId: 'mobile-menu-mount', captionKey: 'hudChrome.mounts.mount' },
  { id: 'chat', elementId: 'mobile-menu-chat', captionKey: 'hud.core.mobileChat' },
  { id: 'map', elementId: 'mobile-menu-map', captionKey: 'hud.core.mobileMap' },
  { id: 'bags', elementId: 'mobile-menu-bags', captionKey: 'hud.keybinds.actions.bags' },
  { id: 'social', elementId: 'mobile-social', captionKey: 'hud.core.mobileSocial' },
  { id: 'quest', elementId: 'mobile-quest', captionKey: 'questUi.tracker.title' },
  { id: 'char', elementId: 'mobile-menu-char', captionKey: 'hud.keybinds.actions.char' },
  { id: 'spellbook', elementId: 'mobile-menu-spellbook', captionKey: 'abilityUi.spellbook.title' },
  { id: 'settings', elementId: 'mobile-menu', captionKey: 'hud.core.mobileSettings' },
  { id: 'more', elementId: 'mobile-more', captionKey: 'hud.core.mobileMore' },
];

export const MENU_STRIP_COUNT = MENU_STRIP_ITEMS.length;

/** The row grows rightward: the control sits at the left of the bottom band, so
 *  the whole screen width is in front of it. This is the direction for the
 *  shipped right-handed HUD, and resolveMenuStripDirection below is the only
 *  thing allowed to answer otherwise. */
export const MENU_STRIP_DIRECTION = 'right' as const;

export interface MenuStripDirectionInput {
  /** Whether the left-handed HUD mirror is on (body.mobile-left-handed), which
   *  is what moves the control to the opposite edge. */
  leftHanded: boolean;
}

/**
 * Which way the row grows. The mirror is the ONE thing that changes it, so the
 * muscle memory the roster order buys survives every other move: the control is
 * seated 152px in from one screen edge, and the left-handed mirror seats it in
 * from the other, where a rightward row would run off the screen and be clamped
 * back over the anchor while the travel, the dim and the caption still counted
 * rightward.
 *
 * Deliberately NOT the consumables row's room comparison
 * (resolveConsumableStripDirection): that seat sits hard against the edge, so
 * which side holds the row is an honest readout there, while this control sits
 * near the middle of a narrow portrait viewport and a room comparison flips it
 * on a right-handed phone barely narrower than the ones we ship.
 */
export function resolveMenuStripDirection(input: MenuStripDirectionInput): StripDirection {
  return input.leftHanded ? 'left' : MENU_STRIP_DIRECTION;
}

/** The shared strip pitch under this row's own name. Re-exported rather than
 *  restated, so the menu strip and the consumables row cannot drift apart on the
 *  one number a player's thumb learns. */
export const MENU_STRIP_PITCH_PX = STRIP_PITCH_PX;

/** The shared caption half-width under this menu's own name; see the pitch
 *  above for why it is re-exported rather than restated. */
export const MENU_CAPTION_HALF_PX = STRIP_CAPTION_HALF_PX;

/** What a release on the control does. */
export type MenuStripOutcome =
  | { kind: 'open' }
  | { kind: 'pick'; index: number }
  | { kind: 'cancel' };

export interface MenuStripReleaseInput {
  /** resolveStripIndex's readout: -1 while the finger is still in the deadzone. */
  index: number;
  /** Whether the row was showing when the finger came up. */
  revealed: boolean;
  count: number;
}

/**
 * The release rule. A bare tap OPENS the row as a persistent menu, so the player
 * who never learns the gesture still reaches every item with two ordinary taps;
 * the control has no action of its own to run instead. Once the row is OPEN, a
 * release back in the anchor's own band means the player looked and chose
 * nothing, so back out instead of opening something they did not pick.
 */
export function resolveMenuStripRelease(input: MenuStripReleaseInput): MenuStripOutcome {
  if (input.count <= 0) return { kind: 'open' };
  if (input.revealed && input.index < 0) return { kind: 'cancel' };
  if (input.index < 0) return { kind: 'open' };
  return { kind: 'pick', index: Math.min(input.index, input.count - 1) };
}

// The cancel-is-live and reveal-early rules are the SHARED strip rules under this
// menu's own names (radial_action_core.ts owns the one implementation): they were
// byte-identical to the consumables row's, doc comment included.
// The caption clamp is the SHARED strip rule under this menu's own names
// (radial_action_core.ts owns the one implementation): the consumables row grew
// the same live caption, so a second copy of the clamp is how the two rows'
// captions would drift apart.
export {
  type StripCaptionInput as MenuCaptionInput,
  shouldRevealStrip as shouldRevealMenuStrip,
  stripCancelIsLive as menuStripCancelIsLive,
  stripCaptionCenterX as menuCaptionCenterX,
};
