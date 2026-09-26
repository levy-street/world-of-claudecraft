import { describe, expect, it } from 'vitest';
import {
  WICKHARBOR_WHARF_CRITICAL_PARTS,
  WICKHARBOR_WHARF_OPTIONAL_PARTS,
  WICKHARBOR_WHARF_TRIM_PARTS,
  wickharborWharfParts,
} from '../src/render/wickharbor_wharf_core';
import { WICKHARBOR_WHARF_PROPS } from '../src/sim/content/wickharbor_wharf';

// The Wickharbor ferry wharf's pure core (src/render/wickharbor_wharf_core.ts): which parts
// each graphics tier draws. Everything a player walks on, bumps into or steers by is drawn on
// every tier; only collision-free dressing is shed (graphics-settings fairness).

describe('wickharbor wharf tiers (graphics fairness)', () => {
  it('keeps the plank field, frame, flight, rails, lanterns and cargo on every tier', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      const parts = wickharborWharfParts(tier);
      for (const p of WICKHARBOR_WHARF_CRITICAL_PARTS) expect(parts, tier).toContain(p);
    }
    expect(wickharborWharfParts('low')).toEqual([...WICKHARBOR_WHARF_CRITICAL_PARTS]);
    expect(wickharborWharfParts('medium')).toEqual([
      ...WICKHARBOR_WHARF_CRITICAL_PARTS,
      ...WICKHARBOR_WHARF_TRIM_PARTS,
    ]);
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      expect(wickharborWharfParts(tier)).toEqual([
        ...WICKHARBOR_WHARF_CRITICAL_PARTS,
        ...WICKHARBOR_WHARF_TRIM_PARTS,
        ...WICKHARBOR_WHARF_OPTIONAL_PARTS,
      ]);
    }
  });

  it('draws every solid the sim collides with in a part the low tier keeps', () => {
    const drawnBy: Record<string, string> = {
      lanternPost: 'WharfLanterns',
      bollard: 'WharfCargo',
      crateStack: 'WharfCargo',
      barrel: 'WharfCargo',
    };
    const low = wickharborWharfParts('low');
    for (const p of WICKHARBOR_WHARF_PROPS) {
      expect(drawnBy[p.kind], p.kind).toBeDefined();
      expect(low).toContain(drawnBy[p.kind]);
    }
    // the walkable surfaces and the rails too
    for (const part of ['WharfDeck', 'WharfFrame', 'WharfFlight', 'WharfRails']) {
      expect(low).toContain(part);
    }
    // the shed parts hold nothing solid
    for (const part of [...WICKHARBOR_WHARF_TRIM_PARTS, ...WICKHARBOR_WHARF_OPTIONAL_PARTS]) {
      expect(Object.values(drawnBy)).not.toContain(part);
    }
  });
});
