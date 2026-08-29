import { describe, expect, it, vi } from 'vitest';
import {
  type BattlegroundAssetPrewarmUnit,
  createBattlegroundAssetPrewarm,
} from '../src/render/battleground_asset_prewarm';

const units = (...ids: string[]): BattlegroundAssetPrewarmUnit[] =>
  ids.map((id) => ({ id, run: vi.fn().mockResolvedValue(undefined) }));

describe('createBattlegroundAssetPrewarm', () => {
  it('starts only on preview intent and advances in bounded idle batches', async () => {
    const plan = units('ground', 'walls', 'trees', 'decor');
    const idle = vi.fn().mockResolvedValue(undefined);
    const warm = createBattlegroundAssetPrewarm(plan, { idle, batchSize: 2 });

    expect(plan.every((unit) => vi.mocked(unit.run).mock.calls.length === 0)).toBe(true);

    warm.startPreview();
    await warm.whenPausedOrComplete();

    expect(plan.map((unit) => vi.mocked(unit.run).mock.calls.length)).toEqual([1, 1, 1, 1]);
    expect(idle).toHaveBeenCalledTimes(2);
    expect(warm.snapshot()).toMatchObject({ completed: 4, total: 4, committed: false });
  });

  it('pauses preview work between batches and resumes without repeating assets', async () => {
    const plan = units('ground', 'walls', 'trees', 'decor');
    let releaseIdle: () => void = () => undefined;
    const idle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseIdle = resolve;
        }),
    );
    const warm = createBattlegroundAssetPrewarm(plan, { idle, batchSize: 2 });

    warm.startPreview();
    await Promise.resolve();
    await Promise.resolve();
    releaseIdle();
    await Promise.resolve();
    await Promise.resolve();
    warm.pausePreview();
    releaseIdle();
    await warm.whenPausedOrComplete();

    expect(plan.map((unit) => vi.mocked(unit.run).mock.calls.length)).toEqual([1, 1, 0, 0]);
    expect(warm.snapshot()).toMatchObject({ completed: 2, active: false, committed: false });

    warm.startPreview();
    await Promise.resolve();
    await Promise.resolve();
    releaseIdle();
    await warm.whenPausedOrComplete();
    expect(plan.map((unit) => vi.mocked(unit.run).mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it('queue commitment is idempotent, cannot be paused, and returns full readiness', async () => {
    const plan = units('ground', 'walls', 'decor');
    const warm = createBattlegroundAssetPrewarm(plan, {
      idle: vi.fn().mockResolvedValue(undefined),
      batchSize: 1,
    });

    const first = warm.commit();
    warm.pausePreview();
    const second = warm.commit();

    expect(second).toBe(first);
    await first;
    expect(plan.map((unit) => vi.mocked(unit.run).mock.calls.length)).toEqual([1, 1, 1]);
    expect(warm.snapshot()).toEqual({
      active: false,
      committed: true,
      completed: 3,
      total: 3,
      failed: [],
    });
  });

  it('continues after one failed optional asset and reports it honestly', async () => {
    const plan = units('ground', 'broken', 'decor');
    vi.mocked(plan[1].run).mockRejectedValueOnce(new Error('missing'));
    const warm = createBattlegroundAssetPrewarm(plan, {
      idle: vi.fn().mockResolvedValue(undefined),
      batchSize: 1,
    });

    await warm.commit();

    expect(vi.mocked(plan[2].run)).toHaveBeenCalledOnce();
    expect(warm.snapshot().failed).toEqual(['broken']);
  });
});
