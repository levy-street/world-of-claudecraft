import { describe, expect, it, vi } from 'vitest';
import { createActionCameraPainter } from '../src/ui/action_camera_painter';

describe('ActionCameraPainter', () => {
  it('mounts a hidden crosshair, toggles it, and disposes cleanly', () => {
    const remove = vi.fn();
    const element = {
      id: '',
      hidden: false,
      setAttribute: vi.fn(),
      remove,
    };
    const appendChild = vi.fn();
    const doc = {
      createElement: vi.fn(() => element),
      body: { appendChild },
    } as unknown as Document;

    const painter = createActionCameraPainter(doc);
    expect(element.id).toBe('action-camera-crosshair');
    expect(element.hidden).toBe(true);
    expect(element.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(appendChild).toHaveBeenCalledWith(element);

    painter.setVisible(true);
    expect(element.hidden).toBe(false);
    painter.setVisible(false);
    expect(element.hidden).toBe(true);

    painter.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
