import { describe, expect, it } from 'vitest';
import { PREVIEW_FRAMING } from '../src/render/characters/preview_framing';

// The character turntable camera framing lives in a pure constants module so a
// Node test can pin the two framings without a WebGL context. The self character
// sheet frames close and face-on; the inspect window pulls the camera back so a
// tall silhouette (a pointed hat, a staff) stays inside the frame.

describe('PREVIEW_FRAMING', () => {
  it('pins the self-sheet framing (the classic close, face-on camera)', () => {
    expect(PREVIEW_FRAMING.sheet).toEqual({ y: 1.45, z: 5.1, lookY: 1.3 });
  });

  it('pins the pulled-back inspect framing', () => {
    expect(PREVIEW_FRAMING.inspect).toEqual({ y: 1.5, z: 6.6, lookY: 1.3 });
  });

  it('inspect sits farther back and slightly higher than the self sheet', () => {
    expect(PREVIEW_FRAMING.inspect.z).toBeGreaterThan(PREVIEW_FRAMING.sheet.z);
    expect(PREVIEW_FRAMING.inspect.y).toBeGreaterThan(PREVIEW_FRAMING.sheet.y);
  });
});
