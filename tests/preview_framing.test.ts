import { describe, expect, it } from 'vitest';
import { PLAYER_HEIGHT_SCALE } from '../src/render/characters/player_scale';
import { PREVIEW_FRAMING } from '../src/render/characters/preview_framing';

// The character turntable camera framing lives in a pure constants module so a
// Node test can pin the two framings without a WebGL context. The self character
// sheet frames close and face-on; the inspect window pulls the camera back so a
// tall silhouette (a pointed hat, a staff) stays inside the frame.
//
// Every number is an absolute world-unit distance from the model's feet, composed
// around a body of a known height, so the framings are lifted by PLAYER_HEIGHT_SCALE
// to match the taller player rigs. Both the resolved values AND the base-times-scale
// relationship are pinned: the literals catch a silent retune, and the relationship
// catches someone changing the player scale without moving the camera (which crops
// the crown and the feet out of the character screen).

describe('PREVIEW_FRAMING', () => {
  it('pins the self-sheet framing (the classic close, face-on camera)', () => {
    expect(PREVIEW_FRAMING.sheet).toEqual({ y: 1.74, z: 6.12, lookY: 1.56 });
  });

  it('pins the pulled-back inspect framing', () => {
    expect(PREVIEW_FRAMING.inspect).toEqual({ y: 1.8, z: 7.92, lookY: 1.56 });
  });

  it('inspect sits farther back and slightly higher than the self sheet', () => {
    expect(PREVIEW_FRAMING.inspect.z).toBeGreaterThan(PREVIEW_FRAMING.sheet.z);
    expect(PREVIEW_FRAMING.inspect.y).toBeGreaterThan(PREVIEW_FRAMING.sheet.y);
  });

  it('lifts the 2.6-era base framings by exactly the player height scale', () => {
    // The originals, tuned against a stock 2.6 rig. Pinned as literals here so this
    // stays a real cross-check and not a restatement of the module's own arithmetic.
    const base = {
      sheet: { y: 1.45, z: 5.1, lookY: 1.3 },
      inspect: { y: 1.5, z: 6.6, lookY: 1.3 },
    } as const;

    for (const name of ['sheet', 'inspect'] as const) {
      for (const axis of ['y', 'z', 'lookY'] as const) {
        expect(PREVIEW_FRAMING[name][axis], `${name}.${axis}`).toBeCloseTo(
          base[name][axis] * PLAYER_HEIGHT_SCALE,
          4,
        );
      }
    }
  });
});
