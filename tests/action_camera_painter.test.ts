import { describe, expect, it, vi } from 'vitest';
import { createActionCameraCrosshair } from '../src/ui/action_camera_crosshair';

describe('ActionCameraCrosshair', () => {
  it('mounts a hidden crosshair, toggles it, and disposes cleanly', () => {
    const remove = vi.fn();
    const element = {
      id: '',
      hidden: false,
      style: { left: '', top: '' },
      setAttribute: vi.fn(),
      remove,
    };
    const appendChild = vi.fn();
    const doc = {
      createElement: vi.fn(() => element),
      body: { appendChild },
    } as unknown as Document;

    const crosshair = createActionCameraCrosshair(
      {
        getBoundingClientRect: () => ({ left: 100, top: 40, width: 500, height: 300 }) as DOMRect,
      },
      doc,
    );
    expect(element.id).toBe('action-camera-crosshair');
    expect(element.hidden).toBe(true);
    expect(element.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(appendChild).toHaveBeenCalledWith(element);

    crosshair.setVisible(true);
    expect(element.hidden).toBe(false);
    expect(element.style).toEqual({ left: '350px', top: '166px' });
    crosshair.setVisible(true);
    expect(element.hidden).toBe(false);
    crosshair.setVisible(false);
    expect(element.hidden).toBe(true);

    crosshair.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('hides instead of reusing a stale anchor while the canvas has no valid layout', () => {
    const element = {
      id: '',
      hidden: false,
      style: { left: '', top: '' },
      setAttribute: vi.fn(),
      remove: vi.fn(),
    };
    let rect = { left: 20, top: 10, width: 600, height: 400 } as DOMRect;
    const doc = {
      createElement: vi.fn(() => element),
      body: { appendChild: vi.fn() },
    } as unknown as Document;
    const crosshair = createActionCameraCrosshair(
      { getBoundingClientRect: () => rect },
      doc,
    );

    crosshair.setVisible(true);
    expect(element.hidden).toBe(false);
    expect(element.style).toEqual({ left: '320px', top: '178px' });

    rect = { left: 20, top: 10, width: 0, height: 0 } as DOMRect;
    crosshair.setVisible(true);
    expect(element.hidden).toBe(true);

    rect = { left: 40, top: 30, width: 800, height: 500 } as DOMRect;
    crosshair.setVisible(true);
    expect(element.hidden).toBe(false);
    expect(element.style).toEqual({ left: '440px', top: '240px' });
  });
});
