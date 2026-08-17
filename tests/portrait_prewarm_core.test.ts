import { describe, expect, it } from 'vitest';
import {
  type PortraitPrewarmSteps,
  runPortraitPrewarm,
} from '../src/render/characters/portrait_prewarm_core';

interface Harness {
  steps: PortraitPrewarmSteps<string>;
  calls: string[];
  errors: unknown[];
  committed: string[];
}

function harness(overrides: Partial<PortraitPrewarmSteps<string>> = {}): Harness {
  const calls: string[] = [];
  const errors: unknown[] = [];
  const committed: string[] = [];
  const steps: PortraitPrewarmSteps<string> = {
    cached: () => false,
    ready: () => true,
    atlasPending: () => false,
    build: () => {
      calls.push('build');
      return 'visual';
    },
    uploadTextures: async () => {
      calls.push('upload');
    },
    current: () => true,
    compile: async () => {
      calls.push('compile');
    },
    renderAndSnapshot: () => {
      calls.push('render');
      return Promise.resolve('data:png');
    },
    release: (visual) => {
      calls.push(`release:${visual}`);
    },
    commit: (url) => {
      calls.push('commit');
      committed.push(url);
    },
    onError: (err) => {
      errors.push(err);
    },
    ...overrides,
  };
  return { steps, calls, errors, committed };
}

describe('runPortraitPrewarm', () => {
  it('runs upload, compile, render, release, then commits the encoded URL', async () => {
    const h = harness();
    await runPortraitPrewarm(h.steps);
    expect(h.calls).toEqual(['build', 'upload', 'compile', 'render', 'release:visual', 'commit']);
    expect(h.committed).toEqual(['data:png']);
    expect(h.errors).toEqual([]);
  });

  it('builds nothing on the cheap early-outs (cached, assets not ready, atlas pending)', async () => {
    for (const overrides of [
      { cached: () => true },
      { ready: () => false },
      { atlasPending: () => true },
    ]) {
      const h = harness(overrides);
      await runPortraitPrewarm(h.steps);
      expect(h.calls).toEqual([]);
    }
  });

  it('stops after the upload sweep when the rig was swapped, still releasing the visual', async () => {
    const h = harness({ current: () => false });
    await runPortraitPrewarm(h.steps);
    expect(h.calls).toEqual(['build', 'upload', 'release:visual']);
    expect(h.committed).toEqual([]);
  });

  it('stops after compile when the rig was swapped during the link', async () => {
    let checks = 0;
    const h = harness({ current: () => ++checks < 2 });
    await runPortraitPrewarm(h.steps);
    expect(h.calls).toEqual(['build', 'upload', 'compile', 'release:visual']);
    expect(h.committed).toEqual([]);
  });

  it('releases BEFORE awaiting the encode, and never commits a null encode', async () => {
    let resolveEncode!: (url: string | null) => void;
    const h = harness({
      renderAndSnapshot: () => {
        h.calls.push('render');
        return new Promise<string | null>((resolve) => {
          resolveEncode = resolve;
        });
      },
    });
    const run = runPortraitPrewarm(h.steps);
    // Drain the upload/compile microtask chain; the encode stays pending.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // The visual must already be released while the off-thread encode is
    // still pending (the encode holds a bitmap snapshot, not the visual).
    expect(h.calls).toContain('render');
    expect(h.calls).toContain('release:visual');
    expect(h.calls).not.toContain('commit');
    resolveEncode(null);
    await run;
    expect(h.committed).toEqual([]);
  });

  it('drops a late encode when the rig was swapped while it was pending (post-rebuild cache stays clean)', async () => {
    let swapped = false;
    let resolveEncode!: (url: string | null) => void;
    const h = harness({
      current: () => !swapped,
      renderAndSnapshot: () => {
        h.calls.push('render');
        return new Promise<string | null>((resolve) => {
          resolveEncode = resolve;
        });
      },
    });
    const run = runPortraitPrewarm(h.steps);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(h.calls).toContain('render');
    swapped = true; // graphics rebuild lands during the encode
    resolveEncode('data:stale');
    await run;
    expect(h.committed).toEqual([]);
  });

  it('reports a mid-flight throw and still releases the visual', async () => {
    const boom = new Error('context lost');
    const h = harness({
      compile: async () => {
        throw boom;
      },
    });
    await runPortraitPrewarm(h.steps);
    expect(h.errors).toEqual([boom]);
    expect(h.calls).toEqual(['build', 'upload', 'release:visual']);
    expect(h.committed).toEqual([]);
  });
});
