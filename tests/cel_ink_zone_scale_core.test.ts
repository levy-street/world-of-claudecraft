import { afterEach, describe, expect, it } from 'vitest';
import { celInkZoneScale, setCelInkZoneScale } from '../src/render/cel_ink_zone_scale_core';

describe('cel ink zone scale', () => {
  afterEach(() => setCelInkZoneScale(1));

  it('starts at the shipped ink (1)', () => {
    expect(celInkZoneScale()).toBe(1);
  });

  it('carries a zone look ink value, 0 drawing no ink', () => {
    setCelInkZoneScale(0);
    expect(celInkZoneScale()).toBe(0);
    setCelInkZoneScale(0.4);
    expect(celInkZoneScale()).toBe(0.4);
  });

  it('clamps out-of-range values and restores the shipped ink on a non-finite one', () => {
    setCelInkZoneScale(-2);
    expect(celInkZoneScale()).toBe(0);
    setCelInkZoneScale(3);
    expect(celInkZoneScale()).toBe(1);
    setCelInkZoneScale(0.2);
    setCelInkZoneScale(Number.NaN);
    expect(celInkZoneScale()).toBe(1);
  });
});
