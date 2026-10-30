// @vitest-environment jsdom

// Thin-consumer tests for the commission order board painter (issue #1298):
// the "open a new order" form wires the right callback args, and each
// action button fires the matching deps callback with the row's order id.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { buildCommissionOrderBoardModel } from '../src/ui/hud/professions/commission_order_view';
import {
  CommissionOrderBoardPainter,
  type CommissionOrderWindowDeps,
  renderCommissionOrderWindow,
} from '../src/ui/hud/professions/commission_order_window';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import type { CommissionOrderView } from '../src/world_api/professions';

const SWORD_RECIPE = 'recipe_eastbrook_arming_sword';
const SWORD = 'eastbrook_arming_sword';

afterEach(() => setLanguage('en'));

function order(overrides: Partial<CommissionOrderView> = {}): CommissionOrderView {
  return {
    id: 7,
    requesterName: 'Ayla',
    recipeId: SWORD_RECIPE,
    itemId: SWORD,
    scope: 'open',
    status: 'open',
    mine: false,
    mineToCraft: false,
    ...overrides,
  };
}

function deps(): CommissionOrderWindowDeps {
  return {
    hideTooltip: vi.fn(),
    onOpen: vi.fn(),
    onCancel: vi.fn(),
    onAccept: vi.fn(),
    onDeliver: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
  };
}

describe('renderCommissionOrderWindow', () => {
  it('the submit button reads the form and calls onOpen with the picked recipe/scope', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel(
      [],
      [{ id: SWORD_RECIPE, resultItemId: SWORD }],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, d);
    (el.querySelector('#cob-submit') as HTMLButtonElement).click();
    expect(d.onOpen).toHaveBeenCalledWith(SWORD_RECIPE, 'open', undefined);
  });

  it('the crafter-name field surfaces only for scope "crafter" and rides the submit', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel(
      [],
      [{ id: SWORD_RECIPE, resultItemId: SWORD }],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, d);
    const crafterField = el.querySelector('#cob-crafter-field') as HTMLElement;
    expect(crafterField.style.display).toBe('none');
    const crafterRadio = el.querySelector('input[value="crafter"]') as HTMLInputElement;
    crafterRadio.checked = true;
    crafterRadio.dispatchEvent(new Event('change'));
    expect(crafterField.style.display).toBe('');
    (el.querySelector('#cob-crafter-name') as HTMLInputElement).value = 'Borin';
    (el.querySelector('#cob-submit') as HTMLButtonElement).click();
    expect(d.onOpen).toHaveBeenCalledWith(SWORD_RECIPE, 'crafter', 'Borin');
  });

  it('the recipe picker is absent when the viewer knows no commissionable recipe', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel([], [], ITEMS);
    renderCommissionOrderWindow(el, model, d);
    expect(el.querySelector('#cob-recipe')).toBeNull();
    expect(el.querySelector('#cob-submit')).toBeNull();
  });

  it('a cancellable row fires onCancel with its order id', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel([order({ mine: true })], [], ITEMS);
    renderCommissionOrderWindow(el, model, d);
    const btn = [...el.querySelectorAll('.commission-order-btn')].find(
      (b) => b.textContent === 'Cancel',
    ) as HTMLButtonElement;
    btn.click();
    expect(d.onCancel).toHaveBeenCalledWith(7);
  });

  it('an acceptable row fires onAccept, a deliverable row fires onDeliver', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel(
      [order({ id: 8, status: 'open' }), order({ id: 9, mineToCraft: true, status: 'accepted' })],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, d);
    const acceptBtn = [...el.querySelectorAll('.commission-order-btn')].find(
      (b) => b.textContent === 'Accept',
    ) as HTMLButtonElement;
    acceptBtn.click();
    expect(d.onAccept).toHaveBeenCalledWith(8);
    const deliverBtn = [...el.querySelectorAll('.commission-order-btn')].find(
      (b) => b.textContent === 'Deliver',
    ) as HTMLButtonElement;
    deliverBtn.click();
    expect(d.onDeliver).toHaveBeenCalledWith(9);
  });

  it('an empty section renders its localized empty line, not a blank list', () => {
    const el = document.createElement('div');
    const d = deps();
    const model = buildCommissionOrderBoardModel([], [], ITEMS);
    renderCommissionOrderWindow(el, model, d);
    const emptyLines = [...el.querySelectorAll('.prof-empty')].map((n) => n.textContent);
    expect(emptyLines).toHaveLength(3); // mine, toCraft, board
  });

  it('the close button fires onClose', () => {
    const el = document.createElement('div');
    const d = deps();
    renderCommissionOrderWindow(el, buildCommissionOrderBoardModel([], [], ITEMS), d);
    (el.querySelector('[data-close]') as HTMLButtonElement).click();
    expect(d.onClose).toHaveBeenCalledOnce();
  });
});

// W20: the recipe picker moved from the shared .hud-select class onto .ui-input,
// which carries no <select> chrome, so the control lost appearance: none, the
// gold caret, the dark option list, the forced-colors fallback and the 40px
// coarse-pointer floor and rendered as raw OS chrome inside the HUD.
describe('commission board: the recipe picker keeps its select chrome', () => {
  const components = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');
  const ruleBody = (selector: string, from = 0): string => {
    const at = components.indexOf(`${selector} {`, from);
    expect(at, `components.css has no rule for ${selector}`).toBeGreaterThan(-1);
    const open = components.indexOf('{', at);
    return components.slice(open + 1, components.indexOf('}', open));
  };

  it('is still a native <select> on the library input', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [],
      [{ id: SWORD_RECIPE, resultItemId: SWORD }],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps());
    const select = el.querySelector('#cob-recipe');
    expect(select?.tagName).toBe('SELECT');
    expect(select?.classList.contains('ui-input')).toBe(true);
  });

  it('suppresses the OS chrome and draws the token caret', () => {
    const base = ruleBody('\n  #cob-recipe');
    expect(base).toContain('appearance: none;');
    expect(base).toContain('-webkit-appearance: none;');
    expect(base).toContain('linear-gradient(45deg, transparent 50%, var(--gold) 50%)');
    expect(ruleBody('\n  #cob-recipe option')).toContain('background: var(--color-bg-dark);');
  });

  it('keeps the coarse-pointer floor and the forced-colors fallback', () => {
    const coarse = components.indexOf('@media (pointer: coarse) {\n    #cob-recipe {');
    expect(coarse, 'no coarse-pointer floor').toBeGreaterThan(-1);
    expect(ruleBody('\n    #cob-recipe', coarse)).toContain('min-height: 40px;');
    const forced = components.indexOf('@media (forced-colors: active) {\n    #cob-recipe {');
    expect(forced, 'no forced-colors fallback').toBeGreaterThan(-1);
    const body = ruleBody('\n    #cob-recipe', forced);
    expect(body).toContain('appearance: auto;');
    expect(body).toContain('background-image: none;');
  });
});

// The chrome dialog contract (src/ui/CLAUDE.md; the Masterwrought Phase 18
// sweep): the board root is a dialog with exactly one accessible name, opens on
// the family's flex-column shell, and Hud drives the shared focus trap and
// opener restore around it the way it does for the crafting window.
describe('commission board dialog semantics', () => {
  it('marks the root role=dialog with ONE accessible name (the label form) and aria-modal false', () => {
    const el = document.createElement('div');
    renderCommissionOrderWindow(el, buildCommissionOrderBoardModel([], [], ITEMS), deps());
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('false');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.getAttribute('aria-label')).toBe(t('hudChrome.commissionBoard.title'));
    expect(el.getAttribute('aria-labelledby')).toBeNull();
  });

  it('opens on the family flex-column display value, not display:block', () => {
    const el = document.createElement('div');
    renderCommissionOrderWindow(el, buildCommissionOrderBoardModel([], [], ITEMS), deps());
    expect(el.style.display).toBe('flex');
    // The column rule that makes 'flex' a column lives on the id in the
    // stylesheet (the #professions-window precedent).
    // process.cwd(), not import.meta.url: jsdom's URL refuses the file scheme.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    const rule = /#commission-board-window \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/flex-direction:\s*column;/);
  });

  it('a repaint keeps the dialog attributes (markDialogRoot runs on every render)', () => {
    const el = document.createElement('div');
    const d = deps();
    renderCommissionOrderWindow(el, buildCommissionOrderBoardModel([], [], ITEMS), d);
    renderCommissionOrderWindow(
      el,
      buildCommissionOrderBoardModel([order({ mine: true })], [], ITEMS),
      d,
    );
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-label')).toBe(t('hudChrome.commissionBoard.title'));
  });

  it('Hud captures the opener AFTER the paint and restores it on close (source pins)', () => {
    // The coordinator cannot be unit-driven; the crafting window's shape is
    // pinned the same way. Slice each method to its own closing brace so the
    // pins cannot be satisfied by another window's identical calls.
    const hud = readFileSync(resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    expect(hud).toContain(
      "private readonly commissionBoardFocus = this.windowFocus('#commission-board-window');",
    );
    const openStart = hud.indexOf('openCommissionBoard(): void {');
    expect(openStart).toBeGreaterThan(-1);
    const open = hud.slice(openStart, hud.indexOf('\n  }', openStart));
    expect(open.length).toBeLessThan(1200);
    const paintAt = open.indexOf('this.renderCommissionBoard();');
    const captureAt = open.indexOf(
      'this.commissionBoardOpenerFocus = this.commissionBoardFocus.captureFocus();',
    );
    expect(paintAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(paintAt);
    const closeStart = hud.indexOf('closeCommissionBoard(): void {');
    expect(closeStart).toBeGreaterThan(-1);
    const close = hud.slice(closeStart, hud.indexOf('\n  }', closeStart));
    expect(close.length).toBeLessThan(800);
    expect(close).toContain(
      'this.commissionBoardFocus.restoreFocus(this.commissionBoardOpenerFocus);',
    );
    expect(close).toContain('this.commissionBoardOpenerFocus = null;');
  });
});

// The crafter's-record quality signal (Masterwrought phase 14): the compact
// line renders exactly when the view model resolved a record, with both
// counts formatted, and never invents one on an open or record-less row.
describe('the crafter record line', () => {
  it('renders label and both pluralized counts on an accepted row', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [
        order({
          status: 'accepted',
          acceptedByName: 'Borin',
          crafterMasterworks: 12,
          crafterLegendaries: 1,
        }),
      ],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps());
    const line = el.querySelector('.commission-crafter-record');
    expect(line).not.toBeNull();
    expect(line?.querySelector('.ccr-label')?.textContent).toContain("Crafter's record");
    const values = line?.querySelector('.ccr-values')?.textContent ?? '';
    expect(values).toContain('12 masterworks');
    expect(values).toContain('1 legendary');
  });

  it('renders nothing on an open row, and nothing when the wire carried no record', () => {
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [
        order({ id: 1, status: 'open', crafterMasterworks: 4, crafterLegendaries: 4 }),
        order({ id: 2, status: 'accepted', acceptedByName: 'Borin' }),
      ],
      [],
      ITEMS,
    );
    renderCommissionOrderWindow(el, model, deps());
    expect(el.querySelector('.commission-crafter-record')).toBeNull();
  });

  it('uses locale-aware separators for status details and crafter record counts', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const el = document.createElement('div');
    const model = buildCommissionOrderBoardModel(
      [
        order({
          status: 'accepted',
          acceptedByName: 'Borin',
          crafterMasterworks: 12,
          crafterLegendaries: 1,
        }),
      ],
      [],
      ITEMS,
    );

    renderCommissionOrderWindow(el, model, deps());

    expect(el.querySelector('.commission-order-row .vi-name > .vi-sub')?.textContent).toBe(
      '引き受け済み、Borinが引き受け済み',
    );
    expect(el.querySelector('.ccr-values')?.textContent).toBe('傑作12点、伝説の品1点');
    expect(el.querySelector('.commission-order-row')?.textContent).not.toContain(' · ');
  });
});

// The live board: other players accept, deliver, cancel and post orders, and
// online the viewer's own commissionOrderResult can beat the corder mirror, so
// the Hud's slow band polls the painter. A moved board repaints the row
// sections only; the order form (picked recipe, scope radios, typed crafter
// name, focus inside it) survives untouched.
describe('CommissionOrderBoardPainter: live refresh', () => {
  const OTHER_RECIPE = 'recipe_test_other';
  let world: {
    commissionOrders: CommissionOrderView[];
    recipeList: { id: string; resultItemId: string }[];
  };

  function setup(orders: CommissionOrderView[] = [order()]) {
    document.body.innerHTML = '<div id="commission-board-window"></div>';
    const el = document.getElementById('commission-board-window') as HTMLElement;
    world = {
      commissionOrders: orders,
      recipeList: [
        { id: SWORD_RECIPE, resultItemId: SWORD },
        // A second commissionable recipe so the select has a non-default pick.
        { id: OTHER_RECIPE, resultItemId: SWORD },
      ],
    };
    const painter = new CommissionOrderBoardPainter(() => world as never);
    const d = deps();
    painter.render(el, d);
    return { el, painter, d };
  }

  const rowText = (el: HTMLElement) =>
    [...el.querySelectorAll('.commission-order-row')].map((r) => r.textContent ?? '');

  function fillForm(el: HTMLElement): HTMLInputElement {
    (el.querySelector('#cob-recipe') as HTMLSelectElement).value = OTHER_RECIPE;
    const crafterRadio = el.querySelector('input[value="crafter"]') as HTMLInputElement;
    crafterRadio.checked = true;
    crafterRadio.dispatchEvent(new Event('change'));
    const name = el.querySelector('#cob-crafter-name') as HTMLInputElement;
    name.value = 'Borin';
    return name;
  }

  it('an accept by another player shows on the next poll without touching the form', () => {
    const { el, painter, d } = setup();
    expect(rowText(el).join('')).not.toContain('Borin');
    const name = fillForm(el);
    name.focus();
    const form = el.querySelector('.commission-board-form');
    world.commissionOrders = [order({ status: 'accepted', acceptedByName: 'Borin' })];
    painter.refreshIfChanged();
    expect(rowText(el).join('')).toContain('Borin');
    // The form node, its values and focus are the same ones the player left.
    expect(el.querySelector('.commission-board-form')).toBe(form);
    expect((el.querySelector('#cob-recipe') as HTMLSelectElement).value).toBe(OTHER_RECIPE);
    expect((el.querySelector('input[value="crafter"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('#cob-crafter-name') as HTMLInputElement).value).toBe('Borin');
    expect(document.activeElement).toBe(name);
    expect(d.hideTooltip).toHaveBeenCalledTimes(2); // the render, then the one repaint
  });

  it('a new posting and a delivery both move the board', () => {
    const { el, painter } = setup([]);
    expect(el.querySelectorAll('.commission-order-row')).toHaveLength(0);
    world.commissionOrders = [order({ id: 11 })];
    painter.refreshIfChanged();
    expect(el.querySelectorAll('.commission-order-row')).toHaveLength(1);
    world.commissionOrders = [order({ id: 11, status: 'delivered', acceptedByName: 'Borin' })];
    painter.refreshIfChanged();
    expect(rowText(el)[0]).toContain('Delivered');
  });

  it('an unchanged poll writes nothing, and render re-latches the signature', () => {
    const { el, painter, d } = setup();
    const row = el.querySelector('.commission-order-row');
    painter.refreshIfChanged();
    painter.refreshIfChanged();
    expect(el.querySelector('.commission-order-row')).toBe(row);
    expect(d.hideTooltip).toHaveBeenCalledTimes(1);
    // A fresh array with identical content is not a move either.
    world.commissionOrders = [order()];
    painter.refreshIfChanged();
    expect(el.querySelector('.commission-order-row')).toBe(row);
    // An explicit render (the own-action result) latches the moved board, so
    // the next poll does not rebuild a second time.
    world.commissionOrders = [order({ status: 'cancelled', mine: true })];
    painter.render(el, d);
    const rendered = el.querySelector('.commission-order-row');
    painter.refreshIfChanged();
    expect(el.querySelector('.commission-order-row')).toBe(rendered);
  });

  it('a closed board is never repainted by the poll or the language arm', () => {
    const { el, painter } = setup();
    el.style.display = 'none';
    const row = el.querySelector('.commission-order-row');
    world.commissionOrders = [order({ status: 'accepted', acceptedByName: 'Borin' })];
    painter.refreshIfChanged();
    painter.relocalize();
    expect(el.querySelector('.commission-order-row')).toBe(row);
  });

  it('a focused row button keeps focus by its key, and degrades to Close when its action left', () => {
    const { el, painter } = setup([order({ id: 8 }), order({ id: 9 })]);
    const accept9 = () =>
      [...el.querySelectorAll<HTMLButtonElement>('.commission-order-btn')].find(
        (b) => b.dataset.focusKey === 'cob:accept:9',
      );
    accept9()?.focus();
    expect(document.activeElement).toBe(accept9());
    world.commissionOrders = [
      order({ id: 8, status: 'accepted', acceptedByName: 'Borin' }),
      order({ id: 9 }),
    ];
    painter.refreshIfChanged();
    expect(document.activeElement).toBe(accept9());
    world.commissionOrders = [order({ id: 8, status: 'accepted', acceptedByName: 'Borin' })];
    painter.refreshIfChanged();
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
  });

  it('a full repaint of an open board (own result, relocalize) carries the form across', () => {
    const { el, painter, d } = setup();
    const name = fillForm(el);
    name.focus();
    world.commissionOrders = [order({ status: 'accepted', acceptedByName: 'Borin' })];
    painter.render(el, d);
    expect(rowText(el).join('')).toContain('Borin');
    expect((el.querySelector('#cob-recipe') as HTMLSelectElement).value).toBe(OTHER_RECIPE);
    expect((el.querySelector('input[value="crafter"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('#cob-crafter-field') as HTMLElement).style.display).toBe('');
    expect((el.querySelector('#cob-crafter-name') as HTMLInputElement).value).toBe('Borin');
    expect((document.activeElement as HTMLElement | null)?.id).toBe('cob-crafter-name');
    painter.relocalize();
    expect((el.querySelector('#cob-crafter-name') as HTMLInputElement).value).toBe('Borin');
    // relocalize re-latched: the next poll does not rebuild again.
    const row = el.querySelector('.commission-order-row');
    painter.refreshIfChanged();
    expect(el.querySelector('.commission-order-row')).toBe(row);
  });

  it('a sections-only poll rebuild restores the window root scroll offset', () => {
    const { el, painter } = setup([order({ id: 8 }), order({ id: 9 })]);
    // jsdom keeps no layout, so stand in for the browser: a root scrollTop the
    // test can write, which the sections wipe collapses to 0 the way emptying a
    // scrolled box clamps it in a real browser.
    let scroll = 0;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => scroll,
      set: (value: number) => {
        scroll = value;
      },
    });
    const body = el.querySelector<HTMLElement>('.commission-board-sections');
    if (!body) throw new Error('fixture needs the sections body');
    const wipe = body.replaceChildren.bind(body);
    body.replaceChildren = (...nodes: (Node | string)[]) => {
      wipe(...nodes);
      scroll = 0;
    };
    const form = el.querySelector('.commission-board-form');
    const rowsBefore = [...el.querySelectorAll('.commission-order-row')];
    expect(rowsBefore).toHaveLength(2);
    el.scrollTop = 60;
    world.commissionOrders = [
      order({ id: 8, status: 'accepted', acceptedByName: 'Borin' }),
      order({ id: 9 }),
    ];
    painter.refreshIfChanged();
    expect(el.scrollTop).toBe(60);
    // The sections really rebuilt (new row nodes), the form did not.
    const rowsAfter = [...el.querySelectorAll('.commission-order-row')];
    expect(rowsAfter).toHaveLength(2);
    for (const row of rowsAfter) expect(rowsBefore).not.toContain(row);
    expect(el.querySelector('.commission-board-sections')).toBe(body);
    expect(el.querySelector('.commission-board-form')).toBe(form);
  });

  it('render(el, deps, true) starts the form clean on an OPEN board; omitted, it carries the form', () => {
    const { el, painter, d } = setup();
    expect(el.style.display).toBe('flex');
    fillForm(el);
    // resetForm omitted: the typed crafter name and scope ride the repaint.
    painter.render(el, d);
    expect((el.querySelector('#cob-recipe') as HTMLSelectElement).value).toBe(OTHER_RECIPE);
    expect((el.querySelector('input[value="crafter"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('#cob-crafter-name') as HTMLInputElement).value).toBe('Borin');
    // resetForm true (the player's own order just posted): clean, board still open.
    painter.render(el, d, true);
    expect(el.style.display).toBe('flex');
    expect((el.querySelector('#cob-recipe') as HTMLSelectElement).value).toBe(SWORD_RECIPE);
    expect((el.querySelector('input[value="open"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('input[value="crafter"]') as HTMLInputElement).checked).toBe(false);
    expect((el.querySelector('#cob-crafter-field') as HTMLElement).style.display).toBe('none');
    expect((el.querySelector('#cob-crafter-name') as HTMLInputElement).value).toBe('');
  });

  it('opening a closed board starts the form clean', () => {
    const { el, painter, d } = setup();
    fillForm(el);
    el.style.display = 'none';
    painter.render(el, d);
    expect((el.querySelector('#cob-recipe') as HTMLSelectElement).value).toBe(SWORD_RECIPE);
    expect((el.querySelector('input[value="open"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('#cob-crafter-name') as HTMLInputElement).value).toBe('');
  });
});
