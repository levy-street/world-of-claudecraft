// Pure, host-agnostic core for the "Unlock interface" option: the declarative
// table of which HUD frames the toggle governs, and the two decisions the
// coordinator makes on every flip (which label the option row shows, and which
// frames are eligible right now).
//
// DOM-free and game-free: a frame is named by its element id and its storage
// key, both plain strings the DOM adapter (interface_unlock.ts) resolves. Kept
// declarative so adding a frame is a row here plus its `isActive` probe at the
// wiring site, never a new branch in the coordinator. Registered in
// tests/architecture.test.ts UI_PURE_CORES.

import type { TranslationKey } from './i18n.catalog';

/** One movable HUD frame under the global unlock toggle. */
export interface HudFrameSpec {
  /** Stable identifier used by the coordinator's registry and by tests. */
  id: string;
  /** The element id in index.html the adapter looks up. */
  elementId: string;
  /** localStorage key its chosen position + size persist under. */
  storageKey: string;
  /** Name chip shown on the frame while unlocked, so a dimmed placeholder is
   *  never an anonymous floating box. Reuses an existing key where one already
   *  names the frame (the unit-frame aria labels, the target-aura tab names). */
  labelKey: TranslationKey;
  /** Nominal size used to clamp a saved spot while the frame is hidden. */
  fallbackSize: { w: number; h: number };
  /**
   * True when the frame lives inside a TRANSFORMED ancestor (#bottom-bar carries
   * a centering transform), which hijacks absolute positioning by becoming the
   * containing block. Those frames are re-homed onto #ui while positioned, the
   * same move the player frame already makes; the rest are already #ui children.
   */
  detachToUiRoot: boolean;
  /**
   * What a SIDE-edge drag does, defaulting to 'scale' (zoom the whole frame).
   * Only a frame whose contents genuinely REFLOW sets 'box' (a real layout
   * width/height): the wrapping aura rows. Everything else here is fixed
   * content (46px action slots, a minimap canvas, a portrait), where stretching
   * one axis only ever grew empty space, which is why those side resizes read
   * as broken. See MovableFrameConfig.resizeMode.
   */
  resizeMode?: 'scale' | 'box';
}

/**
 * Every frame the "Unlock interface" option moves and scales, in the order the
 * coordinator registers them. The three unit frames that predate this option
 * (player, target, party) keep their own corner buttons and are joined to the
 * same toggle at the wiring site, so they are deliberately NOT rows here: their
 * storage keys and labels already live in frame_pos_reset.ts.
 */
export const HUD_FRAME_SPECS: readonly HudFrameSpec[] = [
  {
    id: 'actionBar1',
    elementId: 'actionbar',
    storageKey: 'woc_hud_frame_actionbar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBar1',
    fallbackSize: { w: 612, h: 46 },
    detachToUiRoot: true,
  },
  {
    id: 'actionBar2',
    elementId: 'actionbar2',
    storageKey: 'woc_hud_frame_actionbar2',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBar2',
    fallbackSize: { w: 612, h: 46 },
    detachToUiRoot: true,
  },
  {
    id: 'actionBar3',
    elementId: 'actionbar3',
    storageKey: 'woc_hud_frame_actionbar3',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBar3',
    fallbackSize: { w: 612, h: 46 },
    detachToUiRoot: true,
  },
  // The whole action-bar block as ONE frame, live only while the "Combine
  // Action Bars" option is on; the three rows above go inactive in that mode so
  // exactly one of the two shapes is ever movable.
  {
    id: 'actionBarGroup',
    elementId: 'actionbar-group',
    storageKey: 'woc_hud_frame_actionbar_group',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.actionBarGroup',
    fallbackSize: { w: 612, h: 150 },
    detachToUiRoot: true,
  },
  {
    id: 'castBar',
    elementId: 'castbar',
    storageKey: 'woc_hud_frame_castbar',
    labelKey: 'hudChrome.castBar.playerAria',
    fallbackSize: { w: 300, h: 24 },
    detachToUiRoot: false,
  },
  // The auto-attack swing timer. Hidden except while auto-attacking a live
  // target, so editing shows it as a dimmed placeholder like the cast bar.
  {
    id: 'swingBar',
    elementId: 'swingbar',
    storageKey: 'woc_hud_frame_swingbar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.swingBar',
    fallbackSize: { w: 220, h: 12 },
    detachToUiRoot: false,
  },
  // The Wishlist on Steam reminder chip (#community-hud, PR 3616), movable
  // like any other corner chrome so a player can park it out of the way.
  // Already absolutely positioned in #ui, so no re-home is needed.
  {
    id: 'steamWishlist',
    elementId: 'community-hud',
    storageKey: 'woc_hud_frame_community',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.steamWishlist',
    fallbackSize: { w: 160, h: 30 },
    detachToUiRoot: false,
  },
  {
    id: 'menu',
    elementId: 'side-buttons',
    storageKey: 'woc_hud_frame_side_buttons',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.menu',
    fallbackSize: { w: 200, h: 220 },
    detachToUiRoot: false,
  },
  {
    id: 'minimap',
    elementId: 'minimap-wrap',
    storageKey: 'woc_hud_frame_minimap',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.minimap',
    fallbackSize: { w: 170, h: 240 },
    detachToUiRoot: false,
  },
  {
    id: 'petFrame',
    elementId: 'pet-frame',
    storageKey: 'woc_hud_frame_pet',
    labelKey: 'hudChrome.unitFrame.petLabel',
    fallbackSize: { w: 180, h: 54 },
    detachToUiRoot: true,
  },
  // The stance-style choice bar (warrior stances, paladin auras) sits inside
  // the transformed #actionbar-stack like the action bars, so it detaches too.
  {
    id: 'stanceBar',
    elementId: 'stancebar',
    storageKey: 'woc_hud_frame_stancebar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.stanceBar',
    fallbackSize: { w: 180, h: 44 },
    detachToUiRoot: true,
  },
  {
    id: 'xpBar',
    elementId: 'xpbar',
    storageKey: 'woc_hud_frame_xpbar',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.xpBar',
    fallbackSize: { w: 612, h: 12 },
    detachToUiRoot: true,
  },
  // The buff and debuff rows are independent frames (each placed on its own).
  // Both genuinely REFLOW (the icons re-wrap as the width changes), so their
  // side edges resize the real box rather than zooming, which keeps each
  // outline an honest picture of the area its auras will occupy. Both detach:
  // the auras-on-frame option re-parents the buff row into the player frame at
  // runtime, and the detacher is a no-op when a row already lives on #ui.
  {
    id: 'buffBar',
    elementId: 'buff-bar',
    storageKey: 'woc_hud_frame_buffbar',
    labelKey: 'hudChrome.targetAuras.buffs',
    fallbackSize: { w: 320, h: 32 },
    detachToUiRoot: true,
    resizeMode: 'box',
  },
  {
    id: 'debuffBar',
    elementId: 'debuff-bar',
    storageKey: 'woc_hud_frame_debuffbar',
    labelKey: 'hudChrome.targetAuras.debuffs',
    fallbackSize: { w: 320, h: 32 },
    detachToUiRoot: true,
    resizeMode: 'box',
  },
] as const;

/** Every storage key the option owns, so a reset can clear the whole set. */
export const HUD_FRAME_STORAGE_KEYS: readonly string[] = HUD_FRAME_SPECS.map((s) => s.storageKey);

/** Label the Interface option row shows: it names the ACTION the press performs,
 *  so it reads "Unlock interface" while locked and "Lock interface" once every
 *  frame is loose. */
export function interfaceUnlockLabelKey(unlocked: boolean): TranslationKey {
  return unlocked ? 'hudChrome.interfaceUnlock.lock' : 'hudChrome.interfaceUnlock.unlock';
}

/** A registered frame, reduced to the two things the eligibility rule reads. */
export interface UnlockCandidate {
  id: string;
  /** Whether the frame is live for this character right now: a hunter with no
   *  pet out has no pet frame, and the optional action bars are off by default. */
  isActive(): boolean;
}

/**
 * Which frames a flip to `unlocked` should actually loosen. Unlocking asks each
 * candidate whether it is live, so an absent frame (no pet, a disabled action
 * bar) is never made draggable; LOCKING is unconditional, because a frame that
 * went inactive mid-session (the pet was dismissed while the interface was
 * unlocked) must still be told to lock, or it would keep a live drag gesture
 * armed behind a hidden element.
 */
export function framesToLock(
  candidates: readonly UnlockCandidate[],
  unlocked: boolean,
): { id: string; unlocked: boolean }[] {
  return candidates.map((c) => ({ id: c.id, unlocked: unlocked && c.isActive() }));
}
