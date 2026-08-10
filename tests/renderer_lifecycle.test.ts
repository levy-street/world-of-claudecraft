import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CharacterVisualPool } from '../src/render/characters/visual_pool';
import { Renderer } from '../src/render/renderer';

const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function slice(startText: string, endText: string): string {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Renderer lifecycle wiring', () => {
  it('keeps the legacy constructor and accepts an explicit WebGL2 context', () => {
    const constructorSource = slice(
      '  constructor(\n    private sim: IWorld,',
      '\n  private beginRendererShutdown(): void',
    );
    expect(constructorSource).toContain('options: RendererCreateOptions = {}');
    expect(constructorSource).toContain('context: options.context');
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
    const mountKeyEdge = slice(
      'if (e.mountKey !== v.lastMountKey) {',
      '\n      }\n\n      // per-ability windup orb',
    );
    // Covers dismount (mountKey -> ''), a live mount swap (mountKey -> a
    // different mountKey), and a fresh summon reusing this entity id
    // ('' -> mountKey): all three funnel through this one check, and
    // mountEngineReset is a safe no-op when there is no engine-mount state
    // to drop (an ordinary mount, or no prior mount at all).
    expect(mountKeyEdge).toContain('this.audioSink?.mountEngineReset(e.id)');
  });

  it("preloads a new mount's engine clips on the same mountKey-transition edge", () => {
    const mountKeyEdge = slice(
      'if (e.mountKey !== v.lastMountKey) {',
      '\n      }\n\n      // per-ability windup orb',
    );
    // Threading the preload through the same edge that resets state (rather
    // than lazily on the first movement frame) is what actually shrinks the
    // cold-first-ride silence window: the fetch+decode gets a head start.
    expect(mountKeyEdge).toContain('this.audioSink?.preloadMountEngine(e.mountKey)');
  });

  it("preloads an already-mounted entity's engine clips at view creation", () => {
    // The edge above only fires on a CHANGE, and lastMountKey is seeded from
    // the entity's current mountKey when the view is born, so a remote rider
    // entering interest range mid-ride and an already-mounted login both have
    // no edge to detect and would otherwise always hit the cold path.
    const createView = slice('private createView(e: Entity): void {', '\n  }\n\n  // Shared core');
    expect(createView).toContain("if (e.mountKey !== '') this.audioSink?.preloadMountEngine(");
  });

  it("holds an engine mount's audio phase while airborne instead of polling a stop", () => {
    const audioBlock = slice(
      '// --- spatial movement audio (self + others) --------------------------',
      "// Capture the flight's peak fall speed before the landing reset",
    );
    // The airborne branch must come before the "not moving" branch that
    // polls mountEngine with moving=false, and must not itself call
    // mountEngine at all: calling it with moving=false would run a full
    // winddown-then-windup cycle on every jump instead of holding steady.
    const airborneBranch = audioBlock.indexOf('logicallyMounted && airborne');
    const notMovingBranch = audioBlock.indexOf(
      'logicallyMounted && !visuallyDead && !(st.sitting && !riderMounted)',
    );
    expect(airborneBranch).toBeGreaterThan(-1);
    expect(notMovingBranch).toBeGreaterThan(airborneBranch);
    const airborneBranchBody = audioBlock.slice(airborneBranch, notMovingBranch);
    expect(airborneBranchBody).not.toContain('sink.mountEngine(');
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
