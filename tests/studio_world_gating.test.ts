import { describe, expect, it, vi } from 'vitest';
import { CAM_PITCH_DOWN, CAM_PITCH_UP, clampCamPitch } from '../src/game/camera_pitch_range';
import { easedGliderAwareVisualFacing } from '../src/game/glider_controls';
import { clampGliderCameraPitch } from '../src/game/glider_pitch_input';
import {
  diagonalMovementVisualFacing,
  diagonalMovementVisualOffset,
  easeMovementVisualOffset,
} from '../src/game/movement_visual';
import { clickPlacedMover, pickPlacedMoverAt } from '../src/game/placed_mover_input';

// Studio (authored-map) presentation changes are gated so the built-in world
// plays exactly like the release. Each gate below has both arms pinned: the
// built-in arm reproduces the classic behaviour, the authored arm keeps the
// studio behaviour. The test env itself runs on the built-in world.

const noWorldQuest = { worldQuestLog: new Map() };
const diagonal = { forward: true, back: false, strafeLeft: true, strafeRight: false };
const straight = { forward: true, back: false, strafeLeft: false, strafeRight: false };

describe('easedGliderAwareVisualFacing', () => {
  it('is the classic step on the built-in world (default predicate)', () => {
    const resolve = easedGliderAwareVisualFacing(noWorldQuest, () => false);
    // One frame is enough: no easing, the full diagonal offset at once.
    expect(resolve(diagonal, 1, 1 / 60)).toBe(diagonalMovementVisualFacing(diagonal, 1));
    expect(resolve(straight, 1, 1 / 60)).toBeNull();
  });

  it('withholds the classic step while movement is frozen', () => {
    const resolve = easedGliderAwareVisualFacing(
      noWorldQuest,
      () => true,
      () => false,
    );
    expect(resolve(diagonal, 1, 1 / 60)).toBeNull();
  });

  it('eases toward the diagonal on an authored map instead of snapping', () => {
    const resolve = easedGliderAwareVisualFacing(
      noWorldQuest,
      () => false,
      () => true,
    );
    const full = diagonalMovementVisualOffset(diagonal) as number;
    const first = resolve(diagonal, 0, 1 / 60) as number;
    expect(first).not.toBeNull();
    // Part of the way there after one frame, the right direction, not all of it.
    expect(Math.sign(first)).toBe(Math.sign(full));
    expect(Math.abs(first)).toBeLessThan(Math.abs(full));
    let last = first;
    for (let i = 0; i < 120; i++) last = resolve(diagonal, 0, 1 / 60) as number;
    expect(last).toBeCloseTo(full, 3);
    // Releasing the strafe eases back, then hands facing back (null) once settled.
    const back = resolve(straight, 0, 1 / 60);
    expect(back).not.toBeNull();
    let settled: number | null = back;
    for (let i = 0; i < 240 && settled !== null; i++) settled = resolve(straight, 0, 1 / 60);
    expect(settled).toBeNull();
  });

  it('switches arms per frame with the live predicate', () => {
    let authored = true;
    const resolve = easedGliderAwareVisualFacing(
      noWorldQuest,
      () => false,
      () => authored,
    );
    const eased = resolve(diagonal, 0, 1 / 60) as number;
    authored = false;
    expect(resolve(diagonal, 0, 1 / 60)).toBe(diagonalMovementVisualFacing(diagonal, 0));
    authored = true;
    // The classic arm reset the easing state, so the authored arm starts over.
    expect(resolve(diagonal, 0, 1 / 60)).toBeCloseTo(eased, 9);
  });

  it('eases the short way round the wrap', () => {
    const next = easeMovementVisualOffset(3.0, -3.0, 0.05);
    // From +172 deg toward -172 deg: through pi, not back through zero.
    expect(Math.abs(next)).toBeGreaterThan(3.0);
  });
});

describe('clampCamPitch', () => {
  it('keeps the classic look-up limit on the built-in world', () => {
    expect(clampCamPitch(-2, false, false)).toBe(clampGliderCameraPitch(-2, false));
    expect(clampCamPitch(-2, false, false)).toBe(-0.4);
    expect(clampCamPitch(2, false, false)).toBe(1.35);
    // The default argument reads the live world, which is the built-in one here.
    expect(clampCamPitch(-2, false)).toBe(-0.4);
  });

  it('widens the look-up on an authored map only', () => {
    expect(clampCamPitch(-2, false, true)).toBe(CAM_PITCH_UP);
    expect(clampCamPitch(2, false, true)).toBe(CAM_PITCH_DOWN);
    expect(clampCamPitch(0.3, false, true)).toBe(0.3);
  });

  it('defers to the glider clamp while flying on either world', () => {
    for (const authored of [false, true]) {
      expect(clampCamPitch(-2, true, authored)).toBe(clampGliderCameraPitch(-2, true));
    }
  });
});

describe('placed mover input', () => {
  const hit = { id: 7, x: 3, z: 4 };
  type MoverRenderer = Parameters<typeof clickPlacedMover>[0];
  const renderer = () => {
    const mock = { pickPlacedMover: vi.fn(() => hit), togglePlacedMover: vi.fn() };
    return mock as typeof mock & MoverRenderer;
  };

  it('never raycasts for a mover on the built-in world', () => {
    const r = renderer();
    expect(pickPlacedMoverAt(r, 10, 10, true)).toBeNull();
    expect(r.pickPlacedMover).not.toHaveBeenCalled();
    const hud = { showError: vi.fn() };
    // Default argument: the live (built-in) world, so the click carries on picking.
    expect(clickPlacedMover(r, hud, { x: 0, z: 0 }, 10, 10)).toBe(false);
    expect(r.pickPlacedMover).not.toHaveBeenCalled();
  });

  it('picks the mover on an authored map', () => {
    const r = renderer();
    expect(pickPlacedMoverAt(r, 10, 10, false)).toBe(hit);
  });
});
