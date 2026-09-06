import { describe, expect, it } from 'vitest';
import {
  ChatScrollFollow,
  isNearBottom,
  NEAR_BOTTOM_PX,
} from '../src/ui/hud/chat/chat_scroll_follow';

class FakePane {
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  private listeners: (() => void)[] = [];
  addEventListener(_type: 'scroll', l: () => void): void {
    this.listeners.push(l);
  }
  /** Mimic the browser: set scrollTop (clamped) and fire the scroll event. */
  scrollTo(top: number): void {
    this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
    for (const l of this.listeners) l();
  }
}

describe('isNearBottom', () => {
  it('is true at the bottom and within the slack, false beyond it', () => {
    expect(isNearBottom({ scrollTop: 300, scrollHeight: 500, clientHeight: 200 })).toBe(true);
    expect(
      isNearBottom({ scrollTop: 300 - NEAR_BOTTOM_PX + 1, scrollHeight: 500, clientHeight: 200 }),
    ).toBe(true);
    expect(
      isNearBottom({ scrollTop: 300 - NEAR_BOTTOM_PX, scrollHeight: 500, clientHeight: 200 }),
    ).toBe(false);
  });
});

describe('ChatScrollFollow', () => {
  it('follows by default, including for a pane it was never given', () => {
    const f = new ChatScrollFollow();
    expect(f.shouldFollow(new FakePane())).toBe(true);
  });

  // The 4K regression: the login welcome, appended while the pane was hidden,
  // already overflows a 200px frame at 250% text. Under the old per-append
  // "near bottom" check the pane was stuck at the top forever.
  it('keeps following when content overflowed with no player scroll', () => {
    const pane = new FakePane();
    const f = new ChatScrollFollow([pane]);
    pane.scrollHeight = 260;
    pane.clientHeight = 200;
    expect(f.shouldFollow(pane)).toBe(true);
  });

  it('parks the pane when the player scrolls up and resumes when they return', () => {
    const pane = new FakePane();
    const f = new ChatScrollFollow([pane]);
    pane.scrollHeight = 1000;
    pane.clientHeight = 200;
    pane.scrollTo(800); // the programmatic follow after an append
    expect(f.shouldFollow(pane)).toBe(true);
    pane.scrollTo(400); // reading history
    expect(f.shouldFollow(pane)).toBe(false);
    pane.scrollTo(800 - NEAR_BOTTOM_PX + 1); // back within the slack
    expect(f.shouldFollow(pane)).toBe(true);
  });

  it('keeps a pinned pane pinned through layout-driven scroll events', () => {
    const pane = new FakePane();
    pane.scrollHeight = 500;
    pane.clientHeight = 200;
    const f = new ChatScrollFollow([pane]);
    pane.scrollTo(300);

    pane.scrollHeight = 800;
    pane.scrollTo(300);

    expect(f.shouldFollow(pane)).toBe(true);
    expect(pane.scrollTop).toBe(600);
  });

  it('tracks each pane independently', () => {
    const chat = new FakePane();
    const combat = new FakePane();
    const f = new ChatScrollFollow([chat, combat]);
    for (const p of [chat, combat]) {
      p.scrollHeight = 1000;
      p.clientHeight = 200;
    }
    chat.scrollTo(100);
    expect(f.shouldFollow(chat)).toBe(false);
    expect(f.shouldFollow(combat)).toBe(true);
  });
});
