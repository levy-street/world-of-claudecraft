import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CharacterVisualPool } from '../src/render/characters/visual_pool';
import { makeQuestObjectGate } from '../src/render/quest_object_gate_core';
import { Renderer } from '../src/render/renderer';
import type { Entity, QuestProgress } from '../src/sim/types';

const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
// The mount transition FX moved out of the renderer's entity sweep when the
// rideable-mount lifecycle was extracted (the renderer is under a line
// ratchet). The guarantee these tests encode is unchanged, so they follow the
// code rather than pinning the file it used to live in.
const mountAudioSource = readFileSync(
  new URL('../src/render/ridden_mount_audio.ts', import.meta.url),
  'utf8',
);
const mountLifecycleSource = readFileSync(
  new URL('../src/render/mount_lifecycle.ts', import.meta.url),
  'utf8',
);

function sliceIn(src: string, startText: string, endText: string): string {
  const start = src.indexOf(startText);
  const end = src.indexOf(endText, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

function slice(startText: string, endText: string): string {
  return sliceIn(source, startText, endText);
}

describe('Renderer lifecycle wiring', () => {
  it('does not recreate a quest-hidden required target on successive frames', () => {
    const player = {
      id: 1,
      kind: 'player',
      targetId: 2,
      templateId: '',
      pos: { x: 0, y: 0, z: 0 },
    } as Entity;
    const hiddenTarget = {
      id: 2,
      kind: 'object',
      targetId: null,
      templateId: 'ground_supply_crate',
      objectItemId: 'supply_crate',
      pos: { x: 1, y: 0, z: 0 },
    } as Entity;
    const visibleTarget = {
      ...hiddenTarget,
      id: 3,
      kind: 'mob',
      templateId: 'training_dummy',
      objectItemId: null,
    } as Entity;
    const entities = new Map([
      [player.id, player],
      [hiddenTarget.id, hiddenTarget],
      [visibleTarget.id, visibleTarget],
    ]);
    const questLog = new Map<string, QuestProgress>();
    const views = new Map<number, object>([[player.id, {}]]);
    const createView = vi.fn((candidate: Entity) => views.set(candidate.id, {}));
    const canAttempt = vi.fn(() => true);
    const renderer = Object.create(Renderer.prototype) as Record<string, unknown> & {
      createRequiredViews(player: Entity, createdViewTypes: string[]): number;
    };
    renderer.sim = { entities, questLog };
    renderer.views = views;
    renderer.questObjectHidden = makeQuestObjectGate({});
    renderer.viewCreateRetry = { canAttempt };
    renderer.createView = createView;

    const hiddenFrames = Array.from({ length: 3 }, () => renderer.createRequiredViews(player, []));
    expect(hiddenFrames).toEqual([0, 0, 0]);
    expect(views.has(hiddenTarget.id)).toBe(false);
    expect(createView).not.toHaveBeenCalled();
    expect(canAttempt).not.toHaveBeenCalled();

    player.targetId = visibleTarget.id;
    const visibleFrames = Array.from({ length: 3 }, () => renderer.createRequiredViews(player, []));
    expect(visibleFrames).toEqual([1, 0, 0]);
    expect(createView).toHaveBeenCalledOnce();
    expect(createView).toHaveBeenCalledWith(visibleTarget);
  });

  it('keeps the legacy constructor and accepts an explicit WebGL2 context', () => {
    const constructorSource = slice(
      '  constructor(\n    private sim: IWorld,',
      '\n  private beginRendererShutdown(): void',
    );
    expect(constructorSource).toContain('options: RendererCreateOptions = {}');
    // The context is created by the game and handed to three
    // (src/render/webgl_context_fallback.ts); a supplied one skips the fallback.
    expect(constructorSource).toContain(
      'const createdContext = options.context ?? createRendererGlContext(canvas) ?? undefined',
    );
    expect(constructorSource).toContain('createRendererWebGL(canvas, createdContext)');
    expect(constructorSource).toContain('this.webgl.getContext() !== options.context');
    expect(constructorSource).toContain('if (options.initializeGfx !== false)');
    expect(constructorSource).toContain('initGfxTier(this.webgl)');
  });

  it('removes stored listeners and unregisters page-teardown tracking', () => {
    const shutdown = slice(
      '  private beginRendererShutdown(): void',
      '\n  private disposeRendererResources(): void',
    );
    expect(shutdown).toContain(
      "this.canvas.removeEventListener('webglcontextlost', this.onWebGLContextLost)",
    );
    expect(shutdown).toContain(
      "this.canvas.removeEventListener('webglcontextrestored', this.onWebGLContextRestored)",
    );
    expect(shutdown).toContain(
      "window.removeEventListener('orientationchange', this.onOrientationChange)",
    );
    expect(shutdown).toContain('this.onZonePrepared = null');
    expect(shutdown).toContain('this.audioSink = null');
    expect(shutdown).toContain('this.unregisterWebGLContext?.()');
  });

  it('quiesces once, disposes the old Three wrapper, and returns its same pair', () => {
    const shutdown = slice(
      '  shutdown(): Promise<RecycledRendererContext>',
      '\n  private measureViewport():',
    );
    expect(shutdown).toContain('if (this.shutdownTask) return this.shutdownTask');
    expect(shutdown).toContain('canvas: this.canvas');
    expect(shutdown).toContain('context: this.webgl.getContext() as WebGL2RenderingContext');
    expect(shutdown).toContain('this.backgroundGpuWork.shutdown');
    expect(shutdown.indexOf('await Promise.allSettled')).toBeLessThan(
      shutdown.indexOf('this.disposeRendererResources()'),
    );

    const disposal = slice(
      '  private disposeRendererResources(): void',
      '\n  /**\n   * Quiesce this generation',
    );
    expect(disposal).toContain('this.post?.dispose()');
    expect(disposal).toContain('this.chatBubbles.clear()');
    expect(disposal).toContain('this.removeView(id, true)');
    expect(disposal).toContain(
      'for (const visual of this.visualPool.drain()) bestEffort(() => visual.dispose())',
    );
    expect(disposal).toContain('this.objectPool.clear()');
    expect(disposal).toContain('this.nameplatePainter?.dispose()');
    expect(disposal).toContain('this.nameplateLayer.replaceChildren()');
    expect(disposal).toContain('this.scene.clear()');
    expect(disposal).toContain('webgl.setAnimationLoop(null)');
    expect(disposal).toContain('webgl.dispose()');
    expect(disposal).not.toContain('forceContextLoss');
  });

  it('preflights a live WebGL2 context and the required loss extension', () => {
    const preflight = slice(
      '  preflightContextRecycle(): void',
      '\n  shutdown(): Promise<RecycledRendererContext>',
    );
    expect(preflight).toContain('this.webgl.capabilities.isWebGL2');
    expect(preflight).toContain('preflightWebGL2ContextRecycle(context)');
  });

  it('cleans partial construction before rethrowing', () => {
    const constructorSource = slice(
      '  constructor(\n    private sim: IWorld,',
      '\n  private beginRendererShutdown(): void',
    );
    const catchAt = constructorSource.lastIndexOf('} catch (error) {');
    expect(catchAt).toBeGreaterThan(-1);
    const cleanup = constructorSource.slice(catchAt);
    expect(cleanup).toContain('this.beginRendererShutdown()');
    expect(cleanup).toContain('this.disposeRendererResources()');
    expect(cleanup).toContain('throw error');
  });

  it('resets an entity engine-mount audio state on every mountKey transition', () => {
    const mountKeyEdge = sliceIn(mountLifecycleSource, 'if (mountChanged) {', '\n  }');
    // Covers dismount (mountKey -> ''), a live mount swap (mountKey -> a
    // different mountKey), and a fresh summon reusing this entity id
    // ('' -> mountKey): all three funnel through this one check, and
    // mountEngineReset is a safe no-op when there is no engine-mount state
    // to drop (an ordinary mount, or no prior mount at all).
    expect(mountKeyEdge).toContain('x.engineReset()');
    // ...and the renderer still hands it the real audio sink.
    expect(source).toContain('engineReset: () => this.audioSink?.mountEngineReset(e.id)');
  });

  it('resets engine state BEFORE arming the summon, not after', () => {
    const mountKeyEdge = sliceIn(mountLifecycleSource, 'if (mountChanged) {', '\n  }');
    const resetAt = mountKeyEdge.indexOf('x.engineReset()');
    const summonAt = mountKeyEdge.indexOf('x.summonCall()');
    expect(resetAt).toBeGreaterThan(-1);
    expect(summonAt).toBeGreaterThan(-1);
    // Order is load-bearing, not cosmetic. mountSummon ARMS the per-entity idle
    // gate that holds the parked idle loop until the summon take has played;
    // mountEngineReset CLEARS that gate. With the reset second, both ran on the
    // one frame and the gate was wiped as soon as it was set, so the idle became
    // audible the instant the mount appeared. It only reproduced on a RESUMMON:
    // the first time round the idle's buffer is still decoding, so it arrived
    // late enough to pass for a handoff.
    expect(
      resetAt,
      "mountEngineReset must run before mountSummon, or the summon's idle gate is cleared on the same frame it is armed",
    ).toBeLessThan(summonAt);
  });

  it("preloads a new mount's engine clips on the same mountKey-transition edge", () => {
    const mountKeyEdge = sliceIn(mountLifecycleSource, 'if (mountChanged) {', '\n  }');
    // Threading the preload through the same edge that resets state (rather
    // than lazily on the first movement frame) is what actually shrinks the
    // cold-first-ride silence window: the fetch+decode gets a head start.
    expect(mountKeyEdge).toContain('x.preloadEngine(x.mountLook)');
    expect(source).toContain(
      'preloadEngine: (key: string) => this.audioSink?.preloadMountEngine(key)',
    );
  });

  it('starts warming the summon target on the cast edge even when its call pose is gated', () => {
    const summonEdge = sliceIn(
      mountLifecycleSource,
      "if (x.mountCasting && !v.wasMountCasting && x.mountCastKey !== '') {",
      '\n  }',
    );
    const preloadAt = summonEdge.indexOf('x.preloadEngine(x.mountLook)');
    const poseGateAt = summonEdge.indexOf('x.poseAllowed');

    expect(preloadAt).toBeGreaterThan(-1);
    expect(poseGateAt).toBeGreaterThan(preloadAt);
  });

  it('runs mount transition reset and prewarm before spatial movement audio', () => {
    const transitionAt = source.indexOf('v.wasMountCasting = syncMountTransitionFx(v, {');
    const movementAudioAt = source.indexOf(
      '// --- spatial movement audio (self + others) --------------------------',
    );

    expect(transitionAt).toBeGreaterThan(-1);
    expect(movementAudioAt).toBeGreaterThan(transitionAt);
    const transitionBlock = source.slice(transitionAt, movementAudioAt);
    expect(transitionBlock).toContain('mountCastKey: e.mountCastKey');
    expect(transitionBlock).toContain('engineReset: () => this.audioSink?.mountEngineReset(e.id)');
    expect(transitionBlock).toContain(
      'preloadEngine: (key: string) => this.audioSink?.preloadMountEngine(key)',
    );
  });

  it('pins the mount gait cadence and all three stride-accumulator callers', () => {
    expect(mountAudioSource).toContain('const MOUNT_STRIDE_RUN = 5.8;');
    expect(source).toContain('strideHit(v, loco.speed, dt, SWIM_STRIDE)');
    expect(mountAudioSource).toContain('strideHit(state, speed, dt, MOUNT_STRIDE_RUN)');
    expect(source).toContain(
      'strideHit(v, loco.speed, dt, running ? FOOT_STRIDE_RUN : FOOT_STRIDE_WALK)',
    );
  });

  it('forwards the resolved skin look into run, jump, and landing dispatch', () => {
    expect(source).toContain('const mountLook = mountPresentationKey(e.mountKey, e.mountSkinId);');
    expect(source).toMatch(/updateRiddenMountAudio\(\s*sink,\s*v,\s*mountLook,\s*e.id,/);
    expect(source).toContain("sink.movement('jump', ax, ay, az, isSelf, mountLook || undefined)");
    expect(source).toContain("sink.movement('land', ax, ay, az, isSelf, mountLook || undefined)");
    expect(mountAudioSource).toContain('sink.mountRun(x, y, z, look, surfaceAt(x, z, y), self)');
  });

  it("preloads an already-mounted entity's engine clips at view creation", () => {
    // The edge above only fires on a CHANGE, and lastMountKey is seeded from
    // the entity's current mountKey when the view is born, so a remote rider
    // entering interest range mid-ride and an already-mounted login both have
    // no edge to detect and would otherwise always hit the cold path.
    const createView = slice(
      'private createView(e: Entity, opts?: AssembleOptions, requiredForEntry = false): void {',
      '\n  }\n\n  // Shared core',
    );
    expect(createView).toContain("if (look !== '') this.audioSink?.preloadMountEngine(look);");
  });

  it('keeps the airborne engine poll limited to the spaceship or an idling engine', () => {
    const branch = sliceIn(mountAudioSource, 'if (airborne) {', '} else if (moving) {');
    expect(branch).toContain("if (look === 'goblin_rocket_sled' || sink.mountEngineIdles(look)) {");
    expect(branch).toContain(
      'sink.mountEngine(x, y, z, look, moving, id, backwards, true, state.mountPivot)',
    );
    expect(branch.match(/sink.mountEngine\(/g)).toHaveLength(1);
    expect(branch).not.toContain('sink.mountEngineReset(');
  });

  it('tears down a still-active engine-mount loop when the rider exits the move-audio range gate', () => {
    const audioBlock = slice(
      '// --- spatial movement audio (self + others) --------------------------',
      "// Capture the flight's peak fall speed before the landing reset",
    );
    // SFX_MOVE_RANGE_SQ (42yd) sits inside the panner's own audible falloff
    // (MAX_DISTANCE, 46yd), and every other cue gated by it is a one-shot;
    // an engine mount's loop is not, so exiting the gate while still
    // mounted must explicitly stop it rather than silently freezing it.
    expect(audioBlock).toContain('} else if (sink && logicallyMounted) {');
    const rangeGateElse = audioBlock.slice(
      audioBlock.indexOf('} else if (sink && logicallyMounted) {'),
    );
    expect(rangeGateElse).toContain('sink.mountEngineReset(e.id)');
  });

  it('returns the recyclable pair and finishes terminal cleanup after a view disposal throws', async () => {
    const events: string[] = [];
    const canvas = {} as HTMLCanvasElement;
    const context = {} as WebGL2RenderingContext;
    const renderer = Object.create(Renderer.prototype) as Record<string, unknown> & {
      shutdown(): Promise<{ canvas: HTMLCanvasElement; context: WebGL2RenderingContext }>;
    };
    renderer.shutdownTask = null;
    renderer.rendererResourcesDisposed = false;
    renderer.canvas = canvas;
    renderer.webgl = {
      getContext: () => context,
      setAnimationLoop: (loop: unknown) => events.push(`loop:${String(loop)}`),
      dispose: () => events.push('webgl:dispose'),
    };
    renderer.pendingZonePrepares = new Map();
    renderer.pendingZonePrewarms = new Map();
    renderer.textureUploadTaskSet = new Set();
    renderer.backgroundGpuWork = { shutdown: async () => events.push('queue:shutdown') };
    renderer.beginRendererShutdown = () => events.push('shutdown:begin');
    renderer.post = null;
    renderer.prewarmRenderTarget = null;
    renderer.pmremGenerator = null;
    renderer.envRTs = new Map();
    renderer.prewarmDepthMaterials = new Map();
    renderer.chatBubbles = new Map();
    renderer.views = new Map([[17, {}]]);
    renderer.removeView = () => {
      events.push('view:dispose');
      throw new Error('injected view disposal failure');
    };
    const visualPool = new CharacterVisualPool<{ dispose: () => void }>();
    visualPool.store('player', { dispose: () => events.push('pool:dispose') }, 10);
    renderer.visualPool = visualPool;
    renderer.objectPool = new Map();
    // The deferred weapon-skin apply queue is a teardown participant too: a
    // pending application must never survive into the next context.
    renderer.weaponSkinApplies = { clear: () => events.push('weaponskins:clear') };
    renderer.clickTargets = [];
    renderer.gatherNodeMeshes = [];
    renderer.viewLights = [];
    renderer.nameplatePainter = { dispose: () => events.push('nameplates:dispose') };
    renderer.nameplateLayer = {
      replaceChildren: () => events.push('nameplates:clear'),
    };
    renderer.travelSpeedFx = { dispose: () => events.push('travel:dispose') };
    renderer.scene = { clear: () => events.push('scene:clear') };
    const report = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(renderer.shutdown()).resolves.toEqual({ canvas, context });
    expect(events).toEqual([
      'shutdown:begin',
      'queue:shutdown',
      'view:dispose',
      'pool:dispose',
      'weaponskins:clear',
      'nameplates:dispose',
      'nameplates:clear',
      'travel:dispose',
      'scene:clear',
      'loop:null',
      'webgl:dispose',
    ]);
    expect(report).toHaveBeenCalledWith(
      'Renderer terminal cleanup completed with failures',
      expect.arrayContaining([expect.any(Error)]),
    );
    report.mockRestore();
  });
});
