// Browser-engine + device awareness for adaptive presentation quality.
//
// The renderer already adapts the Three.js pipeline to the GPU (see
// src/render/gfx.ts: deviceMemory / GPU-renderer probe / dynamic render-scale).
// This module covers the *other* half — the DOM/CSS layer — which has its own
// engine-specific costs the WebGL tier can't see:
//   - WebKit (Safari) pays a heavy GPU cost for `backdrop-filter`; worst on iOS.
//   - Gecko (Firefox) stutters compositing large `filter: blur` / many big
//     `box-shadow` blurs, especially on older builds and Android.
//   - Chromium has the strongest compositor; only mobile GPUs need toning down.
//
// Everything here is pure + framework-free so it unit-tests without a DOM. The
// only impure entry point is readBrowserEnv(), guarded for non-browser hosts
// (headless RL env / tests). Nothing in here touches the sim.

export type BrowserEngine = 'chromium' | 'webkit' | 'gecko' | 'unknown';

/** Coarse CSS-effects budget, independent of (but informed by) the WebGL tier. */
export type CssEffectsTier = 'full' | 'reduced' | 'minimal';

/** Renderer tier mirror — kept as a string union so this module never imports render/. */
export type RenderTier = 'low' | 'medium' | 'high' | 'ultra';

export interface BrowserEnv {
  readonly engine: BrowserEngine;
  /** Major engine version (Firefox/Safari "Version"/Chrome major). 0 when unknown. */
  readonly engineVersion: number;
  readonly mobile: boolean;
}

/**
 * browserEffects setting values (settings.ts). 0 = auto (detect), otherwise a
 * manual override that pins the tier regardless of detection.
 */
export const BROWSER_EFFECTS_AUTO = 0;
export const BROWSER_EFFECTS_FULL = 1;
export const BROWSER_EFFECTS_REDUCED = 2;
export const BROWSER_EFFECTS_MINIMAL = 3;

function majorFrom(ua: string, re: RegExp): number {
  const m = ua.match(re);
  const n = m ? parseInt(m[1], 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Classify the rendering engine from a user-agent string. Pure: pass any UA in.
 *
 * Order is load-bearing — UA strings are nested fossils (every Chrome UA also
 * contains `Safari/` + `AppleWebKit/`; Firefox contains `Gecko/`):
 *   1. iOS forces ALL browsers onto WebKit (CriOS/EdgiOS/FxiOS are Safari under
 *      the hood) — caught first so iOS Chrome doesn't read as Chromium.
 *   2. Gecko / Firefox (desktop + Android).
 *   3. Chromium family (Chrome, Edge `Edg`, Opera `OPR`, Brave, Chromium).
 *   4. Desktop Safari (AppleWebKit + `Version/` with no Chrome token).
 */
export function detectBrowserEngine(ua: string): { engine: BrowserEngine; version: number } {
  const s = ua || '';
  if (/iPhone|iPad|iPod/.test(s)) {
    // Safari reports its product as `Version/16.3`; fall back to the iOS version.
    const v = majorFrom(s, /Version\/(\d+)/) || majorFrom(s, /OS (\d+)[_.]/);
    return { engine: 'webkit', version: v };
  }
  if (/Gecko\/\d/.test(s) && /Firefox\/(\d+)/.test(s)) {
    return { engine: 'gecko', version: majorFrom(s, /Firefox\/(\d+)/) };
  }
  if (/(?:Chrome|Chromium|CriOS|Edg|OPR)\/\d/.test(s)) {
    return { engine: 'chromium', version: majorFrom(s, /(?:Chrome|Chromium|CriOS|Edg|OPR)\/(\d+)/) };
  }
  if (/AppleWebKit/.test(s) && /Version\/\d/.test(s) && !/Chrome|Chromium/.test(s)) {
    return { engine: 'webkit', version: majorFrom(s, /Version\/(\d+)/) };
  }
  return { engine: 'unknown', version: 0 };
}

/**
 * Decide the CSS-effects tier. Pure — every input is explicit so it tests
 * exhaustively without a browser.
 *
 * A non-zero `override` short-circuits detection (the Esc-menu manual control).
 * In auto mode the renderer's own verdict wins first: if gfx.ts already dropped
 * to the `low` GPU tier, the DOM has no business painting frosted glass. Only
 * then do engine-specific quirks apply.
 */
export function cssEffectsTier(input: {
  engine: BrowserEngine;
  version: number;
  mobile: boolean;
  renderTier: RenderTier;
  override?: number;
}): CssEffectsTier {
  switch (input.override) {
    case BROWSER_EFFECTS_FULL: return 'full';
    case BROWSER_EFFECTS_REDUCED: return 'reduced';
    case BROWSER_EFFECTS_MINIMAL: return 'minimal';
  }
  const { engine, version, mobile, renderTier } = input;
  // The GPU pipeline already gave up — match it in the DOM.
  if (renderTier === 'low') return mobile ? 'minimal' : 'reduced';

  if (engine === 'webkit') {
    // backdrop-filter is Safari's most expensive compositing path; brutal on iOS.
    if (mobile) return 'minimal';
    // Pre-16 Safari had markedly weaker layer compositing.
    if (version > 0 && version < 16) return 'reduced';
    return renderTier === 'medium' ? 'reduced' : 'full';
  }
  if (engine === 'gecko') {
    if (mobile) return 'minimal';
    // Firefox ESR < 115-era struggled with large blur/shadow compositing.
    if (version > 0 && version < 115) return 'reduced';
    return 'full';
  }
  if (engine === 'chromium') {
    return mobile ? 'reduced' : 'full';
  }
  // Unknown engine: stay conservative rather than risk a janky first frame.
  return mobile ? 'minimal' : 'reduced';
}

/**
 * Every body class this module can stamp, for callers that need to clear the
 * full set before a re-stamp (the in-world Esc override and the landing screen
 * stamp both re-apply from scratch). Pure data so the module stays DOM-free.
 */
export const BROWSER_BODY_CLASSES = [
  'fx-full', 'fx-reduced', 'fx-minimal',
  'engine-chromium', 'engine-webkit', 'engine-gecko', 'engine-unknown',
  'is-mobile', 'is-desktop',
] as const;

/** The body classes that drive the adaptive CSS in index.html. */
export function browserBodyClasses(env: BrowserEnv, tier: CssEffectsTier): string[] {
  return [`engine-${env.engine}`, env.mobile ? 'is-mobile' : 'is-desktop', `fx-${tier}`];
}

/** Read the live browser env. Returns a desktop-Chromium default off-DOM. */
export function readBrowserEnv(): BrowserEnv {
  if (typeof navigator === 'undefined') {
    return { engine: 'chromium', engineVersion: 0, mobile: false };
  }
  const ua = navigator.userAgent || '';
  const { engine, version } = detectBrowserEngine(ua);
  // maxTouchPoints catches desktop-class iPadOS (which reports a Mac UA); the
  // UA regex catches phones. Either signal flags "mobile" for effects purposes.
  const touch = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  const mobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua) || (engine === 'webkit' && touch);
  return { engine, engineVersion: version, mobile };
}
