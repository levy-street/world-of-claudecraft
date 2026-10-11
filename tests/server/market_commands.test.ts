import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchMarketCommand } from '../../server/market_commands';
import { resetMarketSoldVolumeForTests } from '../../server/market_sold_volume';
import type { Sim } from '../../src/sim/sim';

// The three buy-order arms of the market wire surface. The sim is a stub: this
// suite pins the FRAME GUARDS (which fields must be present and typed before a
// sim method runs), never order legality, which src/sim owns. The place/fill
// arms route through the sold-volume observer, which needs `marketOrders` on
// the sim; the observer stays unconfigured here, so a booked sale is a no-op
// and no database is ever reached.
function stubSim() {
  const sim = {
    marketOrders: [] as Array<{ id: number; itemId: string }>,
    marketOrderPlace: vi.fn(() => []),
    marketOrderFill: vi.fn(() => ({ units: 0, copper: 0 })),
    marketOrderCancel: vi.fn(),
  };
  return { sim, asSim: sim as unknown as Sim };
}

const PID = 42;

describe('dispatchMarketCommand: market_order_place', () => {
  beforeEach(() => {
    resetMarketSoldVolumeForTests();
  });

  it('routes a well-formed frame to marketOrderPlace(item, count, price, pid)', () => {
    const { sim, asSim } = stubSim();
    const handled = dispatchMarketCommand(
      asSim,
      { cmd: 'market_order_place', item: 'vale_wheat', count: 5, price: 30 },
      PID,
    );
    expect(handled).toBe(true);
    expect(sim.marketOrderPlace).toHaveBeenCalledWith('vale_wheat', 5, 30, PID);
  });

  it.each([
    ['a missing item', { cmd: 'market_order_place', count: 5, price: 30 }],
    ['a non-string item', { cmd: 'market_order_place', item: 7, count: 5, price: 30 }],
    [
      'a non-number count',
      { cmd: 'market_order_place', item: 'vale_wheat', count: '5', price: 30 },
    ],
    [
      'a non-finite price',
      { cmd: 'market_order_place', item: 'vale_wheat', count: 5, price: Number.POSITIVE_INFINITY },
    ],
    ['a NaN price', { cmd: 'market_order_place', item: 'vale_wheat', count: 5, price: Number.NaN }],
  ])('refuses %s without touching the sim', (_label, msg) => {
    const { sim, asSim } = stubSim();
    expect(dispatchMarketCommand(asSim, msg, PID)).toBe(false);
    expect(sim.marketOrderPlace).not.toHaveBeenCalled();
  });
});

describe('dispatchMarketCommand: market_order_fill', () => {
  beforeEach(() => {
    resetMarketSoldVolumeForTests();
  });

  it('routes a well-formed frame to marketOrderFill(id, count, pid)', () => {
    const { sim, asSim } = stubSim();
    expect(dispatchMarketCommand(asSim, { cmd: 'market_order_fill', id: 9, count: 3 }, PID)).toBe(
      true,
    );
    expect(sim.marketOrderFill).toHaveBeenCalledWith(9, 3, PID);
  });

  it.each([
    ['a missing id', { cmd: 'market_order_fill', count: 3 }],
    ['a string id', { cmd: 'market_order_fill', id: '9', count: 3 }],
    ['a missing count', { cmd: 'market_order_fill', id: 9 }],
    ['a string count', { cmd: 'market_order_fill', id: 9, count: '3' }],
  ])('refuses %s without touching the sim', (_label, msg) => {
    const { sim, asSim } = stubSim();
    expect(dispatchMarketCommand(asSim, msg, PID)).toBe(false);
    expect(sim.marketOrderFill).not.toHaveBeenCalled();
  });
});

describe('dispatchMarketCommand: market_order_cancel', () => {
  it('routes a numeric id to marketOrderCancel(id, pid)', () => {
    const { sim, asSim } = stubSim();
    expect(dispatchMarketCommand(asSim, { cmd: 'market_order_cancel', id: 4 }, PID)).toBe(true);
    expect(sim.marketOrderCancel).toHaveBeenCalledWith(4, PID);
  });

  it('refuses a string id without touching the sim', () => {
    const { sim, asSim } = stubSim();
    expect(dispatchMarketCommand(asSim, { cmd: 'market_order_cancel', id: '4' }, PID)).toBe(false);
    expect(sim.marketOrderCancel).not.toHaveBeenCalled();
  });
});
