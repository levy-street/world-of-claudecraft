import { describe, expect, it } from 'vitest';
import { ChatGeometryController } from '../src/ui/hud/chat/chat_geometry_controller';
import { FakeDocument, FakeWindow, pointerEvent } from './helpers/fake_dom';

class MemoryStorage {
  readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function makeHarness(
  initialStorage: Record<string, string> = {},
  options: { mobile?: boolean } = {},
) {
  const document = new FakeDocument();
  const window = new FakeWindow(1280, 720);
  const wrap = document.element('chatlog-wrap');
  wrap.setRect({ left: 100, top: 80, width: 370, height: 206 });
  const tabs = document.element('chatlog-tabs');
  tabs.setRect({ left: 100, top: 80, width: 370, height: 22 });
  const frame = document.element('chatlog-frame');
  frame.setRect({ left: 100, top: 102, width: 370, height: 184 });
  const input = document.element('chat-input', 'input');
  const storage = new MemoryStorage(initialStorage);
  const controller = new ChatGeometryController({
    document: document as unknown as Document,
    window: window as unknown as Window,
    storage,
    isMobileLayout: () => options.mobile ?? false,
    hasStorePromoCard: () => false,
    uiScale: () => 1,
  });
  return { controller, document, window, wrap, tabs, frame, input, storage };
}

describe('ChatGeometryController', () => {
  it('restores persisted desktop geometry and clamps the mobile offset', () => {
    const harness = makeHarness({
      woc_chat_geometry: '{"left":120,"top":90,"width":420,"height":210}',
      woc_mobile_chat_bottom: '9999',
    });

    harness.controller.init();

    expect(harness.wrap.style.left).toBe('120px');
    expect(harness.wrap.style.top).toBe('90px');
    expect(harness.wrap.style.width).toBe('420px');
    expect(harness.frame.style.height).toBe('210px');
    expect(harness.input.style.left).toBe('120px');
    expect(harness.document.documentElement.style.getPropertyValue('--mobile-chat-bottom')).toBe(
      '400px',
    );
  });

  it('moves the box from pointer coordinates and persists only after the gesture ends', () => {
    const harness = makeHarness({
      woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}',
    });
    harness.controller.init();
    harness.tabs.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 7, clientX: 120, clientY: 90 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 7, clientX: 300, clientY: 200 }),
    );

    expect(harness.wrap.style.left).toBe('280px');
    expect(harness.wrap.style.top).toBe('190px');
    expect(harness.storage.getItem('woc_chat_geometry')).toBe(
      '{"left":100,"top":80,"width":370,"height":184}',
    );

    harness.document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 7, clientX: 300, clientY: 200 }),
    );
    expect(JSON.parse(harness.storage.getItem('woc_chat_geometry') ?? '{}')).toMatchObject({
      left: 280,
      top: 190,
      width: 370,
      height: 184,
    });
  });

  it('resizes the mobile panel from its body handle and persists only on gesture end', () => {
    const harness = makeHarness({}, { mobile: true });
    harness.controller.init();
    const handle = harness.document.body.querySelector<HTMLElement>('.chat-mobile-resize');
    expect(handle).not.toBeNull();

    handle?.dispatchEvent(pointerEvent('pointerdown', { pointerId: 11, clientX: 0, clientY: 300 }));
    handle?.dispatchEvent(pointerEvent('pointermove', { pointerId: 12, clientX: 0, clientY: 200 }));
    expect(harness.document.documentElement.style.getPropertyValue('--mobile-chat-bottom')).toBe(
      '',
    );

    handle?.dispatchEvent(pointerEvent('pointermove', { pointerId: 11, clientX: 0, clientY: 200 }));
    expect(harness.document.documentElement.style.getPropertyValue('--mobile-chat-bottom')).toBe(
      '152px',
    );
    expect(harness.storage.getItem('woc_mobile_chat_bottom')).toBeNull();
    expect(harness.document.body.classList.contains('chat-box-dragging')).toBe(true);

    handle?.dispatchEvent(pointerEvent('pointerup', { pointerId: 11, clientX: 0, clientY: 200 }));
    expect(harness.storage.getItem('woc_mobile_chat_bottom')).toBe('152px');
    expect(harness.document.body.classList.contains('chat-box-dragging')).toBe(false);
  });

  it('resets persisted geometry and every inline placement owned by chat', () => {
    const harness = makeHarness({
      woc_chat_geometry: '{"left":120,"top":90,"width":420,"height":210}',
    });
    harness.controller.init();
    harness.controller.reset();

    expect(harness.storage.getItem('woc_chat_geometry')).toBeNull();
    for (const element of [harness.wrap, harness.frame, harness.input]) {
      expect(element.style.left).toBe('');
      expect(element.style.top).toBe('');
      expect(element.style.right).toBe('');
      expect(element.style.bottom).toBe('');
      expect(element.style.width).toBe('');
      expect(element.style.height).toBe('');
    }
  });
});
