// QuestProgressBanner (src/ui/hud/quest/quest_progress_banner.ts): the WoW-style yellow
// top-center quest flash. Pins the stack contract: lines append in order, the
// oldest drops past maxLines, and each line fades then removes on its own
// timers. Driven over a tiny hand-rolled fake DOM (no jsdom) + fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUEST_BANNER_FADE_MS,
  QUEST_BANNER_LINE_MS,
  QUEST_BANNER_MAX_LINES,
  QuestProgressBanner,
} from '../src/ui/hud/quest/quest_progress_banner';

interface FakeEl {
  className: string;
  textContent: string;
  children: FakeEl[];
  parentEl: FakeEl | null;
  firstElementChild: FakeEl | null;
  ownerDocument: { createElement(tag: string): FakeEl };
  classList: { add(c: string): void; contains(c: string): boolean };
  appendChild(kid: FakeEl): void;
  remove(): void;
}

function fakeEl(): FakeEl {
  const classes = new Set<string>();
  const el: FakeEl = {
    className: '',
    textContent: '',
    children: [],
    parentEl: null,
    get firstElementChild() {
      return el.children[0] ?? null;
    },
    ownerDocument: { createElement: () => fakeEl() },
    classList: {
      add: (c) => classes.add(c),
      contains: (c) => classes.has(c),
    },
    appendChild(kid) {
      kid.parentEl = el;
      el.children.push(kid);
    },
    remove() {
      const p = el.parentEl;
      if (!p) return;
      const i = p.children.indexOf(el);
      if (i >= 0) p.children.splice(i, 1);
      el.parentEl = null;
    },
  };
  return el;
}

describe('QuestProgressBanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('appends a yellow line per progress event, newest last', () => {
    const host = fakeEl();
    const banner = new QuestProgressBanner(host as unknown as HTMLElement);
    banner.show('Forest Wolf slain: 1/8');
    banner.show('Forest Wolf slain: 2/8');
    expect(host.children.map((c) => c.textContent)).toEqual([
      'Forest Wolf slain: 1/8',
      'Forest Wolf slain: 2/8',
    ]);
    expect(host.children[0].className).toBe('quest-banner-line');
  });

  it('drops the OLDEST line when the stack overflows maxLines', () => {
    const host = fakeEl();
    const banner = new QuestProgressBanner(host as unknown as HTMLElement);
    for (let i = 1; i <= QUEST_BANNER_MAX_LINES + 2; i++) banner.show(`line ${i}`);
    expect(host.children).toHaveLength(QUEST_BANNER_MAX_LINES);
    expect(host.children[0].textContent).toBe('line 3'); // 1 and 2 yielded
    expect(host.children.at(-1)?.textContent).toBe(`line ${QUEST_BANNER_MAX_LINES + 2}`);
  });

  it('fades a line after its visible window, then removes it after the fade', () => {
    const host = fakeEl();
    const banner = new QuestProgressBanner(host as unknown as HTMLElement);
    banner.show('Forest Wolf slain: 3/8');
    const line = host.children[0];
    // fully visible through the window
    vi.advanceTimersByTime(QUEST_BANNER_LINE_MS - 1);
    expect(line.classList.contains('fade')).toBe(false);
    // fade class lands at the window's end; the node survives the transition
    vi.advanceTimersByTime(1);
    expect(line.classList.contains('fade')).toBe(true);
    expect(host.children).toHaveLength(1);
    // and is removed once the CSS fade duration elapses
    vi.advanceTimersByTime(QUEST_BANNER_FADE_MS);
    expect(host.children).toHaveLength(0);
  });

  it('a line already dropped by overflow does not throw when its fade timer fires', () => {
    const host = fakeEl();
    const banner = new QuestProgressBanner(host as unknown as HTMLElement, 1);
    banner.show('first');
    banner.show('second'); // evicts 'first' immediately
    expect(host.children.map((c) => c.textContent)).toEqual(['second']);
    // both timers fire; the evicted line's remove() is a no-op, never a throw
    vi.advanceTimersByTime(QUEST_BANNER_LINE_MS + QUEST_BANNER_FADE_MS);
    expect(host.children).toHaveLength(0);
  });
});
