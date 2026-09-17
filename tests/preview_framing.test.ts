import { describe, expect, it } from 'vitest';
import { PREVIEW_FRAMING } from '../src/render/characters/preview_framing';

// The character turntable camera framing lives in a pure constants module so a
// Node test can pin the two framings without a WebGL context. The self character
// sheet frames close and face-on; the inspect window pulls the camera back so a
// tall silhouette (a pointed hat, a staff) stays inside the frame.

describe('PREVIEW_FRAMING', () => {
  it('pins the self-sheet framing (face-on, a step back from the classic close camera)', () => {
    expect(PREVIEW_FRAMING.sheet).toEqual({ y: 1.45, z: 5.67, lookY: 1.3 });
  });

  it('draws the sheet model about a tenth smaller than the classic 5.1 distance', () => {
    // Apparent size scales with 1 / distance, so 5.1 / 5.67 is the on-screen ratio.
    // The gear columns float over the stage edges; the step back keeps a wide
    // silhouette (a shield arm, a drawn weapon) clear of their names.
    expect(5.1 / PREVIEW_FRAMING.sheet.z).toBeCloseTo(0.9, 2);
  });

  it('pins the pulled-back inspect framing', () => {
    expect(PREVIEW_FRAMING.inspect).toEqual({ y: 1.5, z: 6.6, lookY: 1.3 });
  });

  it('inspect sits farther back and slightly higher than the self sheet', () => {
    expect(PREVIEW_FRAMING.inspect.z).toBeGreaterThan(PREVIEW_FRAMING.sheet.z);
    expect(PREVIEW_FRAMING.inspect.y).toBeGreaterThan(PREVIEW_FRAMING.sheet.y);
  });
});
