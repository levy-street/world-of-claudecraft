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

  it('keeps the quest-log footer inside the sheet while only its content panes scroll', () => {
    expect(mobileCss).toMatch(
      /body\.mobile-touch #quest-log-window\s*\{[^}]*--mobile-quest-log-content-offset:\s*168px;[^}]*overflow:\s*hidden;/s,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #quest-log-window \.ql-cols\s*\{[^}]*height:\s*min\([^;]+var\(--mobile-quest-log-content-offset\)[^;]+;[^}]*min-height:\s*0;/s,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #quest-log-window \.ql-list\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #quest-log-window \.ql-detail\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*none;/s,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch #quest-log-window \.ql-detail-body\s*\{[^}]*flex:\s*1 1 auto;/s,
    );
  });

  it('reserves a shared scroll-end gap on every major mobile window scroll surface', () => {
    const block =
      mobileCss.match(/body\.mobile-touch \.window\s+:is\([\s\S]*?\)\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toBe('');
    for (const selector of [
      '.bag-grid',
      '.bank-scroll',
      '.soc-body',
      '.ql-list',
      '.ql-detail-body',
      '.spell-list',
      '.lb-body',
      '.dr-body',
      '.delve-shop-list',
      '#market-body',
      '#mailbox-body',
      '.mail-reading-body',
      '.cal-day-pane',
      '#discord-window .dc-body',
    ]) {
      expect(block).toContain(selector);
    }
    expect(block).toContain('padding-bottom: var(--mobile-scroll-end-space);');
    expect(block).toContain('scroll-padding-bottom: var(--mobile-scroll-end-space);');
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
});
