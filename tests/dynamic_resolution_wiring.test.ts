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
    expect(allocation).toContain('this.post.setSize(this.viewport.width, this.viewport.height');
    expect(allocation).toContain('this.applyRenderRegion();');

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
