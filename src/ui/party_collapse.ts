// The collapse-state pure core for the mobile party-frames chip.
//
// On a touch HUD the always-expanded party stack (#party-frames: the member unit
// frames) eats a large top-left area, so mobile replaces
// it with a two-state UI: a compact "Party" chip (collapsed, the default) that taps
// to reveal the full stack (expanded), with the chip staying as a header above it.
//
// This module owns the STATE half only (DOM-free, deterministic, Node-tested): the
// persistence key + load/save, the default-collapsed choice, the toggle, and the
// pure resolver that maps (in-party, mobile, collapsed) to what the painter should
// show. The DOM side (building the chip, toggling the container class) is thin and
// lives in party_chip.ts + party_frames_painter.ts.
//
// Fairness: party HP is actionable info, so the collapse is a pure USER toggle. It
// is NOT influenced by data-fx-level, reduce-motion, or the FPS governor; the only
// input is the player's own persisted choice (default collapsed, the product
// decision) plus whether they are in a party on mobile.

// The persisted collapse flag's localStorage key. Its own key, like the haptics
// toggle's woc_haptics_on: '1' means collapsed, '0' means expanded. Collapsed is
// the default, so a MISSING key (never toggled) reads as collapsed.
export const PARTY_COLLAPSE_STORE_KEY = 'woc_party_collapsed';

/**
 * Read the persisted collapsed flag. Default TRUE (collapsed) when storage is
 * unavailable, the key is unset, or a read throws (the try/catch + feature-detect
 * shape the haptics toggle uses). Only the exact stored '0' expands; anything else
 * (including a missing key) stays collapsed.
 */
export function loadPartyCollapsed(
  storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(),
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(PARTY_COLLAPSE_STORE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Persist the collapsed flag ('1' collapsed, '0' expanded). Silently no-ops when
 *  storage is unavailable or a write throws, exactly like saveHapticsEnabled. */
export function savePartyCollapsed(
  collapsed: boolean,
  storage: Pick<Storage, 'setItem'> | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(PARTY_COLLAPSE_STORE_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** The inputs the resolver reads: whether the player is in a party, on a touch HUD,
 *  their persisted collapse choice, and whether the mobile chat overlay is open. */
export interface PartyChipInputs {
  inParty: boolean;
  mobile: boolean;
  collapsed: boolean;
  /** The mobile chat overlay (body.mobile-chat-open) is open. While it is, the party
   *  UI YIELDS: the stack force-collapses and the chip hides, so the chat log / tabs /
   *  composer have the top-left free of overlap. A TRANSIENT visual yield only: it
   *  never touches the persisted `collapsed` flag, so closing chat restores the
   *  player's own expanded/collapsed choice (exactly like the joystick hiding while
   *  chat is open). Chat has focus priority while the player is deliberately typing. */
  chatOpen: boolean;
}

/** What the painter renders from the inputs: whether the chip exists at all, and
 *  whether the member frames are expanded (shown) under it. */
export interface PartyChipState {
  /** The compact chip is shown only while actually in a party, on mobile, AND chat is
   *  not open (chat yields the whole party UI, chip included). */
  chipVisible: boolean;
  /** The full stack (member frames) shows only when the chip is
   *  present AND the player has expanded it AND chat is not open. Off desktop the chip
   *  never exists, so the frames are always "expanded" there (the desktop stack is
   *  unchanged). */
  framesExpanded: boolean;
}

/**
 * Pure resolver: map (in-party, mobile, collapsed, chat-open) to the render decision.
 * The chip exists only in a party on mobile with chat closed. When the chip exists,
 * the frames expand only if the player has NOT collapsed them; off mobile there is no
 * chip, so the frames are always shown (desktop is untouched). While chat is open on
 * mobile the party UI yields entirely (no chip, no frames); the persisted `collapsed`
 * is untouched, so closing chat restores the player's choice. Not in a party -> no
 * chip, nothing to show.
 */
export function partyChipState(inputs: PartyChipInputs): PartyChipState {
  // Chat open on mobile: the party UI yields entirely (chip + frames) so the chat
  // overlay owns the top-left. Desktop is unaffected (no chat overlay, no chip).
  if (inputs.chatOpen && inputs.mobile) {
    return { chipVisible: false, framesExpanded: false };
  }
  const chipVisible = inputs.inParty && inputs.mobile;
  const framesExpanded = chipVisible ? !inputs.collapsed : inputs.inParty;
  return { chipVisible, framesExpanded };
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
