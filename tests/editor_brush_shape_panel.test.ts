// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { brushShapeButtons } from '../src/editor/brush_shape_panel';
import { captureFocusKey, findFocusKey, restoreFirstEnabled } from '../src/ui/focus_restore';

describe('brush shape switcher', () => {
  it('retains keyboard focus when changing shape rebuilds the inspector controls', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rebuild = (shape: 'circle' | 'square'): void => {
      const focusKey = captureFocusKey(root);
      root.replaceChildren(brushShapeButtons(shape, rebuild));
      if (focusKey !== null) restoreFirstEnabled([findFocusKey(root, focusKey)]);
    };
    rebuild('circle');
    for (const shape of ['square', 'circle'] as const) {
      const control = root.querySelector<HTMLButtonElement>(`[data-brush-shape="${shape}"]`)!;
      control.focus();
      control.click();
      const rebuilt = root.querySelector(`[data-brush-shape="${shape}"]`)!;
      expect(rebuilt).not.toBe(control);
      expect(document.activeElement).toBe(rebuilt);
      expect(rebuilt.getAttribute('aria-pressed')).toBe('true');
    }
    root.remove();
  });

  it('switches both ways with button semantics and keeps the current choice visible', () => {
    const changed = vi.fn();
    const panel = brushShapeButtons('circle', changed);
    const circle = panel.querySelector<HTMLButtonElement>('[data-brush-shape="circle"]')!;
    const square = panel.querySelector<HTMLButtonElement>('[data-brush-shape="square"]')!;
    expect(circle.getAttribute('aria-pressed')).toBe('true');
    square.click();
    expect(changed).toHaveBeenLastCalledWith('square');
    expect(square.getAttribute('aria-pressed')).toBe('true');
    expect(circle.getAttribute('aria-pressed')).toBe('false');
    circle.click();
    expect(changed).toHaveBeenLastCalledWith('circle');
    expect(circle.getAttribute('aria-pressed')).toBe('true');
    expect(square.type).toBe('button');
  });
});
