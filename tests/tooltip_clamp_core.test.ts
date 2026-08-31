// The shared #tooltip box's placement math (src/ui/tooltip_clamp_core.ts): the
// fix job for the trio the Masterwrought Phase 18 sweep reopened. The paint
// path clamped the left and top edges only and the mousemove path lacked even
// the left floor, so a tall card near the top of a laptop screen ran off the
// bottom and a hover near the left edge could push the box off screen. Every
// arm is a number the core returns, so each is pinned directly here; the
// coordinator's consumption is a source pin at the end.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TOOLTIP_EDGE_GAP,
  TOOLTIP_POINTER_DX,
  TOOLTIP_POINTER_DY,
  tooltipMaxHeight,
  tooltipPlacementAt,
} from '../src/ui/tooltip_clamp_core';

const VIEW = { w: 1366, h: 768, scale: 1 };

describe('tooltipPlacementAt', () => {
  it('keeps the classic offsets: right of the pointer, bottom edge above it', () => {
    expect(TOOLTIP_EDGE_GAP).toBe(8);
    expect(TOOLTIP_POINTER_DX).toBe(14);
    expect(TOOLTIP_POINTER_DY).toBe(10);
    expect(tooltipPlacementAt(500, 400, { w: 200, h: 100 }, VIEW)).toEqual({
      left: 514,
      top: 290,
    });
  });

  it('pulls the box back inside the right edge', () => {
    // 1366 - 200 - 8 = 1158 is the furthest left edge that still fits.
    expect(tooltipPlacementAt(1300, 400, { w: 200, h: 100 }, VIEW).left).toBe(1158);
  });

  it('floors the left edge at the gap (the mousemove path lacked this floor)', () => {
    // A box wider than the viewport allows: the RIGHT clamp alone would send
    // the left edge negative; the floor wins so the box starts on screen.
    expect(tooltipPlacementAt(2, 400, { w: 1400, h: 100 }, VIEW).left).toBe(TOOLTIP_EDGE_GAP);
    // And an ordinary pointer at the very left edge still lands at x + 14.
    expect(tooltipPlacementAt(0, 400, { w: 200, h: 100 }, VIEW).left).toBe(14);
  });

  it('floors the top edge at the gap for a pointer near the top', () => {
    expect(tooltipPlacementAt(500, 30, { w: 200, h: 100 }, VIEW).top).toBe(TOOLTIP_EDGE_GAP);
  });

  it('clamps the BOTTOM edge (the missing arm): an anchor below the viewport is pulled back up', () => {
    // Pointer near the bottom: y - h - 10 already fits, so nothing moves...
    expect(tooltipPlacementAt(500, 760, { w: 200, h: 100 }, VIEW).top).toBe(650);
    // ...while an anchor past the bottom edge (a stale pointer after a resize,
    // an element rect below the fold) used to place the box off screen; the
    // bottom clamp holds it at 768 - 100 - 8 = 660.
    expect(tooltipPlacementAt(500, 900, { w: 200, h: 100 }, VIEW).top).toBe(660);
    expect(tooltipPlacementAt(500, 5000, { w: 200, h: 100 }, VIEW).top).toBe(660);
  });

  it('a tall box near the top is floored, and the height cap is what keeps its bottom inside', () => {
    // Anchored above a pointer with less room than its height, the box floors
    // at the top gap; its bottom then lands at 8 + h, which stays inside
    // exactly because tooltipMaxHeight bounds h to the viewport minus both gaps.
    const at = tooltipPlacementAt(500, 200, { w: 200, h: 700 }, VIEW);
    expect(at.top).toBe(TOOLTIP_EDGE_GAP);
    expect(at.top + 700).toBeLessThanOrEqual(VIEW.h - TOOLTIP_EDGE_GAP);
    expect(700).toBeLessThanOrEqual(tooltipMaxHeight(VIEW));
  });

  it('the top floor wins over the bottom clamp when the box is taller than the viewport', () => {
    // Nothing can make a 900px box fit 768px: the top-left corner stays on
    // screen and the overflow falls off the far edge, where tooltipMaxHeight
    // (applied before the measure) is the arm that actually prevents it.
    expect(tooltipPlacementAt(500, 200, { w: 200, h: 900 }, VIEW).top).toBe(TOOLTIP_EDGE_GAP);
    expect(900).toBeGreaterThan(tooltipMaxHeight(VIEW));
  });

  it('maps the visual pointer into author space under a UI scale', () => {
    // At scale 2 the author-space viewport is 683 x 384; a visual pointer at
    // (1000, 600) is author (500, 300).
    const at = tooltipPlacementAt(1000, 600, { w: 100, h: 50 }, { w: 1366, h: 768, scale: 2 });
    expect(at).toEqual({ left: 514, top: 240 });
    // The right clamp is in author space too: 683 - 100 - 8 = 575.
    expect(
      tooltipPlacementAt(1300, 600, { w: 100, h: 50 }, { w: 1366, h: 768, scale: 2 }).left,
    ).toBe(575);
  });

  it('is pure: the same inputs always give the same box and allocate nothing shared', () => {
    const a = tooltipPlacementAt(500, 400, { w: 200, h: 100 }, VIEW);
    const b = tooltipPlacementAt(500, 400, { w: 200, h: 100 }, VIEW);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('tooltipMaxHeight', () => {
  it('leaves the edge gap above and below, in author space', () => {
    expect(tooltipMaxHeight(VIEW)).toBe(768 - 2 * TOOLTIP_EDGE_GAP);
    expect(tooltipMaxHeight({ w: 1366, h: 768, scale: 2 })).toBe(384 - 2 * TOOLTIP_EDGE_GAP);
  });

  it('never goes negative on a degenerate viewport', () => {
    expect(tooltipMaxHeight({ w: 10, h: 10, scale: 1 })).toBe(0);
  });
});

describe('hud.ts consumes the core (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('paintTooltipAt caps the height BEFORE the one measure, then places through the core', () => {
    const start = hud.indexOf('private paintTooltipAt(');
    expect(start).toBeGreaterThan(-1);
    const body = hud.slice(start, hud.indexOf('\n  }', start));
    expect(body.length).toBeLessThan(1500);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts on source text that contains a template literally.
    const cap = body.indexOf('this.tooltipEl.style.maxHeight = `${tooltipMaxHeight(viewport)}px`;');
    const measure = body.indexOf('this.tooltipEl.offsetWidth');
    expect(cap).toBeGreaterThan(-1);
    expect(measure).toBeGreaterThan(cap);
    expect(body).toContain('const at = tooltipPlacementAt(x, y, box, viewport);');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts on source text that contains a template literally.
    expect(body).toContain('this.tooltipEl.style.left = `${at.left}px`;');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts on source text that contains a template literally.
    expect(body).toContain('this.tooltipEl.style.top = `${at.top}px`;');
    // The hand-rolled clamp is gone from the paint path.
    expect(body).not.toContain('Math.min(window.innerWidth');
  });

  it('the mousemove reposition path reuses the cached box through the same core', () => {
    const start = hud.indexOf("el.addEventListener('mousemove', (e) => {");
    expect(start).toBeGreaterThan(-1);
    const body = hud.slice(start, hud.indexOf("el.addEventListener('mouseleave'", start));
    expect(body).toMatch(
      /tooltipPlacementAt\(\s*e\.clientX,\s*e\.clientY,\s*\{ w: ttW, h: ttH \},\s*this\.tooltipViewport\(\),?\s*\)/,
    );
    expect(body).not.toContain('Math.min(window.innerWidth');
    // No layout read on the hot path: the cached size, never a re-measure.
    expect(body).not.toContain('offsetWidth');
  });
});
