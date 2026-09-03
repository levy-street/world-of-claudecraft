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
  it('allocates at the manual ceiling on the region path and at the rung elsewhere', () => {
    const allocation = methodSource('private applyResolution(): void');
    expect(allocation).toContain('dynamicResolutionAllocationScale(');
    expect(allocation).toContain('this.webgl.setPixelRatio(ratio);');
    expect(allocation).toContain('this.webgl.setSize(this.viewport.width, this.viewport.height');
    expect(allocation).toContain('this.post.setSize(this.viewport.width, this.viewport.height');
    expect(allocation).toContain('this.applyRenderRegion();');

    const liveRegion = methodSource('private applyRenderRegion(): void');
    expect(liveRegion).toContain('post.setRenderRegion(rect);');
    expect(liveRegion).not.toContain('.setSize(');
    expect(liveRegion).not.toContain('.setPixelRatio(');
  });

  it('steps the effective scale through the rung core and reallocates only off the region path', () => {
    const automaticStep = methodSource(
      'private applyRenderBudgetState(state: RenderBudgetState): void',
    );
    // The scale in force is the core's answer, fed the scale before the step,
    // the governor's level, the dev pin and the static ceiling and floor.
    expect(automaticStep).toMatch(
      /this\.effectiveRenderScale = resolutionAllocationScale\(\{\s+mode: this\.post\?\.dynamicResolution \?\? 'locked',\s+pin: dynamicResolutionPin\(\),\s+previous: previousScale,\s+level: state\.levels\.resolution,\s+ceiling: this\.renderBudgetMaxScale\(\),\s+floor: this\.renderBudgetMinScale\(\),\s+\}\);/,
    );
    // An unchanged scale touches nothing.
    expect(automaticStep).toContain(
      'if (Math.abs(previousScale - this.effectiveRenderScale) < 0.001) return;',
    );
    // The region path moves a viewport; the allocation path reallocates
    // through the ONE allocating method and marks the frame that pays it.
    expect(automaticStep).toMatch(
      /if \(this\.post\?\.supportsDynamicResolution\) this\.applyRenderRegion\(\);\s+else \{\s+this\.reallocationPending = true;\s+this\.applyResolution\(\);\s+\}/,
    );
    expect(automaticStep).not.toContain('.setSize(');
    expect(automaticStep).not.toContain('.setPixelRatio(');
  });

  it('opens the governor range for both lever modes and pins it under ?dynres', () => {
    const update = methodSource('private updateAdaptiveResolution(dt: number): void');
    expect(update).toContain("const mode = this.post?.dynamicResolution ?? 'locked';");
    expect(update).toContain("const governed = mode !== 'locked';");
    // The governor learns which arm it drives: a reallocating step reads
    // sustained cost only (render_budget.ts `resolutionReallocates`).
    expect(update).toContain("sample.resolutionReallocates = mode === 'allocation';");
    expect(update).toMatch(
      /const resolutionRange = dynamicResolutionGovernorRange\(\s+governed,\s+this\.effectiveRenderScale,\s+this\.renderBudgetMinScale\(\),\s+this\.renderBudgetMaxScale\(\),\s+dynamicResolutionPin\(\),\s+\);/,
    );
    expect(update).toContain('sample.minRenderScale = resolutionRange.minRenderScale;');
    expect(update).toContain('sample.maxRenderScale = resolutionRange.maxRenderScale;');
  });

  it('hands the reallocation to the governor on the next sample, once', () => {
    const update = methodSource('private updateAdaptiveResolution(dt: number): void');
    expect(update).toMatch(
      /sample\.reallocated = this\.reallocationPending;\s+sample\.resolutionReallocates = mode === 'allocation';\s+this\.reallocationPending = false;/,
    );
    expect(update.indexOf('sample.reallocated')).toBeLessThan(
      update.indexOf('this.renderBudgetGovernor.update('),
    );
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

  it('surfaces the lever mode beside the effective scale in perfStats', () => {
    expect(renderer).toContain("dynamicResolution: this.post?.dynamicResolution ?? 'locked',");
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
