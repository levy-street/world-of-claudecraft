import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  boundedPrewarmVisibility,
  type PrewarmGroupLike,
  runBackgroundPrewarm,
  withHiddenPrewarmGroups,
} from '../src/render/prewarm_pass';

const idle =
  (forcedProgress = false) =>
  async () => ({
    forcedProgress,
    source: forcedProgress ? ('idle-timeout' as const) : ('idle' as const),
    timeRemainingMs: forcedProgress ? 0 : 5,
  });

function group(childCount: number): PrewarmGroupLike {
  return { visible: true, children: Array.from({ length: childCount }, (_, i) => i) };
}

describe('runBackgroundPrewarm', () => {
  it('never forces a hidden scene light visible for a bounded upload', () => {
    expect(boundedPrewarmVisibility(false, true)).toBe(false);
    expect(boundedPrewarmVisibility(true, true)).toBe(true);
    expect(boundedPrewarmVisibility(true, false)).toBe(false);
  });

  it('keeps newly attached groups hidden across awaited work and restores their state', async () => {
    const groups = [group(1), group(1)];
    groups[1].visible = false;
    let release!: () => void;
    const work = withHiddenPrewarmGroups(
      groups,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    expect(groups.map((entry) => entry.visible)).toEqual([false, false]);
    release();
    await work;
    expect(groups.map((entry) => entry.visible)).toEqual([true, false]);
  });

  it('restores hidden-group state when awaited compilation fails', async () => {
    const groups = [group(1), group(1)];
    groups[1].visible = false;
    await expect(
      withHiddenPrewarmGroups(groups, async () => {
        expect(groups.map((entry) => entry.visible)).toEqual([false, false]);
        throw new Error('compile failed');
      }),
    ).rejects.toThrow('compile failed');
    expect(groups.map((entry) => entry.visible)).toEqual([true, false]);
  });

  it('keeps every group invisible across the whole awaited compile window', async () => {
    const groups = [group(2), group(3)];
    const seen: boolean[] = [];
    const compiled: unknown[] = [];
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: async () => {
        seen.push(...groups.map((g) => g.visible));
        return { forcedProgress: false, source: 'idle', timeRemainingMs: 5 };
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
    // Two idle slots per child (compile + isolated upload). A group is visible
    // only inside its own synchronous upload callback.
    expect(seen.filter(Boolean)).toHaveLength(5);
    expect(groups.map((g) => g.visible)).toEqual([false, false]);
    expect(compiled).toEqual([0, 1, 0, 1, 2]);
  });

  it('spreads child uploads across idle slots without a redundant final pass', async () => {
    const groups = [group(2)];
    const events: string[] = [];
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: async () => {
        events.push('idle');
        return { forcedProgress: false, source: 'idle', timeRemainingMs: 5 };
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
    ]);
  });

  it('splits a child into labeled upload units, one idle slot and one arbiter grant each', async () => {
    const groups = [group(2)];
    const events: string[] = [];
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: async () => {
        events.push('idle');
        return { forcedProgress: false, source: 'idle', timeRemainingMs: 5 };
      },
      compileChild: async (child) => {
        events.push(`compile:${child}`);
      },
      warmChildUnits: (_group, child) => [
        { label: 'tex', run: () => events.push(`tex:${child}`) },
        { label: `render:${child}`, run: () => events.push(`render:${child}`) },
      ],
      renderWarmPass: () => events.push('final'),
      runUpload: async (work, label) => {
        events.push(`grant:${label ?? 'unlabeled'}`);
        work();
      },
    });
    // Per child: one compile slot, then one slot + one grant PER UNIT, and no
    // redundant final whole-group pass afterward.
    expect(events).toEqual([
      'idle',
      'compile:0',
      'idle',
      'grant:tex',
      'tex:0',
      'idle',
      'grant:render:0',
      'render:0',
      'idle',
      'compile:1',
      'idle',
      'grant:tex',
      'tex:1',
      'idle',
      'grant:render:1',
      'render:1',
    ]);
  });

  it('prefers warmChildUnits over warmChild when both hooks are supplied', async () => {
    const groups = [group(1)];
    const events: string[] = [];
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: idle(),
      compileChild: async () => {},
      warmChild: () => events.push('whole-child'),
      warmChildUnits: () => [{ run: () => events.push('unit') }],
      renderWarmPass: () => events.push('final'),
    });
    expect(events).toEqual(['unit']);
  });

  it('keeps a child hidden while its upload waits for the shared GPU arbiter', async () => {
    const groups = [group(1)];
    let releaseUpload!: () => void;
    let visibleDuringUpload = false;
    const run = runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: idle(),
      compileChild: async () => {},
      warmChild: () => {
        visibleDuringUpload = groups[0].visible;
      },
      renderWarmPass: () => {},
      runUpload: async (work) => {
        await new Promise<void>((resolve) => {
          releaseUpload = resolve;
        });
        expect(groups[0].visible).toBe(false);
        work();
      },
    });

    for (let turn = 0; turn < 10 && !releaseUpload; turn++) await Promise.resolve();
    expect(groups[0].visible).toBe(false);
    releaseUpload();
    await run;
    expect(visibleDuringUpload).toBe(true);
    expect(groups[0].visible).toBe(false);
  });

  it('shows the groups only for the synchronous warm pass and hides them after', async () => {
    const groups = [group(1), group(1)];
    let visibleDuringPass: boolean[] | null = null;
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: true,
      idleSlot: idle(),
      compileChild: async () => {},
      renderWarmPass: () => {
        visibleDuringPass = groups.map((g) => g.visible);
      },
    });
    expect(visibleDuringPass).toEqual([true, true]);
    expect(groups.map((g) => g.visible)).toEqual([false, false]);
  });

  it('paces bounded child uploads without invoking compileAsync when parallel compile is absent', async () => {
    const groups = [group(4)];
    let idleCalls = 0;
    let compileCalls = 0;
    let passRan = false;
    const uploads: unknown[] = [];
    let renderUploads = 0;
    await runBackgroundPrewarm(groups, {
      supportsAsyncCompile: false,
      idleSlot: async () => {
        idleCalls++;
        return { forcedProgress: false, source: 'idle', timeRemainingMs: 5 };
      },
      compileChild: async () => {
        compileCalls++;
      },
      prepareChildAssets: (child) => {
        uploads.push(child);
        expect(groups[0].visible).toBe(false);
      },
      warmChild: () => {
        renderUploads++;
      },
      renderWarmPass: () => {
        passRan = true;
      },
    });
    expect(idleCalls).toBe(4);
    expect(compileCalls).toBe(0);
    expect(uploads).toEqual([0, 1, 2, 3]);
    expect(renderUploads).toBe(0);
    expect(passRan).toBe(false);
    expect(groups[0].visible).toBe(false);
  });

  it('leaves the groups hidden when a compile throws', async () => {
    const groups = [group(2)];
    await expect(
      runBackgroundPrewarm(groups, {
        supportsAsyncCompile: true,
        idleSlot: idle(),
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
        return { forcedProgress: false, source: 'idle', timeRemainingMs: 5 };
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

  it('reports when a bounded timeout ceiling deliberately forces one expensive unit', async () => {
    const forced: string[] = [];
    await runBackgroundPrewarm([group(1)], {
      supportsAsyncCompile: true,
      idleSlot: idle(true),
      compileChild: async () => {},
      warmChild: () => {},
      renderWarmPass: () => {},
      onForcedProgress: (phase) => forced.push(phase),
    });
    expect(forced).toEqual(['compile', 'upload']);
  });

  it('does not submit a final whole-group pass after every child was warmed in isolation', async () => {
    let finalPasses = 0;
    await runBackgroundPrewarm([group(2)], {
      supportsAsyncCompile: true,
      idleSlot: idle(),
      compileChild: async () => {},
      warmChild: () => {},
      renderWarmPass: () => {
        finalPasses++;
      },
    });
    expect(finalPasses).toBe(0);
  });

  it('wires background uploads to a bounded root render and resets all out-of-band draws', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const zoneStart = source.indexOf('async prewarmZoneAt(');
    const zoneEnd = source.indexOf('\n  /** Blocking-path neighborhood prepare', zoneStart);
    const zoneMethod = source.slice(zoneStart, zoneEnd);
    const prepareStart = source.indexOf('prepareZoneAt(');
    const prepareEnd = source.indexOf('\n  /** Stage wall-times', prepareStart);
    const prepareMethod = source.slice(prepareStart, prepareEnd);
    const passStart = source.indexOf('private renderPrewarmPass(');
    const passEnd = source.indexOf('\n  private diagnosticsBaselineForPrewarm', passStart);
    const passMethod = source.slice(passStart, passEnd);
    const boundedStart = source.indexOf('private renderBoundedPrewarmRoot(');
    const boundedEnd = source.indexOf('\n  private renderPrewarmPass(', boundedStart);
    const boundedMethod = source.slice(boundedStart, boundedEnd);
    const compileStart = source.indexOf('private async compilePrewarmColorPrograms(');
    const compileEnd = source.indexOf('\n  private async compileShadowPrograms(', compileStart);
    const compileMethod = source.slice(compileStart, compileEnd);

    expect(zoneMethod).toContain('() => this.compilePrewarmColorPrograms(childRoot, true)');
    expect(zoneMethod).toContain('() => this.compileShadowPrograms(childRoot)');
    expect(zoneMethod).toContain('runUpload: (work, label) =>');
    // The decomposed upload: texture batches first, then the bounded render.
    expect(zoneMethod).toContain('warmChildUnits: (groupLike, child) =>');
    expect(zoneMethod).toContain('this.webgl.initTexture(texture)');
    expect(zoneMethod).toContain('this.renderBoundedPrewarmRoot(group, childRoot)');
    expect(prepareMethod).toContain('const featureGroups = this.lastAttachedFeatureGroups.slice()');
    const hideAt = prepareMethod.indexOf('withHiddenPrewarmGroups(featureGroups');
    const queueAt = prepareMethod.indexOf('this.backgroundGpuWork.run(', hideAt);
    expect(hideAt).toBeGreaterThan(-1);
    expect(queueAt).toBeGreaterThan(hideAt);
    expect(zoneMethod).toContain('mobGroup.visible = false');
    expect(zoneMethod).toContain('npcGroup.visible = false');
    expect(zoneMethod.indexOf('mobGroup.visible = false')).toBeLessThan(
      zoneMethod.indexOf('this.scene.add(mobGroup, npcGroup)'),
    );
    expect(zoneMethod).not.toContain('Promise.race');
    expect(compileMethod).toContain('if (!this.post) await compileAtTarget(null)');
    expect(compileMethod).toContain('if (this.post || includeOffscreenVariant)');
    const setTargetAt = compileMethod.indexOf('this.webgl.setRenderTarget(target)');
    const compileAt = compileMethod.indexOf('compilePromise = this.webgl.compileAsync(');
    const restoreAt = compileMethod.indexOf(
      'this.webgl.setRenderTarget(previousTarget)',
      compileAt,
    );
    const awaitAt = compileMethod.indexOf('await compilePromise', restoreAt);
    expect(setTargetAt).toBeGreaterThan(-1);
    expect(compileAt).toBeGreaterThan(setTargetAt);
    expect(restoreAt).toBeGreaterThan(compileAt);
    expect(awaitAt).toBeGreaterThan(restoreAt);
    expect(compileMethod).toContain('await compileAtTarget(this.prewarmRenderTarget)');
    expect(boundedMethod).toContain('boundedPrewarmVisibility(entry.visible, keepVisible)');
    expect(boundedMethod).toContain('this.webgl.shadowMap.autoUpdate = false');
    expect(boundedMethod).not.toContain('if (!this.post)');
    expect(boundedMethod).not.toContain('this.prewarmObjectTextures(childRoot)');
    expect(boundedMethod).toContain('this.webgl.setRenderTarget(this.prewarmRenderTarget)');
    expect(boundedMethod).toContain('this.webgl.render(this.scene, this.camera)');
    expect(boundedMethod).toContain('this.webgl.setRenderTarget(previousTarget)');
    expect(boundedMethod).toContain('this.webgl.shadowMap.autoUpdate = previousShadowAutoUpdate');
    expect(boundedMethod).toContain('this.webgl.shadowMap.needsUpdate = previousShadowNeedsUpdate');
    expect(boundedMethod).toContain('group.children[i].visible = groupVisibility[i]');
    expect(boundedMethod).toContain('this.scene.children[i].visible = sceneVisibility[i]');
    expect(boundedMethod).toContain('this.discardOutOfBandDraws()');
    expect(passMethod).toContain('finally');
    expect(passMethod).toContain('this.discardOutOfBandDraws()');
  });

  it('awaits shader compiles instead of letting timed-out work overlap later lanes', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const zoneStart = source.indexOf('private async prepareZoneSky(');
    const zoneEnd = source.indexOf('\n  /** Blocking-path neighborhood prepare', zoneStart);
    const zoneSlice = source.slice(zoneStart, zoneEnd);
    const shadowStart = source.indexOf('private async compileShadowPrograms(');
    const shadowEnd = source.indexOf('\n  // A tiny throwaway target', shadowStart);
    const shadowSlice = source.slice(shadowStart, shadowEnd);
    const bootStart = source.indexOf("id: 'programs.compile'");
    const bootEnd = source.indexOf("id: 'sky.current-zone'", bootStart);
    const bootSlice = source.slice(bootStart, bootEnd);

    expect(zoneSlice).not.toContain('Promise.race');
    expect(shadowSlice).not.toContain('Promise.race');
    expect(bootSlice).not.toContain('Promise.race');
  });
});
