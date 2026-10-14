// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BuildTransformControls,
  type BuildTransformControlsDeps,
  type BuildTransformControlsState,
} from '../src/editor/build_transform_controls';
import {
  captureFocusKey,
  FOCUS_KEY_ATTR,
  findFocusKey,
  restoreFirstEnabled,
} from '../src/ui/focus_restore';
import { type TranslationKey, t } from '../src/ui/i18n';

function harness() {
  const state: BuildTransformControlsState = {
    transform: { rotY: 0, scale: 1 },
    fineRotation: false,
    canUndo: false,
    canRedo: false,
  };
  const onTransform = vi.fn((next) => {
    state.transform = next;
    state.canUndo = true;
  });
  const onUndo = vi.fn(() => {
    state.canUndo = false;
    state.canRedo = true;
  });
  const onRedo = vi.fn(() => {
    state.canUndo = true;
    state.canRedo = false;
  });
  const deps: BuildTransformControlsDeps = {
    getState: () => state,
    onTransform,
    onFineRotationChange: (on) => {
      state.fineRotation = on;
    },
    onUndo,
    onRedo,
  };
  const controls = new BuildTransformControls(deps);
  document.body.append(controls.root);
  const control = (key: TranslationKey) => {
    const found = [...controls.root.querySelectorAll('button')].find(
      (entry) => entry.textContent === t(key),
    );
    if (!found) throw new Error(`Missing control: ${key}`);
    return found;
  };
  return { state, deps, controls, control, onTransform, onUndo, onRedo };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('build transform controls', () => {
  it('carries rotation and fine-rotation focus through rebuilding the inspector controls', () => {
    for (const key of ['transform:rotateRight', 'transform:fineRotation']) {
      const h = harness();
      const previous = findFocusKey(h.controls.root, key);
      previous?.focus();
      const captured = captureFocusKey(h.controls.root);
      expect(captured).toBe(key);
      if (captured === null) throw new Error('Focused transform control has no identity');
      const rebuilt = new BuildTransformControls(h.deps);
      h.controls.root.replaceWith(rebuilt.root);
      restoreFirstEnabled([findFocusKey(rebuilt.root, captured)]);
      expect(captureFocusKey(rebuilt.root)).toBe(key);
      const keys = [...rebuilt.root.querySelectorAll('button, input')].map((control) =>
        control.getAttribute(FOCUS_KEY_ATTR),
      );
      expect(keys.every((value) => value?.startsWith('transform:'))).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('uses current injected state for visible rotate, fine rotation, and resize controls', () => {
    const h = harness();
    h.control('editor.buildMode.rotateRight').click();
    expect(h.state.transform?.rotY).toBeCloseTo(Math.PI / 4);
    expect(h.onTransform).toHaveBeenLastCalledWith({ rotY: Math.PI / 4, scale: 1 }, 'rotateRight');
    h.controls.root.querySelector('input')?.click();
    h.control('editor.buildMode.rotateLeft').click();
    expect(h.state.fineRotation).toBe(true);
    expect(h.state.transform?.rotY).toBeCloseTo(Math.PI / 6);
    h.control('editor.buildMode.larger').click();
    expect(h.state.transform?.scale).toBe(1.1);
    h.control('editor.buildMode.smaller').click();
    expect(h.state.transform?.scale).toBe(1);
    expect(h.controls.root.getAttribute('aria-label')).toBe(
      t('editor.buildMode.transformControls'),
    );
  });

  it('keeps history available with no asset and refreshes button availability after actions', () => {
    const h = harness();
    h.state.transform = null;
    h.state.canUndo = true;
    h.controls.refresh();
    expect(h.control('editor.buildMode.rotateLeft').disabled).toBe(true);
    h.control('editor.buildMode.rotateLeft').click();
    expect(h.onTransform).not.toHaveBeenCalled();
    h.control('editor.buildMode.undo').click();
    expect(h.onUndo).toHaveBeenCalledOnce();
    expect(h.control('editor.buildMode.undo').disabled).toBe(true);
    expect(h.control('editor.buildMode.redo').disabled).toBe(false);
    h.control('editor.buildMode.redo').click();
    expect(h.onRedo).toHaveBeenCalledOnce();
    expect(h.control('editor.buildMode.redo').disabled).toBe(true);
  });

  it('does not send no-op scale changes to the host undo stack', () => {
    const h = harness();
    h.state.transform = { rotY: 0, scale: 50 };
    h.controls.refresh();
    h.control('editor.buildMode.larger').click();
    expect(h.onTransform).not.toHaveBeenCalled();
  });

  it('consumes only an active unmodified transform shortcut', () => {
    const h = harness();
    const event = new KeyboardEvent('keydown', { key: '.', cancelable: true });
    expect(h.controls.handleKeydown(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(h.state.transform?.rotY).toBeCloseTo(Math.PI / 4);
    const modified = new KeyboardEvent('keydown', { key: '.', metaKey: true, cancelable: true });
    expect(h.controls.handleKeydown(modified)).toBe(false);
    expect(modified.defaultPrevented).toBe(false);
    h.state.transform = null;
    const empty = new KeyboardEvent('keydown', { key: ']', cancelable: true });
    expect(h.controls.handleKeydown(empty)).toBe(false);
    expect(empty.defaultPrevented).toBe(false);
  });

  it('preserves text entry for input fields and nested editable elements', () => {
    const h = harness();
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const nested = document.createElement('span');
    editable.append(nested);
    h.controls.root.append(input, editable);
    h.controls.root.addEventListener('keydown', (event) => h.controls.handleKeydown(event));
    for (const target of [input, nested]) {
      const event = new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(h.onTransform).not.toHaveBeenCalled();
  });
});
