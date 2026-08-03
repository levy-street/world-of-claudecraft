import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
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
    expect(disposal).toContain('for (const visual of pool) bestEffort(() => visual.dispose())');
    expect(disposal).toContain('this.objectPool.clear()');
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
    renderer.visualPool = new Map([['player', [{ dispose: () => events.push('pool:dispose') }]]]);
    renderer.objectPool = new Map();
    renderer.clickTargets = [];
    renderer.gatherNodeMeshes = [];
    renderer.viewLights = [];
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
