import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  // Comment-stripped, like every other source-text pin in the suite: without
  // this a commented-out declaration satisfies the regex reads below, and
  // these pins are the only automated coverage of the mobile floors and
  // reserves (the measuring rig is manual).
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block (selector to closing brace) that carries `needle`,
 *  optionally the one whose selector line is `selector`. Anchoring on a
 *  declaration rather than on a line offset keeps these pins readable when the
 *  surrounding comments move, which they do every time the reasoning is
 *  written down. */
function blockContaining(needle: string, selector?: string): string {
  const blocks = mobileCss.split('\n  }');
  const hit = blocks.find(
    (b) => b.includes(needle) && (selector === undefined || b.includes(selector)),
  );
  expect(hit, `a block carrying ${needle}${selector ? ` under ${selector}` : ''}`).toBeDefined();
  return hit ?? '';
}

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

  it('scopes the bank one-row toolbar contract to the short-phone footer regime, with its yield', () => {
    // The nowrap lives HERE, on the footer regime, never on a bare
    // #bank-window in components.css: a desktop window resized toward its
    // 220px floor must wrap rather than clip controls off the edge. The
    // browser arm (tests/browser/bank_mobile_chrome.browser.test.ts) proves
    // the geometry; this pin keeps the RULE from being deleted, unscoped, or
    // quietly moved back where the default vitest run would never notice.
    expect(mobileCss).toMatch(
      /body\.mobile-touch #bank-window:has\(\.bank-footer\) \.bag-tools,\s*body\.mobile-touch\.bank-open #bank-window:has\(\.bank-footer\) \.bag-tools \{[^}]*flex-wrap: nowrap;/,
    );
    // The yield that makes nowrap safe under a wordy locale: the deposit
    // button shrinks with an ellipsis instead of clipping off the
    // overflow-hidden window edge (es/es_ES measured 52px past the row at
    // 740x360 without it).
    expect(mobileCss).toMatch(
      /body\.mobile-touch #bank-window:has\(\.bank-footer\) \.bank-deposit-all,\s*body\.mobile-touch\.bank-open #bank-window:has\(\.bank-footer\) \.bank-deposit-all \{[^}]*text-overflow: ellipsis;/,
    );
    const componentsCss = readFileSync(
      new URL('../src/styles/components.css', import.meta.url),
      'utf8',
    );
    expect(componentsCss).not.toMatch(/#bank-window \.bag-tools \{[^}]*flex-wrap: nowrap/);
  });

  it('keeps mobile Daily Rewards in one vertical scroller above the open-window layer', () => {
    const rewardsWindow = mobileCss.match(
      /body\.mobile-touch #daily-rewards-window:not\(\.store-active\) \{([^}]*)\}/,
    );
    expect(rewardsWindow).not.toBeNull();
    expect(rewardsWindow?.[1]).toContain(
      'width: min(560px, calc(var(--app-vw) / var(--ui-scale, 1) - 20px));',
    );

    const rewardsBody = mobileCss.match(
      /body\.mobile-touch #daily-rewards-window:not\(\.store-active\) \.dr-body \{([^}]*)\}/,
    );
    expect(rewardsBody).not.toBeNull();
    expect(rewardsBody?.[1]).toContain('columns: initial;');
    expect(rewardsBody?.[1]).toContain('overflow-x: hidden;');
    expect(rewardsBody?.[1]).toContain('overflow-y: auto;');
    expect(rewardsBody?.[1]).toContain('overscroll-behavior: contain;');
    expect(rewardsBody?.[1]).not.toContain('column-count:');
    expect(rewardsBody?.[1]).not.toContain('column-count: 2;');

    const spinOverlayZ = Number(
      mobileCss.match(/body\.mobile-touch \.dr-spin-overlay \{[^}]*z-index: (\d+);/)?.[1],
    );
    const openUiZ = Number(
      mobileCss.match(/body\.mobile-touch\.mobile-window-open #ui \{[^}]*z-index: (\d+);/)?.[1],
    );
    const backdropZ = Number(
      mobileCss.match(
        /body\.mobile-touch\.mobile-window-open #mobile-window-backdrop \{[^}]*z-index: (\d+);/,
      )?.[1],
    );
    expect(spinOverlayZ).toBeGreaterThan(openUiZ);
    expect(openUiZ).toBeGreaterThan(backdropZ);

    const components = readFileSync(
      new URL('../src/styles/components.css', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    expect(components).toMatch(/\.dr-spin-overlay \{[^}]*z-index: 60;/);

    expect(mobileCss).toMatch(
      /body\.mobile-touch \.dr-spin-stage \{[^}]*width: min\(360px, calc\(var\(--app-vw, 100vw\) - 24px\), calc\(var\(--app-vh, 100dvh\) - 24px\)\);/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.dr-spin-wheel-big \{[^}]*width: 300px;[^}]*max-width: 84%;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.dr-spin-wheel-big span \{[^}]*translateY\(-106px\)/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.dr-spin-result \{[^}]*width: 120px;[^}]*height: 120px;[^}]*font-size: 18px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.dr-spin-pointer \{[^}]*border-left-width: 13px;[^}]*border-right-width: 13px;[^}]*border-top-width: 24px;/,
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

  it('floors the money-surface consent controls and the bid field on touch (the Exchange and the trade arm)', () => {
    // A checkbox cannot be 40px without looking broken, so the LABEL is the
    // tap target and carries the floor; the terms link beside it is the
    // smallest money-surface tap target and gets an inline-flex floor of its
    // own; the box itself is sized 24px; the legal caption is floored to the
    // window's 16px button size; the bid amount field joins the 40px floor.
    // Literal mobile layout values, pinned here like their siblings.
    expect(mobileCss).toMatch(
      /body\.mobile-touch #woc-market-window label\.wm-terms,\s*body\.mobile-touch #woc-market-window label\.wm-offer-next,\s*body\.mobile-touch #trade-window \.trade-woc-terms \{\s*min-height: 40px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #woc-market-window \.wm-terms-link,\s*body\.mobile-touch #trade-window \.trade-woc-terms-link \{[^}]*display: inline-flex;[^}]*min-height: 40px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #woc-market-window label\.wm-terms input,\s*body\.mobile-touch #woc-market-window label\.wm-offer-next input,\s*body\.mobile-touch #trade-window \.trade-woc-terms input \{[^}]*width: 24px;[^}]*height: 24px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #trade-window \.trade-woc-terms,\s*body\.mobile-touch #trade-window \.trade-woc-terms-link \{\s*font-size: 16px;/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #woc-market-window \.wm-bid-form input\[data-field="bid-usd"\] \{\s*min-height: 40px;/,
    );
  });

  it('reserves the sticky commit row and the sticky header on the trade sheet', () => {
    // Both reserves are load-bearing and both were wrong once. The BOTTOM one
    // must mirror the window's own inset-aware padding-bottom (the generic rule
    // pinned above): built on the flat --window-pad token it came up 15px short
    // on a phone with a home indicator, and a headless capture cannot see that
    // because it reports zero insets. The TOP one clears the sticky
    // .window > .panel-title, which paints over the sheet scrolling beneath it.
    const block = blockContaining('scroll-padding-bottom:', 'body.mobile-touch #trade-window {');
    // The DECLARATION, not the block: the block also carries the prose that
    // explains the value, and prose satisfies a substring check on its own.
    const reserve = /scroll-padding-bottom:([^;]+);/.exec(block)?.[1] ?? '';
    expect(reserve, 'the bottom reserve is declared').not.toBe('');
    // Tied to the GENERIC rule's own declaration, not to a second copy of the
    // literal: pinning each separately lets the generic padding be retuned, its
    // own pin updated, and the reserve silently under-cover by the difference.
    const generic = blockContaining('padding-bottom: max(', 'body.mobile-touch .window {');
    const padding = /padding-bottom:([^;]+);/.exec(generic)?.[1]?.trim() ?? '';
    expect(padding, 'the generic mobile window declares an inset-aware padding').not.toBe('');
    expect(reserve.replace(/\s+/g, ' '), 'the reserve carries that exact expression').toContain(
      padding.replace(/\s+/g, ' '),
    );
    expect(reserve).toContain('40px');
    // The TOP reserve is tied to the header's own declared floor the same way,
    // rather than repeating the number and hoping: move the floor and this
    // reds instead of the reserve going stale 800 lines away.
    const header = blockContaining('min-height:', 'body.mobile-touch .window > .panel-title {');
    const headerFloor = /min-height:\s*([0-9]+px);/.exec(header)?.[1] ?? '';
    expect(headerFloor, 'the mobile header declares a height floor').toMatch(/^\d+px$/);
    const top = /scroll-padding-top:([^;]+);/.exec(block)?.[1] ?? '';
    expect(top, 'the top reserve is built from that floor').toContain(headerFloor);
    expect(top, 'and clears it rather than just meeting it').toContain('var(--spacing-sm)');
  });

  it('does not pin the money sheets to both edges (a short sheet must not stretch)', () => {
    // A fixed element with height:auto and BOTH top and bottom set fills the
    // screen: a two-line trade painted a 400px panel with its commit row at the
    // bottom of an empty sheet. The inset-aware max-height is what keeps the
    // sheet on screen; the bottom pin belongs only to the side-by-side split.
    for (const id of ['#trade-window', '#woc-market-window']) {
      const block = blockContaining(
        'top: calc(max(10px, env(safe-area-inset-top)) / var(--ui-scale, 1));',
        `body.mobile-touch ${id} {`,
      );
      expect(block, `${id} pins its top inset`).toContain(
        'top: calc(max(10px, env(safe-area-inset-top))',
      );
      expect(block, `${id} subtracts both insets from its cap`).toContain(
        'max(10px, env(safe-area-inset-bottom))',
      );
      // EVERY block that names the sheet, not only the one above: a re-added
      // pin would most naturally land in the rule this sheet SHARES with
      // #social-window, which sets exactly that for itself.
      for (const other of mobileCss.split('\n  }')) {
        if (!other.includes(`${id} {`) && !other.includes(`${id},`)) continue;
        if (other.includes(':has(#trade-window')) continue; // the split dock, below
        expect(other, `no block may pin ${id}'s bottom edge`).not.toMatch(/\n\s*bottom: (?!auto)/);
      }
    }
    // ...and the split dock KEEPS both pins, because a side-by-side sheet is
    // meant to be full height. That is the other half of the same decision.
    const split = mobileCss
      .split('\n  }')
      .find((b) => b.includes(':has(#trade-window') && b.includes('position: fixed'));
    expect(split, 'the side-by-side split rule exists').toBeDefined();
    expect(split ?? '', 'the split dock pins both edges').toMatch(/\n\s*bottom: calc\(max\(10px/);
  });

  it('gives the phone Exchange rows their rhythm, first row included', () => {
    // The 15 sign-off note: taller cells than the desktop 6px, and the first
    // row clears the header hairline with its own top padding instead of
    // starting flush against it.
    const rows = blockContaining('padding-top: 12px;', '#woc-market-window .wm-table td');
    expect(rows).toContain('padding-bottom: 12px;');
    const first = blockContaining('padding-top: 16px;', 'tbody tr:first-child td');
    expect(first).toContain('#woc-market-window');
  });

  it('the split dock marker is the one the HUD actually stamps', () => {
    // The split rule keys on [data-window-open="1"] on BOTH #trade-window and
    // #bags, and the stamp lives in hud.ts as dataset.windowOpen. Renaming
    // either side alone would silently restore "bags covers the trade window
    // entirely" (the blocking mobile defect this pass fixed), and only the
    // manual BAGS_OVER E2E arm could see it; this cross-file pin is the cheap
    // in-gate guard.
    expect(mobileCss).toContain(
      ':has(#trade-window[data-window-open="1"]):has(#bags[data-window-open="1"])',
    );
    // Comment-stripped like the CSS read above: a commented-out stamp left by
    // a refactor must not keep this green.
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|(?<!:)\/\/[^\n]*/g,
      '',
    );
    expect(hud, 'the HUD stamps the marker the selector reads').toContain(
      "dataset.windowOpen = '1'",
    );
    expect(hud, 'and clears it on close').toContain('delete el.dataset.windowOpen');
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

  it('clips the mobile action-page indicator instead of wrapping a locale-widened label (#2975)', () => {
    // hudChrome.mobile.actionPageIndicator's English value is a bare digit, but
    // a locale can translate it into a real word (ja_JP appends "ページ"). Without
    // this, the wider string wraps inside the flex column and the circular
    // badge shows a garbled multi-line stack instead of the page number.
    const toggle = mobileCss.match(/body\.mobile-touch #mobile-action-page-toggle \{([^}]*)\}/);
    expect(toggle).not.toBeNull();
    expect(toggle?.[1]).toContain('overflow: hidden;');

    const indicator = mobileCss.match(
      /body\.mobile-touch #mobile-action-page-toggle \.mobile-action-page-indicator \{([^}]*)\}/,
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.[1]).toContain('white-space: nowrap;');
    expect(indicator?.[1]).toContain('overflow: hidden;');
    expect(indicator?.[1]).toContain('text-overflow: ellipsis;');
  });
});
