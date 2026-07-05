// Source-level guards for the Ravenpost mailbox painter (the bags_window.test.ts
// shape): the pure inbox/send decisions are unit-tested in mailbox_view.test.ts; here
// we pin the two send-tab contracts that live in painter glue and broke in play:
// the coin inputs select their contents on focus (typing "1" must mean 1g, not the
// "10" you get by appending to the seeded 0), and a send/collect outcome repaints
// the bags window immediately (the inventory cluster must not show stale gold or
// items while the mailbox stays open).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const painter = readFileSync(new URL('../src/ui/mailbox_window.ts', import.meta.url), 'utf8');
const onMailResult = painter.slice(
  painter.indexOf('onMailResult('),
  painter.indexOf('refreshIfChanged('),
);

describe('mailbox_window: coin inputs select their value on focus', () => {
  it('wires a focus listener that selects the whole input', () => {
    expect(painter).toMatch(/addEventListener\('focus',[\s\S]{0,160}\.select\(\)/);
  });

  it('swallows the mouseup that follows a click-to-focus (once), so the selection survives', () => {
    expect(painter).toMatch(/'mouseup',[\s\S]{0,120}preventDefault\(\)[\s\S]{0,120}once: true/);
  });
});

describe('mailbox_window: mail outcomes repaint the inventory cluster', () => {
  it('slices a real onMailResult body to guard against renames', () => {
    expect(onMailResult.length).toBeGreaterThan(0);
  });

  it('repaints the bags window when a send lands (escrow left the purse and bags)', () => {
    const sent = onMailResult.slice(0, onMailResult.indexOf("'collected'"));
    expect(sent).toContain('syncBags(');
  });

  it('repaints the bags window when parcels or coin are collected from a letter', () => {
    const collected = onMailResult.slice(onMailResult.indexOf("'collected'"));
    expect(collected).toContain('syncBags(');
  });
});

describe('mailbox_window: house style', () => {
  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});
