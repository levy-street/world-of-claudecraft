// @vitest-environment happy-dom
// The bag-stack step buttons: the material source picker's per-row pair
// (material_sources_dialog.ts) and the vault withdraw prompt's pair
// (bank_quantity_prompt.ts `step`), both the shared quantity_stepper.ts. One
// press moves a whole carried stack (the item's stack size, DEFAULT_STACK by
// default) and clamps at the bound, so the last press tops the row out or
// empties it rather than doing nothing; the unit +/- pair keeps its exact
// one-unit stepping beside them; both pairs disable on their bound. A picker
// opened with a destination ceiling (`limit`) caps the rows' shared total.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STACK } from '../src/sim/bags';
import { showQuantityPrompt } from '../src/ui/bank_quantity_prompt';
import {
  closeMaterialSourcesDialog,
  type MaterialSourcesDialogOptions,
  openMaterialSourcesDialog,
} from '../src/ui/material_sources_dialog';

const composition = [
  { source: { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } }, count: 45 },
  { source: { gatherer: { kind: 'character' as const, id: 22, name: 'Bru' } }, count: 2 },
];

afterEach(() => {
  closeMaterialSourcesDialog(false);
  document.body.innerHTML = '';
});

function mountOpener(): HTMLButtonElement {
  document.body.innerHTML =
    '<div id="prompt-stack"></div><section class="window"><button id="opener">Sources</button></section>';
  return document.getElementById('opener') as HTMLButtonElement;
}

function openPicker(
  over: Partial<MaterialSourcesDialogOptions> = {},
  onConfirm: MaterialSourcesDialogOptions['onConfirm'] = () => {},
): HTMLElement {
  const opener = mountOpener();
  openMaterialSourcesDialog({
    itemName: 'Copper Ore',
    sources: composition,
    opener,
    onConfirm,
    ...over,
  });
  return document.getElementById('material-sources-dialog') as HTMLElement;
}

function rowControls(root: HTMLElement, sourceIndex: number) {
  const input = root.querySelector<HTMLInputElement>(
    `input[data-material-source-index="${sourceIndex}"]`,
  );
  const downBig = root.querySelector<HTMLButtonElement>(
    `[data-material-source-decrease-by="${sourceIndex}"]`,
  );
  const down = root.querySelector<HTMLButtonElement>(
    `[data-material-source-decrease="${sourceIndex}"]`,
  );
  const upBig = root.querySelector<HTMLButtonElement>(
    `[data-material-source-increase-by="${sourceIndex}"]`,
  );
  const up = root.querySelector<HTMLButtonElement>(
    `[data-material-source-increase="${sourceIndex}"]`,
  );
  if (!input || !downBig || !down || !upBig || !up) {
    throw new Error(`row ${sourceIndex} controls missing`);
  }
  return { input, downBig, down, upBig, up };
}

const confirmButton = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('.material-sources-confirm') as HTMLButtonElement;

describe('the source picker bag-stack steps', () => {
  it('moves a stack per press, clamps at the row bounds, and keeps the unit step exact', () => {
    expect(DEFAULT_STACK).toBe(20);
    const root = openPicker();
    const ana = rowControls(root, 0);
    expect(ana.upBig.textContent).toBe('+20');
    expect(ana.downBig.textContent).toMatch(/20$/);
    expect(ana.down.textContent).toBe('−');
    expect(ana.up.textContent).toBe('+');
    expect(ana.upBig.getAttribute('aria-label')).toBe('Increase units from Collected by Ana by 20');
    expect(ana.downBig.getAttribute('aria-label')).toBe(
      'Decrease units from Collected by Ana by 20',
    );
    expect(ana.downBig.disabled).toBe(true);
    expect(ana.down.disabled).toBe(true);
    expect(ana.upBig.disabled).toBe(false);

    ana.upBig.click();
    expect(ana.input.value).toBe('20');
    ana.up.click();
    expect(ana.input.value).toBe('21');
    ana.upBig.click();
    expect(ana.input.value).toBe('41');
    // 41 + 20 exceeds the row's 45: the press lands on the bound.
    ana.upBig.click();
    expect(ana.input.value).toBe('45');
    expect(ana.upBig.disabled).toBe(true);
    expect(ana.up.disabled).toBe(true);
    ana.downBig.click();
    expect(ana.input.value).toBe('25');
    ana.downBig.click();
    ana.downBig.click();
    expect(ana.input.value).toBe('0');
    expect(ana.downBig.disabled).toBe(true);

    // A two-unit row tops out at two on the first press.
    const bru = rowControls(root, 1);
    bru.upBig.click();
    expect(bru.input.value).toBe('2');
    expect(bru.upBig.disabled).toBe(true);
  });

  it('steps by the opener-supplied stack size and refuses a typed value it cannot act on', () => {
    const root = openPicker({ stepSize: 5 });
    const ana = rowControls(root, 0);
    expect(ana.upBig.textContent).toBe('+5');
    expect(ana.upBig.getAttribute('aria-label')).toBe('Increase units from Collected by Ana by 5');
    ana.upBig.click();
    expect(ana.input.value).toBe('5');
    // A typed value past the row disables every step and a press changes nothing.
    ana.input.value = '99';
    ana.input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ana.upBig.disabled).toBe(true);
    expect(ana.down.disabled).toBe(true);
    ana.down.click();
    expect(ana.input.value).toBe('99');
    expect(confirmButton(root).disabled).toBe(true);
  });

  it('Move all fills every row and confirms the whole composition in one press', () => {
    const confirmed: Array<{ count: number; quantities: unknown }> = [];
    const root = openPicker({}, (selected) => {
      confirmed.push({ count: selected.count, quantities: selected.quantities });
    });
    const moveAll = root.querySelector<HTMLButtonElement>('.material-sources-move-all');
    expect(moveAll?.textContent).toBe('Move all units');
    // It sits beside Move selected units, which stays disabled until a row
    // is filled by hand.
    expect(confirmButton(root).disabled).toBe(true);
    moveAll?.click();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.count).toBe(47);
    expect(confirmed[0]?.quantities).toEqual([
      { sourceIndex: 0, count: 45 },
      { sourceIndex: 1, count: 2 },
    ]);
    expect(document.getElementById('material-sources-dialog')).toBeNull();
  });

  it('caps the rows at a destination ceiling and says how much fits', () => {
    const confirmed: number[] = [];
    const root = openPicker({ limit: 30 }, (selected) => {
      confirmed.push(selected.count);
    });
    expect(root.querySelector('.material-sources-fits')?.textContent).toBe(
      'Up to 30 fit right now',
    );
    const ana = rowControls(root, 0);
    const bru = rowControls(root, 1);
    ana.upBig.click();
    expect(ana.input.value).toBe('20');
    // 20 + 20 would pass the ceiling: the press lands on it, and the other
    // row, with nothing left to claim, disables its up side.
    ana.upBig.click();
    expect(ana.input.value).toBe('30');
    expect(ana.upBig.disabled).toBe(true);
    expect(ana.up.disabled).toBe(true);
    expect(bru.up.disabled).toBe(true);
    expect(bru.upBig.disabled).toBe(true);
    expect(confirmButton(root).disabled).toBe(false);
    // Giving units back on one row reopens the other.
    ana.down.click();
    expect(ana.input.value).toBe('29');
    expect(bru.up.disabled).toBe(false);
    bru.up.click();
    expect(bru.input.value).toBe('1');
    expect(bru.up.disabled).toBe(true);
    // A typed total past the ceiling cannot be confirmed.
    ana.input.value = '45';
    ana.input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(confirmButton(root).disabled).toBe(true);
    ana.input.value = '29';
    ana.input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(confirmButton(root).disabled).toBe(false);
    confirmButton(root).click();
    expect(confirmed).toEqual([30]);
  });

  it('Move all under a ceiling fills rows in order up to what fits', () => {
    const confirmed: Array<{ count: number; quantities: unknown }> = [];
    const root = openPicker({ limit: 46 }, (selected) => {
      confirmed.push({ count: selected.count, quantities: selected.quantities });
    });
    root.querySelector<HTMLButtonElement>('.material-sources-move-all')?.click();
    expect(confirmed).toEqual([
      {
        count: 46,
        quantities: [
          { sourceIndex: 0, count: 45 },
          { sourceIndex: 1, count: 1 },
        ],
      },
    ]);
  });

  it('shows no ceiling line and no cap when the whole stack fits', () => {
    const root = openPicker({ limit: 47 });
    expect(root.querySelector('.material-sources-fits')).toBeNull();
    const ana = rowControls(root, 0);
    ana.upBig.click();
    ana.upBig.click();
    ana.upBig.click();
    expect(ana.input.value).toBe('45');
  });

  it('grows no step buttons on the read-only details list', () => {
    const opener = mountOpener();
    openMaterialSourcesDialog({ itemName: 'Copper Ore', sources: composition, opener });
    const root = document.getElementById('material-sources-dialog') as HTMLElement;
    expect(root.querySelectorAll('.material-sources-step')).toHaveLength(0);
    expect(root.querySelector('.material-sources-move-all')).toBeNull();
  });
});

describe('the quantity prompt bag-stack steps', () => {
  function open(step: boolean, maxCount = 45): HTMLElement {
    document.body.innerHTML = '<div id="prompt-stack"></div>';
    showQuantityPrompt(
      {
        installPromptDialog: (_prompt, _opener, close) => ({
          dismiss: close,
          dismissAndReturn: close,
        }),
        dismissSiblings: () => {},
      },
      {
        className: 'test-quantity-prompt',
        titleText: 'Withdraw Copper Ore',
        inputAriaText: 'Quantity to withdraw',
        confirmText: 'Withdraw',
        cancelText: 'Cancel',
        maxCount,
        resolveCount: (requested) => requested,
        send: () => {},
        afterClose: () => {},
        ...(step
          ? {
              step: {
                size: 20,
                downAriaText: 'Decrease the quantity by 20',
                upAriaText: 'Increase the quantity by 20',
                unitDownAriaText: 'Decrease the quantity by 1',
                unitUpAriaText: 'Increase the quantity by 1',
              },
            }
          : {}),
      },
    );
    return document.querySelector('.test-quantity-prompt') as HTMLElement;
  }

  it('steps the seeded count by a stack or a unit, clamps to [1, max], and disables on the bounds', () => {
    const prompt = open(true);
    const input = prompt.querySelector('input') as HTMLInputElement;
    const [down, unitDown, unitUp, up] = Array.from(
      prompt.querySelectorAll<HTMLButtonElement>('.prompt-step'),
    );
    expect(down.textContent).toMatch(/20$/);
    expect(up.textContent).toBe('+20');
    expect(unitDown.textContent).toBe('−');
    expect(unitUp.textContent).toBe('+');
    expect(up.getAttribute('aria-label')).toBe('Increase the quantity by 20');
    expect(unitDown.getAttribute('aria-label')).toBe('Decrease the quantity by 1');
    expect(unitUp.getAttribute('aria-label')).toBe('Increase the quantity by 1');
    // Seeded at the floor: the down pair starts disabled.
    expect(input.value).toBe('1');
    expect(down.disabled).toBe(true);
    expect(unitDown.disabled).toBe(true);
    expect(up.disabled).toBe(false);
    up.click();
    expect(input.value).toBe('21');
    expect(down.disabled).toBe(false);
    unitUp.click();
    expect(input.value).toBe('22');
    unitDown.click();
    expect(input.value).toBe('21');
    up.click();
    expect(input.value).toBe('41');
    up.click();
    expect(input.value).toBe('45');
    expect(up.disabled).toBe(true);
    expect(unitUp.disabled).toBe(true);
    down.click();
    expect(input.value).toBe('25');
    down.click();
    expect(input.value).toBe('5');
    down.click();
    expect(input.value).toBe('1');
    expect(down.disabled).toBe(true);
    // The stepper row sits between the title and the confirm/cancel pair;
    // stack pair outside, unit pair inside.
    expect(prompt.querySelector('.prompt-steps')?.children).toHaveLength(5);
    expect(
      Array.from(prompt.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual([down.textContent, '−', '+', '+20', 'Withdraw', 'Cancel']);
  });

  it('disables all four steps on a one-unit prompt', () => {
    const prompt = open(true, 1);
    const steps = Array.from(prompt.querySelectorAll<HTMLButtonElement>('.prompt-step'));
    expect(steps).toHaveLength(4);
    expect(steps.every((button) => button.disabled)).toBe(true);
    steps[3].click();
    expect((prompt.querySelector('input') as HTMLInputElement).value).toBe('1');
  });

  it('renders no step pair when the caller passes none', () => {
    const prompt = open(false);
    expect(prompt.querySelectorAll('.prompt-step')).toHaveLength(0);
    expect(prompt.querySelector('.prompt-steps')).toBeNull();
    expect(
      Array.from(prompt.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual(['Withdraw', 'Cancel']);
  });
});
