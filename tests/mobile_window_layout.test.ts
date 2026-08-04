import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

describe('mobile window layout CSS', () => {
  it('clamps generic mobile windows to the app viewport and reserves bottom padding', () => {
    const start = mobileCss.indexOf('body.mobile-touch .window {');
    expect(start).toBeGreaterThan(0);
    const block = mobileCss.slice(start, mobileCss.indexOf('}', start));
    expect(block).toContain(
      'max-width: calc(var(--app-vw, 100vw) / var(--window-scale, 1) - 20px);',
    );
    expect(block).toContain(
      'padding-bottom: max(var(--window-pad), calc(18px + env(safe-area-inset-bottom)));',
    );
  });

  it('does not keep the old cramped mobile 100vw minus 170px window width', () => {
    expect(mobileCss).not.toContain('calc(100vw - 170px)');
    expect(mobileCss).toContain(
      'width: min(430px, calc(var(--app-vw) / var(--ui-scale, 1) - 20px));',
    );
    expect(mobileCss).toContain(
      'width: min(560px, calc(var(--app-vw) / var(--ui-scale, 1) - 20px));',
    );
  });

  it('keeps mobile tab and filter rows scrollable instead of clipping labels', () => {
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.bag-chips \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #social-window \.soc-tabs \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/,
    );
  });

  it('hides the mobile bottom action bar only while a truly fullscreen window (bags/char) is open', () => {
    expect(mobileCss).toMatch(
      /body\.mobile-touch\.mobile-fullscreen-window-open #bottom-bar \{[^}]*display: none;/,
    );
    // Regression guard: this must NOT be gated on the broad "any window open"
    // class, or partial windows (loot, lockpick, delve-rite, map, ...) would
    // hide the player's own HP/resource frame while they still leave real
    // screen visible underneath.
    expect(mobileCss).not.toMatch(
      /body\.mobile-touch\.mobile-window-open #bottom-bar \{[^}]*display: none;/,
    );
  });

  it('sizes the mobile map from the app viewport so zoom controls do not dominate it', () => {
    const start = mobileCss.indexOf('body.mobile-touch #map-window {');
    expect(start).toBeGreaterThan(0);
    const block = mobileCss.slice(start, mobileCss.indexOf('}', start));
    expect(block).toContain('width: min(330px, calc(var(--app-vw) / var(--ui-scale, 1) - 32px));');
    expect(block).toContain('max-width: calc(var(--app-vw) / var(--ui-scale, 1) - 32px);');
  });

  it('shows all three mobile specializations in one compact grid without horizontal drag', () => {
    expect(mobileCss).not.toMatch(/body\.mobile-touch #talents-window \{[^}]*column-count: 2;/);
    expect(mobileCss).toMatch(
      /body\.mobile-touch #talents-window \{[^}]*width: min\(620px,[^}]*transform: translate\(-50%, -50%\);[^}]*overflow-x: hidden;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #talents-window \.ts-specs-grid \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
    );
    expect(mobileCss).not.toMatch(
      /body\.mobile-touch #talents-window \.ts-specs-grid \{[^}]*flex-direction: column;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #talents-window \.ts-panel \{[^}]*min-height: 150px;/,
    );
  });

  it('scales the vendor window bottom clamp by --window-scale instead of a raw dvh', () => {
    const start = mobileCss.indexOf('body.mobile-touch #vendor-window {\n    max-height:');
    expect(start).toBeGreaterThan(0);
    const block = mobileCss.slice(start, mobileCss.indexOf('}', start));
    expect(block).toContain(
      'max-height: calc(\n      var(--app-vh) /\n      var(--window-scale, 1) -\n      12px -\n      max(10px, env(safe-area-inset-bottom))\n    );',
    );
    expect(block).not.toContain('100dvh');
  });

  it('places the Claudium wallet card beside the balance in mobile landscape', () => {
    expect(mobileCss).toContain(`@media (orientation: landscape) {
    body.mobile-touch #claudium-window .cl-body:has(> .cl-wallet-connect) {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: stretch;
      gap: 10px;
    }`);
    expect(mobileCss).toContain(`body.mobile-touch
      #claudium-window
      .cl-body:has(> .cl-wallet-connect)
      > :not(.cl-balance, .cl-wallet-connect) {
      grid-column: 1 / -1;
    }`);
    expect(mobileCss).toContain(`body.mobile-touch #claudium-window .cl-wallet-connect {
      margin-top: 0;
    }`);
  });

  it('reduces the shared market control grid to one column on mobile touch', () => {
    // Search and filters share the desktop grid, so mobile changes the column definition
    // directly. No nested flex basis may return and turn a control width into its height.
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.mkt-controls \{[^}]*grid-template-columns: 1fr;[^}]*align-items: stretch;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.mkt-search \{[^}]*max-width: none;[^}]*min-height: 40px;/,
    );
    expect(mobileCss).toMatch(/body\.mobile-touch \.mkt-filter \{[^}]*max-width: none;/);
    expect(mobileCss).not.toMatch(/body\.mobile-touch \.mkt-(?:search|filter) \{[^}]*\bflex:/);
    expect(mobileCss).not.toContain('body.mobile-touch .mkt-filters {');
  });

  it('floors the vendor purchase-quantity controls at 40px under a coarse pointer (phase 21)', () => {
    // The control row lives in components.css beside the rest of the vendor
    // family; the coarse-pointer floor is the mobile tap-target contract the
    // desktop chip size must never squeeze away.
    const components = readFileSync(
      new URL('../src/styles/components.css', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(components).toMatch(
      /@media \(pointer: coarse\) \{\s*\.vendor-qty-btn \{[^}]*min-width: 40px;[^}]*min-height: 40px;/,
    );
  });

  it('floors the shared prompt-family action buttons at 40px under a coarse pointer (phase 21 QA)', () => {
    // The bags/bank/vendor quantity prompts share one recipe; the vendor
    // custom-amount prompt made those buttons a mobile purchase surface, so
    // the tap floor lives on the shared .prompt .btn rule in hud.css.
    const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    expect(hudCss).toMatch(
      /@media \(pointer: coarse\) \{\s*\.prompt \.btn \{[^}]*min-width: 40px;[^}]*min-height: 40px;/,
    );
  });
});
