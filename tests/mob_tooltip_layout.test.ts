import { describe, expect, it } from 'vitest';
import { mobileMobTooltipLayout, type VisualRect } from '../src/ui/mob_tooltip_layout';

function rect(left: number, top: number, width: number, height: number): VisualRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe('mobileMobTooltipLayout', () => {
  it('places the right-handed tooltip eight visual pixels below the minimap', () => {
    const layout = mobileMobTooltipLayout({
      viewportWidth: 844,
      viewportHeight: 390,
      uiScale: 1,
      tooltipAuthorWidth: 188,
      tooltipNaturalAuthorHeight: 96,
      minimapRect: rect(16, 12, 85, 85),
      leftHanded: false,
      obstacles: [],
    });

    expect(layout.left).toBe(16);
    expect(layout.top).toBe(105);
    expect(layout.maxHeight).toBe(277);
    expect(layout.clipped).toBe(false);
  });

  it('aligns the trailing tooltip edge to a left-handed minimap', () => {
    const layout = mobileMobTooltipLayout({
      viewportWidth: 844,
      viewportHeight: 390,
      uiScale: 1,
      tooltipAuthorWidth: 188,
      tooltipNaturalAuthorHeight: 96,
      minimapRect: rect(743, 12, 85, 85),
      leftHanded: true,
      obstacles: [],
    });

    expect(layout.left).toBe(640);
    expect(layout.top).toBe(105);
  });

  it('clamps either handed edge inside the visual viewport', () => {
    const rightClamped = mobileMobTooltipLayout({
      viewportWidth: 360,
      viewportHeight: 740,
      uiScale: 1,
      tooltipAuthorWidth: 188,
      tooltipNaturalAuthorHeight: 96,
      minimapRect: rect(300, 12, 85, 85),
      leftHanded: false,
      obstacles: [],
    });
    const leftClamped = mobileMobTooltipLayout({
      viewportWidth: 360,
      viewportHeight: 740,
      uiScale: 1,
      tooltipAuthorWidth: 188,
      tooltipNaturalAuthorHeight: 96,
      minimapRect: rect(-40, 12, 85, 85),
      leftHanded: true,
      obstacles: [],
    });

    expect(rightClamped.left).toBe(164);
    expect(leftClamped.left).toBe(8);
  });

  it('converts visual coordinates and maximum height into zoomed author space', () => {
    const layout = mobileMobTooltipLayout({
      viewportWidth: 1000,
      viewportHeight: 500,
      uiScale: 1.25,
      tooltipAuthorWidth: 160,
      tooltipNaturalAuthorHeight: 200,
      minimapRect: rect(400, 20, 100, 100),
      leftHanded: false,
      obstacles: [],
    });

    expect(layout.left).toBe(320);
    expect(layout.top).toBe(102.4);
    expect(layout.maxHeight).toBe(291.2);
    expect(layout.clipped).toBe(false);
  });

  it('uses the nearest lower obstacle that intersects the tooltip lane', () => {
    const layout = mobileMobTooltipLayout({
      viewportWidth: 844,
      viewportHeight: 390,
      uiScale: 1,
      tooltipAuthorWidth: 188,
      tooltipNaturalAuthorHeight: 100,
      minimapRect: rect(16, 12, 85, 85),
      leftHanded: false,
      obstacles: [rect(260, 150, 100, 100), rect(20, 260, 100, 80), rect(30, 210, 100, 40)],
    });

    expect(layout.maxHeight).toBe(101);
    expect(layout.clipped).toBe(false);
  });

  it('marks long content clipped with four visual pixels of obstacle clearance', () => {
    const layout = mobileMobTooltipLayout({
      viewportWidth: 844,
      viewportHeight: 390,
      uiScale: 1,
      tooltipAuthorWidth: 188,
      tooltipNaturalAuthorHeight: 180,
      minimapRect: rect(16, 12, 85, 85),
      leftHanded: false,
      obstacles: [rect(20, 210, 100, 48)],
    });

    expect(layout.maxHeight).toBe(101);
    expect(layout.clipped).toBe(true);
  });
});
