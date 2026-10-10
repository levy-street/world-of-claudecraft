// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTooltip } from '../src/ui/tooltip_binding';
import { SharedTooltipOwner } from '../src/ui/tooltip_owner';
import { TOOLTIP_PEEK_MS, TouchPeekGuard } from '../src/ui/touch_peek';

function rig(initialHoverAllowed = true) {
  const el = document.createElement('button');
  const tooltipEl = document.createElement('div');
  document.body.append(el, tooltipEl);
  tooltipEl.style.display = 'none';
  const rect = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 40,
    y: 60,
    left: 40,
    top: 60,
    right: 80,
    bottom: 100,
    width: 40,
    height: 40,
    toJSON: () => ({}),
  });
  const html = vi.fn(() => 'spell details');
  const paint = vi.fn((content: string, _x: number, _y: number) => {
    tooltipEl.innerHTML = content;
    tooltipEl.style.display = 'block';
    return { w: 120, h: 80 };
  });
  const viewport = vi.fn(() => ({ w: 800, h: 600, scale: 1 }));
  const owner = new SharedTooltipOwner<HTMLElement>();
  const peekGuard = new TouchPeekGuard();
  let allowed = initialHoverAllowed;
  const deps = {
    peekGuard,
    tooltipOwner: owner,
    tooltipEl,
    paintTooltipAt: paint,
    tooltipViewport: viewport,
    hoverAllowed: () => allowed,
  };
  bindTooltip(el, html, deps);
  return {
    el,
    tooltipEl,
    rect,
    html,
    paint,
    viewport,
    owner,
    peekGuard,
    deps,
    allowHover: (value: boolean) => {
      allowed = value;
    },
  };
}

function mouse(el: HTMLElement, type: string, x = 200, y = 300) {
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
}

function pointer(el: HTMLElement, type: string, pointerType = 'touch') {
  el.dispatchEvent(new PointerEvent(type, { pointerType, clientX: 200, clientY: 300 }));
}

beforeEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('tooltip input binding', () => {
  it('shows enabled hover and repositions without evaluating content or reading layout again', () => {
    const r = rig();
    mouse(r.el, 'mouseenter');
    expect(r.paint).toHaveBeenCalledWith('spell details', 80, 80);
    expect(r.owner.current()).toBe(r.el);
    mouse(r.el, 'mousemove');
    expect(r.tooltipEl.style.left).toBe('214px');
    expect(r.tooltipEl.style.top).toBe('210px');
    expect(r.html).toHaveBeenCalledTimes(1);
    expect(r.rect).toHaveBeenCalledTimes(1);
    expect(r.paint).toHaveBeenCalledTimes(1);
    expect(r.peekGuard.consume()).toBe(false);
  });

  it('suppresses both disabled hover events before content, layout, or placement work', () => {
    const r = rig(false);
    mouse(r.el, 'mouseenter');
    mouse(r.el, 'mousemove');
    expect(r.html).not.toHaveBeenCalled();
    expect(r.rect).not.toHaveBeenCalled();
    expect(r.paint).not.toHaveBeenCalled();
    expect(r.viewport).not.toHaveBeenCalled();
    expect(r.owner.current()).toBeNull();
    expect(r.tooltipEl.style.display).toBe('none');
    expect(r.tooltipEl.style.left).toBe('');
  });

  it('reads the preference live for an already-bound control', () => {
    const r = rig(false);
    r.allowHover(true);
    mouse(r.el, 'mousemove');
    expect(r.paint).toHaveBeenCalledTimes(1);
    r.allowHover(false);
    mouse(r.el, 'mouseenter');
    mouse(r.el, 'mousemove', 400, 400);
    expect(r.paint).toHaveBeenCalledTimes(1);
    expect(r.rect).not.toHaveBeenCalled();
    expect(r.viewport).not.toHaveBeenCalled();
    r.owner.release();
    r.allowHover(true);
    mouse(r.el, 'mousemove');
    expect(r.paint).toHaveBeenCalledTimes(2);
  });

  it('keeps keyboard focus inspection when hover is disabled, without pointer-click focus tooltips', () => {
    const r = rig(false);
    pointer(r.el, 'pointerdown', 'mouse');
    r.el.dispatchEvent(new FocusEvent('focusin'));
    expect(r.paint).not.toHaveBeenCalled();
    pointer(r.el, 'pointerup', 'mouse');
    r.el.dispatchEvent(new FocusEvent('focusin'));
    expect(r.paint).toHaveBeenCalledWith('spell details', 80, 80);
    expect(r.peekGuard.consume()).toBe(false);
    r.el.dispatchEvent(new FocusEvent('focusout'));
    expect(r.tooltipEl.style.display).toBe('none');
    expect(r.owner.current()).toBeNull();
  });

  it('does not let a desktop press without focus suppress subsequent keyboard inspection', () => {
    const r = rig(false);
    pointer(r.el, 'pointerdown', 'mouse');
    pointer(r.el, 'pointerup', 'mouse');
    r.el.dispatchEvent(new FocusEvent('focusin'));
    expect(r.paint).toHaveBeenCalledTimes(1);
  });

  it('honors the one-shot focus suppression used while restoring a rebuilt control', () => {
    const r = rig(false);
    r.el.dataset.suppressFocusTooltip = 'true';
    r.el.dispatchEvent(new FocusEvent('focusin'));
    expect(r.paint).not.toHaveBeenCalled();
    expect(r.el.dataset.suppressFocusTooltip).toBeUndefined();
    r.el.dispatchEvent(new FocusEvent('focusin'));
    expect(r.paint).toHaveBeenCalledTimes(1);
  });

  it('re-resolves foreign or released shared content on movement after a drag', () => {
    const r = rig();
    const other = document.createElement('button');
    const otherHtml = vi.fn(() => 'other spell');
    bindTooltip(other, otherHtml, r.deps);
    mouse(other, 'mousemove');
    expect(r.tooltipEl.innerHTML).toBe('other spell');
    mouse(r.el, 'mousemove');
    expect(r.tooltipEl.innerHTML).toBe('spell details');
    expect(r.owner.current()).toBe(r.el);
    r.html.mockReturnValue('rebound spell');
    r.tooltipEl.style.display = 'none';
    r.owner.release();
    mouse(r.el, 'mousemove');
    expect(r.tooltipEl.innerHTML).toBe('rebound spell');
    expect(r.tooltipEl.style.display).toBe('block');
    mouse(r.el, 'mouseleave');
    expect(r.owner.current()).toBeNull();
    expect(r.tooltipEl.style.display).toBe('none');
  });

  it('preserves touch long-press inspection and its release-click guard with hover disabled', () => {
    vi.useFakeTimers();
    document.body.classList.add('mobile-touch');
    const r = rig(false);
    pointer(r.el, 'pointerdown');
    r.el.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(TOOLTIP_PEEK_MS - 1);
    expect(r.paint).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(r.paint).toHaveBeenCalledWith('spell details', 200, 300);
    pointer(r.el, 'pointerup');
    expect(r.peekGuard.consume()).toBe(true);
    expect(r.peekGuard.consume()).toBe(false);
  });

  it.each(['pointerup', 'pointercancel', 'mouseleave', 'focusout'])(
    'cancels pending touch inspection on %s',
    (eventType) => {
      vi.useFakeTimers();
      document.body.classList.add('mobile-touch');
      const r = rig(false);
      pointer(r.el, 'pointerdown');
      vi.advanceTimersByTime(100);
      r.el.dispatchEvent(new Event(eventType));
      vi.advanceTimersByTime(TOOLTIP_PEEK_MS);
      expect(r.paint).not.toHaveBeenCalled();
      expect(r.peekGuard.consume()).toBe(false);
    },
  );

  it('ignores mouse hover and mouse long-press on touch interfaces', () => {
    vi.useFakeTimers();
    document.body.classList.add('mobile-touch');
    const r = rig();
    mouse(r.el, 'mouseenter');
    mouse(r.el, 'mousemove');
    pointer(r.el, 'pointerdown', 'mouse');
    vi.advanceTimersByTime(TOOLTIP_PEEK_MS);
    expect(r.paint).not.toHaveBeenCalled();
    expect(r.rect).not.toHaveBeenCalled();
  });
});
