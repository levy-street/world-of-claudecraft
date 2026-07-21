import { describe, expect, it } from 'vitest';
import { installWindowDrag, isWindowDragPreviewMutation } from '../src/ui/window_drag';
import { draggedWindowPosition } from '../src/ui/window_drag_core';
import { stackedWindowsVisible } from '../src/ui/window_stack_state_core';

describe('draggedWindowPosition', () => {
  it('converts visual pointer coordinates into clamped author coordinates', () => {
    expect(
      draggedWindowPosition(
        {
          pointerX: 1_700,
          pointerY: 1_100,
          grabOffsetX: 40,
          grabOffsetY: 30,
        },
        {
          scale: 2,
          viewportWidth: 960,
          viewportHeight: 600,
          windowWidth: 400,
          windowHeight: 300,
          margin: 8,
        },
      ),
    ).toEqual({ left: 552, top: 292 });
  });

  it('converts scaled visual coordinates before an edge clamp is needed', () => {
    expect(
      draggedWindowPosition(
        {
          pointerX: 500,
          pointerY: 300,
          grabOffsetX: 40,
          grabOffsetY: 20,
        },
        {
          scale: 2,
          viewportWidth: 960,
          viewportHeight: 600,
          windowWidth: 400,
          windowHeight: 300,
          margin: 8,
        },
      ),
    ).toEqual({ left: 230, top: 140 });
  });

  it('keeps the window inside every viewport edge', () => {
    const bounds = {
      scale: 1,
      viewportWidth: 1_280,
      viewportHeight: 800,
      windowWidth: 400,
      windowHeight: 300,
      margin: 8,
    };
    expect(
      draggedWindowPosition(
        { pointerX: -100, pointerY: -100, grabOffsetX: 20, grabOffsetY: 20 },
        bounds,
      ),
    ).toEqual({ left: 8, top: 8 });
    expect(
      draggedWindowPosition(
        { pointerX: 5_000, pointerY: 5_000, grabOffsetX: 20, grabOffsetY: 20 },
        bounds,
      ),
    ).toEqual({ left: 872, top: 492 });
  });
});

// Fake DOM harness covering the event-driven drag contract without adding jsdom.
describe('installWindowDrag', () => {
  const setup = (options?: { elId?: string; isDragHandle?: () => boolean }) => {
    const windowClasses = new Set(['window', 'panel']);
    const bodyClasses = new Set<string>();
    let rectReads = 0;
    let currentRect = { left: 100, top: 80, width: 400, height: 300 } as DOMRect;
    let transform = '';
    let transformWrites = 0;
    const style = {
      left: '',
      top: '',
      right: '',
      bottom: '',
      get transform() {
        return transform;
      },
      set transform(value: string) {
        transform = value;
        transformWrites++;
      },
    } as unknown as CSSStyleDeclaration;
    const el = {
      id: options?.elId ?? 'claudium-window',
      dataset: {} as Record<string, string>,
      style,
      classList: {
        add: (name: string) => windowClasses.add(name),
        remove: (name: string) => windowClasses.delete(name),
        contains: (name: string) => windowClasses.has(name),
      },
      getBoundingClientRect: () => {
        rectReads++;
        return currentRect;
      },
    } as unknown as HTMLElement;
    const captures: number[] = [];
    const handle = {
      closest: (selector: string) => (selector === '.window.panel' ? el : null),
      setPointerCapture: (pointerId: number) => captures.push(pointerId),
    } as unknown as HTMLElement;
    const listeners = new Map<string, ((event: PointerEvent) => void)[]>();
    const documentStub = {
      body: {
        classList: {
          add: (name: string) => bodyClasses.add(name),
          remove: (name: string) => bodyClasses.delete(name),
        },
      },
      addEventListener: (type: string, listener: (event: PointerEvent) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: (type: string, listener: (event: PointerEvent) => void) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener),
        );
      },
    } as unknown as Document;
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    let frameRequests = 0;
    const windowStub = {
      innerWidth: 1_280,
      innerHeight: 800,
    } as unknown as Window & typeof globalThis;
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = documentStub;
    globalThis.window = windowStub;

    const commits: Array<{ left: number; top: number; width: number; height: number }> = [];
    let raised = 0;
    let tooltipHides = 0;
    const controller = installWindowDrag({
      getScale: () => 1,
      isDragHandle: options?.isDragHandle ?? (() => true),
      bringToFront: () => raised++,
      hideTooltip: () => tooltipHides++,
      pinWindow: (target) => {
        target.style.left = '100px';
        target.style.top = '80px';
        target.style.transform = 'none';
      },
      commitWindow: (_target, left, top, finalRect) =>
        commits.push({ left, top, width: finalRect.width, height: finalRect.height }),
      requestFrame: (callback) => {
        frameRequests++;
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => frames.delete(id),
    });

    const fire = (type: string, event: Record<string, unknown>) => {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener({
          button: 0,
          buttons: 1,
          pointerId: 7,
          pointerType: 'mouse',
          target: handle,
          preventDefault: () => {},
          clientX: 120,
          clientY: 100,
          ...event,
        } as unknown as PointerEvent);
      }
    };
    const flushFrame = () => {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(0);
    };
    const restore = () => {
      controller.destroy();
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    };

    return {
      bodyClasses,
      captures,
      commits,
      controller,
      el,
      fire,
      frameRequests: () => frameRequests,
      flushFrame,
      rectReads: () => rectReads,
      raised: () => raised,
      restore,
      setRect: (next: DOMRect) => {
        currentRect = next;
      },
      tooltipHides: () => tooltipHides,
      transformWrites: () => transformWrites,
    };
  };

  it('batches live movement into compositor transforms without per-move layout reads', () => {
    const harness = setup();
    try {
      harness.fire('pointerdown', {});
      expect(harness.rectReads()).toBe(2);
      expect(harness.raised()).toBe(1);
      expect(harness.tooltipHides()).toBe(1);
      expect(harness.captures).toEqual([7]);
      expect(harness.el.classList.contains('window-dragging')).toBe(true);
      expect(harness.bodyClasses.has('window-drag-active')).toBe(true);

      harness.fire('pointermove', { clientX: 220, clientY: 180 });
      harness.fire('pointermove', { clientX: 230, clientY: 190 });
      expect(harness.rectReads()).toBe(2);
      expect(harness.frameRequests()).toBe(1);
      expect(harness.el.style.left).toBe('100px');
      expect(harness.el.style.top).toBe('80px');
      expect(harness.el.style.transform).toBe('none');
      const writesBeforeFrame = harness.transformWrites();

      harness.flushFrame();
      expect(harness.el.style.transform).toBe('translate3d(110px, 90px, 0)');
      expect(harness.transformWrites()).toBe(writesBeforeFrame + 1);
      expect(harness.rectReads()).toBe(2);
      expect(harness.commits).toEqual([]);

      harness.fire('pointerup', { clientX: 230, clientY: 190, buttons: 0 });
      expect(harness.rectReads()).toBe(3);
      expect(harness.commits).toEqual([{ left: 210, top: 170, width: 400, height: 300 }]);
      expect(harness.el.style.transform).toBe('none');
      expect(harness.el.classList.contains('window-dragging')).toBe(false);
      expect(harness.bodyClasses.has('window-drag-active')).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it('commits the latest pointer position even before its frame callback runs', () => {
    const harness = setup();
    try {
      harness.fire('pointerdown', {});
      harness.fire('pointermove', { clientX: 300, clientY: 240 });
      harness.setRect({ left: 280, top: 220, width: 420, height: 360 } as DOMRect);
      harness.fire('pointerup', { clientX: 300, clientY: 240, buttons: 0 });
      expect(harness.commits).toEqual([{ left: 280, top: 220, width: 420, height: 360 }]);
      harness.flushFrame();
      expect(harness.el.style.transform).toBe('none');
    } finally {
      harness.restore();
    }
  });

  it('schedules and paints a fresh frame after the previous frame was rendered', () => {
    const harness = setup();
    try {
      harness.fire('pointerdown', {});
      harness.fire('pointermove', { clientX: 220, clientY: 180 });
      harness.flushFrame();
      expect(harness.frameRequests()).toBe(1);
      expect(harness.el.style.transform).toBe('translate3d(100px, 80px, 0)');

      harness.fire('pointermove', { clientX: 240, clientY: 200 });
      expect(harness.frameRequests()).toBe(2);
      harness.flushFrame();
      expect(harness.el.style.transform).toBe('translate3d(120px, 100px, 0)');
    } finally {
      harness.restore();
    }
  });

  it('cleans up and commits an active drag on cancellation', () => {
    const harness = setup();
    try {
      harness.fire('pointerdown', {});
      harness.fire('pointermove', { clientX: 260, clientY: 210 });
      harness.flushFrame();
      harness.controller.cancel({} as HTMLElement);
      expect(harness.bodyClasses.has('window-drag-active')).toBe(true);
      harness.controller.cancel(harness.el);
      expect(harness.commits).toEqual([{ left: 240, top: 190, width: 400, height: 300 }]);
      expect(harness.el.style.transform).toBe('none');
      expect(harness.el.classList.contains('window-dragging')).toBe(false);
      expect(harness.bodyClasses.has('window-drag-active')).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it('handles native pointer cancellation through the registered listener', () => {
    const harness = setup();
    try {
      harness.fire('pointerdown', {});
      harness.fire('pointermove', { clientX: 260, clientY: 210 });
      harness.flushFrame();
      harness.fire('pointercancel', { buttons: 0 });
      expect(harness.commits).toEqual([{ left: 240, top: 190, width: 400, height: 300 }]);
      expect(harness.el.style.transform).toBe('none');
      expect(harness.el.classList.contains('window-dragging')).toBe(false);
      expect(harness.bodyClasses.has('window-drag-active')).toBe(false);
    } finally {
      harness.restore();
    }
  });

  it('raises ordinary window clicks but only starts a left-button handle drag', () => {
    const nonHandle = setup({ isDragHandle: () => false });
    try {
      nonHandle.fire('pointerdown', {});
      expect(nonHandle.raised()).toBe(1);
      expect(nonHandle.rectReads()).toBe(0);
      expect(nonHandle.bodyClasses.has('window-drag-active')).toBe(false);
    } finally {
      nonHandle.restore();
    }

    const rightClick = setup();
    try {
      rightClick.fire('pointerdown', { button: 2 });
      expect(rightClick.raised()).toBe(1);
      expect(rightClick.rectReads()).toBe(0);
    } finally {
      rightClick.restore();
    }

    const confirm = setup({ elId: 'confirm-dialog' });
    try {
      confirm.fire('pointerdown', {});
      expect(confirm.raised()).toBe(0);
      expect(confirm.rectReads()).toBe(0);
    } finally {
      confirm.restore();
    }
  });
});

describe('stacked window compositor state', () => {
  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, true],
  ])('uses effects only when both windows are visible', (firstVisible, secondVisible, expected) => {
    expect(stackedWindowsVisible(firstVisible, secondVisible)).toBe(expected);
  });

  it('recognizes only live drag preview style mutations', () => {
    const classes = new Set(['window-dragging']);
    const el = {
      classList: { contains: (name: string) => classes.has(name) },
    } as unknown as HTMLElement;
    expect(isWindowDragPreviewMutation('style', el)).toBe(true);
    expect(isWindowDragPreviewMutation('class', el)).toBe(false);
    classes.clear();
    expect(isWindowDragPreviewMutation('style', el)).toBe(false);
  });
});
