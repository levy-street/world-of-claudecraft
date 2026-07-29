import { describe, expect, it } from 'vitest';
import {
  clampMeterFrame,
  initialMeterFrame,
  METER_FRAME_LIMITS,
  type MeterFrameGeometry,
  parseMeterFrame,
  placeMeterFrame,
  serializeMeterFrame,
  TABBED_METER_FRAME_LIMITS,
} from '../src/ui/meters_frame_core';

const VIEWPORT = { w: 1600, h: 900 };
const geo = (left: number, top: number, width: number, height: number): MeterFrameGeometry => ({
  left,
  top,
  width,
  height,
});

describe('meter frame geometry', () => {
  it('leaves a panel that already fits untouched', () => {
    const wanted = geo(400, 300, 240, 180);
    expect(clampMeterFrame(wanted, VIEWPORT)).toEqual(wanted);
  });

  it('keeps a panel dragged past an edge fully on screen, on both axes', () => {
    const { margin } = METER_FRAME_LIMITS;
    // past the right/bottom edges
    const bottomRight = clampMeterFrame(geo(5000, 5000, 240, 180), VIEWPORT);
    expect(bottomRight.left).toBe(VIEWPORT.w - 240 - margin);
    expect(bottomRight.top).toBe(VIEWPORT.h - 180 - margin);
    // past the left/top edges
    const topLeft = clampMeterFrame(geo(-500, -500, 240, 180), VIEWPORT);
    expect(topLeft.left).toBe(margin);
    expect(topLeft.top).toBe(margin);
  });

  it('holds the size between its min and max', () => {
    const tiny = clampMeterFrame(geo(100, 100, 10, 10), VIEWPORT);
    expect(tiny.width).toBe(METER_FRAME_LIMITS.minWidth);
    expect(tiny.height).toBe(METER_FRAME_LIMITS.minHeight);
    const huge = clampMeterFrame(geo(100, 100, 9000, 9000), VIEWPORT);
    expect(huge.width).toBe(METER_FRAME_LIMITS.maxWidth);
    expect(huge.height).toBe(METER_FRAME_LIMITS.maxHeight);
  });

  it('prefers the margin over a negative size on a viewport smaller than the minimum', () => {
    const cramped = clampMeterFrame(geo(0, 0, 240, 180), { w: 120, h: 100 });
    expect(cramped.width).toBe(METER_FRAME_LIMITS.minWidth);
    expect(cramped.height).toBe(METER_FRAME_LIMITS.minHeight);
    expect(cramped.left).toBe(METER_FRAME_LIMITS.margin);
    expect(cramped.top).toBe(METER_FRAME_LIMITS.margin);
  });

  it('divides the css writes by the UI scale while persisting visual coordinates', () => {
    const placement = placeMeterFrame(geo(400, 300, 240, 180), VIEWPORT, 2);
    // geo stays in screen space so a panel saved at one scale reopens in place
    expect(placement.geo).toEqual(geo(400, 300, 240, 180));
    // css is author space: #ui's zoom re-multiplies it back to geo
    expect(placement.css).toEqual(geo(200, 150, 120, 90));
  });

  it('falls back to scale 1 rather than blanking the panel on a bad scale read', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(placeMeterFrame(geo(400, 300, 240, 180), VIEWPORT, bad).css).toEqual(
        geo(400, 300, 240, 180),
      );
    }
  });

  it('round-trips through storage and rejects corrupt or partial data', () => {
    const original = geo(120, 340, 260, 200);
    expect(parseMeterFrame(serializeMeterFrame(original))).toEqual(original);
    expect(parseMeterFrame(null)).toBeNull();
    expect(parseMeterFrame('')).toBeNull();
    expect(parseMeterFrame('not json')).toBeNull();
    // every field must be present and finite, so a half-written record is dropped
    expect(parseMeterFrame('{"left":10,"top":10,"width":200}')).toBeNull();
    expect(parseMeterFrame('{"left":10,"top":10,"width":200,"height":null}')).toBeNull();
    expect(parseMeterFrame('{"left":10,"top":10,"width":200,"height":"tall"}')).toBeNull();
  });

  it('seeds a detaching panel from where it already is, so it does not jump', () => {
    const fallback = geo(0, 0, 240, 180);
    expect(initialMeterFrame({ left: 900, top: 640, width: 260, height: 150 }, fallback)).toEqual(
      geo(900, 640, 260, 150),
    );
  });

  it('uses the fallback when the panel is measured while hidden', () => {
    const fallback = geo(40, 50, 240, 180);
    // a display:none panel reports a zero rect; a first-open window must not
    // land at 0x0 with no size
    expect(initialMeterFrame({ left: 0, top: 0, width: 0, height: 0 }, fallback)).toEqual(fallback);
    expect(initialMeterFrame({ left: 12, top: 12, width: 200, height: 0 }, fallback)).toEqual(
      fallback,
    );
  });

  it('holds the tabbed window to a wider floor than a detached one', () => {
    // Its title carries three tabs plus three controls and wraps below ~238px,
    // so the tabbed floor is the stock width while a detached panel may shrink
    // further. A regression that equalized them would silently break the chrome.
    expect(TABBED_METER_FRAME_LIMITS.minWidth).toBeGreaterThan(METER_FRAME_LIMITS.minWidth);
    expect(TABBED_METER_FRAME_LIMITS.minWidth).toBeGreaterThanOrEqual(238);
    const shrunk = clampMeterFrame(geo(100, 100, 10, 10), VIEWPORT, TABBED_METER_FRAME_LIMITS);
    expect(shrunk.width).toBe(TABBED_METER_FRAME_LIMITS.minWidth);
    // everything else is shared, so the two only differ where they must
    expect({ ...TABBED_METER_FRAME_LIMITS, minWidth: 0 }).toEqual({
      ...METER_FRAME_LIMITS,
      minWidth: 0,
    });
  });
});
