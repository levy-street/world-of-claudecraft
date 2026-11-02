import { describe, expect, it, vi } from 'vitest';
import { StaticInteriorTracker } from '../src/render/static_interior_tracker';

describe('static interior loading', () => {
  it('retries a failed dungeon load after cooldown without duplicating pending or built rooms', async () => {
    let now = 0;
    const built = new Set<string>();
    const error = new Error('Temporary asset failure');
    const build = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({});
    const failed = vi.fn();
    const tracker = new StaticInteriorTracker(built, build, () => now, failed);
    tracker.schedule('crypt:0', 'crypt', 100300, -1250);
    tracker.schedule('crypt:0', 'crypt', 100300, -1250);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(error));
    expect(build).toHaveBeenCalledTimes(1);
    expect(built.has('crypt:0')).toBe(false);
    tracker.schedule('crypt:0', 'crypt', 100300, -1250);
    expect(build).toHaveBeenCalledTimes(1);
    now = 14999;
    tracker.schedule('crypt:0', 'crypt', 100300, -1250);
    await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(1);
    now = 15000;
    tracker.schedule('crypt:0', 'crypt', 100300, -1250);
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    tracker.schedule('crypt:0', 'crypt', 100300, -1250);
    expect(build).toHaveBeenCalledTimes(2);
    expect(built.has('crypt:0')).toBe(true);
  });

  it('holds dungeon readiness until prepareDungeon settles and shares in-flight builds with schedule', async () => {
    const built = new Set<string>();
    let resolveBuild!: () => void;
    const build = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveBuild = resolve;
        }),
    );
    const tracker = new StaticInteriorTracker(
      built,
      build,
      () => 0,
      () => {},
    );
    const dungeon = { id: 'hollow_crypt', index: 0, interior: 'hollow_crypt' };
    const progress: Array<[number, number]> = [];

    expect(tracker.isDungeonSettled(dungeon, -1250)).toBe(false);
    const prepare = tracker.prepareDungeon(dungeon, -1250, (done, total) =>
      progress.push([done, total]),
    );
    tracker.schedule('hollow_crypt:0', 'hollow_crypt', 100300, -1250);
    await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(1);
    expect(tracker.isDungeonSettled(dungeon, -1250)).toBe(false);

    resolveBuild();
    await prepare;
    expect(tracker.isDungeonSettled(dungeon, -1250)).toBe(true);
    expect(progress).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});
