import { describe, expect, it } from 'vitest';
import { focusActiveTab, wireTabStrip } from '../src/ui/tab_strip_painter';

// Hand-rolled fake DOM (repo convention: no jsdom for src/ui/ wiring tests). Models
// only the contract wireTabStrip uses: querySelectorAll by class, dataset.tab, and a
// per-type listener list a test fires directly instead of a real event loop.
class FakeTab {
  dataset: { tab?: string };
  classes: Set<string>;
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  focused = false;
  constructor(tab: string, classes: string[] = []) {
    this.dataset = { tab };
    this.classes = new Set(classes);
  }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
  focus(): void {
    this.focused = true;
  }
  fire(type: string, event: unknown = { preventDefault: () => {} }): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
}

class FakeContainer {
  constructor(private readonly tabs: FakeTab[]) {}
  querySelectorAll<T>(sel: string): T[] {
    const classes = sel.split('.').filter(Boolean);
    return this.tabs.filter((tab) => classes.every((c) => tab.classes.has(c))) as unknown as T[];
  }
  querySelector<T>(sel: string): T | null {
    const classes = sel.split('.').filter(Boolean);
    const found = this.tabs.find((tab) => classes.every((c) => tab.classes.has(c)));
    return (found ?? null) as unknown as T | null;
  }
}

describe('wireTabStrip', () => {
  it('dispatches a click without focus-follow', () => {
    const [friends, guild] = [
      new FakeTab('friends', ['soc-tab']),
      new FakeTab('guild', ['soc-tab']),
    ];
    const calls: [string, boolean][] = [];
    wireTabStrip(
      new FakeContainer([friends, guild]) as unknown as HTMLElement,
      'soc-tab',
      (id, focusFollow) => calls.push([id, focusFollow]),
    );
    friends.fire('click');
    expect(calls).toEqual([['friends', false]]);
  });

  it('moves selection to the next tab on ArrowRight, with focus-follow', () => {
    const [friends, guild] = [
      new FakeTab('friends', ['soc-tab']),
      new FakeTab('guild', ['soc-tab']),
    ];
    const calls: [string, boolean][] = [];
    wireTabStrip(
      new FakeContainer([friends, guild]) as unknown as HTMLElement,
      'soc-tab',
      (id, focusFollow) => calls.push([id, focusFollow]),
    );
    let prevented = false;
    friends.fire('keydown', { key: 'ArrowRight', preventDefault: () => (prevented = true) });
    expect(calls).toEqual([['guild', true]]);
    expect(prevented).toBe(true);
  });

  it('wraps Home/End and activates the focused tab on Enter/Space, all focus-follow', () => {
    const [friends, guild, block] = [
      new FakeTab('friends', ['soc-tab']),
      new FakeTab('guild', ['soc-tab']),
      new FakeTab('block', ['soc-tab']),
    ];
    const calls: [string, boolean][] = [];
    wireTabStrip(
      new FakeContainer([friends, guild, block]) as unknown as HTMLElement,
      'soc-tab',
      (id, focusFollow) => calls.push([id, focusFollow]),
    );
    guild.fire('keydown', { key: 'End', preventDefault: () => {} });
    block.fire('keydown', { key: 'Enter', preventDefault: () => {} });
    guild.fire('keydown', { key: ' ', preventDefault: () => {} });
    expect(calls).toEqual([
      ['block', true],
      ['block', true],
      ['guild', true],
    ]);
  });

  it('ignores a non-navigation key', () => {
    const friends = new FakeTab('friends', ['soc-tab']);
    const calls: [string, boolean][] = [];
    wireTabStrip(new FakeContainer([friends]) as unknown as HTMLElement, 'soc-tab', (id, f) =>
      calls.push([id, f]),
    );
    friends.fire('keydown', { key: 'a', preventDefault: () => {} });
    expect(calls).toEqual([]);
  });

  it("honors an explicit 'both' orientation (Up/Down roving, for a future vertical strip)", () => {
    const [a, b] = [new FakeTab('a', ['tal-tab']), new FakeTab('b', ['tal-tab'])];
    const calls: [string, boolean][] = [];
    wireTabStrip(
      new FakeContainer([a, b]) as unknown as HTMLElement,
      'tal-tab',
      (id, f) => calls.push([id, f]),
      'both',
    );
    a.fire('keydown', { key: 'ArrowDown', preventDefault: () => {} });
    expect(calls).toEqual([['b', true]]);
  });

  it("defaults to 'horizontal' orientation (ArrowDown is not a navigation key)", () => {
    const [a, b] = [new FakeTab('a', ['soc-tab']), new FakeTab('b', ['soc-tab'])];
    const calls: [string, boolean][] = [];
    wireTabStrip(new FakeContainer([a, b]) as unknown as HTMLElement, 'soc-tab', (id, f) =>
      calls.push([id, f]),
    );
    a.fire('keydown', { key: 'ArrowDown', preventDefault: () => {} });
    expect(calls).toEqual([]);
  });

  it('wires nothing when tabClass does not match any tab (closes the querySelectorAll hole)', () => {
    const friends = new FakeTab('friends', ['soc-tab']);
    const calls: [string, boolean][] = [];
    wireTabStrip(new FakeContainer([friends]) as unknown as HTMLElement, 'tal-tab', (id, f) =>
      calls.push([id, f]),
    );
    friends.fire('click');
    expect(calls).toEqual([]);
  });
});

describe('focusActiveTab', () => {
  it('focuses the tab matching both the tab class and the selected class', () => {
    const friends = new FakeTab('friends', ['soc-tab']);
    const guild = new FakeTab('guild', ['soc-tab', 'on']);
    const container = new FakeContainer([friends, guild]);
    focusActiveTab(container as unknown as HTMLElement, 'soc-tab', 'on');
    expect(guild.focused).toBe(true);
    expect(friends.focused).toBe(false);
  });

  it('is a no-op when no tab is selected', () => {
    const friends = new FakeTab('friends', ['soc-tab']);
    const container = new FakeContainer([friends]);
    expect(() =>
      focusActiveTab(container as unknown as HTMLElement, 'soc-tab', 'on'),
    ).not.toThrow();
    expect(friends.focused).toBe(false);
  });
});
