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
});
