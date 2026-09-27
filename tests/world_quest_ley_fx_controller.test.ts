// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldQuestLeyFxController } from '../src/ui/world_quest_ley_fx_controller';

describe('Ley effect lifecycle', () => {
  let original: PropertyDescriptor | undefined;
  let fx: WorldQuestLeyFxController;
  let root: HTMLElement;
  let cell: HTMLButtonElement;
  let records: Array<{
    element: Element;
    options: KeyframeAnimationOptions;
    cancel: ReturnType<typeof vi.fn>;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
  }>;
  beforeEach(() => {
    document.body.className = '';
    delete document.documentElement.dataset.fxLevel;
    document.body.innerHTML =
      '<section><button><span class="wql-rotor"><span class="wqp-arm"></span><span class="wql-core"></span></span></button><div class="fx"></div></section>';
    root = document.querySelector('section')!;
    cell = root.querySelector('button')!;
    records = [];
    original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: function (this: Element, _frames: Keyframe[], options: KeyframeAnimationOptions) {
        const animation = {
          element: this,
          options,
          cancel: vi.fn(),
          onfinish: null,
          oncancel: null,
        };
        records.push(animation);
        return animation;
      },
    });
    fx = new WorldQuestLeyFxController(root, root.querySelector('.fx')!, document);
  });
  afterEach(() => {
    fx.dispose();
    if (original) Object.defineProperty(Element.prototype, 'animate', original);
    else Reflect.deleteProperty(Element.prototype, 'animate');
    delete document.documentElement.dataset.fxLevel;
  });
  it('animates the decorative core without delaying the functional connectors', () => {
    cell.focus();
    fx.playCircuit([0], [cell], [1]);
    expect(records.some((r) => r.element.classList.contains('wql-core'))).toBe(true);
    expect(
      records.every(
        (r) =>
          !r.element.classList.contains('wql-rotor') && !r.element.classList.contains('wqp-arm'),
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(cell);
    expect(cell.disabled).toBe(false);
  });
  it('cancels delayed waves when settings are lowered, and suppresses subsequent effects', async () => {
    fx.playOutcome('won');
    expect(root.querySelectorAll('.wql-effect').length).toBeGreaterThan(50);
    document.documentElement.dataset.fxLevel = 'low';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelectorAll('.wql-effect')).toHaveLength(0);
    expect(records.every((r) => r.cancel.mock.calls.length === 1)).toBe(true);
    const count = records.length;
    fx.playOutcome('won');
    fx.playCircuit([0], [cell], [1]);
    expect(records).toHaveLength(count);
  });
  it('cleans every finite animation on completion and disposal', () => {
    fx.playOutcome('won');
    expect(
      records.every((r) => Number(r.options.duration) + Number(r.options.delay ?? 0) <= 5250),
    ).toBe(true);
    for (const record of records) record.onfinish?.();
    expect(root.querySelectorAll('.wql-effect')).toHaveLength(0);
    fx.dispose();
    expect(records.every((r) => r.cancel.mock.calls.length === 1)).toBe(true);
  });
  it('keeps the board usable if animation support throws', () => {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value() {
        throw new Error('No animation backend');
      },
    });
    expect(() => fx.playCircuit([0], [cell], [1])).not.toThrow();
    expect(root.querySelectorAll('.wql-effect')).toHaveLength(0);
    expect(cell.disabled).toBe(false);
  });
});
