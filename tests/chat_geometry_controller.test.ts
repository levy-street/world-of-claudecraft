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
  options: { mobile?: boolean; unlocked?: boolean; snap?: boolean; uiScale?: number } = {},
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
    uiScale: () => options.uiScale ?? 1,
    isInterfaceUnlocked: () => options.unlocked ?? false,
    snapToGrid: () => options.snap ?? false,
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
    // Mid-gesture the box is NOT persisted: storage still holds the seeded
    // spot, upgraded once at init by the legacy viewport-stamp migration.
    expect(harness.storage.getItem('woc_chat_geometry')).toBe(
      '{"left":100,"top":80,"width":370,"height":184,"vw":1280,"vh":720}',
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

// While the global "Unlock interface" toggle is on, the whole chat box is a
// drag handle (its panes are pointer-inert in CSS, so the wrap is the event
// target); while it is off, a wrap press does nothing and only the tab strip
// moves the box, the contract that shipped before the toggle existed.
describe('ChatGeometryController interface unlock', () => {
  it('drags the box from anywhere on the wrap while unlocked', () => {
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { unlocked: true },
    );
    harness.controller.init();

    harness.wrap.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 7, clientX: 120, clientY: 90 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 7, clientX: 300, clientY: 200 }),
    );
    expect(harness.wrap.style.left).toBe('280px');
    expect(harness.wrap.style.top).toBe('190px');

    harness.document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 7, clientX: 300, clientY: 200 }),
    );
    expect(JSON.parse(harness.storage.getItem('woc_chat_geometry') ?? '{}')).toMatchObject({
      left: 280,
      top: 190,
    });
  });

  it('keeps the wrap inert while locked (only the tab strip moves the box)', () => {
    const harness = makeHarness({
      woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}',
    });
    harness.controller.init();

    harness.wrap.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 7, clientX: 120, clientY: 90 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 7, clientX: 300, clientY: 200 }),
    );
    expect(harness.wrap.style.left).toBe('100px');
    expect(harness.wrap.style.top).toBe('80px');
  });

  it('arrow keys on the move button step the box and persist (Shift for the fine step)', () => {
    const harness = makeHarness({
      woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}',
    });
    harness.controller.init();
    const moveBtn = harness.wrap.querySelector('.chat-move-btn');
    expect(moveBtn, 'the arrange-mode keyboard move button exists').toBeTruthy();
    expect(moveBtn?.getAttribute('aria-keyshortcuts')).toBe(
      'ArrowUp ArrowDown ArrowLeft ArrowRight',
    );

    moveBtn?.dispatchEvent(keyEvent('ArrowRight'));
    expect(harness.wrap.style.left).toBe('110px');
    moveBtn?.dispatchEvent(keyEvent('ArrowDown', true));
    expect(harness.wrap.style.top).toBe('81px');
    expect(JSON.parse(harness.storage.getItem('woc_chat_geometry') ?? '{}')).toMatchObject({
      left: 110,
      top: 81,
    });
  });

  it('the resize grip is a real named button whose arrow keys size the box', () => {
    const harness = makeHarness({
      woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}',
    });
    harness.controller.init();
    const grip = harness.frame.querySelector('.chat-resize-grip');
    expect(grip?.tagName.toLowerCase()).toBe('button');
    expect(grip?.getAttribute('aria-hidden')).toBeNull();
    expect(grip?.getAttribute('aria-label')).toBeTruthy();

    grip?.dispatchEvent(keyEvent('ArrowRight'));
    expect(harness.wrap.style.width).toBe('380px');
    grip?.dispatchEvent(keyEvent('ArrowUp', true));
    expect(harness.frame.style.height).toBe('183px');
    expect(JSON.parse(harness.storage.getItem('woc_chat_geometry') ?? '{}')).toMatchObject({
      width: 380,
      height: 183,
    });
  });

  it('relocalize rewrites the chrome written once at init (the name chip is not stranded)', () => {
    const harness = makeHarness();
    harness.controller.init();
    const chip = harness.wrap.querySelector('.tf-frame-label');
    expect(chip?.textContent).toBeTruthy();
    const before = chip?.textContent;
    if (chip) chip.textContent = 'stale-locale-text';

    harness.controller.relocalize();
    expect(chip?.textContent).toBe(before);
  });

  it('Snap to Grid quantizes a grip resize to the grid pitch', () => {
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { snap: true },
    );
    harness.controller.init();
    const grip = harness.frame.querySelector<HTMLElement>('.chat-resize-grip');
    grip?.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, clientX: 470, clientY: 286 }));
    // +33 of travel: raw 403 wide by 217 tall, which the grid rounds to
    // 400 x 224 before the placement clamp.
    harness.document.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 5, clientX: 503, clientY: 319 }),
    );
    harness.document.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 5, clientX: 503, clientY: 319 }),
    );
    expect(JSON.parse(harness.storage.getItem('woc_chat_geometry') ?? '{}')).toMatchObject({
      width: 400,
      height: 224,
    });
  });

  it('mints the edge-glow overlay and the grip hover lights its two edges', () => {
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { unlocked: true },
    );
    harness.controller.init();
    expect(harness.wrap.querySelector('.tf-edge-glow')).toBeTruthy();

    const grip = harness.frame.querySelector('.chat-resize-grip');
    grip?.dispatchEvent(new Event('pointerenter'));
    expect(harness.wrap.getAttribute('data-resize-edge')).toBe('se');
    grip?.dispatchEvent(new Event('pointerleave'));
    expect(harness.wrap.getAttribute('data-resize-edge')).toBeNull();
  });

  it('returning to the approach band after a grip visit repaints its highlight', () => {
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { unlocked: true },
    );
    harness.controller.init();
    const grip = harness.frame.querySelector<HTMLElement>('.chat-resize-grip');
    // East band, then the grip, then back: the leave handler must clear the
    // hover memo or the east band stays elided (review round four).
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 6, clientX: 468, clientY: 170 }),
    );
    expect(harness.wrap.getAttribute('data-resize-edge')).toBe('e');
    grip?.dispatchEvent(new Event('pointerenter'));
    expect(harness.wrap.getAttribute('data-resize-edge')).toBe('se');
    grip?.dispatchEvent(new Event('pointerleave'));
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 6, clientX: 468, clientY: 170 }),
    );
    expect(harness.wrap.getAttribute('data-resize-edge')).toBe('e');
  });

  it('the grip hover stamps nothing while the interface is locked', () => {
    const harness = makeHarness({
      woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}',
    });
    harness.controller.init();
    harness.frame.querySelector('.chat-resize-grip')?.dispatchEvent(new Event('pointerenter'));
    expect(harness.wrap.getAttribute('data-resize-edge')).toBeNull();
  });

  it('the hit-test cache stays in VISUAL space at UI Scale 1.25 (review blocker)', () => {
    // apply() once cached the author-space css box (visual divided by the
    // #ui zoom) while edgeAt compares against visual clientX/Y, so at any
    // scale other than 1 the edge bands landed wrong. The cache must hold
    // placement.geo: the west band of the VISUAL box (left 100) answers,
    // and the author-space box's edges (left 80) do not.
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { unlocked: true, uiScale: 1.25 },
    );
    harness.controller.init();
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 4, clientX: 101, clientY: 170 }),
    );
    expect(harness.wrap.getAttribute('data-resize-edge')).toBe('w');
    expect(harness.wrap.style.cursor).toBe('var(--cursor-resize-ew, ew-resize)');
    // The author-space west band (around x=80) is NOT an edge of the box the
    // player sees; the visual body there reports no edge.
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 4, clientX: 81, clientY: 170 }),
    );
    expect(harness.wrap.getAttribute('data-resize-edge')).toBeNull();
  });

  it('a hover jump between opposite borders repaints the highlight (shared cursor)', () => {
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { unlocked: true },
    );
    harness.controller.init();
    // North band then south band: both are ns-resize, so a cursor-keyed
    // elision kept the north highlight painted on the south edge.
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 4, clientX: 285, clientY: 82 }),
    );
    expect(harness.wrap.getAttribute('data-resize-edge')).toBe('n');
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 4, clientX: 285, clientY: 284 }),
    );
    expect(harness.wrap.getAttribute('data-resize-edge')).toBe('s');
  });

  it('with Snap to Grid on the arrows walk grid lines (Shift stays the fine step)', () => {
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { snap: true },
    );
    harness.controller.init();
    const moveBtn = harness.wrap.querySelector<HTMLElement>('.chat-move-btn');
    moveBtn?.dispatchEvent(keyEvent('ArrowRight'));
    expect(harness.wrap.style.left).toBe('112px');
    moveBtn?.dispatchEvent(keyEvent('ArrowRight', true));
    expect(harness.wrap.style.left).toBe('113px');

    const grip = harness.frame.querySelector<HTMLElement>('.chat-resize-grip');
    grip?.dispatchEvent(keyEvent('ArrowRight'));
    expect(harness.wrap.style.width).toBe('384px');
    grip?.dispatchEvent(keyEvent('ArrowUp'));
    expect(harness.frame.style.height).toBe('176px');
  });

  it('hovering the unlocked wrap hit-tests a cached box, not a rect read per move', () => {
    const harness = makeHarness(
      { woc_chat_geometry: '{"left":100,"top":80,"width":370,"height":184}' },
      { unlocked: true },
    );
    harness.controller.init();
    let reads = 0;
    const original = harness.wrap.getBoundingClientRect.bind(harness.wrap);
    harness.wrap.getBoundingClientRect = () => {
      reads += 1;
      return original();
    };
    for (let i = 0; i < 20; i += 1) {
      harness.wrap.dispatchEvent(
        pointerEvent('pointermove', { pointerId: 3, clientX: 101 + i, clientY: 90 }),
      );
    }
    expect(reads).toBe(0);
    // The cached box still answers correctly: the west border reports an edge
    // cursor, the body clears it.
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 3, clientX: 101, clientY: 170 }),
    );
    expect(harness.wrap.style.cursor).not.toBe('');
    harness.wrap.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 3, clientX: 285, clientY: 170 }),
    );
    expect(harness.wrap.style.cursor).toBe('');
  });
});

function keyEvent(key: string, shiftKey = false): Event {
  const event = new Event('keydown', { cancelable: true });
  for (const [name, value] of Object.entries({ key, shiftKey })) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}
