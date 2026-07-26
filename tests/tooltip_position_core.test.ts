import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOLTIP_EDGE_MARGIN, tooltipPosition } from '../src/ui/tooltip_position_core';

describe('tooltipPosition', () => {
  it('clamps a pointer tooltip against every viewport edge', () => {
    expect(
      tooltipPosition({
        pointerX: 390,
        pointerY: 840,
        tooltipWidth: 280,
        tooltipHeight: 600,
        viewportWidth: 390,
        viewportHeight: 844,
        uiScale: 1,
      }),
    ).toEqual({ left: 102, top: 230 });
  });

  it('pins an oversized comparison tooltip to the margin for scrollable mobile display', () => {
    expect(
      tooltipPosition({
        pointerX: 200,
        pointerY: 400,
        tooltipWidth: 280,
        tooltipHeight: 900,
        viewportWidth: 390,
        viewportHeight: 667,
        uiScale: 1,
      }).top,
    ).toBe(TOOLTIP_EDGE_MARGIN);
  });

  it('does all placement in author space when UI zoom is active', () => {
    expect(
      tooltipPosition({
        pointerX: 700,
        pointerY: 500,
        tooltipWidth: 200,
        tooltipHeight: 200,
        viewportWidth: 800,
        viewportHeight: 600,
        uiScale: 2,
      }),
    ).toEqual({ left: 192, top: 40 });
  });
});

describe('responsive tooltip CSS', () => {
  const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');

  it('caps tooltip height and lets touch/gamepad readers scroll long comparisons', () => {
    expect(css).toContain('max-height: calc(100dvh - 16px);');
    expect(css).toContain('overflow-y: auto;');
    expect(css).toContain('body.mobile-touch #tooltip');
    expect(css).toContain('body.gamepad-pointer-mode #tooltip');
    expect(css).toContain('pointer-events: auto;');
  });
});
