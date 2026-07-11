// Pure geometry for the MOBILE chat overlay (the body.mobile-chat-open panel):
// clamping, (de)serialization, and the legacy-key migration. No DOM, no Three,
// no i18n; just arithmetic, so the rules unit-test headlessly (the mobile
// sibling of chat_window.ts, which owns the desktop chat box math). The DOM
// wiring (pointer events, CSS vars, localStorage) lives in
// chat_mobile_overlay.ts; hud.mobile.css consumes the resulting
// --mobile-chat-left/top/h vars and provides the defaults when none are set.

/** The open panel's viewport-px top-left plus its total height (composer bar +
 *  tab strip + log). Width is NOT stored: it always follows the CSS
 *  --mobile-chat-w formula (defaultMobileChatWidth mirrors it) so the panel
 *  keeps a sane width across rotations without a second clamp axis. */
export interface MobileChatPanelGeom {
  left: number;
  top: number;
  height: number;
}

export interface MobileChatPanelLimits {
  /** Edge inset the panel keeps from the viewport rim. */
  margin: number;
  /** Reserved top band: the top-left Chat/Social/More trio must stay tappable
   *  ABOVE the panel (the Chat button is the only close affordance), so the
   *  panel top never rises past this. Mirrors the CSS default seat,
   *  max(8px, env(safe-area-inset-top)) + 64px, at a zero safe inset. */
  minTop: number;
  /** Smallest usable panel: the 40px composer bar + the 40px tab strip + a
   *  few log lines. */
  minHeight: number;
}

export const MOBILE_CHAT_PANEL_LIMITS: MobileChatPanelLimits = {
  margin: 8,
  minTop: 72,
  minHeight: 180,
};

/** The CSS default left seat (max(12px, env(safe-area-inset-left)) at a zero
 *  safe inset): the panel anchors to the viewport's left side by default. */
export const MOBILE_CHAT_DEFAULT_LEFT = 12;

/** Mirrors the CSS --mobile-chat-w default in hud.mobile.css:
 *  min(500px, max(320px, 58vw), calc(100vw - 16px)). About 56-62% of a
 *  landscape phone, floored for portrait, and never wider than the viewport
 *  minus both edge margins. The numbers here and in the stylesheet are pinned
 *  together by tests/mobile_chat_centered.test.ts. */
export function defaultMobileChatWidth(viewportW: number): number {
  // Rounded so float dust (0.58 * 800 = 463.9999...) never leaks into px math.
  return Math.round(Math.min(500, Math.max(320, 0.58 * viewportW), viewportW - 16));
}

function clamp(v: number, lo: number, hi: number): number {
  // hi can fall below lo on tiny viewports; prefer the lower bound so the
  // panel never collapses below its usable minimum (mirrors CSS clamp()).
  return Math.max(lo, Math.min(hi, v));
}

/** Clamp a desired panel geometry to the viewport: height first (so a saved
 *  size survives a rotation), then top against the reserved trio band and the
 *  bottom edge, then left against the side margins. `width` is the panel's
 *  live (or default) width, measured by the caller. */
export function clampMobileChatPanel(
  geo: MobileChatPanelGeom,
  viewport: { w: number; h: number },
  width: number,
  limits: MobileChatPanelLimits = MOBILE_CHAT_PANEL_LIMITS,
): MobileChatPanelGeom {
  const { margin, minTop, minHeight } = limits;
  const height = clamp(geo.height, minHeight, viewport.h - minTop - margin);
  const top = clamp(geo.top, minTop, Math.max(minTop, viewport.h - height - margin));
  const left = clamp(geo.left, margin, Math.max(margin, viewport.w - width - margin));
  return { left, top, height };
}

export function serializeMobileChatPanel(geo: MobileChatPanelGeom): string {
  return JSON.stringify({ left: geo.left, top: geo.top, height: geo.height });
}

/** Parse persisted geometry, returning null for missing/corrupt data so the
 *  caller falls back to the CSS defaults. Every field must be a finite number. */
export function parseMobileChatPanel(raw: string | null | undefined): MobileChatPanelGeom | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const nums = ['left', 'top', 'height'].map((k) => o[k]);
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const [left, top, height] = nums as number[];
    return { left, top, height };
  } catch {
    return null;
  }
}

/** One-time migration from the pre-move model's woc_mobile_chat_bottom key (a
 *  bare px bottom inset, e.g. "120px"): the old panel stretched from the
 *  reserved top band down to that inset, so the equivalent height is
 *  viewport - minTop - inset. Position lands on the new defaults. Returns null
 *  when the legacy value is missing or unparseable. */
export function migrateMobileChatBottomInset(
  raw: string | null | undefined,
  viewport: { w: number; h: number },
  limits: MobileChatPanelLimits = MOBILE_CHAT_PANEL_LIMITS,
): MobileChatPanelGeom | null {
  if (!raw) return null;
  const bottom = Number.parseInt(raw, 10);
  if (!Number.isFinite(bottom)) return null;
  return clampMobileChatPanel(
    {
      left: MOBILE_CHAT_DEFAULT_LEFT,
      top: limits.minTop,
      height: viewport.h - limits.minTop - bottom,
    },
    viewport,
    defaultMobileChatWidth(viewport.w),
    limits,
  );
}
