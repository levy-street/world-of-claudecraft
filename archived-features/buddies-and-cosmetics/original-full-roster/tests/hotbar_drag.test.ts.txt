// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BUDDY_DRAG_ATTR, endBuddyDrag, startBuddyDrag } from '../src/ui/hud/action_bar/buddy_drag';
import {
  HOTBAR_ACTION_MIME,
  HOTBAR_ATTACK_MIME,
  parseHotbarAction,
  placeBuddyOnSlot,
} from '../src/ui/hud/action_bar/hotbar';
import {
  acceptAttackDrag,
  readDraggedAction,
  writeDraggedAction,
} from '../src/ui/hud/action_bar/hotbar_drag';
import { sanitizeActionBarLayout } from '../src/world_api/action_bar';

/** A DataTransfer stand-in: jsdom ships no constructor for the real one. */
function fakeTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()];
    },
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
  } as unknown as DataTransfer;
}

const exists = {
  ability: (id: string) => id === 'heroic_strike',
  item: (id: string) => id === 'reins_valorsteed',
  buddy: (id: string) => id === 'stag',
};

describe('hotbar drag payload (src/ui/hud/action_bar/hotbar_drag.ts)', () => {
  it('round-trips each action kind through the DataTransfer', () => {
    for (const action of [
      { type: 'ability' as const, id: 'heroic_strike' },
      { type: 'item' as const, id: 'reins_valorsteed' },
      { type: 'buddy' as const, id: 'stag' },
    ]) {
      const dt = fakeTransfer();
      writeDraggedAction(dt, action);
      expect(dt.getData('text/plain')).toBe(action.id);
      expect(readDraggedAction(dt, exists)).toEqual(action);
    }
  });

  it('refuses what the host cannot resolve, and a missing or broken payload', () => {
    const dt = fakeTransfer();
    writeDraggedAction(dt, { type: 'buddy', id: 'not_collected' });
    expect(readDraggedAction(dt, exists)).toBeNull();
    expect(readDraggedAction(null, exists)).toBeNull();
    expect(readDraggedAction(fakeTransfer(), exists)).toBeNull();
    const broken = fakeTransfer();
    broken.setData(HOTBAR_ACTION_MIME, '{nope');
    expect(readDraggedAction(broken, exists)).toBeNull();
  });

  it('parseHotbarAction keeps an unknown buddy by default (the stored-layout rule)', () => {
    expect(
      parseHotbarAction(
        { type: 'buddy', id: 'gone' },
        () => false,
        () => false,
      ),
    ).toEqual({
      type: 'buddy',
      id: 'gone',
    });
    expect(
      parseHotbarAction(
        { type: 'buddy', id: 'gone' },
        () => false,
        () => false,
        () => false,
      ),
    ).toBeNull();
  });

  it('placeBuddyOnSlot writes the summon slot and ignores an out-of-range index', () => {
    const bar = placeBuddyOnSlot([null, null], 'stag', 1);
    expect(bar).toEqual([null, { type: 'buddy', id: 'stag' }]);
    expect(placeBuddyOnSlot(bar, 'stag', 5)).toEqual(bar);
  });

  it('the server-shared layout sanitizer accepts a buddy slot', () => {
    const clean = sanitizeActionBarLayout({
      v: 1,
      forms: {
        normal: {
          bar: [
            { type: 'buddy', id: 'stag' },
            { type: 'nope', id: 'x' },
          ],
        },
      },
    });
    expect(clean?.forms.normal?.bar).toEqual([{ type: 'buddy', id: 'stag' }, null]);
  });

  it('acceptAttackDrag handles only the Attack marker, on slot 0, and runs the drop effect once', () => {
    const btn = document.createElement('button');
    const onDrop = vi.fn();
    const plain = { dataTransfer: fakeTransfer(), preventDefault: vi.fn() } as unknown as DragEvent;
    expect(acceptAttackDrag(plain, btn, 0, 'over', onDrop)).toBe(false);
    const dt = fakeTransfer();
    dt.setData(HOTBAR_ATTACK_MIME, '1');
    const attack = { dataTransfer: dt, preventDefault: vi.fn() } as unknown as DragEvent;
    expect(acceptAttackDrag(attack, btn, 0, 'over', onDrop)).toBe(true);
    expect(btn.classList.contains('drop-target')).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
    expect(acceptAttackDrag(attack, btn, 0, 'drop', onDrop)).toBe(true);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('drop-target')).toBe(false);
  });

  it('a buddy drag writes the payload and arms the live channel; dragend clears it', () => {
    const host = { setDragAction: vi.fn(), clearActionDropTargets: vi.fn() };
    const dt = fakeTransfer();
    const ev = { dataTransfer: dt } as unknown as DragEvent;
    startBuddyDrag(ev, 'stag', host);
    expect(host.setDragAction).toHaveBeenCalledWith({ type: 'buddy', id: 'stag' });
    expect(readDraggedAction(dt, exists)).toEqual({ type: 'buddy', id: 'stag' });
    expect(dt.effectAllowed).toBe('copy');
    endBuddyDrag(host);
    expect(host.setDragAction).toHaveBeenLastCalledWith(null);
    expect(host.clearActionDropTargets).toHaveBeenCalledTimes(1);
    expect(BUDDY_DRAG_ATTR).toBe('data-buddy-drag');
  });
});
