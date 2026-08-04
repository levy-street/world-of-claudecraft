import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { withHiddenPrewarmGroups } from '../src/render/prewarm_pass';

describe('createBackgroundGpuQueue', () => {
  it('serializes independent GPU lanes without overlap', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          events.push('first:start');
          releaseFirst = () => {
            active--;
            events.push('first:end');
            resolve();
          };
        }),
    );
    const second = queue.run(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push('second:start');
      active--;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(maxActive).toBe(1);
  });

  it('continues the queue after a failed lane', async () => {
    const queue = createBackgroundGpuQueue();
    const failed = queue.run(async () => {
      throw new Error('gpu lane failed');
    });
    const later = queue.run(async () => 'later');

    await expect(failed).rejects.toThrow('gpu lane failed');
    await expect(later).resolves.toBe('later');
  });

  it('runs higher-priority pending work first and preserves FIFO within a priority', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          events.push('active');
          releaseActive = resolve;
        }),
      GPU_WORK_PRIORITY.BACKGROUND,
    );
    await Promise.resolve();

    const low = queue.run(async () => {
      events.push('low');
    }, GPU_WORK_PRIORITY.BOOT_RESUME);
    const highOne = queue.run(async () => {
      events.push('high-one');
    }, GPU_WORK_PRIORITY.LIVE_VIEW);
    const medium = queue.run(async () => {
      events.push('medium');
    }, GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const highTwo = queue.run(async () => {
      events.push('high-two');
    }, GPU_WORK_PRIORITY.LIVE_VIEW);

    releaseActive();
    await Promise.all([active, low, highOne, medium, highTwo]);
    expect(events).toEqual(['active', 'high-one', 'high-two', 'medium', 'low']);
    expect(GPU_WORK_PRIORITY.ACTIONABLE_VIEW).toBeGreaterThan(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(GPU_WORK_PRIORITY.LIVE_VIEW).toBeGreaterThan(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(GPU_WORK_PRIORITY.VISIBLE_PREWARM).toBeGreaterThan(GPU_WORK_PRIORITY.BACKGROUND);
    expect(GPU_WORK_PRIORITY.BACKGROUND).toBeGreaterThan(GPU_WORK_PRIORITY.BOOT_RESUME);
  });

  it('hides a queued group synchronously before an occupied GPU lane releases', async () => {
    const queue = createBackgroundGpuQueue();
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          releaseActive = resolve;
        }),
    );
    await Promise.resolve();
    const group = { visible: true, children: [] };
    const queued = withHiddenPrewarmGroups([group], () => queue.run(async () => {}));

    expect(group.visible).toBe(false);
    releaseActive();
    await Promise.all([active, queued]);
    expect(group.visible).toBe(true);
  });

  it('wires sky, feature, archetype, and boot-resume units through one renderer queue', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const method = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      const end = source.indexOf(endText, start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const sky = method('private async prepareZoneSky(', '\n  /**\n   * Materialize the terrain');
    const features = method('prepareZoneAt(', '\n  /** Stage wall-times');
    const archetypes = method('async prewarmZoneAt(', '\n  /** Blocking-path neighborhood prepare');
    const texture = method('private prewarmTextureInIdle(', '\n  private prewarmMaterialTextures(');
    const initial = method('async prewarmInitialScene(', '\n  // Visual reactions to sim events');
    expect(source).toContain('private backgroundGpuWork = createBackgroundGpuQueue()');
    expect(sky).toContain('this.backgroundGpuWork.run(');
    expect(features).toContain('this.backgroundGpuWork.run(');
    expect(archetypes).toContain('this.backgroundGpuWork.run(');
    expect(texture).toContain('this.backgroundGpuWork.run(');
    expect(initial).toContain(
      'this.backgroundGpuWork.run(unit.run, GPU_WORK_PRIORITY.BOOT_RESUME)',
    );
  });
});
