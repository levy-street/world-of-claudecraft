// The character-select delete control. It used to be a full-size red .btn-danger
// rendered BEFORE Enter World, which players hit by reflex; it is now a quiet
// icon-only control rendered AFTER the primary action. These assertions pin the
// three properties that make it safe, each of which a regression would break:
// it is not a button-styled call to action, it still carries its accessible name,
// and the row renders the primary action first.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deleteCharButtonHtml, normalizeDeleteConfirmation } from '../src/ui/char_delete_button';
import { characterRowHtml } from '../src/ui/character_membership_view';

const shell = readFileSync(new URL('../src/styles/shell.css', import.meta.url), 'utf8');

describe('deleteCharButtonHtml', () => {
  it('is not a .btn and never the red .btn-danger call to action', () => {
    const html = deleteCharButtonHtml(false);
    const classes = (html.match(/class="([^"]+)"/)?.[1] ?? '').split(/\s+/);
    expect(classes).not.toContain('btn');
    expect(classes).not.toContain('btn-danger');
    expect(classes).toContain('char-delete-btn');
  });

  it('renders an icon, not a text label, but keeps its accessible name', () => {
    const html = deleteCharButtonHtml(false);
    expect(html).toContain('<svg');
    // The name is the same t('character.delete') string the old label rendered, so a
    // screen reader user loses nothing: it moved from the label to aria-label.
    expect(html).toMatch(/aria-label="[^"]+"/);
    // No visible text node: the glyph is the whole button body.
    expect(html.replace(/<svg[\s\S]*?<\/svg>/, '')).not.toMatch(/>[^<>]*[A-Za-z][^<>]*</);
  });

  it('stays disabled and explains itself while the character is in the world', () => {
    const online = deleteCharButtonHtml(true);
    expect(online).toContain('disabled');
    expect(online).toMatch(/title="[^"]+"/);
    expect(deleteCharButtonHtml(false)).not.toContain('disabled');
  });
});

describe('character row order', () => {
  it('renders the primary action BEFORE the delete control in every row variant', () => {
    // The reflex click (and the first Tab stop) must land on the action the player
    // came for, never on the irreversible one.
    for (const [primary, flags] of [
      ['enter-world-btn', { online: false, forceRename: false }],
      ['take-over-btn', { online: true, forceRename: false }],
      ['rename-btn', { online: false, forceRename: true }],
      ['enter-world-btn', { online: false, forceRename: false, membershipLocked: true }],
    ] as const) {
      const html = characterRowHtml({ name: 'Alice', class: 'warrior', level: 1, ...flags }, '', 0);
      expect(html.indexOf(primary), `${primary} row not found`).toBeGreaterThanOrEqual(0);
      expect(
        html.indexOf('delete-char-btn'),
        `delete control must come after ${primary}`,
      ).toBeGreaterThan(html.indexOf(primary));
    }
  });
});

describe('char-delete-btn styling', () => {
  it('is a transparent ghost control that only tints on hover/focus', () => {
    const block = shell.slice(
      shell.indexOf('.char-delete-btn {'),
      shell.indexOf('.char-delete-btn .ui-icon'),
    );
    expect(block).toContain('background: transparent;');
    expect(block).toContain('border: 1px solid transparent;');
    expect(shell).toContain('.char-delete-btn:hover:not(:disabled),');
  });

  it('keeps the 40x40 tap floor on touch, where there is no hover to reveal it', () => {
    const touch = shell.slice(shell.indexOf('body.mobile-touch .char-delete-btn {'));
    expect(touch.slice(0, 160)).toContain('width: 40px;');
    expect(touch.slice(0, 160)).toContain('height: 40px;');
  });
});

describe('normalizeDeleteConfirmation', () => {
  it('ignores case and surrounding whitespace so the typed name matches the character', () => {
    expect(normalizeDeleteConfirmation('  Thrallwyn ')).toBe('thrallwyn');
    expect(normalizeDeleteConfirmation('THRALLWYN')).toBe(normalizeDeleteConfirmation('thrallwyn'));
  });

  it('keeps interior spacing as typed, so a different name still mismatches', () => {
    expect(normalizeDeleteConfirmation('Thrall wyn')).not.toBe(
      normalizeDeleteConfirmation('Thrallwyn'),
    );
  });
});
