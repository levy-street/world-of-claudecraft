// The composer-tier resolution lever under docs/design/graphics-settings-fairness.md:
// the governor may shed 3D pixels on high, ultra and insane (allocation rungs), the
// FLOOR of the shed is a pure function of the STATIC preset, and the surfaces a
// player reads text from (the HUD, nameplates, the perf overlay) never follow the
// drawing buffer.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GFX_BUDGETS, type GfxTier } from '../src/render/gfx';
import { resolutionRungLadder, resolutionRungTransition } from '../src/render/resolution_rung_core';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function methodSource(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n  private ', start + signature.length);
  return source.slice(start, next < 0 ? source.length : next);
}

const TIERS: readonly GfxTier[] = ['low', 'medium', 'high', 'ultra', 'insane'];

describe('resolution lever fairness: the floor is a pure function of the static preset', () => {
  it('pins every tier floor to its literal, desktop and mobile', () => {
    const floors: Record<GfxTier, { desktop: number; mobile: number }> = {
      low: { desktop: 0.65, mobile: 0.55 },
      medium: { desktop: 0.72, mobile: 0.55 },
      high: { desktop: 0.7, mobile: 0.6 },
      ultra: { desktop: 0.78, mobile: 0.68 },
      insane: { desktop: 0.78, mobile: 0.68 },
    };
    for (const tier of TIERS) {
      expect(GFX_BUDGETS[tier].minRenderScaleDesktop, tier).toBe(floors[tier].desktop);
      expect(GFX_BUDGETS[tier].minRenderScaleMobile, tier).toBe(floors[tier].mobile);
    }
  });

  it('never lets the allocation ladder reach below the tier floor or above the ceiling', () => {
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      for (const floor of [
        GFX_BUDGETS[tier].minRenderScaleDesktop,
        GFX_BUDGETS[tier].minRenderScaleMobile,
      ]) {
        const ladder = resolutionRungLadder(1, floor);
        expect(Math.min(...ladder), tier).toBe(floor);
        expect(Math.max(...ladder), tier).toBe(1);
        for (const previous of ladder) {
          for (const level of [0, 0.3, 0.5, floor - 0.05, floor, 0.85, 0.99, 1, 1.5]) {
            const next = resolutionRungTransition(previous, level, 1, floor);
            expect(next, `${tier} ${previous} ${level}`).toBeGreaterThanOrEqual(floor);
            expect(next, `${tier} ${previous} ${level}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('reads the floor from the static preset budget in the renderer, never the governor', () => {
    const source = stripComments(read('src/render/renderer.ts'));
    const floor = methodSource(source, 'private renderBudgetMinScale(): number');
    expect(floor).toContain('const budget = GFX.budget;');
    expect(floor).toContain(
      'this.isMobileRuntime() ? budget.minRenderScaleMobile : budget.minRenderScaleDesktop',
    );
    for (const forbidden of ['renderBudgetGovernor', 'pressure', 'frameMsEma', 'levels']) {
      expect(floor, forbidden).not.toContain(forbidden);
    }
    const ceiling = methodSource(source, 'private renderBudgetMaxScale(): number');
    expect(ceiling).toContain('Math.min(this.renderScale, GFX.budget.maxRenderScale)');
  });

  it('keeps the rung core free of any tier, preset, profile or governor input', () => {
    const source = stripComments(read('src/render/resolution_rung_core.ts'));
    expect(source).not.toMatch(/^\s*import\s/m);
    for (const forbidden of [
      'GFX',
      'gfx',
      'governor',
      'pressure',
      'window',
      'document',
      'navigator',
      "'low'",
      "'medium'",
      "'high'",
      "'ultra'",
      "'insane'",
      'mobile',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // Its ONLY inputs are the arguments: the held scale, the level, the ceiling and the floor.
    expect(source).toMatch(
      /export function resolutionRungTransition\(\s+previous: number,\s+level: number,\s+ceiling: number,\s+floor: number,\s+\)/,
    );
  });
});

describe('resolution lever fairness: text surfaces stay in CSS space', () => {
  it('reallocates the drawing buffer without touching the canvas CSS box', () => {
    const source = stripComments(read('src/render/renderer.ts'));
    const allocation = methodSource(source, 'private applyResolution(): void');
    // updateStyle=false: the canvas keeps its viewport-sized CSS box and the
    // compositor upscales the reduced drawing buffer into it; the HUD DOM
    // above it is never sized from the drawing buffer.
    expect(allocation).toContain(
      'this.webgl.setSize(this.viewport.width, this.viewport.height, false);',
    );
  });

  it('paints nameplates on their own surface at the DEVICE pixel ratio, not the render scale', () => {
    const painter = stripComments(read('src/render/nameplate_painter.ts'));
    expect(painter).toContain('window.devicePixelRatio || 1');
    expect(painter).toContain(
      'this.surface.beginFrame(width, height, this.getDevicePixelRatio());',
    );
    for (const forbidden of ['getPixelRatio()', 'effectiveRenderScale', 'renderScale']) {
      expect(painter, forbidden).not.toContain(forbidden);
    }
    const canvas = stripComments(read('src/render/nameplate_canvas.ts'));
    expect(canvas).toContain('beginFrame(width: number, height: number, devicePixelRatio: number)');
    for (const forbidden of ['getPixelRatio()', 'effectiveRenderScale', 'renderScale']) {
      expect(canvas, forbidden).not.toContain(forbidden);
    }
  });

  it('lets the HUD read the effective scale only as a perf readout', () => {
    // src/ui consumes effectiveRenderScale in exactly one place: the ?perf
    // overlay's metrics sampler, a readout. No HUD layout, font or frame reads it.
    const hud = stripComments(read('src/ui/hud.ts'));
    expect(hud).not.toContain('effectiveRenderScale');
    expect(hud).not.toContain('getPixelRatio()');
    const sampler = stripComments(read('src/ui/perf_metrics_sampler.ts'));
    expect(sampler).toContain(
      "renderScale: typeof r.effectiveRenderScale === 'number' ? r.effectiveRenderScale : null,",
    );
  });
});
