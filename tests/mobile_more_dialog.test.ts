import { describe, expect, it, vi } from 'vitest';
import type { FocusManager, FocusTrapHandle, FocusTrapOptions } from '../src/ui/focus_manager';
import { MobileMoreDialogController } from '../src/ui/mobile_more_dialog';

function element(): HTMLElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  } as unknown as HTMLElement;
}

describe('MobileMoreDialogController', () => {
  it('opens one shared focus trap, updates ARIA, then restores focus on close', () => {
    const trigger = element();
    const dialog = element();
    const focusFirst = vi.fn();
    const release = vi.fn();
    const handle = { focusFirst, release } satisfies FocusTrapHandle;
    const open = vi.fn((_options: FocusTrapOptions) => handle);
    const controller = new MobileMoreDialogController({ open } as Pick<FocusManager, 'open'>, {
      trigger: () => trigger,
      dialog: () => dialog,
    });

    controller.sync(true);
    controller.sync(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.getAttribute('aria-hidden')).toBe('false');
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({
      root: expect.any(Function),
      returnFocusTo: trigger,
    });
    expect(open.mock.calls[0][0].root()).toBe(dialog);
    expect(focusFirst).toHaveBeenCalledWith('#mobile-more-close');

    controller.sync(false);
    controller.sync(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(dialog.getAttribute('aria-hidden')).toBe('true');
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(true);
  });

  it('releases without restoring focus during a More-to-window handoff', () => {
    const trigger = element();
    const dialog = element();
    const release = vi.fn();
    const handle = { focusFirst: vi.fn(), release } satisfies FocusTrapHandle;
    const controller = new MobileMoreDialogController(
      { open: vi.fn((_options: FocusTrapOptions) => handle) },
      { trigger: () => trigger, dialog: () => dialog },
    );

    controller.sync(true);
    controller.sync(false, false);

    expect(release).toHaveBeenCalledWith(false);
  });
});
