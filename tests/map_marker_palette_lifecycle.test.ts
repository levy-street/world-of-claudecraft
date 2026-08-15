import { describe, expect, it, vi } from 'vitest';
import { installMapMarkerPaletteLifecycle } from '../src/ui/map_marker_palette_lifecycle';

class FakeMediaQuery {
  readonly addEventListener = vi.fn(
    (_type: 'change', listener: (event: Pick<MediaQueryListEvent, 'matches'>) => void) => {
      this.listener = listener;
    },
  );
  readonly removeEventListener = vi.fn(
    (_type: 'change', listener: (event: Pick<MediaQueryListEvent, 'matches'>) => void) => {
      if (this.listener === listener) this.listener = null;
    },
  );
  private listener: ((event: Pick<MediaQueryListEvent, 'matches'>) => void) | null = null;

  emit(matches: boolean): void {
    this.listener?.({ matches });
  }
}

class FakeFrameHost {
  readonly query = new FakeMediaQuery();
  readonly matchMedia = vi.fn(() => this.query);
  readonly requestAnimationFrame = vi.fn((callback: () => void) => {
    this.frame = callback;
    return 7;
  });
  readonly cancelAnimationFrame = vi.fn((handle: number) => {
    if (handle === 7) this.frame = null;
  });
  private frame: (() => void) | null = null;

  flushFrame(): void {
    const callback = this.frame;
    this.frame = null;
    callback?.();
  }
}

describe('map marker palette lifecycle', () => {
  it('coalesces theme and forced-colors signals to one frame-bounded refresh', () => {
    const host = new FakeFrameHost();
    const refresh = vi.fn();

    const lifecycle = installMapMarkerPaletteLifecycle(host, refresh);

    expect(host.matchMedia).toHaveBeenCalledTimes(1);
    expect(host.matchMedia).toHaveBeenCalledWith('(forced-colors: active)');
    expect(host.query.addEventListener).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();

    lifecycle.notify();
    lifecycle.notify();
    host.query.emit(true);
    expect(host.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    host.flushFrame();
    expect(refresh).toHaveBeenCalledTimes(1);

    host.query.emit(false);
    host.flushFrame();
    expect(refresh).toHaveBeenCalledTimes(2);

    lifecycle.dispose();
    expect(host.query.removeEventListener).toHaveBeenCalledTimes(1);
    host.query.emit(true);
    host.flushFrame();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('replaces an earlier listener and cancels its pending refresh on reinstall', () => {
    const host = new FakeFrameHost();
    const firstRefresh = vi.fn();
    const secondRefresh = vi.fn();
    const first = installMapMarkerPaletteLifecycle(host, firstRefresh);
    first.notify();

    const second = installMapMarkerPaletteLifecycle(host, secondRefresh);

    expect(host.query.removeEventListener).toHaveBeenCalledTimes(1);
    expect(host.cancelAnimationFrame).toHaveBeenCalledWith(7);
    host.flushFrame();
    expect(firstRefresh).not.toHaveBeenCalled();

    second.notify();
    host.flushFrame();
    expect(secondRefresh).toHaveBeenCalledTimes(1);
    second.dispose();
  });

  it('falls back safely when browser lifecycle APIs are unavailable', () => {
    const refresh = vi.fn();
    const lifecycle = installMapMarkerPaletteLifecycle({}, refresh);

    expect(refresh).not.toHaveBeenCalled();
    lifecycle.notify();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(() => lifecycle.dispose()).not.toThrow();
  });
});
