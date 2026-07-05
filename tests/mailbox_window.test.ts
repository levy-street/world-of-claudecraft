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

describe('mailbox_window: recipient autocomplete wiring', () => {
  it('recipient input has role="combobox"', () => {
    expect(painter).toContain('role="combobox"');
  });

  it('recipient input has aria-autocomplete="list"', () => {
    expect(painter).toContain('aria-autocomplete="list"');
  });

  it('recipient listbox has role="listbox"', () => {
    expect(painter).toContain('role="listbox"');
  });

  it('recipient input is wired with aria-controls pointing to the listbox', () => {
    expect(painter).toContain('aria-controls="mail-to-suggest"');
  });

  it('calls searchCharacters when building recipient suggestions', () => {
    expect(painter).toContain('searchCharacters(');
  });

  it('routes filtering/limit logic through recipientSuggestions view helper', () => {
    expect(painter).toContain('recipientSuggestions(');
  });

  it('selecting a suggestion writes the name into the recipient input', () => {
    // selectRecipient sets input.value = name and then clears the list.
    expect(painter).toMatch(/input\.value\s*=\s*name/);
  });

  it('ArrowDown moves the suggestion highlight', () => {
    expect(painter).toContain("'ArrowDown'");
    expect(painter).toContain('moveRecipientSuggest');
  });

  it('ArrowUp moves the suggestion highlight', () => {
    expect(painter).toContain("'ArrowUp'");
  });

  it('Escape closes the suggestion list', () => {
    expect(painter).toMatch(/'Escape'[\s\S]{0,120}renderRecipientSuggest/);
  });

  it('blur clears suggestions after a delay so mousedown can fire first', () => {
    expect(painter).toContain('RECIPIENT_SUGGEST_BLUR_CLEAR_MS');
  });

  it('sets aria-expanded false in the empty-results branch and true in the non-empty branch', () => {
    expect(painter).toMatch(/results\.length === 0[\s\S]{0,240}'aria-expanded', 'false'/);
    expect(painter).toMatch(/results\.length === 0[\s\S]{0,900}'aria-expanded', 'true'/);
  });

  it('aria-activedescendant is set on the highlighted option', () => {
    expect(painter).toContain('aria-activedescendant');
  });

  it('resets suggestion model and debounce timer when the send form is rebuilt and on close', () => {
    expect(painter).toMatch(/renderSend\([\s\S]{0,220}clearTimeout\(this\.recipientSuggestTimer\)/);
    expect(painter).toMatch(/renderSend\([\s\S]{0,320}this\.recipientSuggest = \{ items: \[], index: -1 \}/);
    expect(painter).toMatch(/close\([\s\S]{0,220}clearTimeout\(this\.recipientSuggestTimer\)/);
    expect(painter).toMatch(/close\([\s\S]{0,320}this\.recipientSuggest = \{ items: \[], index: -1 \}/);
  });

  it('routes keyboard wrap-around through wrappedSuggestionIndex view helper', () => {
    expect(painter).toContain('wrappedSuggestionIndex(');
  });
});

describe('mailbox_window: house style', () => {
  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('\u2014'), 'em dash found').toBe(false);
    expect(painter.includes('\u2013'), 'en dash found').toBe(false);
  });
});
