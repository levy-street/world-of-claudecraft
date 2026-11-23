// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SelectionQuickActions,
  type SelectionQuickActionsState,
} from '../src/editor/selection_quick_actions';
import { t } from '../src/ui/i18n';

function harness(
  initial: SelectionQuickActionsState | null = {
    label: 'Royal arch',
    count: 1,
    transform: { rotY: 0, scale: 1 },
    fineRotation: false,
  },
) {
  let state = initial;
  const onMove = vi.fn();
  const onFrame = vi.fn();
  const onDuplicate = vi.fn();
  const onRemove = vi.fn();
  const onTransform = vi.fn((next) => {
    if (state) state.transform = next;
  });
  const panel = new SelectionQuickActions({
    getState: () => state,
    onMove,
    onFrame,
    onDuplicate,
    onRemove,
    onTransform,
  });
  const stage = document.createElement('div');
  stage.append(panel.root);
  document.body.append(stage);
  const control = (action: string): HTMLButtonElement => {
    const found = panel.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (!found) throw new Error(`Missing action: ${action}`);
    return found;
  };
  return {
    panel,
    stage,
    control,
    onMove,
    onFrame,
    onDuplicate,
    onRemove,
    onTransform,
    get state() {
      if (!state) throw new Error('No active selection in this fixture');
      return state;
    },
    setState(next: SelectionQuickActionsState | null) {
      state = next;
    },
  };
}

beforeEach(() => document.body.replaceChildren());

describe('selected-placement quick actions', () => {
  it('routes selection commands once and identifies the selected asset', () => {
    const h = harness();
    expect(h.panel.root.hidden).toBe(false);
    expect(h.panel.root.getAttribute('aria-label')).toBe(t('editor.quickActions.title'));
    expect(h.panel.root.querySelector('strong')?.textContent).toBe('Royal arch');
    for (const action of ['move', 'frame', 'duplicate', 'remove']) h.control(action).click();
    expect(h.onMove).toHaveBeenCalledOnce();
    expect(h.onFrame).toHaveBeenCalledOnce();
    expect(h.onDuplicate).toHaveBeenCalledOnce();
    expect(h.onRemove).toHaveBeenCalledOnce();
    expect(h.onTransform).not.toHaveBeenCalled();
  });

  it('reads current rotation, fine step, and scale for each transform action', () => {
    const h = harness();
    h.control('rotateRight').click();
    expect(h.onTransform).toHaveBeenLastCalledWith({ rotY: Math.PI / 4, scale: 1 });
    h.state.fineRotation = true;
    h.control('rotateLeft').click();
    expect(h.state.transform.rotY).toBeCloseTo(Math.PI / 6);
    h.control('larger').click();
    expect(h.state.transform.scale).toBe(1.1);
    h.control('smaller').click();
    expect(h.state.transform.scale).toBe(1);
    expect(h.panel.root.querySelector('.ed-selection-quick-readout')?.textContent).toBe(
      t('editor.buildMode.transformReadout', { degrees: '30', scale: '1' }),
    );
    expect(h.onTransform).toHaveBeenCalledTimes(4);
  });

  it('keeps the same focused control when selection labels and counts refresh', () => {
    const h = harness();
    const focused = h.control('duplicate');
    focused.focus();
    h.state.count = 3;
    h.state.label = 'Changed asset';
    h.panel.refresh();
    expect(h.control('duplicate')).toBe(focused);
    expect(document.activeElement).toBe(focused);
    expect(h.panel.root.querySelector('strong')?.textContent).toBe(
      t('editor.quickActions.count', { count: '3' }),
    );
    h.state.count = 1;
    h.panel.refresh();
    expect(h.panel.root.querySelector('strong')?.textContent).toBe('Changed asset');
  });

  it('hides and disables every action when there is no selection', () => {
    const h = harness(null);
    expect(h.panel.root.hidden).toBe(true);
    for (const control of h.panel.root.querySelectorAll('button')) {
      expect(control.disabled).toBe(true);
      control.click();
    }
    expect(h.onMove).not.toHaveBeenCalled();
    expect(h.onRemove).not.toHaveBeenCalled();
    expect(h.onTransform).not.toHaveBeenCalled();
  });

  it('rejects a stale click if the selection disappeared before the next refresh', () => {
    const h = harness();
    h.setState(null);
    h.control('remove').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    h.control('rotateRight').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.onRemove).not.toHaveBeenCalled();
    expect(h.onTransform).not.toHaveBeenCalled();
    expect(h.panel.root.hidden).toBe(true);
    expect(h.panel.root.querySelector('strong')?.textContent).toBe('');
  });

  it('disables a bounded scale action and never sends an empty transform to undo', () => {
    const h = harness();
    h.state.transform.scale = 50;
    h.panel.refresh();
    expect(h.control('larger').disabled).toBe(true);
    expect(h.control('smaller').disabled).toBe(false);
    h.control('larger').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.onTransform).not.toHaveBeenCalled();
    h.state.transform.scale = 0.2;
    h.panel.refresh();
    expect(h.control('smaller').disabled).toBe(true);
    h.control('smaller').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.onTransform).not.toHaveBeenCalled();
    h.control('larger').click();
    expect(h.state.transform.scale).toBe(0.22);
    expect(h.control('smaller').disabled).toBe(false);
  });

  it('does not pass panel gestures or keyboard actions into the editor canvas', () => {
    const h = harness();
    const canvasInput = vi.fn();
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'click', 'contextmenu']) {
      h.stage.addEventListener(type, canvasInput);
      h.control('frame').dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
    expect(canvasInput).not.toHaveBeenCalled();
    expect(h.onFrame).toHaveBeenCalledOnce();
    for (const key of ['Delete', 'ArrowLeft', '.', 'Enter', ' ', 'Tab']) {
      h.stage.addEventListener('keydown', canvasInput);
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      h.control('frame').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(canvasInput).not.toHaveBeenCalled();
    expect(h.onRemove).not.toHaveBeenCalled();
    expect(h.onTransform).not.toHaveBeenCalled();
  });

  it('cleans up the panel and rejects retained button actions after disposal', () => {
    const h = harness();
    const remove = h.control('remove');
    h.panel.dispose();
    expect(h.panel.root.isConnected).toBe(false);
    expect(h.panel.root.hidden).toBe(true);
    remove.dispatchEvent(new MouseEvent('click'));
    h.panel.refresh();
    expect(h.onRemove).not.toHaveBeenCalled();
    expect(h.panel.root.hidden).toBe(true);
  });
});
