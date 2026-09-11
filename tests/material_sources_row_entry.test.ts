// @vitest-environment happy-dom
// The two doors into the material sources dialog from an item row
// (material_sources_dialog.ts attachMaterialSourcesContextMenu +
// appendMaterialSourcesActionAfter). Desktop reaches the dialog through the
// row's existing right-click (and the native Context Menu key) and grows NO
// per-row button; touch layouts, which have no right-click, keep the visible
// Sources button. Both doors open the same session: the exact-quantity picker
// when the caller's selection factory yields a live session, the read-only
// details list otherwise, and a REFUSAL (nothing opens) when the factory
// reports the stack has left the live inventory.

import { afterEach, describe, expect, it } from 'vitest';
import {
  appendMaterialSourcesActionAfter,
  attachMaterialSourcesContextMenu,
  type MaterialSourcesDialogOptions,
  type MaterialSourcesSelectionSession,
  materialSourcesButtonShown,
} from '../src/ui/material_sources_dialog';

const composition = [
  { source: { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } }, count: 2 },
  { source: {}, count: 3 },
];

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

function mountRow(): HTMLElement {
  const parent = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'bank-item';
  parent.appendChild(row);
  document.body.appendChild(parent);
  return row;
}

function rightClick(row: HTMLElement, pointerType = 'mouse'): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return row.dispatchEvent(event);
}

describe('material sources row entry points', () => {
  it('shows the per-row button on touch layouts only', () => {
    const opened: MaterialSourcesDialogOptions[] = [];
    const open = (options: MaterialSourcesDialogOptions): void => {
      opened.push(options);
    };

    expect(materialSourcesButtonShown()).toBe(false);
    const desktopRow = mountRow();
    expect(
      appendMaterialSourcesActionAfter(desktopRow, 'Copper Ore', composition, open),
    ).toBeNull();
    expect(document.querySelector('.material-sources-action')).toBeNull();
    expect(desktopRow.parentElement?.classList.contains('material-source-item')).toBe(false);

    document.body.classList.add('mobile-touch');
    expect(materialSourcesButtonShown()).toBe(true);
    const touchRow = mountRow();
    const button = appendMaterialSourcesActionAfter(touchRow, 'Copper Ore', composition, open);
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Sources');
    expect(touchRow.parentElement?.classList.contains('material-source-item')).toBe(true);
    button?.click();
    expect(opened).toHaveLength(1);
    expect(opened[0]?.onConfirm).toBeUndefined();
    expect(opened[0]?.sources).toBe(composition);
  });

  it('opens the read-only details list from a desktop right-click', () => {
    const opened: MaterialSourcesDialogOptions[] = [];
    const row = mountRow();
    attachMaterialSourcesContextMenu(row, 'Copper Ore', composition, (options) => {
      opened.push(options);
    });

    expect(rightClick(row)).toBe(false);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ itemName: 'Copper Ore', opener: row });
    expect(opened[0]?.onConfirm).toBeUndefined();
    expect(opened[0]?.sources).toBe(composition);
  });

  it('opens the exact-quantity picker from a right-click when a selection session is live', () => {
    const opened: MaterialSourcesDialogOptions[] = [];
    const row = mountRow();
    const bank = document.createElement('div');
    const captured = [composition[0]];
    let confirms = 0;
    const session: MaterialSourcesSelectionSession = {
      sources: captured,
      onConfirm: () => {
        confirms++;
      },
      associatedOwners: [bank],
    };
    let factoryCalls = 0;
    attachMaterialSourcesContextMenu(
      row,
      'Copper Ore',
      composition,
      (options) => {
        opened.push(options);
      },
      () => {
        factoryCalls++;
        return session;
      },
    );

    expect(factoryCalls).toBe(0);
    rightClick(row);
    expect(factoryCalls).toBe(1);
    expect(opened).toHaveLength(1);
    // The picker carries the SESSION's captured sources and owners, not the
    // row's display composition: the command revalidates exactly what was
    // captured when the affordance fired.
    expect(opened[0]?.sources).toBe(captured);
    expect(opened[0]?.associatedOwners).toEqual([bank]);
    opened[0]?.onConfirm?.({
      sources: captured,
      quantities: [{ sourceIndex: 0, count: 1 }],
      count: 1,
    });
    expect(confirms).toBe(1);
  });

  it('refuses (opens nothing) when the selection factory reports a vanished stack', () => {
    const opened: MaterialSourcesDialogOptions[] = [];
    const row = mountRow();
    attachMaterialSourcesContextMenu(
      row,
      'Copper Ore',
      composition,
      (options) => {
        opened.push(options);
      },
      () => null,
    );

    rightClick(row);
    expect(opened).toHaveLength(0);
  });

  it('leaves a touch-sourced contextmenu to the tooltip peek', () => {
    const opened: MaterialSourcesDialogOptions[] = [];
    const row = mountRow();
    attachMaterialSourcesContextMenu(row, 'Copper Ore', composition, (options) => {
      opened.push(options);
    });

    expect(rightClick(row, 'touch')).toBe(true);
    expect(rightClick(row, 'pen')).toBe(true);
    document.body.classList.add('mobile-touch');
    expect(rightClick(row, '')).toBe(true);
    expect(opened).toHaveLength(0);
  });

  it('attaches nothing for a sourceless row or a missing opener', () => {
    const opened: MaterialSourcesDialogOptions[] = [];
    const open = (options: MaterialSourcesDialogOptions): void => {
      opened.push(options);
    };
    const sourceless = mountRow();
    attachMaterialSourcesContextMenu(sourceless, 'Copper Ore', [], open);
    expect(rightClick(sourceless)).toBe(true);
    const unwired = mountRow();
    attachMaterialSourcesContextMenu(unwired, 'Copper Ore', composition, undefined);
    expect(rightClick(unwired)).toBe(true);
    expect(opened).toHaveLength(0);
  });
});
