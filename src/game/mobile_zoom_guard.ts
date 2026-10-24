// Mobile page-zoom guard: blocks the accidental zooms a touch HUD invites (iOS
// pinch gestures, double-tap zoom on non-interactive chrome) and undoes the one
// zoom it cannot block, the iOS text-field focus zoom.
//
// The trap this closes: iOS auto-zooms the page when a focused text field
// renders below 16px. The page stays zoomed after the field blurs, pinch is
// blocked (the gesture listeners here plus the game's touch-action rules), and
// a fixed full-screen window (the Book of Deeds search) is left with its close
// button off-screen and no way back. The zoom-aware 16px floor in base.css
// stops the zoom from starting; this is the recovery if one slips through.

/** Above this visual-viewport scale the page counts as zoomed in. */
const ZOOMED_SCALE = 1.01;

/** A second plain tap this soon after the last one is a double-tap zoom. */
const DOUBLE_TAP_MS = 320;

// The viewport meta clamp that snaps iOS back to scale 1. Held only long
// enough for the browser to commit the zoom-out: the shipped meta deliberately
// carries no scale-lock (a11y), so it is restored afterwards (pinned in
// tests/client_shell.test.ts).
const RESET_CLAMP = ', maximum-scale=1.0';
export const RESET_HOLD_MS = 300;

const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Whether the page is zoomed in. */
export function isPageZoomed(scale: number | undefined): boolean {
  return (scale ?? 1) > ZOOMED_SCALE;
}

/**
 * Whether leaving text entry should undo a page zoom: only a zoom that began
 * with the focus (the iOS small-text auto-zoom), never one the player was
 * already in when they tapped the field.
 */
export function shouldResetFocusZoom(
  scaleAtFocus: number | undefined,
  scaleAtBlur: number | undefined,
): boolean {
  return !isPageZoomed(scaleAtFocus) && isPageZoomed(scaleAtBlur);
}

/** Snap the page back to scale 1 by briefly clamping the viewport meta. */
export function resetPageZoom(win: Window = window): void {
  const meta = win.document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const original = meta.getAttribute('content') ?? '';
  if (original.includes('maximum-scale')) return;
  meta.setAttribute('content', original + RESET_CLAMP);
  win.setTimeout(() => meta.setAttribute('content', original), RESET_HOLD_MS);
}

function isTextEntry(el: EventTarget | null): boolean {
  return el instanceof Element && el.matches(TEXT_ENTRY_SELECTOR);
}

/** Install the guard; returns a function that removes every listener. */
export function installMobileZoomGuard(win: Window = window): () => void {
  const doc = win.document;
  const scale = () => win.visualViewport?.scale;
  const ac = new AbortController();
  const passiveFalse = { passive: false, signal: ac.signal };
  let lastTouchEnd = 0;
  const prevent = (e: Event) => e.preventDefault();
  doc.addEventListener('gesturestart', prevent, passiveFalse);
  doc.addEventListener('gesturechange', prevent, passiveFalse);
  doc.addEventListener('gestureend', prevent, passiveFalse);
  doc.addEventListener(
    'touchend',
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      // client_shell.test guards this interactive-target allowlist:
      // target?.closest('button, a, input, textarea, select, [role="button"], [role="option"], [tabindex]')
      if (
        target?.closest(
          'button, a, input, textarea, select, [role="button"], [role="option"], [tabindex]',
        )
      ) {
        lastTouchEnd = Date.now();
        return;
      }
      const now = Date.now();
      if (now - lastTouchEnd <= DOUBLE_TAP_MS) e.preventDefault();
      lastTouchEnd = now;
    },
    passiveFalse,
  );
  // The scale from before the player entered text entry. Held across a
  // re-focus (the Deeds search re-renders and re-focuses its input on every
  // keystroke) and across hops between fields, so the baseline is never the
  // zoom the focus itself caused.
  let scaleAtFocus: number | undefined;
  let entered = false;
  doc.addEventListener(
    'focusin',
    (e) => {
      if (!isTextEntry(e.target) || entered) return;
      entered = true;
      scaleAtFocus = scale();
    },
    { signal: ac.signal },
  );
  doc.addEventListener(
    'focusout',
    (e) => {
      if (!isTextEntry(e.target)) return;
      // Decide once focus has settled: a re-render or a hop to another field
      // lands focus on text entry again and is not leaving it.
      win.setTimeout(() => {
        if (ac.signal.aborted || !entered || isTextEntry(doc.activeElement)) return;
        entered = false;
        if (shouldResetFocusZoom(scaleAtFocus, scale())) resetPageZoom(win);
        scaleAtFocus = undefined;
      }, 0);
    },
    { signal: ac.signal },
  );
  return () => ac.abort();
}
