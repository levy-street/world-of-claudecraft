import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
// Mobile chat "centered + large + in front" fix. On touch, tapping the Chat button
// used to open the log as a small strip pinned to the bottom-left corner (and the
// composer sat BEHIND the #mobile-controls layer, z-index 25 vs 60). The fix makes
// the open chat a large, horizontally-centered panel that renders in front of the
// in-game controls. These assertions pin that layout so a future edit cannot quietly
// shrink it back into the corner. Everything here is scoped to body.mobile-touch, so
// the classic desktop bottom-left chat panel is untouched.
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

describe('mobile chat centered/large/in-front layout', () => {
  it('defines a large shared panel width var on the open chat', () => {
    const body = ruleBody('body\\.mobile-touch\\.mobile-chat-open');
    // A single DRY width var drives the wrap AND the composer AND the dismiss-chevron
    // offset, so they always agree. It is large: a generous cap that falls back to
    // (viewport - a small margin) on a phone, never the old ~340px strip.
    expect(body).toMatch(/--mobile-chat-w:\s*min\(560px,\s*calc\(100vw - 24px\)\)/);
  });

  it('centers the open chat log horizontally as a wide, tall, elevated panel', () => {
    const wrap = ruleBody('body\\.mobile-touch\\.mobile-chat-open #chatlog-wrap');
    // Horizontally centered (not corner-pinned).
    expect(wrap).toMatch(/left:\s*50%/);
    expect(wrap).toMatch(/transform:\s*translateX\(-50%\)/);
    // Uses the shared large width var, not a narrow fixed strip.
    expect(wrap).toMatch(/width:\s*var\(--mobile-chat-w\)/);
    // A flex column so the tab strip stays natural and the frame fills the rest.
    expect(wrap).toMatch(/display:\s*flex/);
    expect(wrap).toMatch(/flex-direction:\s*column/);
    // Tall: its top clears the top-left Chat button trio (so the close tap survives),
    // pinned decisively (safe-area inset + a real gap that clears the trio), not merely
    // "some calc", so a regression to top:0 that re-covers the Chat button would fail here.
    expect(wrap).toMatch(/top:\s*calc\(max\(8px, env\(safe-area-inset-top\)\) \+ 64px\)/);
    // The bottom is player-resizable via a CLAMPED --mobile-chat-bottom (drag handle), with
    // a small default so the panel is large by default. Whitespace-tolerant: biome breaks
    // the long calc across lines.
    expect(wrap).toMatch(/bottom:\s*calc\([\s\S]*env\(safe-area-inset-bottom\)/);
    expect(wrap).toMatch(/clamp\([\s\S]*var\(--mobile-chat-bottom, 52px\)/);
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
    // The move is done in main.ts (a flow item inside the panel, not a sibling of #ui).
    expect(mainTs).toContain('ensureMobileComposerInPanel');
    expect(mainTs).toContain('wrap.insertBefore(chatInput, wrap.firstChild)');
    // mobileControlsZ() stays referenced so the pinned control-layer z-index cannot drift
    // out from under the "panel paints in front" reasoning above.
    expect(mobileControlsZ()).toBe(60);
  });

  it('applies the centered/large/in-front panel on the compact tier (portrait phones)', () => {
    // resolveTier() returns 'compact' whenever width <= 700, so a portrait phone runs
    // the compact tier: its overrides are the PRIMARY path, not an edge case. Without
    // them, the tier's own closed-seat width/height/bottom rules (which are later in the
    // file at equal specificity) would pin the open chat back to a narrow bottom strip.
    const wrap = ruleBody(
      'body\\.mobile-touch\\.hud-mobile-compact\\.mobile-chat-open #chatlog-wrap',
    );
    expect(wrap).toMatch(/width:\s*var\(--mobile-chat-w\)/);
    // The compact bottom MUST track --mobile-chat-bottom (not a fixed value), or the resize
    // handle moves but the panel never changes size (the real-device resize bug).
    expect(wrap).toMatch(/var\(--mobile-chat-bottom, 52px\)/);
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

  it('fills the keyboard-open panel above the keyboard (composer is a flow item, no reservation)', () => {
    const wrap = ruleBody(
      'body\\.mobile-touch\\.mobile-keyboard-open\\.mobile-chat-open #chatlog-wrap',
    );
    // The panel fills the visible-above-keyboard band. The composer is a flow item at the
    // top of the panel, so there is NO --mobile-composer-h reservation and NO --mobile-chat-top
    // clamp (both belonged to the removed docked-composer / drag-resize models).
    expect(wrap).toMatch(/var\(--mobile-keyboard-visible-vh, 100vh\)/);
    expect(wrap).not.toMatch(/--mobile-composer-h/);
    // The keyboard-open wrap has no composer reservation; the composer flows at the top.
    expect(wrap).not.toMatch(/--mobile-chat-bottom/);
  });

  it('gives the read panel a drag-to-resize bottom handle (persisted)', () => {
    // The panel's bottom inset is player-resizable: a bottom grabber drives
    // --mobile-chat-bottom, clamped in CSS so a saved value stays valid across orientations.
    expect(hudMobileCss).toContain('.chat-mobile-resize {\n    display: none;\n  }');
    const handle = ruleBody('body\\.mobile-touch\\.mobile-chat-open \\.chat-mobile-resize');
    expect(handle).toMatch(/display:\s*flex/);
    // A vertical drag must resize, not scroll the log/page; and a high z-index keeps it
    // above any overlay (so nothing can swallow the drag).
    expect(handle).toMatch(/touch-action:\s*none/);
    expect(Number(handle.match(/z-index:\s*(\d+)/)?.[1] ?? '0')).toBeGreaterThanOrEqual(200);
  });
});
