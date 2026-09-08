import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import {
  prepareGraphicsProfileAssets,
  resetGraphicsProfileDerivedCaches,
} from '../src/render/assets/graphics_profile';
import type { SimEvent } from '../src/sim/types';
import { StudioRuntime } from '../src/vfx_studio/runtime';
import { DEFAULT_STUDIO_CONFIG } from '../src/vfx_studio/session';

vi.mock('../src/vfx_studio/prepare_ability_kit', () => ({
  prepareStudioAbilityKit: vi.fn(async () => {}),
}));
vi.mock('../src/vfx_studio/prepare_views', () => ({ prepareStudioViews: vi.fn(async () => {}) }));
vi.mock('../src/vfx_studio/prepare_assets', () => ({ prepareStudioAssets: vi.fn(async () => {}) }));

const boundary = vi.hoisted(() => ({
  lose: vi.fn(),
  restore: vi.fn(),
  ready: vi.fn(async () => {}),
  prewarm: vi.fn(async () => {}),
  forms: vi.fn(async () => {}),
  recycle: vi.fn(),
  renderers: [] as {
    sync: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
    handleEvent: ReturnType<typeof vi.fn>;
    punchFov: ReturnType<typeof vi.fn>;
    abilityVfxFx: {
      onPresentationMoment:
        | ((id: string, phase: 'release' | 'impact', sourceId: number) => void)
        | null;
    };
  }[],
  frame: null as FrameRequestCallback | null,
  now: 0,
}));
vi.mock('../src/game/sfx', () => ({
  sfx: {
    init: vi.fn(),
    setVolume: vi.fn(),
    playAt: vi.fn(),
    loop: vi.fn(),
    unloop: vi.fn(),
    preload: vi.fn(),
  },
}));
vi.mock('../src/vfx_studio/graphics', () => ({
  createStudioGraphicsContext: vi.fn(() => ({
    context: { isContextLost: () => false, getExtension: () => ({ loseContext: boundary.lose }) },
    capabilities: {
      softwareRendering: false,
      gpuRenderer: 'test',
      platform: 'desktop',
      nativeApp: false,
    },
  })),
}));
vi.mock('../src/render/assets/graphics_profile', () => ({
  prepareGraphicsProfileAssets: vi.fn(async () => {}),
  resetGraphicsProfileDerivedCaches: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  beginDeferredPreloads: vi.fn(),
  assetsReady: boundary.ready,
}));
vi.mock('../src/render/sky', () => ({ ensureSkyAssetsAt: vi.fn(async () => {}) }));
vi.mock('../src/render/characters', () => ({
  setModularLookProvider: vi.fn(),
  npcLookFor: vi.fn(),
}));
vi.mock('../src/render/characters/modular', () => ({ classArmorSet: vi.fn() }));
vi.mock('../src/render/characters/assets', () => ({
  preloadTrainingDummyAssets: vi.fn(async () => {}),
}));
vi.mock('../src/render/context_recycle', () => ({ recycleWebGL2Context: boundary.recycle }));
vi.mock('../src/render/renderer', () => ({
  Renderer: class {
    views = new Map();
    abilityVfxFx = {
      onPresentationMoment: null as
        | ((id: string, phase: 'release' | 'impact', sourceId: number) => void)
        | null,
    };
    sync = vi.fn();
    setAbilityPresentationListener(listener: typeof this.abilityVfxFx.onPresentationMoment) {
      this.abilityVfxFx.onPresentationMoment = listener;
    }
    setAudioSink = vi.fn();
    setBrightness = vi.fn();
    setCameraFov = vi.fn();
    setRenderScale = vi.fn();
    setWaterRipples = vi.fn();
    setStudioLighting = vi.fn();
    resetStudioPresentation = vi.fn();
    prepareZoneAt = vi.fn(async () => {});
    armEntryDetailHorizon = vi.fn();
    prewarmInitialScene = boundary.prewarm;
    prepareStudioActorForms = boundary.forms;
    handleEvent = vi.fn();
    punchFov = vi.fn();
    shutdown = vi.fn(async () => ({
      canvas: {},
      context: {
        isContextLost: () => false,
        getExtension: () => ({ loseContext: boundary.lose, restoreContext: boundary.restore }),
      },
    }));
    constructor(
      _sim: unknown,
      _canvas: unknown,
      _plates: unknown,
      readonly options: { graphicsPreferences?: { graphicsPreset: number } },
    ) {
      boundary.renderers.push(this);
    }
  },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  boundary.renderers.length = 0;
  boundary.now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => boundary.now);
  boundary.lose.mockClear();
  boundary.ready.mockReset().mockResolvedValue();
  boundary.prewarm.mockReset().mockResolvedValue();
  boundary.forms.mockReset().mockResolvedValue();
  boundary.recycle.mockReset().mockImplementation(async (value) => value);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      boundary.frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frame(dt = 50): void {
  boundary.now += dt;
  boundary.frame?.(boundary.now);
}

describe('studio renderer ownership', () => {
  it('warms signature audio only for the current kit after audio is enabled', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    expect(sfx.preload).not.toHaveBeenCalled();
    runtime.setAudio(true);
    expect(sfx.preload).toHaveBeenCalledWith('cast_masterwork_tide');
    expect(sfx.preload).toHaveBeenCalledWith('impact_masterwork_tide');
    expect(sfx.preload).not.toHaveBeenCalledWith('cast_masterwork_pyre');
    vi.mocked(sfx.preload).mockClear();
    await runtime.configure({ ...DEFAULT_STUDIO_CONFIG, cls: 'mage', spec: 'fire' });
    expect(sfx.preload).toHaveBeenCalledWith('cast_masterwork_pyre');
    expect(sfx.preload).toHaveBeenCalledWith('impact_masterwork_pyre');
    expect(sfx.preload).not.toHaveBeenCalledWith('cast_masterwork_tide');
    runtime.setAudio(false);
    vi.mocked(sfx.preload).mockClear();
    await runtime.configure(DEFAULT_STUDIO_CONFIG);
    expect(sfx.preload).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it('keeps the warmed renderer, camera and playback speed across class and build changes', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    const renderer = runtime.renderer!;
    renderer.camYaw = 2.3;
    renderer.camPitch = 0.4;
    renderer.camDist = 21;
    runtime.playback.speed = 0.25;
    runtime.pause();
    const prepare = vi.mocked(prepareGraphicsProfileAssets);
    prepare.mockClear();
    await runtime.configure({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' });
    expect(runtime.renderer).toBe(renderer);
    expect(runtime.session?.sim.player.templateId).toBe('warrior');
    expect(renderer.camYaw).toBe(2.3);
    expect(renderer.camDist).toBe(21);
    expect(runtime.playback.speed).toBe(0.25);
    expect(runtime.playback.paused).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(renderer.shutdown).not.toHaveBeenCalled();
    expect(renderer.resetStudioPresentation).toHaveBeenCalledOnce();
    await runtime.configure({ ...DEFAULT_STUDIO_CONFIG, spec: 'elemental' });
    expect(runtime.renderer).toBe(renderer);
    expect(prepare).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it('discards superseded build choices before preparing a new take', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    const renderer = runtime.renderer;
    await Promise.all([
      runtime.configure({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' }),
      runtime.configure({ ...DEFAULT_STUDIO_CONFIG, cls: 'mage', spec: 'fire' }),
      runtime.configure({ ...DEFAULT_STUDIO_CONFIG, cls: 'rogue', spec: 'combat' }),
    ]);
    expect(runtime.renderer).toBe(renderer);
    expect(runtime.session?.sim.player.templateId).toBe('rogue');
    expect(renderer?.resetStudioPresentation).toHaveBeenCalledOnce();
    await runtime.dispose();
  });
  it('retries preparation after a renderer failed before its first ready frame', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    boundary.prewarm.mockRejectedValueOnce(new Error('preparation failed'));
    await expect(runtime.load(DEFAULT_STUDIO_CONFIG)).rejects.toThrow('preparation failed');
    expect(runtime.renderer).not.toBeNull();
    expect(runtime.ready).toBe(false);
    await runtime.configure(DEFAULT_STUDIO_CONFIG);
    expect(boundary.renderers).toHaveLength(2);
    expect(boundary.prewarm).toHaveBeenCalledTimes(2);
    expect(runtime.ready).toBe(true);
    await runtime.dispose();
  });
  it('stops replay cast loops at the endpoint and redraws a frozen camera on request', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    runtime.setAudio(true);
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    runtime.command({
      kind: 'cast',
      abilityId: 'ghost_wolf',
      targetId: runtime.session!.sim.player.id,
    });
    frame();
    const commands = runtime.session!.commands;
    vi.mocked(sfx.unloop).mockClear();
    await runtime.load(DEFAULT_STUDIO_CONFIG, commands, 1);
    frame();
    expect(runtime.playback.paused).toBe(true);
    expect(sfx.unloop).toHaveBeenCalledWith(`cast:${runtime.session!.sim.player.id}`, 0.05);
    const renderer = boundary.renderers.at(-1)!;
    renderer.sync.mockClear();
    runtime.requestDraw();
    frame();
    expect(renderer.sync).toHaveBeenCalledWith(1, 0, null);
    await runtime.dispose();
  });
  it('prepares profile assets before constructing any scene consumers', async () => {
    const prepared = deferred();
    vi.mocked(prepareGraphicsProfileAssets).mockImplementationOnce(() => prepared.promise);
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    const load = runtime.load({ ...DEFAULT_STUDIO_CONFIG, graphicsPreset: 4 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(boundary.renderers).toHaveLength(0);
    prepared.resolve();
    await load;
    expect(boundary.renderers).toHaveLength(1);
    await runtime.dispose();
  });
  it('passes first-load and superseding graphics choices before content construction', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load({
      ...{ ...DEFAULT_STUDIO_CONFIG, environment: 'world' as const },
      graphicsPreset: 4,
    });
    const release = deferred();
    boundary.renderers[0].shutdown.mockImplementation(async () => {
      await release.promise;
      return {
        context: {
          isContextLost: () => false,
          getExtension: () => ({ loseContext: boundary.lose }),
        },
      };
    });
    const older = runtime.load({
      ...{ ...DEFAULT_STUDIO_CONFIG, environment: 'world' as const },
      graphicsPreset: 1,
    });
    await Promise.resolve();
    await Promise.resolve();
    const latest = runtime.load({
      ...{ ...DEFAULT_STUDIO_CONFIG, environment: 'world' as const },
      graphicsPreset: 3,
    });
    release.resolve();
    await Promise.all([older, latest]);
    expect(runtime.session?.config.graphicsPreset).toBe(3);
    expect(vi.mocked(prepareGraphicsProfileAssets).mock.calls.at(-1)?.[0].tier).toBe('high');
    await runtime.dispose();
  });
  it('reloads released sources before clearing the retiring profile templates', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load({
      ...{ ...DEFAULT_STUDIO_CONFIG, environment: 'world' as const },
      graphicsPreset: 3,
    });
    const prepare = vi.mocked(prepareGraphicsProfileAssets);
    const reset = vi.mocked(resetGraphicsProfileDerivedCaches);
    prepare.mockClear();
    reset.mockClear();
    const ready = deferred();
    prepare.mockImplementationOnce(() => ready.promise);
    const loading = runtime.load({
      ...{ ...DEFAULT_STUDIO_CONFIG, environment: 'world' as const },
      graphicsPreset: 1,
    });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(reset).not.toHaveBeenCalled();
    ready.resolve();
    await loading;
    expect(reset).toHaveBeenCalledOnce();
    expect(reset.mock.invocationCallOrder[0]).toBeGreaterThan(prepare.mock.invocationCallOrder[0]);
    await runtime.dispose();
  });
  it('forwards actual cast and simulation events to the renderer exactly once', async () => {
    const events: import('../src/sim/types').SimEvent[] = [];
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      (rows) => events.push(...rows),
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    runtime.command({
      kind: 'cast',
      abilityId: 'ghost_wolf',
      targetId: runtime.session!.sim.player.id,
    });
    for (let i = 0; i < 45; i++) frame();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'castStart', ability: 'ghost_wolf' }),
    );
    expect(events.some((event) => event.type === 'spellfx')).toBe(true);
    expect(boundary.renderers[0].handleEvent.mock.calls.map((call) => call[0])).toEqual(events);
    await runtime.dispose();
  });
  it('keeps the captured frame frozen across animation callbacks', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    frame();
    const renderer = boundary.renderers[0];
    expect(runtime.session?.ticks).toBe(1);
    renderer.sync.mockClear();
    runtime.pause();
    for (let i = 0; i < 5; i++) frame();
    expect(renderer.sync).not.toHaveBeenCalled();
    expect(runtime.session?.ticks).toBe(1);
    runtime.step();
    expect(renderer.sync).toHaveBeenCalledTimes(1);
    frame();
    expect(renderer.sync).toHaveBeenCalledTimes(1);
    runtime.pause();
    runtime.command({
      kind: 'cast',
      abilityId: 'ghost_wolf',
      targetId: runtime.session!.sim.player.id,
    });
    renderer.sync.mockClear();
    runtime.pause();
    frame();
    expect(renderer.sync).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it.each([0, 10])(
    'preserves endpoint commands and supports repeated replay at tick %i',
    async (endTick) => {
      const runtime = new StudioRuntime(
        {} as HTMLCanvasElement,
        {} as HTMLDivElement,
        () => {},
        () => {},
      );
      await runtime.load(DEFAULT_STUDIO_CONFIG);
      for (let i = 0; i < endTick; i++) frame();
      runtime.command({
        kind: 'cast',
        abilityId: 'ghost_wolf',
        targetId: runtime.session!.sim.player.id,
      });
      const recording = runtime.session!.commands.map((row) => ({
        ...row,
        command: { ...row.command },
      }));
      const remaining = runtime.session!.sim.player.castRemaining;
      for (let take = 0; take < 2; take++) {
        await runtime.load(DEFAULT_STUDIO_CONFIG, runtime.session!.commands, endTick);
        runtime.playback.speed = 2;
        for (let i = 0; i < endTick + 2; i++) frame(100);
        expect(runtime.session?.ticks).toBe(endTick);
        expect(runtime.session?.commands).toEqual(recording);
        expect(runtime.session?.sim.player.castingAbility).toBe('ghost_wolf');
        expect(runtime.session?.sim.player.castRemaining).toBe(remaining);
        expect(runtime.playback.paused).toBe(true);
      }
      await runtime.dispose();
    },
  );
  it('holds an empty tick-zero replay without ticking the simulation', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG, [], 0);
    frame(100);
    expect(runtime.session?.ticks).toBe(0);
    expect(runtime.playback.paused).toBe(true);
    await runtime.dispose();
  });
  it('retains and releases a context when disposed during a reset recycle', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    const pending = deferred();
    boundary.recycle.mockImplementationOnce(async (value) => {
      await pending.promise;
      return value;
    });
    const reset = runtime.load(DEFAULT_STUDIO_CONFIG);
    await vi.waitFor(() => expect(boundary.recycle).toHaveBeenCalledTimes(1));
    const disposal = runtime.dispose();
    pending.resolve();
    await Promise.all([reset, disposal]);
    expect(boundary.renderers).toHaveLength(1);
    expect(boundary.renderers[0].shutdown).toHaveBeenCalledTimes(1);
    expect(boundary.lose).toHaveBeenCalledTimes(1);
    expect(runtime.ready).toBe(false);
  });
  it('restores a retained lost context before rebuilding after a failed reset', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    let lost = true;
    const context = {
      isContextLost: () => lost,
      getExtension: () => ({ loseContext: boundary.lose }),
    };
    boundary.renderers[0].shutdown.mockResolvedValue({ canvas: runtime.canvas, context });
    boundary.recycle.mockRejectedValueOnce(new Error('restore declined'));
    await expect(runtime.load(DEFAULT_STUDIO_CONFIG)).rejects.toThrow('restore declined');
    expect(runtime.ready).toBe(false);
    expect(boundary.renderers).toHaveLength(1);
    boundary.recycle.mockImplementationOnce(async (value) => {
      lost = false;
      return value;
    });
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    expect(boundary.recycle).toHaveBeenLastCalledWith({ canvas: runtime.canvas, context });
    expect(runtime.ready).toBe(true);
    expect(boundary.renderers).toHaveLength(2);
    await runtime.dispose();
  });
  it('releases a restored but unadopted context when asset loading is cancelled', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load({ ...DEFAULT_STUDIO_CONFIG, environment: 'world' as const });
    const pending = deferred();
    boundary.ready.mockImplementationOnce(() => pending.promise);
    const reset = runtime.load({ ...DEFAULT_STUDIO_CONFIG, environment: 'world' as const });
    await vi.waitFor(() => expect(boundary.ready).toHaveBeenCalledTimes(2));
    const disposal = runtime.dispose();
    pending.resolve();
    await Promise.all([reset, disposal]);
    expect(boundary.renderers).toHaveLength(1);
    expect(boundary.lose).toHaveBeenCalledTimes(1);
  });
  it('rejects commands during freeze and steps the real simulation exactly once', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    runtime.pause();
    expect(runtime.command({ kind: 'move', active: true })).toBe(false);
    expect(runtime.session!.commands).toHaveLength(0);
    runtime.step();
    expect(runtime.session!.ticks).toBe(1);
    expect(boundary.renderers[0].sync).toHaveBeenCalledWith(1, 0.05, null);
    await runtime.dispose();
  });
  it('excludes setup celebrations while forwarding real combat events', async () => {
    const seen = vi.fn(),
      runtime = new StudioRuntime({} as HTMLCanvasElement, {} as HTMLDivElement, () => {}, seen);
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    const emit = (runtime as unknown as { events(events: SimEvent[]): void }).events.bind(runtime);
    const combat = {
      type: 'spellfx',
      sourceId: 994,
      targetId: 999,
      ability: 'pyroblast',
      school: 'fire',
      fx: 'projectile',
    } as SimEvent;
    emit([
      { type: 'deedUnlocked', deedId: 'prog_first_steps', pid: 994 },
      { type: 'levelup', level: 20, pid: 994 },
      combat,
    ] as SimEvent[]);
    expect(boundary.renderers[0].handleEvent).toHaveBeenCalledExactlyOnceWith(combat);
    expect(seen).toHaveBeenLastCalledWith([combat]);
    await runtime.dispose();
  });
  it('waits for presentation contact, bounds camera response and redraws paused opt-out', async () => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    const emit = (runtime as unknown as { events(events: SimEvent[]): void }).events.bind(runtime);
    const event = {
      type: 'damage',
      sourceId: runtime.session!.sim.player.id,
      targetId: 999,
      ability: 'Early Grave',
      amount: 80,
      kind: 'hit',
      crit: false,
    } as SimEvent;
    const renderer = boundary.renderers[0];
    emit([event]);
    expect(renderer.punchFov).not.toHaveBeenCalled();
    runtime.cinematicResponse = true;
    emit([event, event]);
    expect(renderer.punchFov).not.toHaveBeenCalled();
    renderer.abilityVfxFx.onPresentationMoment?.(
      'execute',
      'impact',
      runtime.session!.sim.player.id,
    );
    renderer.abilityVfxFx.onPresentationMoment?.(
      'execute',
      'impact',
      runtime.session!.sim.player.id,
    );
    expect(renderer.punchFov).toHaveBeenCalledExactlyOnceWith(1.35);
    runtime.pause();
    const redraw = vi.spyOn(runtime, 'requestDraw');
    runtime.cinematicResponse = false;
    expect(redraw).toHaveBeenCalledOnce();
    runtime.cinematicResponse = true;
    await runtime.load(DEFAULT_STUDIO_CONFIG);
    boundary.renderers[1].abilityVfxFx.onPresentationMoment?.(
      'execute',
      'impact',
      runtime.session!.sim.player.id,
    );
    expect(boundary.renderers[1].punchFov).toHaveBeenCalledOnce();
    await runtime.dispose();
  });
});

it.each(['studio', 'world'] as const)(
  'prepares the selected actor forms before accepting %s casts',
  async (environment) => {
    const runtime = new StudioRuntime(
      {} as HTMLCanvasElement,
      {} as HTMLDivElement,
      () => {},
      () => {},
    );
    boundary.forms.mockImplementationOnce(async () => {
      expect(runtime.ready).toBe(false);
    });
    await runtime.load({ ...DEFAULT_STUDIO_CONFIG, cls: 'druid', environment });
    expect(boundary.forms).toHaveBeenCalledWith(
      runtime.session!.sim.player.id,
      'druid',
      expect.any(Function),
    );
    expect(runtime.ready).toBe(true);
    await runtime.dispose();
  },
);
