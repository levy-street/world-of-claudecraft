import { expect, it, vi } from 'vitest';
import { DeferredContactBursts } from '../src/render/ability_vfx/deferred_contact_bursts';

it.each([30, 60, 120])(
  'retains extraction after the bite and clears reused state at %s Hz',
  (hz) => {
    const queue = new DeferredContactBursts(),
      host = { burstAt: vi.fn() };
    queue.reserve(2, 3, 4, 0x940c2b, 12, 1.35, 'blood', 0.192, 0.048);
    expect(host.burstAt).not.toHaveBeenCalled();
    let time = 0;
    while (time < 0.1) {
      queue.update(host, 1 / hz);
      time += 1 / hz;
      if (time < 0.048) expect(host.burstAt).not.toHaveBeenCalled();
    }
    expect(host.burstAt).toHaveBeenCalledExactlyOnceWith(
      2,
      3,
      4,
      0x940c2b,
      12,
      1.35,
      'blood',
      0.192,
    );
    queue.reserve(9, 8, 7, 0, 1, 1, 'blood', 0.1, 0.02);
    queue.clear();
    queue.update(host, 1);
    expect(host.burstAt).toHaveBeenCalledTimes(1);
  },
);
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
