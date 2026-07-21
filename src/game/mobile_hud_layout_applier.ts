// Thin DOM applier for the Phase 3 responsive mobile HUD layout: reads real
// viewport + mode state, calls the pure src/ui/mobile_hud_layout.ts core, and
// writes the result onto document.body. No decision logic lives here; this
// module only reads inputs and performs the DOM writes the core cannot do
// itself (it must stay host-agnostic for tests/architecture.test.ts).
//
// Safe-area insets: this reads 0 for all four and lets CSS own inset handling
// via env(safe-area-inset-*) directly in hud.mobile.css (the repo's existing
// idiom, see the ring/joystick rules there). The core still accepts insets as
// inputs (so a future JS-side need, e.g. combining an inset with a tier
// threshold, has a seam) but nothing here currently probes the real env()
// values from JS: doing so would need a throwaway probe element and a
// getComputedStyle read every call, which is unnecessary work when CSS already
// applies the same insets natively and unconditionally.

import { resolveMobileHudLayout } from '../ui/mobile_hud_layout';
import { isNativeAppShell, useTouchInterface } from './mobile_controls';

const TIER_CLASSES = ['hud-mobile-compact', 'hud-mobile-standard', 'hud-mobile-tablet'];
const STATE_CLASSES = ['hud-menu-open', 'hud-chat-open'];
const ALL_LAYOUT_CLASSES = [...TIER_CLASSES, ...STATE_CLASSES];

let previousClasses: string[] = [];

/** Read the current viewport/mode state and apply the resolved mobile HUD
 *  layout classes + CSS vars to document.body. Call once at startup (after
 *  settings are applied) and right after every syncAppViewport() call so the
 *  tier stays in sync with resize/orientation/fullscreen changes. */
export function applyMobileHudLayout(win: Window = window): void {
  const doc = win.document;
  const body = doc.body;
  const layout = resolveMobileHudLayout({
    width: win.innerWidth,
    height: win.innerHeight,
    safeAreaTop: 0,
    safeAreaRight: 0,
    safeAreaBottom: 0,
    safeAreaLeft: 0,
    touchMode: useTouchInterface(win) || isNativeAppShell(),
    menuOpen: body.classList.contains('mobile-window-open'),
    chatOpen: body.classList.contains('mobile-chat-open'),
  });

  for (const cls of previousClasses) {
    if (!layout.classes.includes(cls)) body.classList.remove(cls);
  }
  for (const cls of layout.classes) body.classList.add(cls);
  // Guard against a class from an unrelated caller lingering if it happens to
  // collide with our managed set (defensive; not expected in practice).
  for (const cls of ALL_LAYOUT_CLASSES) {
    if (!layout.classes.includes(cls)) body.classList.remove(cls);
  }
  previousClasses = layout.classes;

  for (const [name, value] of Object.entries(layout.cssVars)) {
    body.style.setProperty(name, value);
  }
}
