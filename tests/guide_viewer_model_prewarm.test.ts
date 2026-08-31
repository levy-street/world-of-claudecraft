import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { prewarmModelViewer } from '../src/guide/viewer/model_prewarm';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function prewarmFixture() {
  const events: string[] = [];
  const compile = deferred();
  const textures = [{ isTexture: true }, { isTexture: true }];
  const scene = {
    traverse(callback: (object: unknown) => void): void {
      callback({ material: { map: textures[0], normalMap: textures[1] } });
    },
  };
  const renderer = {
    compileAsync: vi.fn(async () => {
      events.push('compile');
      await compile.promise;
    }),
    initTexture: vi.fn((texture: unknown) => {
      events.push(`upload:${textures.indexOf(texture as (typeof textures)[number])}`);
    }),
  };
  return { compile, events, renderer, scene };
}

describe('Guide ModelViewer GPU prewarm', () => {
  it('links programs and uploads textures before touching linked program tables', async () => {
    const fixture = prewarmFixture();

    const warm = prewarmModelViewer(
      fixture.renderer as never,
      fixture.scene as never,
      {} as never,
      {
        isCancelled: () => false,
        yieldToMain: async () => undefined,
        touchPrograms: async () => {
          fixture.events.push('touch');
        },
      },
    );

    expect(fixture.events).toEqual(['compile']);
    fixture.compile.resolve();
    await warm;
    expect(fixture.events).toEqual(['compile', 'upload:0', 'upload:1', 'touch']);
  });

  it('does not upload into a context destroyed while programs link', async () => {
    const fixture = prewarmFixture();
    let cancelled = false;
    const warm = prewarmModelViewer(
      fixture.renderer as never,
      fixture.scene as never,
      {} as never,
      {
        isCancelled: () => cancelled,
        yieldToMain: async () => undefined,
        touchPrograms: async () => {
          fixture.events.push('touch');
        },
      },
    );

    cancelled = true;
    fixture.compile.resolve();
    await warm;

    expect(fixture.renderer.initTexture).not.toHaveBeenCalled();
    expect(fixture.events).not.toContain('touch');
  });

  it('keeps every viewer draw behind the completed prewarm', () => {
    const source = readFileSync(new URL('../src/guide/viewer/scene.ts', import.meta.url), 'utf8');
    const warm = source.indexOf('await prewarmModelViewer(');
    const ready = source.indexOf('this.renderReady = true;', warm);
    const animate = source.indexOf('if (this.raf === null) this.animate();', ready);

    expect(warm).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(warm);
    expect(animate).toBeGreaterThan(ready);
    expect(source).toContain('if (this.onscreen && this.renderReady)');
    expect(source).toContain('runLinkedProgramTouchLane');
  });

  it('keeps the canvas non-interactive until warm and appends it only after context creation', () => {
    const source = readFileSync(new URL('../src/guide/viewer/scene.ts', import.meta.url), 'utf8');
    const constructed = source.indexOf('new THREE.WebGLRenderer(');
    const appended = source.indexOf('container.appendChild(this.canvas)');

    expect(source).toContain('this.setCanvasReady(false);');
    expect(source).toContain('this.setCanvasReady(true);');
    expect(source).toContain('this.canvas.tabIndex = ready ? 0 : -1;');
    expect(source).toContain("this.canvas.setAttribute('aria-hidden', 'true');");
    expect(constructed).toBeGreaterThan(-1);
    expect(appended).toBeGreaterThan(constructed);
  });
});
