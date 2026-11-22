import { describe, expect, it } from 'vitest';
import {
  type PaladinAscensionVisualPlan,
  paladinAscensionVisualPlanInto,
} from '../src/render/paladin_ascension_core';
import { VALKYR_RETURN, VALKYR_VANISH } from '../src/render/paladin_valkyrs_calling_core';

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
    ).toEqual({ active: true, charges: 4, lastCharge: false, wrathWings: false, vanished: false });
  });

  it('marks the final charge and clamps malformed wire values', () => {
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 1, ascensionRemaining: 2 },
      }),
    ).toEqual({ active: true, charges: 1, lastCharge: true, wrathWings: false, vanished: false });
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 99, ascensionRemaining: 2 },
      }).charges,
    ).toBe(7);
  });

  it('shows all 7 charges once Extended Dawn raises the cap past the base 5', () => {
    expect(
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 7, ascensionRemaining: 45 },
      }),
    ).toEqual({ active: true, charges: 7, lastCharge: false, wrathWings: false, vanished: false });
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
    expect(output).toEqual({
      active: true,
      charges: 3,
      lastCharge: false,
      wrathWings: false,
      vanished: false,
    });
  });

  it("knows when Valkyr's Calling has carried the Paladin out of sight", () => {
    const flying = (elapsed: number) =>
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 4, ascensionRemaining: 30 },
        auras: [],
        valkyrsCalling: { elapsed },
      });
    expect(flying(0.1).vanished).toBe(false);
    expect(flying(VALKYR_VANISH + 0.05).vanished).toBe(true);
    expect(flying(VALKYR_RETURN + 0.05).vanished).toBe(false);
  });

  it('knows when Avenging Wrath has the wings spread already', () => {
    const withAuras = (auras: { id: string; kind: string }[]) =>
      plan({
        templateId: 'paladin',
        dead: false,
        paladinDevotion: { ascensionCharges: 5, ascensionRemaining: 30 },
        auras,
      });
    expect(withAuras([]).wrathWings).toBe(false);
    expect(withAuras([{ id: 'avenging_wrath', kind: 'buff_dmg_done' }]).wrathWings).toBe(true);
    expect(withAuras([{ id: 'life_covenant', kind: 'buff_dr' }]).wrathWings).toBe(false);
    expect(withAuras([{ id: 'consecration', kind: 'hot' }]).wrathWings).toBe(false);
  });
});
