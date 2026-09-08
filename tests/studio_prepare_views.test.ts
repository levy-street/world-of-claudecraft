import { expect, it, vi } from 'vitest';
import { prepareStudioViews } from '../src/vfx_studio/prepare_views';

it('keeps preparation frames moving while the simulation and last image stay frozen', async () => {
  const views = new Map<number, { compilePending: boolean }>();
  let frames = 0;
  const sync = vi.fn(() => {
    frames++;
    views.set(1, { compilePending: frames < 3 });
    views.set(2, { compilePending: true }); // Unrelated scenery never holds the actor.
  });
  const nextFrame = vi.fn(async () => {});
  await prepareStudioViews({ views, sync }, [1], () => true, nextFrame);
  expect(frames).toBe(3);
  expect(nextFrame).toHaveBeenCalledTimes(2);
  for (const call of sync.mock.calls) expect(call).toEqual([1, 0, null, 0, null, true, false]);
});

it('abandons preparation after a newer configuration takes ownership', async () => {
  let current = true;
  const sync = vi.fn();
  await prepareStudioViews(
    { views: new Map(), sync },
    [1],
    () => current,
    async () => {
      current = false;
    },
  );
  expect(sync).toHaveBeenCalledTimes(1);
});
