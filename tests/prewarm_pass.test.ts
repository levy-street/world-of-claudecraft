import { describe, expect, it } from 'vitest';
import { type PrewarmGroupLike, runBackgroundPrewarm } from '../src/render/prewarm_pass';

function group(childCount: number): PrewarmGroupLike {
  return { visible: true, children: Array.from({ length: childCount }, (_, i) => i) };
}

describe('runBackgroundPrewarm', () => {
  it('keeps every group invisible across the whole awaited compile window', async () => {
    const groups = [group(2), group(3)];
    const seen: boolean[] = [];
    const compiled: unknown[] = [];
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: async () => {
        seen.push(...groups.map((g) => g.visible));
      },
      compileChild: async (child) => {
        compiled.push(child);
        seen.push(...groups.map((g) => g.visible));
      },
      warmChild: () => {
        seen.push(...groups.map((g) => g.visible));
      },
      renderWarmPass: () => {},
    });
    // Two idle slots per child (compile + isolated upload), plus the trailing
    // one. A group is visible only inside its own synchronous upload callback.
    expect(seen.filter(Boolean)).toHaveLength(5);
    expect(groups.map((g) => g.visible)).toEqual([false, false]);
    expect(compiled).toEqual([0, 1, 0, 1, 2]);
  });

  it('spreads child uploads across idle slots before the final pass', async () => {
    const groups = [group(2)];
    const events: string[] = [];
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: async () => {
        events.push('idle');
      },
      compileChild: async (child) => {
        events.push(`compile:${child}`);
      },
      warmChild: (_group, child) => {
        expect(groups[0].visible).toBe(true);
        events.push(`upload:${child}`);
      },
      renderWarmPass: () => events.push('final'),
    });
    expect(events).toEqual([
      'idle',
      'compile:0',
      'idle',
      'upload:0',
      'idle',
      'compile:1',
      'idle',
      'upload:1',
      'idle',
      'final',
    ]);
  });

  it('shows the groups only for the synchronous warm pass and hides them after', async () => {
    const groups = [group(1), group(1)];
    let visibleDuringPass: boolean[] | null = null;
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: async () => {},
      compileChild: async () => {},
      renderWarmPass: () => {
        visibleDuringPass = groups.map((g) => g.visible);
      },
    });
    expect(visibleDuringPass).toEqual([true, true]);
    expect(groups.map((g) => g.visible)).toEqual([false, false]);
  });

  it('skips the compile loop without parallel shader compile but still gates visibility', async () => {
    const groups = [group(4)];
    let idleCalls = 0;
    let compileCalls = 0;
    let passRan = false;
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: false,
      idleSlot: async () => {
        idleCalls++;
      },
      compileChild: async () => {
        compileCalls++;
      },
      renderWarmPass: () => {
        passRan = true;
        expect(groups[0].visible).toBe(true);
      },
    });
    expect(idleCalls).toBe(0);
    expect(compileCalls).toBe(0);
    expect(passRan).toBe(true);
    expect(groups[0].visible).toBe(false);
  });

  it('leaves the groups hidden when a compile throws', async () => {
    const groups = [group(2)];
    await expect(
      runBackgroundPrewarm(groups, {
        supportsAsyncCompile: true,
        idleSlot: async () => {},
        compileChild: async () => {
          throw new Error('compile failed');
        },
        renderWarmPass: () => {
          throw new Error('warm pass must not run after a compile failure');
        },
      }),
    ).rejects.toThrow('compile failed');
    expect(groups[0].visible).toBe(false);
  });

  it('never yields between showing the groups and the warm pass', async () => {
    // The warm pass must run in the same task that flips visibility on, so a
    // live gameplay frame can never interleave and paint the T-pose grid.
    const groups = [group(1)];
    let shownAt = -1;
    let passAt = -1;
    let step = 0;
    const proxied: PrewarmGroupLike = {
      children: groups[0].children,
      get visible() {
        return groups[0].visible;
      },
      set visible(v: boolean) {
        groups[0].visible = v;
        if (v) shownAt = step;
      },
    };
    await runBackgroundPrewarm([proxied], {
      supportsAsyncCompile: true,
      idleSlot: async () => {
        step++;
      },
      compileChild: async () => {
        step++;
      },
      renderWarmPass: () => {
        passAt = step;
      },
    });
    expect(shownAt).toBeGreaterThanOrEqual(0);
    expect(passAt).toBe(shownAt);
  });
});
