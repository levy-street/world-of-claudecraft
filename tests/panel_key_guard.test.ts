// @vitest-environment happy-dom
//
// The non-modal panel key guard: which activations the Hud swallows before the
// global jump / chat binds see them, and the one it must not.

import { describe, expect, it } from 'vitest';
import { BAG_ITEM_ROW_ATTR, panelKeyGuardStops } from '../src/ui/panel_key_guard';

function el(tag: string, bagItemRow = false): HTMLElement {
  const node = document.createElement(tag);
  if (bagItemRow) node.setAttribute(BAG_ITEM_ROW_ATTR, '');
  return node;
}

describe('panelKeyGuardStops', () => {
  it('swallows Enter and Space on an ordinary panel button', () => {
    const button = el('button');
    expect(panelKeyGuardStops(button, ' ', 'Space')).toBe(true);
    expect(panelKeyGuardStops(button, 'Spacebar', 'Spacebar')).toBe(true);
    expect(panelKeyGuardStops(button, 'Enter', 'Enter')).toBe(true);
  });

  it('lets Space past a bag item row so the jump still fires', () => {
    expect(panelKeyGuardStops(el('button', true), ' ', 'Space')).toBe(false);
    expect(panelKeyGuardStops(el('button', true), 'Spacebar', 'Spacebar')).toBe(false);
  });

  it('still swallows Enter on a bag item row, which activates it', () => {
    expect(panelKeyGuardStops(el('button', true), 'Enter', 'Enter')).toBe(true);
  });

  it('ignores anything that is not a button', () => {
    expect(panelKeyGuardStops(el('div'), ' ', 'Space')).toBe(false);
    expect(panelKeyGuardStops(el('input'), 'Enter', 'Enter')).toBe(false);
  });

  it('ignores other keys', () => {
    expect(panelKeyGuardStops(el('button'), 'w', 'KeyW')).toBe(false);
    expect(panelKeyGuardStops(el('button'), 'Escape', 'Escape')).toBe(false);
  });
});
