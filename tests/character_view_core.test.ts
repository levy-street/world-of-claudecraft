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

  it('pins renderer wiring to the previous RANGE verdict and exact create/destroy ranges', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(
      /characterViewOutsideHysteresis\(\s*v\.inDrawRange,\s*d2,\s*this\.entityViewCreateRangeSq,\s*this\.entityViewDestroyRangeSq,\s*\)/,
    );
    expect(renderer).toMatch(/v\.inDrawRange = inDrawRange;/);
  });

  // `wasVisible` must be the previous RANGE verdict, never the drawn flag. The
  // frustum cull (character_cull_core.ts) writes `group.visible` at the end of
  // the same loop, so feeding that back in latches: a rig between the create
  // (80yd) and destroy (96yd) radii that goes off camera once reads as "was not
  // visible" the next frame, falls outside the tighter create cutoff, and is
  // `continue`d before the cull can re-evaluate it. Turning back never restores
  // it. The view carries its own `inDrawRange` for exactly this reason.
  it('pins that the renderer never feeds the drawn flag back into the hysteresis', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/characterViewOutsideHysteresis\(\s*v\.group\.visible/);
  });

  it('re-shows a rig in the 80 to 96 band whose range verdict survived a hide', () => {
    const createSq = 80 * 80;
    const destroySq = 96 * 96;
    const at85 = 85 * 85;
    // The latch, stated as the function sees it: the same distance answers
    // "outside" or "inside" purely on which flag the caller kept.
    expect(characterViewOutsideHysteresis(false, at85, createSq, destroySq)).toBe(true);
    expect(characterViewOutsideHysteresis(true, at85, createSq, destroySq)).toBe(false);
  });

  // A distance-cull-exempt object (renderer.ts entity_view_policy_core.ts) is
  // created regardless of distance (collectMissingViewCandidates), but a freshly
  // created view starts hidden behind the async-compile gate: wasVisible === false
  // means this function alone would classify anything past the CREATE radius
  // (80yd) as outside, and since the `if` that calls it `continue`s on a match,
  // wasVisible could never flip true to widen the cutoff to the destroy radius -
  // the wardstone view would exist forever but never draw. The renderer's `if`
  // must short-circuit on the exemption so this function's own create-radius
  // verdict is overridden for that one class of object; this pins that it does.
  it('pins that renderer wiring short-circuits on a distance-cull exemption', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(
      /isDistanceCullExemptObject\(e\)\s*\|\|\s*!characterViewOutsideHysteresis\(/,
    );
  });
});
