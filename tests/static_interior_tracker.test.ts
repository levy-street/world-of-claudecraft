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
});
