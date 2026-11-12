// chat_link_focus.ts: the capture-phase pointer focus drop for chat link tokens
// (the "Space re-opens the last clicked chat link" fix). Plain-Node suite over
// hand-rolled fakes; the trusted-event end-to-end path (real Input, real window
// focus bridge) lives in tests/browser/stale_focus_space.browser.test.ts.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bindChatLinkPointerBlur,
  CHAT_ACTION_LINK_SELECTOR,
  CHAT_INSPECT_LINK_SELECTOR,
} from '../src/ui/hud/chat/chat_link_focus';

interface Bound {
  type: string;
  listener: (e: Event) => void;
  capture: boolean;
}

class FakePane {
  listeners: Bound[] = [];
  addEventListener(
    type: string,
    listener: (e: Event) => void,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    this.listeners.push({ type, listener, capture });
  }
  click(e: { detail: number; pointerType?: string; target: unknown }): void {
    for (const l of this.listeners) if (l.type === 'click') l.listener(e as unknown as Event);
  }
}

/** A click target carrying one class, matched against a comma-separated selector. */
class FakeLink {
  blurred = 0;
  constructor(private readonly cls: string) {}
  closest(selector: string): FakeLink | null {
    return selector.split(', ').includes(`.${this.cls}`) ? this : null;
  }
  blur(): void {
    this.blurred++;
  }
}

function pane(): FakePane {
  const p = new FakePane();
  bindChatLinkPointerBlur(p);
  return p;
}

describe('bindChatLinkPointerBlur', () => {
  it('binds one CAPTURE-phase click listener (the drop must precede the link handler)', () => {
    expect(pane().listeners.map((l) => `${l.type}:${l.capture}`)).toEqual(['click:true']);
  });

  it.each(['chat-quest-link', 'chat-deed-link'])(
    'drops focus from a pointer-clicked %s on every pointer type, never on a keyboard click',
    (cls) => {
      const p = pane();
      const link = new FakeLink(cls);
      p.click({ detail: 1, pointerType: 'mouse', target: link });
      p.click({ detail: 1, pointerType: 'touch', target: link });
      p.click({ detail: 1, target: link });
      expect(link.blurred).toBe(3);
      // Tab + Enter/Space dispatches click with detail 0: focus (and the window
      // opener return it feeds) stays with the keyboard user.
      p.click({ detail: 0, target: link });
      expect(link.blurred).toBe(3);
    },
  );

  it('drops an item link on a MOUSE click only: touch focus is what shows its tooltip', () => {
    const p = pane();
    const link = new FakeLink('chat-item-link');
    p.click({ detail: 1, pointerType: 'mouse', target: link });
    expect(link.blurred).toBe(1);
    p.click({ detail: 1, pointerType: 'touch', target: link });
    p.click({ detail: 1, pointerType: 'pen', target: link });
    p.click({ detail: 1, target: link });
    p.click({ detail: 0, pointerType: 'mouse', target: link });
    expect(link.blurred).toBe(1);
  });

  it('leaves plain chat text and a null target alone', () => {
    const p = pane();
    const text = new FakeLink('chat-line');
    p.click({ detail: 1, pointerType: 'mouse', target: text });
    p.click({ detail: 1, pointerType: 'mouse', target: null });
    expect(text.blurred).toBe(0);
  });
});

describe('coverage pins', () => {
  const uiDir = join(__dirname, '../src/ui');

  it('every chat link class the UI source assigns is in one of the two selectors', () => {
    // The bug regressed because the links sat outside every capture-phase drop.
    // A new link token must enroll before it can ship.
    const found = new Set<string>();
    for (const entry of readdirSync(uiDir, { recursive: true, encoding: 'utf8' })) {
      if (!entry.endsWith('.ts')) continue;
      const src = readFileSync(join(uiDir, entry), 'utf8');
      for (const m of src.matchAll(/className = '(chat-[a-z]+-link)'/g)) found.add(`.${m[1]}`);
    }
    const enrolled = [
      ...CHAT_ACTION_LINK_SELECTOR.split(', '),
      ...CHAT_INSPECT_LINK_SELECTOR.split(', '),
    ];
    expect([...found].sort()).toEqual(enrolled.sort());
    expect(enrolled).toEqual(['.chat-deed-link', '.chat-item-link', '.chat-quest-link']);
  });

  it('the chat controller binds the drop over both panes', () => {
    const src = readFileSync(join(uiDir, 'hud/chat/chat_window_controller.ts'), 'utf8');
    expect(src).toContain('bindChatLinkPointerBlur(this.deps.chatLog)');
    expect(src).toContain('bindChatLinkPointerBlur(this.deps.combatLog)');
  });
});
