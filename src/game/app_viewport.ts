// Keeps the --app-vw/--app-vh custom properties (consumed by #ui's fixed-size,
// overflow:hidden box) in sync with the true viewport. main.ts wires this to
// resize/orientation/fullscreenchange; a window that opens on top of #ui can
// also call it directly so its own size isn't clipped by a stale ancestor box
// from just before a resize/fullscreen transition settles (see options_window.ts).
import { useTouchInterface } from './mobile_controls';

export function syncAppViewport(win: Window = window): void {
  const doc = win.document;
  const useStableGameViewport =
    doc.body.classList.contains('game-active') && useTouchInterface(win);
  const width = Math.max(
    1,
    Math.round(
      useStableGameViewport ? win.innerWidth : (win.visualViewport?.width ?? win.innerWidth),
    ),
  );
  const height = Math.max(
    1,
    Math.round(
      useStableGameViewport ? win.innerHeight : (win.visualViewport?.height ?? win.innerHeight),
    ),
  );
  doc.documentElement.style.setProperty('--app-vw', `${width}px`);
  doc.documentElement.style.setProperty('--app-vh', `${height}px`);
}
