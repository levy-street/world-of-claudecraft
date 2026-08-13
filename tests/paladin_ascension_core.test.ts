import { describe, expect, it } from 'vitest';
import {
  type PaladinAscensionVisualPlan,
  paladinAscensionVisualPlanInto,
} from '../src/render/paladin_ascension_core';

function plan(
  source: Parameters<typeof paladinAscensionVisualPlanInto>[0],
): PaladinAscensionVisualPlan {
  return paladinAscensionVisualPlanInto(source, { active: false, charges: 0, lastCharge: false });
}

describe('paladin Ascension visual plan', () => {
  it('exposes one orbiting symbol per remaining active charge', () => {
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 4, ascensionRemaining: 12 },
      }),
    ).toEqual({ active: true, charges: 4, lastCharge: false });
  });

  it('marks the final charge and clamps malformed wire values', () => {
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 1, ascensionRemaining: 2 },
      }),
    ).toEqual({ active: true, charges: 1, lastCharge: true });
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 99, ascensionRemaining: 2 },
      }).charges,
    ).toBe(5);
  });

  it('hides the transformation for dead, expired, or non-Paladin entities', () => {
    expect(
      plan({
        templateId: 'paladin',
        dead: true,
        paladinDevotion: { ascensionCharges: 5, ascensionRemaining: 25 },
      }).active,
    ).toBe(false);
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 5, ascensionRemaining: 0 },
      }).active,
    ).toBe(false);
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 0, ascensionRemaining: 25 },
      }).active,
    ).toBe(false);
    expect(
      plan({
        templateId: 'mage',
        dead: false,
        paladinDevotion: { ascensionCharges: 5, ascensionRemaining: 25 },
      }).active,
    ).toBe(false);
  });

  it('reuses the caller-owned plan object', () => {
    const output: PaladinAscensionVisualPlan = {
      active: false,
      charges: 0,
      lastCharge: false,
    };
    expect(
      paladinAscensionVisualPlanInto(
        {
          templateId: 'paladin',
          dead: false,
          paladinDevotion: { ascensionCharges: 3, ascensionRemaining: 10 },
        },
        output,
      ),
    ).toBe(output);
    expect(output).toEqual({ active: true, charges: 3, lastCharge: false });
  });
});
