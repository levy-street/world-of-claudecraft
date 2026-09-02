import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function methodSource(signature: string): string {
  const start = renderer.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  const nextMethod = renderer.indexOf('\n  private ', start + signature.length);
  return renderer.slice(start, nextMethod < 0 ? renderer.length : nextMethod);
}

describe('dynamic resolution renderer wiring', () => {
  it('allocates at the manual ceiling and changes only the live region automatically', () => {
    const allocation = methodSource('private applyResolution(): void');
    expect(allocation).toContain('dynamicResolutionAllocationScale(');
    expect(allocation).toContain('this.webgl.setPixelRatio(ratio);');
    expect(allocation).toContain('this.webgl.setSize(this.viewport.width, this.viewport.height');
    expect(allocation).toContain('this.post?.setSize(this.viewport.width, this.viewport.height');
    expect(allocation).toContain('this.applyRenderRegion();');
    // Storage is reallocated only when the drawing-buffer extent actually
    // moves, and the live region is re-applied either way.
    expect(allocation).toContain(
      'if (this.resizeGate.shouldAllocate(this.viewport.width, this.viewport.height, ratio)) {',
    );
    expect(allocation.indexOf('this.applyRenderRegion();')).toBeGreaterThan(
      allocation.indexOf('this.resizeGate.shouldAllocate('),
    );
    // Method-body indentation, so the region re-apply sits OUTSIDE the guard: a
    // pass that reallocates nothing must still re-apply the live region.
    expect(allocation).toContain('\n    this.applyRenderRegion();');
    expect(allocation).not.toContain('\n      this.applyRenderRegion();');
    for (const guarded of [
      '\n      this.webgl.setPixelRatio(ratio);',
      '\n      this.webgl.setSize(this.viewport.width, this.viewport.height, false);',
      '\n      this.post?.setSize(this.viewport.width, this.viewport.height, ratio);',
    ]) {
      expect(allocation).toContain(guarded);
    }

    const automaticStep = methodSource(
      'private applyRenderBudgetState(state: RenderBudgetState): void',
    );
    expect(automaticStep).toMatch(
      /Math\.abs\(previousScale - this\.effectiveRenderScale\) >= 0\.001 &&\s+this\.post\?\.supportsDynamicResolution\s+\) \{\s+this\.applyRenderRegion\(\);\s+\}/,
    );
    expect(automaticStep).not.toContain('this.applyResolution();');
    expect(automaticStep).not.toContain('.setSize(');
    expect(automaticStep).not.toContain('.setPixelRatio(');

    const liveRegion = methodSource('private applyRenderRegion(): void');
    expect(liveRegion).toContain('post.setRenderRegion(rect);');
    expect(liveRegion).not.toContain('.setSize(');
    expect(liveRegion).not.toContain('.setPixelRatio(');
  });

  it('routes every viewport-resize source through the one coalesced frame pass', () => {
    // A drag emits a burst; each event books at most one pass on the next
    // animation frame instead of reallocating the whole post chain in place.
    expect(renderer).toContain(
      'private readonly resizeGate = createResizeCoalescer(() => this.resizeViewport());',
    );
    expect(renderer).toMatch(
      /private readonly onViewportResize = \(\): void =>\s+this\.resizeGate\.request\(\(run\) => requestAnimationFrame\(run\)\);/,
    );
    // Every listener and the DPR watch share that one entry point: none of them
    // may call resizeViewport straight.
    for (const source of [
      "window.addEventListener('resize', this.onViewportResize)",
      "window.visualViewport?.addEventListener('resize', this.onViewportResize)",
      "window.visualViewport?.addEventListener('scroll', this.onViewportResize)",
      "document.addEventListener('fullscreenchange', this.onViewportResize)",
      'watchDevicePixelRatio(this.onViewportResize)',
    ]) {
      expect(renderer).toContain(source);
    }
    expect(renderer).not.toContain('if (!this.shutdownStarted) this.resizeViewport();');
    // The pass itself is what refuses to run after teardown, since a queued
    // frame outlives the listeners the shutdown removes.
    expect(methodSource('private resizeViewport(measured = this.measureViewport()): void')).toMatch(
      /\{\s+if \(this\.shutdownStarted\) return;/,
    );
  });

  it('locks unsupported paths and opens only the pure governor range', () => {
    const update = methodSource('private updateAdaptiveResolution(dt: number): void');
    expect(update).toContain(
      'const dynamicResolution = this.post?.supportsDynamicResolution === true;',
    );
    expect(update).toContain('const resolutionRange = dynamicResolutionGovernorRange(');
    expect(update).toContain('sample.minRenderScale = resolutionRange.minRenderScale;');
    expect(update).toContain('sample.maxRenderScale = resolutionRange.maxRenderScale;');
  });

  it('keeps manual changes on the allocating path', () => {
    const manual = renderer.slice(
      renderer.indexOf('setRenderScale(scale: number): void'),
      renderer.indexOf('\n  private isMobileRuntime()', renderer.indexOf('setRenderScale')),
    );
    expect(manual).toContain('this.renderBudgetGovernor.reset(');
    expect(manual).toContain('this.applyRenderBudgetState(this.renderBudgetState);');
    expect(manual).toContain('this.applyResolution();');
  });

  it('keeps logical screen mapping separate from the cosmetic pixel height', () => {
    expect(
      renderer.match(
        /projectionScalePixels\(\n\s+this\.camera\.projectionMatrix\.elements\[5\],\n\s+this\.renderPixelHeight,/g,
      ),
    ).toHaveLength(2);
    expect(renderer).toContain('(clientX / this.viewport.width) * 2 - 1');
    expect(renderer).toContain('-(clientY / this.viewport.height) * 2 + 1');
    expect(renderer).toContain('(this.tmpV.x * 0.5 + 0.5) * this.viewport.width');
    expect(renderer).toContain('(-this.tmpV.y * 0.5 + 0.5) * this.viewport.height');
  });
});
