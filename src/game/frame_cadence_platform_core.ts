// The fastest rhythm the automatic Frame Rate Limit may hold on this platform.
//
// iOS WebKit (Safari, every other iOS browser, and the native shell's WKWebView)
// kills the page's WebContent process when it crosses its memory ceiling, with
// no error and no unload. On a 120 Hz ProMotion display an uncapped Auto renders
// twice as many frames as on a 60 Hz phone, so every per-frame streaming budget
// (imposter bakes, LOD switches, skin applies) and every per-frame allocation
// runs twice as fast in the first seconds after world entry, exactly when the
// scene is still being built. Players reported crashing within seconds at
// 120 Hz and playing for twenty minutes with the phone forced to 60 Hz. So on
// iOS, Auto treats the display as if it were 60 Hz: it starts at 60, may still
// step down to 30, and never climbs back above 60. An explicit choice (Display,
// 60, 30, or `?fpscap=`) is the player's and is never clamped.
//
// Pure: the wiring reads the platform once and asks these three questions.

import type { FrameCeilingIntent } from './frame_cadence_core';

/** The platform reading this core needs: `mobilePlatform()`, the same rule
 *  (iPhone/iPad/iPod UA, or a touch MacIntel iPad) `GFX.iosMemoryProfile`
 *  applies, so every iOS WebKit host, iPads included. */
export type FrameCadencePlatform = 'ios' | 'android' | 'other';

/** The fastest ceiling Auto may choose here, 0 meaning the display's own rate. */
export function autoTopCeiling(platform: FrameCadencePlatform): FrameCeilingIntent {
  return platform === 'ios' ? 60 : 0;
}

/** The ceiling Auto actually asks the cadence for: its own verdict, never
 *  faster than the platform's top. */
export function autoEffectiveIntent(
  autoCeiling: FrameCeilingIntent,
  top: FrameCeilingIntent,
): FrameCeilingIntent {
  if (top === 0) return autoCeiling;
  if (autoCeiling === 0) return top;
  return autoCeiling < top ? autoCeiling : top;
}

/** The display rate the automatic core reasons on. Under a top it is the top:
 *  Auto's "uncapped" then means the top, its steps (to 60, to 30) are judged
 *  against it, and a probe never returns to the display's full rate. */
export function autoReadingHz(refreshHz: number, top: FrameCeilingIntent): number {
  return top > 0 && refreshHz > top ? top : refreshHz;
}

/** Under a top, a remembered ceiling at or above it is no verdict at all (it
 *  clamps to the top, where Auto starts anyway): observe instead of holding it,
 *  so no probe is spent on a step that changes nothing. */
export function autoRestoresUnderTop(
  rememberedCeiling: FrameCeilingIntent,
  top: FrameCeilingIntent,
): boolean {
  if (rememberedCeiling === 0) return false;
  return top === 0 || rememberedCeiling < top;
}

/** Timestamp jitter an exempt callback may arrive early by and still render. */
export const EXEMPT_TOP_SLACK_MS = 2;

/** Whether an exempt callback (loading cover, held world draw) skips under the
 *  top: one slot of a 120 Hz display after the last exempt render, never on a
 *  display already at or under the top. */
export function exemptSkipsUnderTop(
  lastExemptRenderAtMs: number,
  nowMs: number,
  top: FrameCeilingIntent,
): boolean {
  if (top === 0 || !(lastExemptRenderAtMs > 0)) return false;
  return nowMs - lastExemptRenderAtMs < 1000 / top - EXEMPT_TOP_SLACK_MS;
}
