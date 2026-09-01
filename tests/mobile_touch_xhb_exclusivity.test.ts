import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Mobile-controller exclusivity: pairing a gamepad to the phone is three
// stand-up/stand-down moves, all keyed off the SAME class, .xhb-mode
// (cross_hotbar_wiring.ts's syncPadMode: the cross hotbar enabled AND the pad
// connected), never raw pad connection (a player who disables the cross
// hotbar overlay keeps the touch chrome instead of a HUD with none of it):
//   1. Touch gameplay chrome (move/camera/action ring) stands down.
//   2. The XHB stands up as the one hotbar (it is the pad's stance surface
//      too, see cross_hotbar_wiring.ts's crossHotbarSeed), with its lift
//      intact so the player frame still clears it.
//   3. The desktop #side-buttons micromenu rail stands up too, so the pad's
//      right-stick mouse mode (src/game/gamepad.ts) has menu targets, same as
//      on desktop; Quick Actions stays available for the touch path.
// These assertions pin all of it plus the main.ts wiring, so a future edit
// cannot silently re-fork the standdowns onto different conditions or
// reintroduce separate pad-connected chrome state.

const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const hudMobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

function ruleBody(selector: string): string {
  return hudMobileCss.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('the touch-input chrome stands down for a pad only once it takes the XHB band', () => {
  const selector =
    'body\\.mobile-touch\\.xhb-mode #mobile-move-zone,\\s*\\n\\s*' +
    'body\\.mobile-touch\\.xhb-mode #mobile-move-joystick,\\s*\\n\\s*' +
    'body\\.mobile-touch\\.xhb-mode #mobile-camera-joystick,\\s*\\n\\s*' +
    'body\\.mobile-touch\\.xhb-mode #mobile-action-ring';

  it('hides exactly the movement/camera/action-ring surfaces the pad replaces', () => {
    const body = ruleBody(selector);
    expect(
      body,
      'the four-selector xhb-mode standdown rule was not found as expected',
    ).toBeTruthy();
    expect(body.trim()).toBe('display: none;');
  });

  it('may reposition the Quick Actions seat in xhb-mode (out of the XHB band it used to sit in) but never hides it', () => {
    // Amended per the PR #3658 re-review: the seat sits inside the XHB's own
    // band once the bar stands up (blocking finding), so it moves clear of it
    // instead of standing down; #mobile-menu-anchor itself must never be
    // toggled to display:none either, in xhb-mode or its left-handed mirror.
    for (const selector of [
      'body\\.mobile-touch\\.xhb-mode:not\\(\\.mobile-left-handed\\) #mobile-combat-controls',
      'body\\.mobile-touch\\.xhb-mode\\.mobile-left-handed #mobile-combat-controls',
    ]) {
      const body = ruleBody(selector);
      if (body) expect(body).not.toMatch(/display:\s*none/);
    }
    expect(hudMobileCss).not.toMatch(/\.xhb-mode #mobile-menu-anchor\s*\{\s*\n?\s*display:\s*none/);
  });

  it('is no longer keyed off a separate pad-connected class', () => {
    expect(hudMobileCss).not.toMatch(/pad-connected/);
  });

  it('stays inside @layer hud-mobile (css_layer_containment.test.ts pins the whole file)', () => {
    const layerOpenAt = hudMobileCss.indexOf('@layer hud-mobile {');
    const ruleAt = hudMobileCss.indexOf('body.mobile-touch.xhb-mode #mobile-move-zone');
    expect(layerOpenAt).toBeGreaterThanOrEqual(0);
    expect(ruleAt).toBeGreaterThan(layerOpenAt);
  });
});

describe('the cross hotbar overlay stands alone once it takes over: it does not also stand down', () => {
  it('scopes the touch standdown to :not(.xhb-mode), so the overlay shows once the pad drives it', () => {
    const body = ruleBody('body\\.mobile-touch:not\\(\\.xhb-mode\\) \\.xhb');
    expect(body.trim()).toBe('display: none;');
    // The old, unconditional selector must be gone, not merely shadowed by a
    // later rule: a stray `body.mobile-touch .xhb { display: none; }` would
    // re-hide the bar regardless of source order once both apply.
    expect(hudMobileCss).not.toMatch(/body\.mobile-touch \.xhb \{/);
  });

  it('zeroes --xhb-lift only outside xhb-mode, so the visible bar keeps lifting the player frame clear', () => {
    const body = ruleBody('body\\.mobile-touch:not\\(\\.xhb-mode\\)');
    expect(body).toContain('--xhb-lift: 0px !important;');
    expect(hudMobileCss).not.toMatch(/body\.mobile-touch \{\s*\n\s*--xhb-lift: 0px !important;/);
  });

  it('drops the dead #mobile-stance-anchor exemption (it is a child of the ring the standdown above hides, so visibility:visible could never survive the ancestor display:none)', () => {
    expect(hudMobileCss).not.toMatch(/#mobile-stance-anchor\s*\{\s*\n\s*visibility: visible;/);
  });
});

describe('main.ts syncs xhb-mode alone on every pad connection-state change', () => {
  it('no longer imports the redundant pad-connected module', () => {
    expect(mainTs).not.toContain('mobile_pad_chrome');
  });

  // The two call sites share one reference (syncXhbPadMode) rather than each
  // inlining its own arrow function: a shared reference cannot smuggle extra
  // pad-connected-shaped logic in at either site the way a repeated inline
  // block body could, which is a STRONGER form of the invariant these tests
  // used to pin against two separate inline closures.
  it('defines exactly one syncXhbPadMode delegate to crossHotbar.syncPadMode(gamepad), with nothing else pad-connected-shaped in it', () => {
    const block = mainTs.match(/const syncXhbPadMode = \(\) => ([^;]+);/)?.[1] ?? '';
    expect(block, 'syncXhbPadMode declaration not found').toBeTruthy();
    expect(block.trim()).toBe('crossHotbar.syncPadMode(gamepad)');
    expect(mainTs).not.toMatch(/applyPadConnectedClass|pad-connected/);
  });

  it('wires syncXhbPadMode into GamepadManager.onConnectionChange', () => {
    expect(mainTs).toMatch(/onConnectionChange:\s*syncXhbPadMode,/);
  });

  it('wires syncXhbPadMode into the gamepadEnabled setting applier too (start/stop is synchronous, no event fires)', () => {
    expect(mainTs).toMatch(/createGamepadSettingApplier\(gamepad, settings, syncXhbPadMode\)/);
  });
});

describe('the desktop micromenu rail stands back up for the pad, so its mouse mode has menu targets', () => {
  it('scopes the #side-buttons standdown to :not(.xhb-mode)', () => {
    const body = ruleBody('body\\.mobile-touch:not\\(\\.xhb-mode\\) #side-buttons');
    expect(body.trim()).toBe('display: none;');
    expect(hudMobileCss).not.toMatch(/body\.mobile-touch #side-buttons \{/);
  });

  it('keeps the standalone chest button hidden either way (its mobile equivalent lives in the More tray)', () => {
    const body = ruleBody('body\\.mobile-touch #daily-rewards-button');
    expect(body.trim()).toBe('display: none !important;');
  });

  it('never drops the revived rail buttons below the 24px WCAG 2.5.8 touch floor (src/ui/CLAUDE.md)', () => {
    expect(hudMobileCss).not.toMatch(
      /body\.mobile-touch\.xhb-mode #side-buttons \.micro-btn \{\s*\n\s*height: (?:1\d|2[0-3])px;/,
    );
  });

  it('trims the rail to launchers with no Quick Actions equivalent, so the shorter columns clear the touch floor without a sub-floor button height', () => {
    const selector =
      'body\\.mobile-touch\\.xhb-mode #mm-char,\\s*\\n\\s*' +
      'body\\.mobile-touch\\.xhb-mode #mm-spell,\\s*\\n\\s*' +
      'body\\.mobile-touch\\.xhb-mode #mm-quest,\\s*\\n\\s*' +
      'body\\.mobile-touch\\.xhb-mode #mm-map,\\s*\\n\\s*' +
      'body\\.mobile-touch\\.xhb-mode #mm-bag,\\s*\\n\\s*' +
      'body\\.mobile-touch\\.xhb-mode #mm-social,\\s*\\n\\s*' +
      'body\\.mobile-touch\\.xhb-mode #mm-options';
    const body = ruleBody(selector);
    expect(
      body,
      'the seven-selector duplicate-launcher standdown was not found as expected',
    ).toBeTruthy();
    expect(body.trim()).toBe('display: none;');
  });
});

describe('the revived micromenu rail stands down the progress trackers sharing its corner, except the live delve run', () => {
  // Amended per the PR #3658 second re-review: the whole stack used to stand
  // down here (same top:140px seat as the rail, and the deed/reliquary
  // compact-tier hit-box extension out-z-indexed it). That blanket hide also
  // took #delve-tracker with it, which is a live mid-run tracker (objectives,
  // active affixes), not progress chrome, so a pad player lost it exactly
  // when a desktop pad player keeps it. #rift-tracker carries the same kind of
  // active pacing info, so only deed/reliquary stand down and the stack itself
  // re-seats to the left instead.
  it('hides #deed-tracker and #reliquary-tracker in xhb-mode (progress chrome, no graphics-fairness concern)', () => {
    const body = ruleBody(
      'body\\.mobile-touch\\.xhb-mode #deed-tracker,\\s*\\n\\s*' +
        'body\\.mobile-touch\\.xhb-mode #reliquary-tracker',
    );
    expect(body.trim()).toBe('display: none;');
  });

  it('does NOT hide #delve-tracker or #rift-tracker: both carry live mid-run actionable info', () => {
    expect(hudMobileCss).not.toMatch(/\.xhb-mode #delve-tracker\s*\{\s*\n?\s*display:\s*none/);
    expect(hudMobileCss).not.toMatch(/\.xhb-mode #rift-tracker\s*\{\s*\n?\s*display:\s*none/);
  });

  // Amended per the PR #3658 third re-review: a flat top-anchor put the
  // tracker fully inside the XHB band at UI Scale 1.4 (both this stack and
  // .xhb live inside the zoomed #ui, but only .xhb's own seat moved with
  // it). Bottom-anchoring by the same kind of flat literal .xhb uses keeps
  // the two in lockstep at every scale instead.
  it("re-seats #right-tracker-stack to the left edge (bottom-anchored, not top) instead of standing it down, mirroring #quest-strip's own left-side seat", () => {
    const body = ruleBody('body\\.mobile-touch\\.xhb-mode #right-tracker-stack');
    expect(body.trim()).toBe(
      [
        'left: max(20px, calc(env(safe-area-inset-left) + 10px));',
        'right: auto;',
        'top: auto !important;',
        'bottom: 172px;',
        'z-index: 4;',
      ].join('\n    '),
    );
  });

  // The re-seat seats z-index 4, UNDER #party-frames' 5 (hud.css): a duo
  // delve party (delves cap at 2 players) can expand into this same
  // corner, and party HP must win the paint order over progress-style
  // delve info on the rare overlap (graphics-fairness).
  it("re-seats under #party-frames' z-index so an expanded duo party's HP always paints on top of the tracker on the rare overlap", () => {
    const body = ruleBody('body\\.mobile-touch\\.xhb-mode #right-tracker-stack');
    expect(body).toContain('z-index: 4;');
  });

  // The cap is scale-aware, not a flat px value: a flat cap grows in RENDERED
  // terms right along with the stack's own zoomed bottom anchor under a high
  // UI Scale and runs out of room toward #quest-strip, which is NOT zoomed
  // (a sibling of #ui, so its own real-px footprint never moves). Subtracting
  // the unzoomed quest-strip budget from --app-vh BEFORE dividing by
  // --ui-scale is what keeps this positive (not clamped to 0, invisible) at
  // UI Scale 1.4.
  it("bounds the live trackers' own height in this seat with the app-vh/ui-scale idiom (not a flat px cap), so they stay positive at UI Scale 1.4 instead of clamping to 0", () => {
    const body = ruleBody(
      'body\\.mobile-touch\\.xhb-mode #delve-tracker,\\s*\\n\\s*' +
        'body\\.mobile-touch\\.xhb-mode #rift-tracker',
    );
    expect(body).toContain(
      'max-height: calc((var(--app-vh, 100vh) - 128px) / var(--ui-scale, 1) - 172px);',
    );
    expect(body).toContain('overflow-y: auto;');
  });

  // pointer-events is none on every tracker in this stack except one
  // interactive row (hud.css), so without this override the scroll above is
  // decorative: a touch drag falls through to the canvas instead of moving
  // scrollTop (confirmed live with a real CDP wheel event, not just a
  // computed-style check).
  it('makes the live trackers pointer-events: auto in this seat, so the scroll bound above is a real affordance rather than dead overflow:hidden', () => {
    const body = ruleBody(
      'body\\.mobile-touch\\.xhb-mode #delve-tracker,\\s*\\n\\s*' +
        'body\\.mobile-touch\\.xhb-mode #rift-tracker',
    );
    expect(body).toContain('pointer-events: auto;');
  });
});

describe('the lift composes into the mobile #player-frame/#castbar transform in xhb-mode', () => {
  // hud.css's body.xhb-mode rule only ever sets translateY: this file's own
  // mobile transforms (later in the cascade, @layer hud-mobile) fully replace
  // that single `transform` property rather than adding to it, so the lift
  // has to be composed directly into the mobile rule or the frame never moves
  // clear of a visible XHB bar.
  it('composes the lift into #castbar (the only #castbar transform rule in this file)', () => {
    const body = ruleBody('body\\.mobile-touch\\.xhb-mode #castbar');
    expect(body).toContain('translateX(-50%)');
    expect(body).toContain('translateY(calc(-1 * var(--xhb-lift, 56px)))');
  });

  it('composes the lift into the PORTRAIT #player-frame scale (0.82)', () => {
    const body = ruleBody('body\\.mobile-touch\\.xhb-mode #player-frame');
    expect(body).toContain('translateY(calc(-1 * var(--xhb-lift, 56px)))');
    expect(body).toContain('scale(calc(0.82 * var(--mobile-chrome-scale, 1)))');
  });

  it('ALSO composes the lift into the LANDSCAPE #player-frame scale (0.6): the touch HUD is landscape-only, so this is the rule that actually governs real play, not the portrait one above', () => {
    const landscapeOpenAt = hudMobileCss.indexOf('@media (orientation: landscape) {');
    const bothRules = [
      ...hudMobileCss.matchAll(/body\.mobile-touch\.xhb-mode #player-frame \{([^}]*)\}/g),
    ];
    expect(
      bothRules.length,
      'expected both the portrait and landscape xhb-mode #player-frame rules',
    ).toBe(2);
    const landscapeRule = bothRules.find((m) => (m.index ?? -1) > landscapeOpenAt);
    expect(
      landscapeRule,
      'no xhb-mode #player-frame override found after the landscape media open',
    ).toBeTruthy();
    const body = landscapeRule?.[1] ?? '';
    expect(body).toContain('translateY(calc(-1 * var(--xhb-lift, 56px)))');
    expect(body).toContain('scale(calc(0.6 * var(--mobile-chrome-scale, 1)))');
  });
});
