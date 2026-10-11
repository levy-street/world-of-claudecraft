import { expect, it, vi } from 'vitest';
import { DeferredContactBursts } from '../src/render/ability_vfx/deferred_contact_bursts';

it.each([30, 60, 120])(
  'retains extraction after the bite and clears reused state at %s Hz',
  (hz) => {
    const queue = new DeferredContactBursts(),
      host = { burstAt: vi.fn() };
    queue.reserve(2, 3, 4, 0x940c2b, 12, 1.35, 'blood', 0.192, 0.048);
    expect(host.burstAt).not.toHaveBeenCalled();
    let time = 0,
      deliveredAt = 0;
    while (time < 0.1) {
      queue.update(host, 1 / hz);
      time += 1 / hz;
      if (time < 0.048) expect(host.burstAt).not.toHaveBeenCalled();
      if (!deliveredAt && host.burstAt.mock.calls.length) deliveredAt = time;
    }
    expect(host.burstAt).toHaveBeenCalledExactlyOnceWith(
      2,
      3,
      4,
      0x940c2b,
      12,
      1.35,
      'blood',
      expect.any(Number),
    );
    expect(deliveredAt).toBeGreaterThanOrEqual(0.048);
    expect(deliveredAt).toBeLessThan(0.048 + 1 / hz);
    expect(deliveredAt + host.burstAt.mock.calls[0][7]).toBeCloseTo(0.24, 12);
    queue.reserve(9, 8, 7, 0, 1, 1, 'blood', 0.1, 0.02);
    queue.clear();
    queue.update(host, 1);
    expect(host.burstAt).toHaveBeenCalledTimes(1);
  },
);
it('deducts overdue delivery time from the remaining particle lifetime', () => {
  const queue = new DeferredContactBursts(),
    host = { burstAt: vi.fn() };
  queue.reserve(2, 3, 4, 0x940c2b, 12, 1.35, 'blood', 0.25, 0.02);
  queue.update(host, 0.1);
  expect(host.burstAt).toHaveBeenCalledExactlyOnceWith(
    2,
    3,
    4,
    0x940c2b,
    12,
    1.35,
    'blood',
    expect.any(Number),
  );
  expect(host.burstAt.mock.calls[0][7]).toBeCloseTo(0.17, 12);
});
it('drops expired extraction and releases every occupied slot', () => {
  const queue = new DeferredContactBursts(),
    host = { burstAt: vi.fn() };
  for (let i = 0; i < 48; i++) queue.reserve(i, 0, 0, 0, 3, 1, 'blood', 0.25, 0.02);
  queue.update(host, 0.3);
  expect(host.burstAt).not.toHaveBeenCalled();
  for (let i = 0; i < 48; i++) queue.reserve(i, 0, 0, 0, 3, 1, 'blood', 0.1, 0.02);
  queue.update(host, 0.02);
  expect(host.burstAt).toHaveBeenCalledTimes(48);
});
it('drops garnish that cannot fit the emitter minimum and frees its capacity', () => {
  const queue = new DeferredContactBursts(),
    host = { burstAt: vi.fn() };
  for (let i = 0; i < 48; i++) queue.reserve(i, 0, 0, 0, 3, 1, 'blood', 0.25, 0.02);
  queue.update(host, 0.24);
  expect(host.burstAt).not.toHaveBeenCalled();
  for (let i = 0; i < 48; i++) queue.reserve(i, 0, 0, 0, 3, 1, 'blood', 0.25, 0.02);
  queue.update(host, 0.2);
  expect(host.burstAt).toHaveBeenCalledTimes(48);
  for (const call of host.burstAt.mock.calls) expect(call[7]).toBeCloseTo(0.07, 12);
});
it('preserves unknown lifetimes and the bounded delay when delivery is overdue', () => {
  const queue = new DeferredContactBursts(),
    host = { burstAt: vi.fn() };
  queue.reserve(1, 2, 3, 0, 3, 1, 'blood', undefined, 9);
  queue.update(host, 0.19);
  expect(host.burstAt).not.toHaveBeenCalled();
  queue.update(host, 0.81);
  expect(host.burstAt).toHaveBeenCalledExactlyOnceWith(1, 2, 3, 0, 3, 1, 'blood', undefined);
  queue.update(host, 1);
  expect(host.burstAt).toHaveBeenCalledTimes(1);
});
it('bounds crowded extraction work and ignores invalid clock steps', () => {
  const queue = new DeferredContactBursts(),
    host = { burstAt: vi.fn() };
  for (let i = 0; i < 1000; i++) queue.reserve(i, 0, 0, 0, 3, 1, 'blood', 0.1, 0.02);
  queue.update(host, NaN);
  queue.update(host, -1);
  expect(host.burstAt).not.toHaveBeenCalled();
  queue.update(host, 0.03);
  expect(host.burstAt).toHaveBeenCalledTimes(48);
});
