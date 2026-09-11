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
    expect(painter).toMatch(
      /renderSend\([\s\S]{0,320}this\.recipientSuggest = \{ items: \[], index: -1 \}/,
    );
    expect(painter).toMatch(/close\([\s\S]{0,220}clearTimeout\(this\.recipientSuggestTimer\)/);
    expect(painter).toMatch(
      /close\([\s\S]{0,320}this\.recipientSuggest = \{ items: \[], index: -1 \}/,
    );
  });

  it('routes keyboard wrap-around through wrappedSuggestionIndex view helper', () => {
    expect(painter).toContain('wrappedSuggestionIndex(');
  });
});

describe('mailbox_window: parcel quantity stepper (#1444, PR #1695 review)', () => {
  it('routes +/- clamping through the clampParcelQty view helper', () => {
    expect(painter).toContain('clampParcelQty(');
  });

  it('the ceiling excludes instanced (non-fungible) copies, matching the sim send-path check', () => {
    expect(painter).toMatch(/inventory\.filter\(\(s\) => s\.itemId === itemId && !s\.instance\)/);
  });

  it('renders both stepper aria-labels', () => {
    expect(painter).toContain('parcelQtyDecreaseAria');
    expect(painter).toContain('parcelQtyIncreaseAria');
  });

  it('the stepper only renders once more than one is owned', () => {
    expect(painter).toContain('owned > 1');
  });

  it('the +/- buttons truly disable (not just visually) at the floor/ceiling', () => {
    expect(painter).toMatch(/minus\.disabled = slot\.count <= 1/);
    expect(painter).toMatch(/plus\.disabled = slot\.count >= owned/);
  });

  it('the quantity value is an aria-live region so screen readers hear the new count', () => {
    expect(painter).toMatch(/qty\.setAttribute\('aria-live', 'polite'\)/);
  });

  it('the item name is keyboard-focusable so its tooltip is Tab-reachable', () => {
    expect(painter).toMatch(/name\.tabIndex = 0/);
  });

  it('keys every parcel control by item + role, so a rebuild can refocus the equivalent', () => {
    // Titled for what it checks: that the KEYS are written, in the shape the ladder
    // splits on. Where focus actually LANDS is behavioral and lives in
    // tests/mailbox_window_focus.test.ts; this file only reads source text.
    expect(painter).toMatch(/dataset\.focusKey = `\$\{slot\.itemId\}:minus`/);
    expect(painter).toMatch(/dataset\.focusKey = `\$\{slot\.itemId\}:plus`/);
    // The qty input was missing from this list, and it is the rung the ladder prefers.
    expect(painter).toMatch(/dataset\.focusKey = `\$\{slot\.itemId\}:qty`/);
    // Remove keys on the per-chip key (issue 1165): a plain stack and an
    // instanced copy of one item id are distinct chips. The stepper keys stay
    // on slot.itemId because only a plain stack (no instance) grows a stepper.
    expect(painter).toMatch(/dataset\.focusKey = `\$\{chipKey\}:remove`/);
  });
});

describe('mailbox_window: the attachment and parcel chips describe the COPY', () => {
  // The phase 13 QA frontend finding: both chips colored the name off the def
  // alone while the copy was in hand one line down. They read the shared cell
  // authority now (worn_item_cell_view.ts), so a legacy legendary-rolled copy
  // reads legendary here like every other item cell. Source pins with
  // comments stripped (a commented-out arm cannot satisfy them).
  const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('both chips build their name, quality, and color from the cell authority', () => {
    // Two chips; the four stepper and remove arias beside the parcel chip
    // reuse the chip's own `cell` read (three of the four sit inside the
    // !slot.instance guard, so for them the authority answers the def name
    // by construction; the remove aria is the live one).
    expect(code.match(/wornItemCellParts\(item, slot\.instance\)/g)).toHaveLength(2);
    expect(code.match(/item: cell\.name/g)).toHaveLength(4);
    expect(code.match(/this\.deps\.itemIcon\(item, cell\.quality\)/g)).toHaveLength(2);
    expect(code.match(/style="color:\$\{cell\.color\}"/g)).toHaveLength(2);
    expect(code).not.toContain('QUALITY_COLOR[item.quality');
  });
});

describe('mailbox_window: house style', () => {
  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('\u2014'), 'em dash found').toBe(false);
    expect(painter.includes('\u2013'), 'en dash found').toBe(false);
  });
});

// W20: the Delete rail carried its danger colour only on :hover, which a touch
// device never enters, so the destructive action looked identical to the safe
// one there. The cue moved onto the resting state.
describe('mailbox: the Delete rail is marked at rest', () => {
  const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
  const ruleBody = (selector: string): string => {
    const at = components.indexOf(`\n  ${selector} {`);
    expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
    return components.slice(at, components.indexOf('}', at));
  };

  it('still stamps the danger class on the Delete button', () => {
    expect(painter).toContain("del.className = 'mail-action-btn danger ui-btn';");
  });

  it('colours the danger rail without a hover state', () => {
    const rest = ruleBody('.mail-action-btn.danger');
    expect(rest).toContain('color: var(--color-text-error);');
    expect(rest).toContain('border-color: var(--color-border-invalid);');
    expect(components).not.toContain('.mail-action-btn.danger:hover');
  });
});

// The pinned action rows (W25, the window-shell finding): the reading pane's
// Reply / Return / Delete row and the send form's Send button must stay in view
// however long the letter or the field stack runs. Both halves are pinned, the
// markup that puts the row OUTSIDE the scrollport and the CSS that makes the
// scrollport absorb the height, because either one alone silently does nothing.
describe('mailbox_window: the action row never scrolls out of reach', () => {
  const components = readFileSync(
    new URL('../src/styles/components.css', import.meta.url),
    'utf8',
  ).replace(/\s+/g, ' ');

  it('closes .mail-reading before the action row, so the row is a sibling of the pane', () => {
    const reading = painter.slice(painter.indexOf('private renderReading('));
    const paneEnd = reading.indexOf('`</div>` +');
    const actions = reading.indexOf('class="mail-actions"');
    expect(paneEnd).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(paneEnd);
  });

  it('wraps the send form fields in their own scroller with Send pinned below', () => {
    const send = painter.slice(painter.indexOf('private renderSend('));
    expect(send).toContain('<div class="mail-send-fields">');
    expect(send.indexOf('class="mail-send-actions"')).toBeGreaterThan(
      send.indexOf('class="mail-send-fields"'),
    );
  });

  it('stops the pane scrolling and lets the letter / field stack take the height', () => {
    expect(components).toContain(
      '#mailbox-body:has(> .mail-reading), #mailbox-body:has(> .mail-send-form) { overflow: hidden; }',
    );
    expect(components).toContain(
      '.mail-reading-body, .mail-send-fields { flex: 1 1 auto; min-height: 0; }',
    );
    expect(components).toContain('#mailbox-body > .mail-actions, .mail-send-actions { flex: none;');
  });
});
