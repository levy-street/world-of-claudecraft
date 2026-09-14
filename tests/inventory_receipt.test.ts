import { describe, expect, it } from 'vitest';
import { emitInventoryReceipt } from '../src/sim/inventory_receipt';
import type { ItemInstancePayload, SimEvent } from '../src/sim/types';

describe('inventory receipt identity', () => {
  it('keeps ordinary grants byte-compatible, including absent optional flags', () => {
    const events: SimEvent[] = [];
    emitInventoryReceipt({ emit: (ev) => events.push(ev) }, 7, 'vest', 'Vest', 2);
    expect(events).toEqual([{ type: 'loot', text: 'You receive: Vest x2.', pid: 7 }]);
    emitInventoryReceipt({ emit: (ev) => events.push(ev) }, 7, 'vest', 'Vest', 1, {
      silent: true,
      callerLogs: true,
    });
    expect(events[1]).toEqual({
      type: 'loot',
      text: 'You receive: Vest.',
      pid: 7,
      silent: true,
      callerLogs: true,
    });
  });

  it('carries a detached enhanced copy for the exact item tooltip', () => {
    const instance: ItemInstancePayload = {
      lootQuality: { version: 1, tier: 4, weights: [100, 200, 300, 400, 500] },
    };
    const events: SimEvent[] = [];
    emitInventoryReceipt(
      { emit: (ev) => events.push(ev) },
      7,
      'vest',
      'Vest',
      1,
      undefined,
      instance,
    );
    const event = events[0];
    expect(event).toMatchObject({ itemId: 'vest', count: 1, instance });
    instance.lootQuality!.weights[0] = 999;
    expect(event.type === 'loot' && event.instance?.lootQuality?.weights[0]).toBe(100);
  });
});
