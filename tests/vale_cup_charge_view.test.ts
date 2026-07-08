// The Vale Cup shoot power meter view core (src/ui/vale_cup_charge_view.ts):
// visibility, the clamped fill fraction, the safe/ideal/over tint bands, and
// the cancel-on-invalid-state decision the Hud acts on (drop a charge held
// while the match ended or the holder died). Node-only, no DOM (UI_PURE_CORES).

import { describe, expect, it } from 'vitest';
import {
  buildVcupChargeView,
  SHOOT_IDEAL_FRAC,
  SHOOT_OVER_FRAC,
} from '../src/ui/vale_cup_charge_view';

describe('buildVcupChargeView', () => {
  it('pins the band thresholds (UI-local tuning the meter feel depends on)', () => {
    expect(SHOOT_IDEAL_FRAC).toBe(0.6);
    expect(SHOOT_OVER_FRAC).toBe(0.85);
  });

  it('is hidden and NOT cancelled while no slot is held', () => {
    const v = buildVcupChargeView(false, true, false, 0.5);
    expect(v.visible).toBe(false);
    expect(v.cancel).toBe(false);
  });

  it('shows the clamped fraction while charging in a live match', () => {
    expect(buildVcupChargeView(true, true, false, 0).frac).toBe(0);
    expect(buildVcupChargeView(true, true, false, 0.37).frac).toBe(0.37);
    expect(buildVcupChargeView(true, true, false, 1.4).frac).toBe(1);
    expect(buildVcupChargeView(true, true, false, -0.2).frac).toBe(0);
    expect(buildVcupChargeView(true, true, false, 0.37).visible).toBe(true);
  });

  it('tints safe below ideal, ideal in the sweet spot, over past the over line', () => {
    const safe = buildVcupChargeView(true, true, false, SHOOT_IDEAL_FRAC);
    expect(safe.ideal).toBe(false);
    expect(safe.over).toBe(false);
    const ideal = buildVcupChargeView(true, true, false, SHOOT_IDEAL_FRAC + 0.01);
    expect(ideal.ideal).toBe(true);
    expect(ideal.over).toBe(false);
    const edge = buildVcupChargeView(true, true, false, SHOOT_OVER_FRAC);
    expect(edge.ideal).toBe(true);
    expect(edge.over).toBe(false);
    const over = buildVcupChargeView(true, true, false, SHOOT_OVER_FRAC + 0.01);
    expect(over.ideal).toBe(false);
    expect(over.over).toBe(true);
  });

  it('cancels a charge held after the match ended (meter never sticks)', () => {
    const v = buildVcupChargeView(true, false, false, 0.5);
    expect(v.cancel).toBe(true);
    expect(v.visible).toBe(false);
  });

  it('cancels a charge held by a dead player', () => {
    const v = buildVcupChargeView(true, true, true, 0.5);
    expect(v.cancel).toBe(true);
    expect(v.visible).toBe(false);
  });
});
