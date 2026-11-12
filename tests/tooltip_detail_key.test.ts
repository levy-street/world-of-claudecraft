import { describe, expect, it, vi } from 'vitest';
import { detailHeldAfter, TooltipDetailKey } from '../src/ui/tooltip_detail_key';

describe('detailHeldAfter', () => {
  it('Shift down holds, Shift up releases', () => {
    expect(detailHeldAfter(false, { type: 'keydown', key: 'Shift' })).toBe(true);
    expect(detailHeldAfter(true, { type: 'keyup', key: 'Shift' })).toBe(false);
  });

  it('ignores every other key in both states', () => {
    expect(detailHeldAfter(false, { type: 'keydown', key: 'a' })).toBe(false);
    expect(detailHeldAfter(true, { type: 'keyup', key: 'Control' })).toBe(true);
  });

  it('a window blur always releases (the keyup may never arrive)', () => {
    expect(detailHeldAfter(true, { type: 'blur' })).toBe(false);
  });
});

describe('TooltipDetailKey', () => {
  function fakeTarget() {
    const handlers = new Map<string, (e: Event) => void>();
    return {
      addEventListener: (type: string, fn: (e: Event) => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type),
      fire: (type: string, key?: string) => handlers.get(type)?.({ type, key } as unknown as Event),
      handlers,
    };
  }

  it('notifies only when the held state flips, not on key auto-repeat', () => {
    const target = fakeTarget();
    const key = new TooltipDetailKey();
    const onChange = vi.fn();
    key.install(target as never, onChange);
    target.fire('keydown', 'Shift');
    target.fire('keydown', 'Shift');
    target.fire('keydown', 'Shift');
    expect(key.isHeld()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    target.fire('keyup', 'Shift');
    expect(key.isHeld()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('uninstall removes every listener it added', () => {
    const target = fakeTarget();
    const uninstall = new TooltipDetailKey().install(target as never, () => {});
    expect(target.handlers.size).toBe(3);
    uninstall();
    expect(target.handlers.size).toBe(0);
  });
});
