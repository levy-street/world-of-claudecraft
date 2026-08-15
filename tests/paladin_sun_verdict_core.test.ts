import { describe, expect, it } from 'vitest';
import {
  type PaladinSunVerdictVisualPlan,
  paladinSunVerdictVisualPlanInto,
} from '../src/render/paladin_sun_verdict_core';

function plan(
  source: Parameters<typeof paladinSunVerdictVisualPlanInto>[0],
  viewerId = 7,
): PaladinSunVerdictVisualPlan {
  return paladinSunVerdictVisualPlanInto(source, viewerId, {
    active: false,
    charges: 0,
    imminent: false,
  });
}

describe('Paladin sun verdict visual plan', () => {
  it('shows an empty three-part sun before any qualifying hit', () => {
    expect(
      plan({
        dead: false,
        auras: [{ id: 'sun_gods_verdict', kind: 'sun_verdict', value: 0, sourceId: 7 }],
      }),
    ).toEqual({ active: true, charges: 0, imminent: false });
  });

  it('fills by charge and warns when the next hit will detonate', () => {
    expect(
      plan({
        dead: false,
        auras: [{ id: 'sun_gods_verdict', kind: 'sun_verdict', value: 1, sourceId: 7 }],
      }),
    ).toEqual({ active: true, charges: 1, imminent: false });
    expect(
      plan({
        dead: false,
        auras: [{ id: 'sun_gods_verdict', kind: 'sun_verdict', value: 2, sourceId: 7 }],
      }),
    ).toEqual({ active: true, charges: 2, imminent: true });
    expect(
      plan({
        dead: false,
        auras: [{ id: 'sun_gods_verdict', kind: 'sun_verdict', value: 3, sourceId: 7 }],
      }),
    ).toEqual({ active: true, charges: 3, imminent: true });
  });

  it('prefers the local Paladin mark when several Paladins judge the same enemy', () => {
    expect(
      plan({
        dead: false,
        auras: [
          { id: 'sun_gods_verdict', kind: 'sun_verdict', value: 2, sourceId: 9 },
          { id: 'sun_gods_verdict', kind: 'sun_verdict', value: 1, sourceId: 7 },
        ],
      }).charges,
    ).toBe(1);
  });

  it('hides on death or without a verdict mark and clamps malformed wire values', () => {
    expect(plan({ dead: true, auras: [] }).active).toBe(false);
    expect(plan({ dead: false, auras: [] }).active).toBe(false);
    expect(
      plan({
        dead: false,
        auras: [{ id: 'sun_gods_verdict', kind: 'sun_verdict', value: 99, sourceId: 7 }],
      }).charges,
    ).toBe(3);
  });
});
