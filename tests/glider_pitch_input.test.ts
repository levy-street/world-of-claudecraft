import { describe, expect, it } from 'vitest';
import { gliderPitchFromCamera } from '../src/game/glider_pitch_input';
import { inputSignature } from '../src/net/input_signature';
import { sendMovementFrameV2 } from '../src/net/movement_frame_v2_wire';
import { parseMoveInputFrame, sanitizeMoveInput } from '../src/sim/move_input';
import { emptyMoveInput } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

describe('glider camera pitch intent', () => {
  it('reaches full recovery before the upper camera stop and full dive before looking straight down', () => {
    expect(gliderPitchFromCamera(-0.2, true, true)).toBe(1);
    expect(gliderPitchFromCamera(0.9, true, true)).toBe(-1);
  });
  it('maps up to climb, down to dive, and the default view to neutral', () => {
    expect(gliderPitchFromCamera(-0.4, true, true)).toBe(1);
    expect(gliderPitchFromCamera(1.35, true, true)).toBe(-1);
    expect(gliderPitchFromCamera(0.32, true, true)).toBe(0);
    expect(gliderPitchFromCamera(0.34, true, true)).toBe(0);
    expect(gliderPitchFromCamera(-100, true, true)).toBe(1);
  });

  it('drops pitch on release, outside flight, and for non-finite camera state', () => {
    expect(gliderPitchFromCamera(-0.4, true, false)).toBeUndefined();
    expect(gliderPitchFromCamera(-0.4, false, true)).toBeUndefined();
    expect(gliderPitchFromCamera(Number.NaN, true, true)).toBeUndefined();
  });

  it('validates signed compact and controller input without losing explicit neutral', () => {
    for (const [raw, expected] of [
      [-4, -1],
      [-0.5, -0.5],
      [0, 0],
      [0.5, 0.5],
      [4, 1],
    ]) {
      expect(sanitizeMoveInput({ gp: raw }).gliderPitch).toBe(expected);
      expect(sanitizeMoveInput({ gliderPitch: raw }).gliderPitch).toBe(expected);
    }
    for (const raw of [undefined, null, '1', true, NaN, Infinity, -Infinity, {}]) {
      expect(sanitizeMoveInput({ gp: raw }).gliderPitch).toBeUndefined();
    }
  });

  it('round-trips climb, neutral, dive and release through the actual v2 wire parser', () => {
    for (const pitch of [1, 0, -1, undefined]) {
      let sent = '';
      const mi = { ...emptyMoveInput(), gliderPitch: pitch };
      expect(
        sendMovementFrameV2(
          {
            bufferedAmount: 0,
            send: (s) => {
              sent = s;
            },
          },
          true,
          { ct: 1, mi, facing: null },
          1,
        ),
      ).toBe(true);
      expect(parseMoveInputFrame(JSON.parse(sent)).moveInput.gliderPitch).toBe(pitch);
      expect(Object.hasOwn(JSON.parse(sent).mi, 'gp')).toBe(pitch !== undefined);
    }
  });

  it('change suppression distinguishes neutral from released keyboard fallback', () => {
    const signatures = [undefined, 0, 1, -1].map((gliderPitch) =>
      inputSignature({ ...emptyMoveInput(), gliderPitch }, null),
    );
    expect(new Set(signatures).size).toBe(4);
  });

  it('clears a previous pitch through the mutable input assignment and reset seams', () => {
    const live = emptyMoveInput();
    Object.assign(live, sanitizeMoveInput({ gp: -1 }));
    expect(live.gliderPitch).toBe(-1);
    Object.assign(live, sanitizeMoveInput({}));
    expect(live.gliderPitch).toBeUndefined();
    Object.assign(live, sanitizeMoveInput({ gp: 1 }));
    Object.assign(live, emptyMoveInput());
    expect(live.gliderPitch).toBeUndefined();
  });

  it('clears climb on the real online client setMoveInput path when RMB is released', () => {
    const client = bareClient(1);
    client.setMoveInput({ gliderPitch: 1 });
    expect(client.moveInput.gliderPitch).toBe(1);
    client.setMoveInput({});
    expect(client.moveInput.gliderPitch).toBeUndefined();
  });
});
