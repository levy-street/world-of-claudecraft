// @vitest-environment happy-dom

// Painter pins for the train window's card treatment: the two-arm fee
// rendering (the gold action chip on an AFFORDABLE teachable row only, the
// plain error-tint price when the fee is short, the muted plain price on
// locked rows, no price on known rows), the shared quality-glow socket on
// every row, and the card-fill hover restores in CSS (jsdom runs no layout,
// so the cascade arms are pinned at the source). The pure ladder model is
// tests/train_view.test.ts; the unbind window's matching arms are pinned in
// tests/professions_commissions_ui.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { TrainRow, TrainView } from '../src/ui/hud/vendor/train_view';
import { renderTrainWindow } from '../src/ui/hud/vendor/train_window';

const SWORD = 'eastbrook_arming_sword';

function deps() {
  return {
    hideTooltip: vi.fn(),
    onTrain: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => '<img class="item-icon">'),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
  };
}

function row(over: Partial<TrainRow>): TrainRow {
  return {
    recipeId: 'recipe_qa_train_painter',
    professionId: 'weaponcrafting',
    resultItemId: SWORD,
    item: ITEMS[SWORD],
    skillReq: 0,
    state: 'teachable',
    feeCopper: 2500,
    affordable: true,
    ...over,
  };
}

function paint(rows: TrainRow[]): HTMLElement {
  const el = document.createElement('div');
  const view: TrainView = { stationType: 'forge', rows };
  renderTrainWindow(el, 'Darva', view, deps());
  return el;
}

describe('renderTrainWindow fee arms (gold chip on affordable rows ONLY)', () => {
  it('an affordable teachable row renders the gold fee chip and no plain price', () => {
    const el = paint([row({})]);
    const button = el.querySelector('.train-teachable') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const chip = button.querySelector('.vi-price-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('25');
    expect(button.querySelector('.vi-price')).toBeNull();
  });

  it('an unaffordable teachable row keeps the plain error-tint price, never the chip', () => {
    const el = paint([row({ affordable: false })]);
    const button = el.querySelector('.train-teachable') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.vi-price-chip')).toBeNull();
    const price = button.querySelector('.vi-price');
    expect(price?.classList.contains('unaffordable')).toBe(true);
    expect(price?.textContent).toContain('25');
  });

  it('a locked row renders the muted plain price and a known row no price at all', () => {
    const el = paint([
      row({
        recipeId: 'r_locked',
        state: 'locked',
        requirement: { craft: 'weaponcrafting', skill: 25 },
      }),
      row({ recipeId: 'r_known', state: 'known', feeCopper: 0 }),
    ]);
    const locked = el.querySelector('.train-locked') as HTMLButtonElement;
    expect(locked.querySelector('.vi-price-chip')).toBeNull();
    const lockedPrice = locked.querySelector('.vi-price');
    expect(lockedPrice).not.toBeNull();
    expect(lockedPrice?.classList.contains('unaffordable')).toBe(false);
    const known = el.querySelector('.train-known') as HTMLElement;
    expect(known.querySelector('.vi-price')).toBeNull();
    expect(known.querySelector('.vi-price-chip')).toBeNull();
  });
});

describe('renderTrainWindow pending rows (learn in flight, issue #2342)', () => {
  it('a pending teachable row disables the button and swaps to the in-flight label', () => {
    const el = paint([row({ pending: true })]);
    const button = el.querySelector('.train-teachable') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.train-state')?.textContent).toBe('Learning');
    // The accessible name must carry the in-flight state too: aria-label
    // overrides element content, so the visible pill alone never reaches AT.
    expect(button.getAttribute('aria-label')).toBe('Learning Eastbrook Arming Sword');
    // The fee chip stays (the row is still affordable; the disabled opacity
    // mutes it), per the vendor-family price-rendering contract.
    expect(button.querySelector('.vi-price-chip')).not.toBeNull();
  });

  it('a disabled pending button never reaches onTrain, an enabled row does', () => {
    const d = deps();
    const el = document.createElement('div');
    const view: TrainView = {
      stationType: 'forge',
      rows: [row({ pending: true }), row({ recipeId: 'r_live' })],
    };
    renderTrainWindow(el, 'Darva', view, d);
    const [pendingButton, liveButton] = Array.from(
      el.querySelectorAll<HTMLButtonElement>('.train-teachable'),
    );
    pendingButton.click();
    expect(d.onTrain).not.toHaveBeenCalled();
    liveButton.click();
    expect(d.onTrain).toHaveBeenCalledWith('r_live');
  });

  it('a non-pending row keeps the Available label and the Learn-for-fee aria arm', () => {
    const el = paint([row({})]);
    expect(el.querySelector('.train-state')?.textContent).toBe('Available');
    // The aria-label rides its OWN ternary, independent of the visible label:
    // pin the non-pending arm too, or an inverted ternary that always
    // announces the pending copy would leave every visible pin green.
    const aria = el.querySelector('.train-teachable')?.getAttribute('aria-label') ?? '';
    expect(aria).toMatch(/^Learn Eastbrook Arming Sword for /);
    expect(aria).not.toContain('Learning');
  });
});

describe('renderTrainWindow quality-glow socket', () => {
  it('every row carries the shared socket span, glowing from the item quality', () => {
    const el = paint([
      row({}),
      row({ recipeId: 'r_known', state: 'known' }),
      row({ recipeId: 'r_locked', state: 'locked' }),
    ]);
    const sockets = el.querySelectorAll('.crafting-recipe-socket');
    expect(sockets).toHaveLength(3);
    // The arming sword def carries a quality, so the socket derives a glow;
    // the icon itself still comes from the presentation bag.
    const socket = sockets[0] as HTMLElement;
    expect(ITEMS[SWORD].quality).toBeTruthy();
    expect(socket.getAttribute('style') ?? '').toContain('box-shadow');
    expect(socket.querySelector('.item-icon')).not.toBeNull();
  });
});

describe('train/unbind card hover restores (CSS source pins)', () => {
  // jsdom runs no layout or cascade, so the two rules that keep the card fill
  // under the vendor family's higher-specificity hover arms are pinned at the
  // source: without them, .vendor-item:disabled:hover blanks a disabled card
  // to transparent and the known row's wash suppressor did the same.
  const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');

  it('restates the card fill on disabled hover for both service windows', () => {
    const start = css.indexOf('.train-row:disabled:hover,\n  .unbind-row:disabled:hover {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('background: rgba(0, 0, 0, 0.24)');
  });

  it('keeps the card fill (never transparent) on the known-row hover', () => {
    const start = css.indexOf('.train-row.train-known:hover {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('background: rgba(0, 0, 0, 0.24)');
    expect(rule).not.toContain('background: transparent');
  });
});

describe('renderTrainWindow keyboard focus carry (uninitiated rebuilds)', () => {
  // Inventory and purse deltas repaint an open window uninitiated (#2931), so
  // the painter must carry keyboard focus across its full-subtree wipe (the
  // focus-across-a-REBUILD contract, vendor_window idiom). Roots attach to
  // document.body: focus() and activeElement are inert on a detached tree.
  function paintInto(el: HTMLElement, rows: TrainRow[]): void {
    renderTrainWindow(el, 'Darva', { stationType: 'forge', rows }, deps());
  }
  function attachedRoot(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }
  // A mid-test failure must not leak a focused node into the shared document
  // for later tests in the file.
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps focus on the same recipe row across a repaint', () => {
    const el = attachedRoot();
    paintInto(el, [row({ recipeId: 'recipe_a' }), row({ recipeId: 'recipe_b' })]);
    const first = el.querySelector<HTMLButtonElement>('[data-focus-key="learn:recipe_a"]');
    first?.focus();
    expect(document.activeElement).toBe(first);
    paintInto(el, [row({ recipeId: 'recipe_a' }), row({ recipeId: 'recipe_b' })]);
    // The node was rebuilt, so identity moved; the key must not.
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('learn:recipe_a');
    el.remove();
  });

  it('falls to the ladder neighbor when the focused row came back disabled', () => {
    const el = attachedRoot();
    paintInto(el, [row({ recipeId: 'recipe_a' }), row({ recipeId: 'recipe_b' })]);
    el.querySelector<HTMLButtonElement>('[data-focus-key="learn:recipe_a"]')?.focus();
    // The disabling repaint IS the new edge: a purse delta reserved away the
    // focused row's fee.
    paintInto(el, [
      row({ recipeId: 'recipe_a', affordable: false }),
      row({ recipeId: 'recipe_b' }),
    ]);
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('learn:recipe_b');
    el.remove();
  });

  it('walks BACKWARD to the nearer earlier neighbor when the later side is exhausted', () => {
    // Focus the LAST row, disable it: the forward walk finds nothing past the
    // ladder end, so the backward rung must catch (deleting the slot - step
    // arm would drop this to the close button).
    const el = attachedRoot();
    const three = [
      row({ recipeId: 'recipe_a' }),
      row({ recipeId: 'recipe_b' }),
      row({ recipeId: 'recipe_c' }),
    ];
    paintInto(el, three);
    el.querySelector<HTMLButtonElement>('[data-focus-key="learn:recipe_c"]')?.focus();
    paintInto(el, [three[0], three[1], row({ recipeId: 'recipe_c', affordable: false })]);
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('learn:recipe_b');
    el.remove();
  });

  it('lands on the nearest surviving row when the ladder came back shorter', () => {
    // Focus the third row, repaint with two: the exact key is gone and the
    // remembered slot is out of range, so the slot fallback must land on the
    // new last row, never skip the ladder for the close button. (The
    // Math.min clamp itself is outcome-equivalent to the out-of-range walk;
    // what this decides is that the slot fallback survives a shrink at all.)
    const el = attachedRoot();
    paintInto(el, [
      row({ recipeId: 'recipe_a' }),
      row({ recipeId: 'recipe_b' }),
      row({ recipeId: 'recipe_c' }),
    ]);
    el.querySelector<HTMLButtonElement>('[data-focus-key="learn:recipe_c"]')?.focus();
    paintInto(el, [row({ recipeId: 'recipe_a' }), row({ recipeId: 'recipe_b' })]);
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('learn:recipe_b');
    el.remove();
  });

  it('falls to the close button when every row came back disabled', () => {
    const el = attachedRoot();
    paintInto(el, [row({ recipeId: 'recipe_a' })]);
    el.querySelector<HTMLButtonElement>('[data-focus-key="learn:recipe_a"]')?.focus();
    paintInto(el, [row({ recipeId: 'recipe_a', affordable: false })]);
    expect((document.activeElement as HTMLElement).dataset.focusKey).toBe('close');
    el.remove();
  });

  it('never steals focus that was outside the window', () => {
    const el = attachedRoot();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    paintInto(el, [row({ recipeId: 'recipe_a' })]);
    outside.focus();
    paintInto(el, [row({ recipeId: 'recipe_a' })]);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    el.remove();
  });
});
