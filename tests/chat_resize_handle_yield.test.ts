import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChatGeometryController } from '../src/ui/hud/chat/chat_geometry_controller';
import {
  CHAT_RESIZE_YIELD_CLASS,
  isContextMenuShown,
  syncResizeHandleYield,
} from '../src/ui/hud/chat/chat_resize_handle_yield';
import { FakeDocument, FakeWindow } from './helpers/fake_dom';

// Round 2 of the touch whisper fix: at 844x390 the body-level chat resize handle
// (z-index 300) covered the Cancel row of the chat "+" Add channel menu, which lives
// inside #ui's z-index-10 stacking context and so can never be lifted above it. The
// handle now steps aside (a class the touch sheet hides) while any #ctx-menu is shown.

const hudMobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

/** Records observers so a test can flush them like the browser's microtask would. */
class FakeMutationObserver {
  static readonly live: FakeMutationObserver[] = [];
  target: unknown = null;
  options: unknown = null;

  constructor(private readonly callback: () => void) {
    FakeMutationObserver.live.push(this);
  }

  observe(target: unknown, options: unknown): void {
    this.target = target;
    this.options = options;
  }

  fire(): void {
    this.callback();
  }
}

function makeHarness() {
  FakeMutationObserver.live.length = 0;
  const document = new FakeDocument();
  const window = Object.assign(new FakeWindow(844, 390), {
    MutationObserver: FakeMutationObserver,
  });
  document.element('chatlog-wrap');
  document.element('chatlog-tabs');
  document.element('chatlog-frame');
  document.element('chat-input', 'input');
  const menu = document.element('ctx-menu');
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const controller = new ChatGeometryController({
    document: document as unknown as Document,
    window: window as unknown as Window,
    storage,
    isMobileLayout: () => true,
    hasStorePromoCard: () => false,
    uiScale: () => 0.85,
    isInterfaceUnlocked: () => false,
    snapToGrid: () => false,
  });
  controller.init();
  const handle = document.body.querySelector<HTMLElement>('.chat-mobile-resize');
  return { menu, handle };
}

describe('chat resize handle yields to an open context menu (touch)', () => {
  it('reads the inline display every ctx-menu open/close path writes', () => {
    const menu = new FakeDocument().createElement('div');
    expect(isContextMenuShown(menu)).toBe(false);
    menu.style.display = 'block';
    expect(isContextMenuShown(menu)).toBe(true);
    menu.style.display = 'none';
    expect(isContextMenuShown(menu)).toBe(false);
  });

  it('sync toggles the yield class on the handle and writes only on a change', () => {
    const menu = new FakeDocument().createElement('div');
    let toggles = 0;
    const handle = new FakeDocument().createElement('div');
    const toggle = handle.classList.toggle.bind(handle.classList);
    handle.classList.toggle = (token: string, force?: boolean) => {
      toggles++;
      return toggle(token, force);
    };
    menu.style.display = 'block';
    syncResizeHandleYield(menu, handle);
    syncResizeHandleYield(menu, handle);
    expect(handle.classList.contains(CHAT_RESIZE_YIELD_CLASS)).toBe(true);
    expect(toggles).toBe(1);
    menu.style.display = 'none';
    syncResizeHandleYield(menu, handle);
    expect(handle.classList.contains(CHAT_RESIZE_YIELD_CLASS)).toBe(false);
    expect(toggles).toBe(2);
  });

  it('the geometry controller wires its body-level handle to #ctx-menu style changes', () => {
    const { menu, handle } = makeHarness();
    expect(handle).not.toBeNull();
    const observer = FakeMutationObserver.live[0];
    expect(observer?.target).toBe(menu);
    expect(observer?.options).toEqual({ attributes: true, attributeFilter: ['style'] });
    expect(handle?.classList.contains(CHAT_RESIZE_YIELD_CLASS)).toBe(false);

    // The "+" menu opens (openChannelMenu writes display:block): the handle steps aside.
    menu.style.display = 'block';
    observer?.fire();
    expect(handle?.classList.contains(CHAT_RESIZE_YIELD_CLASS)).toBe(true);

    // Cancel / outside tap (closeContextMenu writes display:none): the handle returns.
    menu.style.display = 'none';
    observer?.fire();
    expect(handle?.classList.contains(CHAT_RESIZE_YIELD_CLASS)).toBe(false);
  });

  it('the touch sheet hides the yielding handle, so it neither covers nor eats the Cancel tap', () => {
    const selector = `body.mobile-touch.mobile-chat-open .chat-mobile-resize.${CHAT_RESIZE_YIELD_CLASS}`;
    const at = hudMobileCss.indexOf(`${selector} {`);
    expect(at, 'yield rule present in hud.mobile.css').toBeGreaterThan(-1);
    const body = hudMobileCss.slice(at, hudMobileCss.indexOf('}', at));
    expect(body).toMatch(/display:\s*none/);
    // It must come AFTER the rule that shows the handle (same layer; it also out-specifies it).
    const show = hudMobileCss.indexOf('body.mobile-touch.mobile-chat-open .chat-mobile-resize {');
    expect(show).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(show);
  });
});
