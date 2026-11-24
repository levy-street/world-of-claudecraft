import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from '../server/shutdown_lifecycle';

describe('shutdown signal coordination', () => {
  it('shares work and completion across repeated signals', async () => {
    let finish!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const failed = vi.fn();
    const signal = createShutdownHandler(work, failed);
    const first = signal();
    expect(signal()).toBe(first);
    finish();
    await first;
    expect(signal()).toBe(first);
    expect(work).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it('reports failure once without running teardown or restarting on a later signal', async () => {
    const teardown = vi.fn();
    const failed = vi.fn();
    const signal = createShutdownHandler(async () => {
      await Promise.reject(new Error('save failed'));
      teardown();
    }, failed);
    await Promise.all([signal(), signal()]);
    await signal();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(teardown).not.toHaveBeenCalled();
  });

  it('wires the durable barrier ahead of lease release and pool closure in startServer', () => {
    // The runtime units exercise the real GameServer save path. This source pin
    // guards main's composition without booting external integrations in units.
    const source = readFileSync('server/main.ts', 'utf8');
    const shutdown = source.slice(source.indexOf('const shutdownWork ='));
    expect(shutdown.indexOf('game.beginShutdown()')).toBeGreaterThan(0);
    expect(shutdown.indexOf('game.beginShutdown()')).toBeLessThan(shutdown.indexOf('await '));
    const barrier = shutdown.indexOf('await game.saveForShutdown()');
    expect(barrier).toBeGreaterThan(0);
    expect(barrier).toBeLessThan(shutdown.indexOf('await releaseAllCharacterLeases()'));
    expect(barrier).toBeLessThan(shutdown.indexOf('await pool.end()'));
    expect(shutdown).toContain('createShutdownHandler(');
    expect(shutdown).toContain('process.exitCode = 1');
    expect(shutdown).toContain("process.on('SIGINT', shutdown)");
    expect(shutdown).toContain("process.on('SIGTERM', shutdown)");
  });
});
