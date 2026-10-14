// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  HOTBAR_ACTION_MIME,
  HOTBAR_ATTACK_MIME,
  parseHotbarAction,
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
};

describe('hotbar drag payload (src/ui/hud/action_bar/hotbar_drag.ts)', () => {
  it('round-trips each action kind through the DataTransfer', () => {
    for (const action of [
      { type: 'ability' as const, id: 'heroic_strike' },
      { type: 'item' as const, id: 'reins_valorsteed' },
    ]) {
      const dt = fakeTransfer();
      writeDraggedAction(dt, action);
      expect(dt.getData('text/plain')).toBe(action.id);
      expect(readDraggedAction(dt, exists)).toEqual(action);
    }
  });

  it('refuses what the host cannot resolve, and a missing or broken payload', () => {
    const dt = fakeTransfer();
    writeDraggedAction(dt, { type: 'ability', id: 'not_learned' });
    expect(readDraggedAction(dt, exists)).toBeNull();
    expect(readDraggedAction(null, exists)).toBeNull();
    expect(readDraggedAction(fakeTransfer(), exists)).toBeNull();
    const broken = fakeTransfer();
    broken.setData(HOTBAR_ACTION_MIME, '{nope');
    expect(readDraggedAction(broken, exists)).toBeNull();
  });

  it('rejects retired buddy drag payloads and saved shortcuts', () => {
    for (const id of ['horse', 'crystal_lich', 'forgemaw', 'gone']) {
      const action = { type: 'buddy', id };
      const dt = fakeTransfer();
      dt.setData(HOTBAR_ACTION_MIME, JSON.stringify(action));
      expect(readDraggedAction(dt, exists)).toBeNull();
      expect(
        parseHotbarAction(
          action,
          () => true,
          () => true,
        ),
      ).toBeNull();
    }
  });

  it('the server-shared layout sanitizer clears old buddy slots and preserves ordinary actions', () => {
    const clean = sanitizeActionBarLayout({
      v: 1,
      forms: {
        normal: {
          bar: [
            { type: 'buddy', id: 'crystal_lich' },
            { type: 'ability', id: 'heroic_strike' },
            { type: 'item', id: 'reins_valorsteed' },
          ],
        },
      },
    });
    expect(clean?.forms.normal?.bar).toEqual([
      null,
      { type: 'ability', id: 'heroic_strike' },
      { type: 'item', id: 'reins_valorsteed' },
    ]);
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
});
