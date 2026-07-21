// Keeps the --app-vw/--app-vh custom properties (consumed by #ui's fixed-size,
// overflow:hidden box) in sync with the true viewport. main.ts wires this to
// resize/orientation/fullscreenchange; a window that opens on top of #ui can
// also call it directly so its own size isn't clipped by a stale ancestor box
// from just before a resize/fullscreen transition settles (see options_window.ts).
import { useTouchInterface } from './mobile_controls';

export function syncAppViewport(win: Window = window): void {
  const doc = win.document;
  const vv = win.visualViewport;
  const useStableGameViewport =
    doc.body.classList.contains('game-active') && useTouchInterface(win);
  const gameViewportIsPortrait = win.innerHeight >= win.innerWidth;
  const keyboardLikelyOpen =
    useStableGameViewport && !!vv && win.innerHeight > 0 && vv.height < win.innerHeight * 0.75;
  const useVisualViewport =
    !useStableGameViewport || (gameViewportIsPortrait && !keyboardLikelyOpen);
  const visualScale = vv?.scale ?? 1;
  // visualViewport dimensions are expressed inside the current page scale.
  // Normalize them back to layout CSS pixels before writing html/body's fixed
  // dimensions. Without this, a landscape-to-portrait rotation can feed the
  // landscape width back into --app-vw while the browser zooms the page down,
  // permanently trapping the portrait layout at the landscape scale.
  const visualWidth = (vv?.width ?? win.innerWidth) * visualScale;
  const visualHeight = (vv?.height ?? win.innerHeight) * visualScale;
  const width = Math.max(1, Math.round(useVisualViewport ? visualWidth : win.innerWidth));
  const height = Math.max(1, Math.round(useVisualViewport ? visualHeight : win.innerHeight));
  doc.documentElement.style.setProperty('--app-vw', `${width}px`);
  doc.documentElement.style.setProperty('--app-vh', `${height}px`);
}
