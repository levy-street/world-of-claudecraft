// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindRaidBossGuideScroll } from '../src/ui/raid_boss_guide_scroll';

describe('bindRaidBossGuideScroll', () => {
  let journal: HTMLElement;

  beforeEach(() => {
    journal = document.createElement('section');
    journal.tabIndex = 0;
    Object.defineProperties(journal, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    document.body.replaceChildren(journal);
    bindRaidBossGuideScroll(journal);
  });

  it('normalizes pixel, line, and page wheels and clamps both boundaries', () => {
    const wheel = (deltaY: number, deltaMode: number = WheelEvent.DOM_DELTA_PIXEL) => {
      const event = new WheelEvent('wheel', { deltaY, deltaMode, cancelable: true });
      journal.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };

    wheel(20);
    expect(journal.scrollTop).toBe(20);
    wheel(2, WheelEvent.DOM_DELTA_LINE);
    expect(journal.scrollTop).toBe(84);
    wheel(1, WheelEvent.DOM_DELTA_PAGE);
    expect(journal.scrollTop).toBe(284);
    wheel(10_000);
    expect(journal.scrollTop).toBe(800);
    wheel(-10_000);
    expect(journal.scrollTop).toBe(0);
  });

  it.each([
    ['ArrowDown', 48],
    ['PageDown', 170],
    ['End', 800],
    ['ArrowUp', 352],
    ['PageUp', 230],
    ['Home', 0],
  ] as const)('handles %s when the scroll region itself is focused', (key, expected) => {
    journal.scrollTop = key === 'ArrowUp' || key === 'PageUp' ? 400 : 0;
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

    journal.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(journal.scrollTop).toBe(expected);
  });

  it('leaves browser zoom gestures and key events from child controls untouched', () => {
    const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, cancelable: true });
    Object.defineProperty(zoom, 'ctrlKey', { configurable: true, value: true });
    const preventZoom = vi.spyOn(zoom, 'preventDefault');
    journal.dispatchEvent(zoom);
    expect(preventZoom).not.toHaveBeenCalled();
    expect(journal.scrollTop).toBe(0);

    const button = document.createElement('button');
    journal.append(button);
    const childKey = new KeyboardEvent('keydown', {
      key: 'End',
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(childKey);
    expect(childKey.defaultPrevented).toBe(false);
    expect(journal.scrollTop).toBe(0);
  });

  it('does not consume scrolling when all journal content already fits', () => {
    Object.defineProperty(journal, 'scrollHeight', { configurable: true, value: 200 });
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true });

    journal.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(false);
    expect(journal.scrollTop).toBe(0);
  });
});
