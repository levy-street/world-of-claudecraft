import { describe, expect, it } from 'vitest';
import { stickSteerOffset } from '../src/game/gamepad_map';

// stickSteerOffset maps the left-stick vector to a facing OFFSET from camera
// forward (radians): stick up = 0, right = +pi/2, left = -pi/2, down = +/-pi.
// The caller adds the live camera yaw. Facing convention matches the sim's
// (sin(facing), cos(facing)) direction used elsewhere, so up (y<0) is forward.
describe('stickSteerOffset', () => {
  it('returns null inside the deadzone (no steering when idle)', () => {
    expect(stickSteerOffset(0, 0, 0.2)).toBeNull();
    expect(stickSteerOffset(0.1, 0.1, 0.2)).toBeNull();
  });

  it('maps stick up to camera-forward (offset 0)', () => {
    expect(stickSteerOffset(0, -1, 0.2)).toBeCloseTo(0, 6);
  });

  it('maps stick left to +pi/2 (screen-left) and right to -pi/2, matching camYaw handedness', () => {
    // camYaw increases turning screen-left, so a left push must yield a positive
    // offset (camYaw + pi/2 faces screen-left). See stickToLook for the yaw sign.
    expect(stickSteerOffset(-1, 0, 0.2)).toBeCloseTo(Math.PI / 2, 6);
    expect(stickSteerOffset(1, 0, 0.2)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('maps stick down to a half turn (magnitude pi)', () => {
    expect(Math.abs(stickSteerOffset(0, 1, 0.2) as number)).toBeCloseTo(Math.PI, 6);
  });

  it('resolves a diagonal to 45 degrees off forward', () => {
    // up-left at full deflection -> +pi/4 (screen-left of camera-forward)
    expect(stickSteerOffset(-0.8, -0.8, 0.2)).toBeCloseTo(Math.PI / 4, 6);
  });

  it('ignores magnitude past the deadzone (any deflection steers at full run)', () => {
    // same direction, different magnitudes -> same offset
    expect(stickSteerOffset(0.3, -0.3, 0.2)).toBeCloseTo(
      stickSteerOffset(0.9, -0.9, 0.2) as number,
      6,
    );
  });
});
