import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
    expect(disposal).toContain('for (const visual of pool) visual.dispose()');
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
});
