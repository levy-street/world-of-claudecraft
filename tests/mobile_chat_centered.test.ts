import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOBILE_CHAT_DEFAULT_LEFT, MOBILE_CHAT_PANEL_LIMITS } from '../src/ui/chat_mobile_panel';

const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const overlayTs = readFileSync(
  new URL('../src/ui/chat_mobile_overlay.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

// Mobile chat overlay layout. On touch, tapping the Chat button opens the log +
// composer as an in-front panel. The current model (the "revise the chat" pass):
// a side-anchored panel about 56-62% of the viewport wide and about half of it
// tall by default, MOVABLE by a 40x40 grab chip at its top-right corner and
// RESIZABLE by the bottom bar, both persisted (chat_mobile_overlay.ts +
// chat_mobile_panel.ts). These assertions pin that layout, the occlusion
// reservation above the resize bar, and the CSS-default/JS-constant agreement.
// Everything here is scoped to body.mobile-touch, so the classic desktop
// bottom-left chat panel is untouched.
const hudMobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

// The z-index of the full-screen #mobile-controls layer the open chat must beat to
// read as "in front of the other content". Pinned from the same file so the two
// numbers can never silently diverge.
function mobileControlsZ(): number {
  const body =
    hudMobileCss.match(/body\.mobile-touch\.game-active #mobile-controls \{([^}]*)\}/)?.[1] ?? '';
  const m = body.match(/z-index:\s*(\d+)/);
  expect(m, 'mobile-controls z-index should be pinned in hud.mobile.css').toBeTruthy();
  return Number(m?.[1] ?? 0);
}

function ruleBody(selector: string): string {
  // selector is already regex-escaped by the caller.
  return hudMobileCss.match(new RegExp(`${selector} \\{([^}]*)\\}`))?.[1] ?? '';
}

describe('mobile chat overlay layout (movable + resizable panel)', () => {
  it('defines the shared panel geometry vars with side-anchored, mid-size defaults', () => {
    const body = ruleBody('body\\.mobile-touch\\.mobile-chat-open');
    // One DRY width var drives the wrap AND the two grab affordances. The default is a
    // MID-SIZE panel (about 56-62vw, capped), never the old near-fullscreen sheet; its
    // numbers must match defaultMobileChatWidth in chat_mobile_panel.ts (pinned below).
    expect(body).toMatch(
      /--mobile-chat-w:\s*min\(500px,\s*max\(320px,\s*58vw\),\s*calc\(100vw - 16px\)\)/,
    );
    // The resolved position/size vars: the JS-persisted override falls back to the stock
    // seat (left side anchor, a top that clears the Chat button trio, about half-height).
    expect(body).toMatch(
      /--mobile-chat-left-r:\s*var\(--mobile-chat-left,\s*max\(12px,\s*env\(safe-area-inset-left\)\)\)/,
    );
    expect(body).toMatch(
      /--mobile-chat-top-r:\s*var\(--mobile-chat-top,\s*calc\(max\(8px, env\(safe-area-inset-top\)\) \+ 64px\)\)/,
    );
    expect(body).toMatch(/var\(--mobile-chat-h,\s*clamp\(200px,\s*48vh,\s*340px\)\)/);
  });

  it('keeps the CSS defaults and the pure-core clamp constants in agreement', () => {
    // The JS clamp (chat_mobile_panel.ts) and the CSS defaults describe the SAME seat:
    // minTop = the 8px safe floor + the 64px trio clearance, defaultLeft = the 12px
    // side anchor. A drift here would make a restored panel jump on first drag.
    expect(MOBILE_CHAT_PANEL_LIMITS.minTop).toBe(8 + 64);
    expect(MOBILE_CHAT_DEFAULT_LEFT).toBe(12);
    // And the width formula is mirrored verbatim (500 cap, 320 floor, 58vw, 16px rim).
    expect(hudMobileCss).toContain('min(500px, max(320px, 58vw), calc(100vw - 16px))');
  });

  it('anchors the open chat log as a side-seated, elevated, var-positioned panel', () => {
    const wrap = ruleBody('body\\.mobile-touch\\.mobile-chat-open #chatlog-wrap');
    // Positioned by the resolved vars (movable), not centered by transform.
    expect(wrap).toMatch(/left:\s*var\(--mobile-chat-left-r\)/);
    expect(wrap).toMatch(/top:\s*var\(--mobile-chat-top-r\)/);
    expect(wrap).toMatch(/height:\s*var\(--mobile-chat-h-r\)/);
    expect(wrap).toMatch(/transform:\s*none/);
    // top+height own the vertical box; a stray bottom from a closed-seat rule must lose.
    expect(wrap).toMatch(/bottom:\s*auto/);
    // Uses the shared width var, not a narrow fixed strip.
    expect(wrap).toMatch(/width:\s*var\(--mobile-chat-w\)/);
    // A flex column so the tab strip stays natural and the frame fills the rest.
    expect(wrap).toMatch(/display:\s*flex/);
    expect(wrap).toMatch(/flex-direction:\s*column/);
    // Raised above the sibling in-HUD frames (which sit in the ~19-45 band).
    const z = Number(wrap.match(/z-index:\s*(\d+)/)?.[1] ?? '0');
    expect(z).toBeGreaterThanOrEqual(50);
  });

  it('fills the open panel with the log frame (drops the ~4-line strip cap)', () => {
    const frame = ruleBody('body\\.mobile-touch\\.mobile-chat-open #chatlog-frame');
    expect(frame).toMatch(/flex:\s*1 1 auto/);
    expect(frame).toMatch(/min-height:\s*0/);
    // The old strip cap (a fixed 4-line height) must not survive into the open state.
    expect(frame).toMatch(/height:\s*auto/);
    const tabs = ruleBody('body\\.mobile-touch\\.mobile-chat-open #chatlog-tabs');
    expect(tabs).toMatch(/flex:\s*0 0 auto/);
  });

  it('places the composer as a flow bar at the top of the panel (desktop-style, in front)', () => {
    const input = ruleBody('body\\.mobile-touch\\.mobile-chat-open #chat-input');
    // The composer is the panel's FIRST child (order -1), a static flow item above the tabs
    // + log, not an absolutely-positioned / docked bar. It no longer needs a z-index lift:
    // main.ts moves it INSIDE #chatlog-wrap (in #ui, z 80), which already paints above the
    // #mobile-controls layer (z 60).
    expect(input).toMatch(/position:\s*static/);
    expect(input).toMatch(/order:\s*-1/);
    expect(input).toMatch(/width:\s*100%/);
    // The right padding reserves the 40px move chip overlaid at the panel's top-right
    // corner, so typed text never runs under it.
    expect(input).toMatch(/padding:\s*9px 50px 9px 12px/);
    // The move is done in main.ts (a flow item inside the panel, not a sibling of #ui).
    expect(mainTs).toContain('ensureMobileComposerInPanel');
    expect(mainTs).toContain('wrap.insertBefore(chatInput, wrap.firstChild)');
    // mobileControlsZ() stays referenced so the pinned control-layer z-index cannot drift
    // out from under the "panel paints in front" reasoning above.
    expect(mobileControlsZ()).toBe(60);
  });

  it('applies the movable panel on the compact tier too (portrait phones)', () => {
    // resolveTier() returns 'compact' whenever width <= 700, so a portrait phone runs
    // the compact tier: its overrides are the PRIMARY path, not an edge case. The
    // closed-seat width/bottom rules (later in the file at equal specificity) would
    // otherwise pin the open chat back to a narrow bottom strip, or (the historical bug
    // class) leave a bottom that beats the top+height model so the handles move while
    // the panel stays put.
    const wrap = ruleBody(
      'body\\.mobile-touch\\.hud-mobile-compact\\.mobile-chat-open #chatlog-wrap',
    );
    expect(wrap).toMatch(/width:\s*var\(--mobile-chat-w\)/);
    expect(wrap).toMatch(/bottom:\s*auto/);
    const frame = ruleBody(
      'body\\.mobile-touch\\.hud-mobile-compact\\.mobile-chat-open #chatlog-frame',
    );
    expect(frame).toMatch(/flex:\s*1 1 auto/);
    expect(frame).toMatch(/height:\s*auto/);
  });

  it('bottom-anchors the open log so recent lines sit near the composer', () => {
    // Classic chat grows from the bottom; in a tall panel the lines must sit at the
    // bottom (nearest the composer), not cluster at the top of a mostly-empty frame.
    const pane = ruleBody(
      'body\\.mobile-touch\\.mobile-chat-open #chatlog-frame \\.chat-pane\\.active',
    );
    expect(pane).toMatch(/display:\s*flex/);
    expect(pane).toMatch(/flex-direction:\s*column/);
    // The non-clipping bottom-anchor trick (collapses to 0 on overflow, unlike
    // justify-content:flex-end which would hide the top of a long log).
    const firstLine = ruleBody(
      'body\\.mobile-touch\\.mobile-chat-open #chatlog-frame \\.chat-pane\\.active > :first-child',
    );
    expect(firstLine).toMatch(/margin-top:\s*auto/);
  });

  it('reserves the resize bar overlap inside the scroller (occlusion fix)', () => {
    // The body-level resize bar straddles the panel's bottom edge: half its height
    // overlaps the last chat lines. The scroller must reserve MORE than that straddle
    // as bottom padding, or the newest message hides behind the bar at every height.
    const handle = ruleBody('body\\.mobile-touch\\.mobile-chat-open \\.chat-mobile-resize');
    const straddle = Number(handle.match(/- 15px\s*\)/) ? 15 : Number.NaN);
    expect(straddle).toBe(15);
    const barH = Number(handle.match(/height:\s*(\d+)px/)?.[1] ?? '0');
    expect(straddle).toBe(barH / 2);
    const pane = ruleBody('body\\.mobile-touch\\.mobile-chat-open #chatlog-frame \\.chat-pane');
    const pad = Number(pane.match(/padding-bottom:\s*(\d+)px/)?.[1] ?? '0');
    expect(pad).toBeGreaterThan(straddle);
  });

  it('gives the read panel a drag-to-resize bottom handle that tracks the panel vars', () => {
    expect(hudMobileCss).toContain('.chat-mobile-resize {\n    display: none;\n  }');
    const handle = ruleBody('body\\.mobile-touch\\.mobile-chat-open \\.chat-mobile-resize');
    expect(handle).toMatch(/display:\s*flex/);
    // Pinned to the panel's bottom edge by the SAME resolved vars the wrap uses.
    expect(handle).toMatch(
      /top:\s*calc\(var\(--mobile-chat-top-r\) \+ var\(--mobile-chat-h-r\) - 15px\)/,
    );
    expect(handle).toMatch(/left:\s*var\(--mobile-chat-left-r\)/);
    expect(handle).toMatch(/width:\s*var\(--mobile-chat-w\)/);
    // A vertical drag must resize, not scroll the log/page; and a high z-index keeps it
    // above any overlay (so nothing can swallow the drag).
    expect(handle).toMatch(/touch-action:\s*none/);
    expect(Number(handle.match(/z-index:\s*(\d+)/)?.[1] ?? '0')).toBeGreaterThanOrEqual(200);
    // chat_mobile_overlay.ts creates the handle as a body-level element (high z) and
    // persists the geometry under its one JSON key.
    expect(overlayTs).toContain("resizeHandle.className = 'chat-mobile-resize';");
    expect(overlayTs).toContain('document.body.appendChild(resizeHandle)');
    expect(overlayTs).toContain("MOBILE_CHAT_PANEL_KEY = 'woc_mobile_chat_panel'");
    expect(overlayTs).toContain('localStorage.setItem(MOBILE_CHAT_PANEL_KEY');
  });

  it('gives the panel a 40x40 move chip inside the wrap (touch-router-owned drag)', () => {
    // Hidden by default (desktop and the long-press peek never show it).
    expect(hudMobileCss).toContain('.chat-mobile-move {\n    display: none;\n  }');
    const chip = ruleBody(
      'body\\.mobile-touch\\.mobile-chat-open #chatlog-wrap \\.chat-mobile-move',
    );
    expect(chip).toMatch(/display:\s*flex/);
    // The 40px mobile touch floor (src/ui/CLAUDE.md): never shrink this below 40.
    expect(Number(chip.match(/width:\s*(\d+)px/)?.[1] ?? '0')).toBeGreaterThanOrEqual(40);
    expect(Number(chip.match(/height:\s*(\d+)px/)?.[1] ?? '0')).toBeGreaterThanOrEqual(40);
    // A drag on the chip must move the panel, never scroll or pan the camera.
    expect(chip).toMatch(/touch-action:\s*none/);
    expect(chip).toMatch(/position:\s*absolute/);
    // The chip is a real button INSIDE #chatlog-wrap: touch_router.ts classifies the wrap
    // as interactive HUD chrome, so the camera can never fight the drag. Its accessible
    // name comes from t() (i18n in scope for every player-visible label).
    expect(overlayTs).toContain("moveHandle.className = 'chat-mobile-move';");
    expect(overlayTs).toContain(
      "moveHandle.setAttribute('aria-label', t('hudChrome.chatWindow.move'))",
    );
    expect(overlayTs).toContain('wrap.appendChild(moveHandle)');
  });

  it('hides both grab affordances while the OS keyboard owns the layout', () => {
    // The keyboard-open rule re-lays the panel to fill the band above the keyboard, so
    // the var-tracked handles would sit stale mid-screen; they hide until it drops.
    expect(hudMobileCss).toMatch(
      /body\.mobile-touch\.mobile-keyboard-open\.mobile-chat-open \.chat-mobile-resize,\s*\n\s*body\.mobile-touch\.mobile-keyboard-open\.mobile-chat-open #chatlog-wrap \.chat-mobile-move \{\s*\n\s*display:\s*none;/,
    );
  });

  it('fills the keyboard-open panel above the keyboard (composer is a flow item, no reservation)', () => {
    const wrap = ruleBody(
      'body\\.mobile-touch\\.mobile-keyboard-open\\.mobile-chat-open #chatlog-wrap',
    );
    // The panel fills the visible-above-keyboard band. The composer is a flow item at the
    // top of the panel, so there is NO --mobile-composer-h reservation and NO
    // --mobile-chat-top clamp (both belonged to the removed docked-composer models).
    expect(wrap).toMatch(/var\(--mobile-keyboard-visible-vh, 100vh\)/);
    expect(wrap).not.toMatch(/--mobile-composer-h/);
    expect(wrap).not.toMatch(/--mobile-chat-bottom/);
  });
});
