import { describe, expect, it, vi } from 'vitest';
import { installActionBarToggle } from '../src/ui/hud/action_bar/action_bar_toggle_controller';
import { actionBarToggleModel } from '../src/ui/hud/action_bar/action_bar_toggle_core';
import {
  type ActionBarVisibility,
  resolveActionBarVisibility,
} from '../src/ui/hud/action_bar/action_bar_visibility_core';

describe('action bar toggle model', () => {
  it('reveals the secondary row first while both optional rows are hidden', () => {
    const model = actionBarToggleModel({ secondary: false, third: false });
    expect(model.expand).toEqual({ setting: 'showSecondaryActionBar', value: true });
    expect(model.collapse).toBeNull();
  });

  it('reveals the third row next and hides the secondary row while only it shows', () => {
    const model = actionBarToggleModel({ secondary: true, third: false });
    expect(model.expand).toEqual({ setting: 'showThirdActionBar', value: true });
    expect(model.collapse).toEqual({ setting: 'showSecondaryActionBar', value: false });
  });

  it('only hides, topmost row first, while both optional rows show', () => {
    const model = actionBarToggleModel({ secondary: true, third: true });
    expect(model.expand).toBeNull();
    expect(model.collapse).toEqual({ setting: 'showThirdActionBar', value: false });
  });

  it('steps through every state and back when composed with the visibility resolver', () => {
    // The click path: the model picks the setting, main.ts applies it through
    // resolveActionBarVisibility. Two plus clicks reach both rows; two minus
    // clicks return to none, third first.
    let visibility: ActionBarVisibility = { secondary: false, third: false };
    const click = (kind: 'expand' | 'collapse') => {
      const action = actionBarToggleModel(visibility)[kind];
      if (!action) return;
      visibility = resolveActionBarVisibility(visibility, action.setting, action.value);
    };
    click('expand');
    expect(visibility).toEqual({ secondary: true, third: false });
    click('expand');
    expect(visibility).toEqual({ secondary: true, third: true });
    click('expand'); // saturated: no-op
    expect(visibility).toEqual({ secondary: true, third: true });
    click('collapse');
    expect(visibility).toEqual({ secondary: true, third: false });
    click('collapse');
    expect(visibility).toEqual({ secondary: false, third: false });
    click('collapse'); // empty: no-op
    expect(visibility).toEqual({ secondary: false, third: false });
  });
});

interface FakeElement {
  tagName: string;
  type: string;
  className: string;
  textContent: string;
  disabled: boolean;
  attributes: Map<string, string>;
  children: FakeElement[];
  listeners: Map<string, () => void>;
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, handler: () => void): void;
  append(...nodes: FakeElement[]): void;
  appendChild(node: FakeElement): FakeElement;
  blur(): void;
  click(): void;
}

function fakeElement(tagName: string): FakeElement {
  const el: FakeElement = {
    tagName,
    type: '',
    className: '',
    textContent: '',
    disabled: false,
    attributes: new Map(),
    children: [],
    listeners: new Map(),
    setAttribute(name, value) {
      el.attributes.set(name, value);
    },
    addEventListener(name, handler) {
      el.listeners.set(name, handler);
    },
    append(...nodes) {
      el.children.push(...nodes);
    },
    appendChild(node) {
      el.children.push(node);
      return node;
    },
    blur() {},
    click() {
      el.listeners.get('click')?.();
    },
  };
  return el;
}

function harness(initial?: ActionBarVisibility) {
  const container = fakeElement('div');
  const doc = { createElement: (tag: string) => fakeElement(tag) } as unknown as Document;
  const apply = vi.fn();
  const tooltip = vi.fn();
  const control = installActionBarToggle({
    container: container as unknown as HTMLElement,
    document: doc,
    initial,
    t: (key) => `t:${key}`,
    apply,
    tooltip,
  });
  const wrap = container.children[0];
  const [plus, minus] = wrap.children;
  return { control, container, wrap, plus, minus, apply, tooltip };
}

describe('action bar toggle controller', () => {
  it('installs the plus/minus pair with localized accessible names and tooltips', () => {
    const { wrap, plus, minus, tooltip } = harness();
    expect(wrap.className).toBe('bar-toggle');
    expect(plus.textContent).toBe('+');
    expect(minus.textContent).toBe('-');
    for (const btn of [plus, minus]) {
      expect(btn.type).toBe('button');
      expect(btn.className).toBe('bar-toggle-btn');
    }
    expect(plus.attributes.get('data-i18n-aria')).toBe('hudChrome.actionBar.showExtraBar');
    expect(plus.attributes.get('aria-label')).toBe('t:hudChrome.actionBar.showExtraBar');
    expect(minus.attributes.get('data-i18n-aria')).toBe('hudChrome.actionBar.hideExtraBar');
    expect(minus.attributes.get('aria-label')).toBe('t:hudChrome.actionBar.hideExtraBar');
    expect(tooltip).toHaveBeenCalledTimes(2);
    const plusText = tooltip.mock.calls[0][1] as () => string;
    expect(plusText()).toBe('t:hudChrome.actionBar.showExtraBar');
  });

  it('starts at the both-hidden default: plus enabled, minus disabled', () => {
    const { plus, minus } = harness();
    expect(plus.disabled).toBe(false);
    expect(minus.disabled).toBe(true);
  });

  it('seeds from the injected initial visibility instead of assuming boot order', () => {
    const { plus, minus, apply } = harness({ secondary: true, third: true });
    expect(plus.disabled).toBe(true);
    expect(minus.disabled).toBe(false);
    minus.click();
    expect(apply).toHaveBeenCalledWith('showThirdActionBar', false);
  });

  it('applies the next reveal per plus click, following the synced visibility', () => {
    const { control, plus, apply } = harness();
    plus.click();
    expect(apply).toHaveBeenCalledWith('showSecondaryActionBar', true);
    control.sync({ secondary: true, third: false });
    plus.click();
    expect(apply).toHaveBeenLastCalledWith('showThirdActionBar', true);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('hides the topmost row per minus click and applies nothing at the bounds', () => {
    const { control, plus, minus, apply } = harness();
    minus.click(); // disabled state guards live in the model, not just the DOM flag
    expect(apply).not.toHaveBeenCalled();
    control.sync({ secondary: true, third: true });
    expect(plus.disabled).toBe(true);
    plus.click();
    expect(apply).not.toHaveBeenCalled();
    minus.click();
    expect(apply).toHaveBeenCalledWith('showThirdActionBar', false);
    control.sync({ secondary: true, third: false });
    minus.click();
    expect(apply).toHaveBeenLastCalledWith('showSecondaryActionBar', false);
    control.sync({ secondary: false, third: false });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(minus.disabled).toBe(true);
  });
});
