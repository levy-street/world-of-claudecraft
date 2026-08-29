import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { characterViewOutsideHysteresis } from '../src/render/character_view_core';

describe('character view visibility hysteresis', () => {
  const createRangeSquared = 80 * 80;
  const destroyRangeSquared = 96 * 96;

  it.each([
    [false, createRangeSquared - 1, false],
    [false, createRangeSquared, false],
    [false, createRangeSquared + 1, true],
    [true, destroyRangeSquared - 1, false],
    [true, destroyRangeSquared, false],
    [true, destroyRangeSquared + 1, true],
  ] as const)(
    'for prior visible=%s classifies distance squared %s outside as %s',
    (wasVisible, distanceSquared, outside) => {
      expect(
        characterViewOutsideHysteresis(
          wasVisible,
          distanceSquared,
          createRangeSquared,
          destroyRangeSquared,
        ),
      ).toBe(outside);
    },
  );

  it('pins renderer wiring to the previous visibility and exact create/destroy ranges', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(
      /characterViewOutsideHysteresis\(\s*v\.group\.visible,\s*d2,\s*this\.entityViewCreateRangeSq,\s*this\.entityViewDestroyRangeSq,\s*\)/,
    );
  });

  // A distance-cull-exempt object (renderer.ts entity_view_policy_core.ts) is
  // created regardless of distance (collectMissingViewCandidates), but a freshly
  // created view starts hidden behind the async-compile gate: wasVisible === false
  // means this function alone would classify anything past the CREATE radius
  // (80yd) as outside, and since the `if` that calls it `continue`s on a match,
  // wasVisible could never flip true to widen the cutoff to the destroy radius -
  // the wardstone view would exist forever but never draw. The renderer's `if`
  // must AND in the exemption so this function's own create-radius verdict is
  // overridden for that one class of object; this pins that the wiring still does.
  it('pins that renderer wiring ANDs in a distance-cull exemption alongside the hysteresis call', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(
      /characterViewOutsideHysteresis\(\s*v\.group\.visible,\s*d2,\s*this\.entityViewCreateRangeSq,\s*this\.entityViewDestroyRangeSq,\s*\)\s*&&\s*!isDistanceCullExemptObject\(e\)/,
    );
  });
});
