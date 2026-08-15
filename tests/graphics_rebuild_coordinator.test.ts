import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  GraphicsRebuildCoordinator,
  type GraphicsRebuildCoordinatorDeps,
  type GraphicsRebuildSettings,
} from '../src/game/graphics_rebuild_coordinator';

type Snapshot = Readonly<{ graphicsPreset: number; terrainDetail: number }>;
type FakeRenderer = { id: string; stopped?: boolean };
type FakeContext = { id: string };

const OLD: Snapshot = { graphicsPreset: 3, terrainDetail: 2 };
const TARGET: Snapshot = { graphicsPreset: 4, terrainDetail: 3 };

function fixture(
  over: Partial<GraphicsRebuildCoordinatorDeps<Snapshot, FakeRenderer, FakeContext>> = {},
) {
  const events: string[] = [];
  let current = { id: 'old' };
  let settings = OLD;
  let builds = 0;
  const deps: GraphicsRebuildCoordinatorDeps<Snapshot, FakeRenderer, FakeContext> = {
    currentRenderer: () => current,
    captureSettings: () => settings,
    settingsEqual: (a, b) =>
      a.graphicsPreset === b.graphicsPreset && a.terrainDetail === b.terrainDetail,
    preflightContext: () => events.push('context:preflight'),
    setClientPaused: (paused) => events.push(`pause:${paused}`),
    resetInput: () => events.push('input:reset'),
    neutralizeOnlineInput: () => events.push('input:neutral'),
    showOpaqueCurtain: () => events.push('curtain:show'),
    awaitCurtainPaint: async () => {
      events.push('curtain:paint');
    },
    hideOpaqueCurtain: () => events.push('curtain:hide'),
    prepareTargetAssets: async (_target, progress) => {
      events.push('assets');
      progress(1, 1);
    },
    resetAuxiliaryRenderers: () => events.push('aux:reset'),
    captureRendererContext: (renderer) => {
      events.push(`context:capture:${renderer.id}`);
      return { id: `context:${renderer.id}` };
    },
    shutdownRenderer: async (renderer) => {
      events.push(`shutdown:${renderer.id}`);
      return { id: `context:${renderer.id}` };
    },
    recycleContext: async (context) => {
      events.push(`recycle:${context.id}`);
      return context;
    },
    activateProfile: (next) => {
      events.push(`activate:${next.graphicsPreset}`);
      return next.graphicsPreset;
    },
    resetProfileResources: (epoch) => {
      events.push(`resources:${epoch}`);
    },
    buildRenderer: async (next, context) => {
      events.push(`build:${next.graphicsPreset}:${context.id}`);
      return { id: `build-${++builds}` };
    },
    prepareCurrentZone: async (renderer) => {
      events.push(`current:${renderer.id}`);
    },
    prepareNeighborZones: async (renderer) => {
      events.push(`neighbors:${renderer.id}`);
    },
    prewarmRenderer: async (renderer) => {
      events.push(`prewarm:${renderer.id}`);
    },
    validateRenderer: (renderer) => {
      events.push(`validate:${renderer.id}`);
    },
    commit: (renderer, next) => {
      if (renderer.stopped) throw new Error('cannot commit a stopped renderer');
      events.push(`commit:${renderer.id}:${next.graphicsPreset}`);
      current = renderer;
      settings = next;
    },
    suspendEntryDiagnostics: () => events.push('entry:suspend'),
    resumeEntryDiagnostics: (next) => events.push(`entry:resume:${next.graphicsPreset}`),
    markCrashPhase: (phase) => events.push(`crash:${phase}`),
    clearCrashMarker: () => events.push('crash:clear'),
    isContextFailure: (error) => error instanceof Error && error.message === 'context-lost',
    showFatalReload: () => events.push('fatal'),
    ...over,
  };
  return {
    coordinator: new GraphicsRebuildCoordinator(deps),
    events,
    current: () => current,
    settings: () => settings,
  };
}

describe('GraphicsRebuildCoordinator', () => {
  it('accepts string-valued profile settings in coordinator snapshots', () => {
    expectTypeOf<{
      graphicsPreset: string;
      effectsQuality: number;
      dynamicShadows: boolean;
    }>().toMatchTypeOf<GraphicsRebuildSettings>();
  });

  it('fails preflight before pausing or showing the curtain', async () => {
    const problem = new Error('WEBGL_lose_context unavailable');
    const f = fixture({
      preflightContext: () => {
        throw problem;
      },
    });

    await expect(f.coordinator.rebuild(TARGET)).resolves.toEqual({
      status: 'rolled-back',
      cause: problem,
    });
    expect(f.events).toEqual([]);
    expect(f.current().id).toBe('old');
  });

  it('paints two opaque frames, prepares assets before teardown, and commits after validation', async () => {
    const f = fixture();

    await expect(f.coordinator.rebuild(TARGET)).resolves.toEqual({ status: 'applied' });

    expect(f.events).toEqual([
      'context:preflight',
      'pause:true',
      'input:reset',
      'input:neutral',
      'curtain:show',
      'curtain:paint',
      'curtain:paint',
      'entry:suspend',
      'crash:starting',
      'assets',
      'crash:assets-prepared',
      'aux:reset',
      'context:capture:old',
      'shutdown:old',
      'crash:renderer-stopped',
      'recycle:context:old',
      'activate:4',
      'resources:4',
      'build:4:context:old',
      'crash:candidate-built',
      'current:build-1',
      'neighbors:build-1',
      'prewarm:build-1',
      'validate:build-1',
      'commit:build-1:4',
      'crash:clear',
      'entry:resume:4',
      'curtain:hide',
      'pause:false',
    ]);
    expect(f.current().id).toBe('build-1');
    expect(f.settings()).toBe(TARGET);
  });

  it('is single-flight while target preparation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fixture({ prepareTargetAssets: () => pending });

    const first = f.coordinator.rebuild(TARGET);
    const second = f.coordinator.rebuild({ graphicsPreset: 1, terrainDetail: 1 });
    expect(second).toBe(first);
    release();
    await expect(first).resolves.toEqual({ status: 'applied' });
  });

  it('keeps the old renderer alive when target asset preparation fails', async () => {
    const problem = new Error('asset failed');
    const f = fixture({
      prepareTargetAssets: async () => {
        throw problem;
      },
    });

    await expect(f.coordinator.rebuild(TARGET)).resolves.toEqual({
      status: 'rolled-back',
      cause: problem,
    });
    expect(f.events).not.toContain('shutdown:old');
    expect(f.current().id).toBe('old');
    expect(f.settings()).toBe(OLD);
  });

  it('restores auxiliary renderers when the second reset throws after the first teardown', async () => {
    const problem = new Error('portrait reset failed');
    let resets = 0;
    const f = fixture({
      resetAuxiliaryRenderers: () => {
        resets++;
        resets++;
        throw problem;
      },
    });

    await expect(f.coordinator.rebuild(TARGET)).resolves.toEqual({
      status: 'rolled-back',
      cause: problem,
    });
    expect(resets).toBe(2);
    expect(f.events).toContain('commit:old:3');
    expect(f.events).not.toContain('shutdown:old');
    expect(f.current().id).toBe('old');
  });

  it('rebuilds the old profile when shutdown rejects after the renderer became unusable', async () => {
    const problem = new Error('shutdown disposal failed');
    let stoppedRendererId: string | null = null;
    const f = fixture({
      shutdownRenderer: async (renderer) => {
        stoppedRendererId = renderer.id;
        renderer.stopped = true;
        throw problem;
      },
    });

    await expect(f.coordinator.rebuild(TARGET)).resolves.toEqual({
      status: 'rolled-back',
      cause: problem,
    });
    expect(stoppedRendererId).toBe('old');
    expect(f.events).toContain('context:capture:old');
    expect(f.events).toContain('recycle:context:old');
    expect(f.events).toContain('activate:3');
    expect(f.events).toContain('build:3:context:old');
    expect(f.events).toContain('commit:build-1:3');
    expect(f.current().id).toBe('build-1');
    expect(f.settings()).toBe(OLD);
  });

  it('rebuilds and rebinds the old profile after a candidate prewarm failure', async () => {
    const problem = new Error('prewarm failed');
    let prewarms = 0;
    const f = fixture({
      prewarmRenderer: async () => {
        if (prewarms++ === 0) throw problem;
      },
    });

    await expect(f.coordinator.rebuild(TARGET)).resolves.toEqual({
      status: 'rolled-back',
      cause: problem,
    });
    expect(f.events).toContain('shutdown:build-1');
    expect(f.events).toContain('recycle:context:build-1');
    expect(f.events).toContain('activate:3');
    expect(f.events).toContain('build:3:context:build-1');
    expect(f.events).toContain('commit:build-2:3');
    expect(f.current().id).toBe('build-2');
    expect(f.settings()).toBe(OLD);
  });

  it('uses the fatal Reload arm for a context failure without publishing the target', async () => {
    const problem = new Error('context-lost');
    const f = fixture({
      buildRenderer: async () => {
        throw problem;
      },
    });

    await expect(f.coordinator.rebuild(TARGET)).resolves.toEqual({
      status: 'fatal',
      cause: problem,
    });
    expect(f.events).toContain('fatal');
    expect(f.events).not.toContain('activate:3');
    expect(f.events).not.toContain('pause:false');
    expect(f.settings()).toBe(OLD);
  });

  it('uses the fatal Reload arm only after candidate and rollback both fail', async () => {
    let builds = 0;
    const f = fixture({
      buildRenderer: async () => {
        builds++;
        throw new Error(builds === 1 ? 'candidate' : 'rollback');
      },
    });

    const result = await f.coordinator.rebuild(TARGET);
    expect(result.status).toBe('fatal');
    expect(result.status === 'fatal' && result.cause).toBeInstanceOf(AggregateError);
    expect(f.events).toContain('activate:3');
    expect(f.events).toContain('fatal');
  });

  it('generation invalidation prevents a stale target from reaching teardown', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fixture({ prepareTargetAssets: () => pending });
    const result = f.coordinator.rebuild(TARGET);
    await Promise.resolve();
    await Promise.resolve();
    f.coordinator.invalidate();
    release();

    await expect(result).resolves.toMatchObject({ status: 'rolled-back' });
    expect(f.events).not.toContain('shutdown:old');
    expect(f.settings()).toBe(OLD);
  });
});
