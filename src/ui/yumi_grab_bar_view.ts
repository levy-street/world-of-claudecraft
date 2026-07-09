// Pure, host-agnostic view model for the Protect Yumi hold-to-grab bar (the
// cast-style timer that fills while a fighter channels a mystery power-up). Kept
// DOM-free and i18n-free like swing_timer.ts: the painter turns this into DOM and
// resolves the label through t(). Allocation-light (one reused container).
//
// The bar fills as `yumiGrabRemaining` counts DOWN from `yumiGrabTotal` to 0
// (= grabbed). Both ride the self snapshot on the local player (server-
// authoritative), so the bar shows exactly the server's channel progress and
// vanishes the instant the grab completes or cancels (remaining back to 0).

/** The player fields the bar reads; a structural subset both the offline Sim and
 *  the online ClientWorld mirror expose. */
export interface GrabBarPlayerInput {
  yumiGrabRemaining: number; // seconds left in the 1.8s channel (0 = not grabbing)
  yumiGrabTotal: number; // the full channel duration (0 = not grabbing)
}

export interface YumiGrabBarState {
  visible: boolean; // shown only while a grab is in progress
  frac: number; // 0..1 fill (grows toward 1 as the grab nears completion)
  secondsLeft: number; // remaining seconds the painter formats into the label
}

const HIDDEN: YumiGrabBarState = { visible: false, frac: 0, secondsLeft: 0 };

export function yumiGrabBarState(p: GrabBarPlayerInput): YumiGrabBarState {
  if (p.yumiGrabRemaining <= 0 || p.yumiGrabTotal <= 0) return HIDDEN;
  const frac = Math.max(0, Math.min(1, 1 - p.yumiGrabRemaining / p.yumiGrabTotal));
  return { visible: true, frac, secondsLeft: p.yumiGrabRemaining };
}
