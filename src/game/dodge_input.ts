export interface DodgeLocalDirection {
  /** Local right is positive, local left is negative. */
  x: number;
  /** Local forward is positive, local backward is negative. */
  z: number;
}

export const DODGE_DOUBLE_TAP_MS = 250;

type DirectionalAction =
  | 'forward'
  | 'back'
  | 'turnLeft'
  | 'turnRight'
  | 'strafeLeft'
  | 'strafeRight';

interface TapState {
  at: number;
  released: boolean;
}

export function dodgeDirectionForAction(action: string | null): DodgeLocalDirection | null {
  switch (action as DirectionalAction | null) {
    case 'forward':
      return { x: 0, z: 1 };
    case 'back':
      return { x: 0, z: -1 };
    case 'turnLeft':
    case 'strafeLeft':
      return { x: -1, z: 0 };
    case 'turnRight':
    case 'strafeRight':
      return { x: 1, z: 0 };
    default:
      return null;
  }
}

/**
 * A key must lift between presses. Tracking the physical code keeps W and
 * ArrowUp independent and prevents two simultaneously-held aliases from
 * masquerading as a double tap.
 */
export class DodgeDoubleTapTracker {
  private readonly taps = new Map<string, TapState>();

  constructor(private readonly windowMs = DODGE_DOUBLE_TAP_MS) {}

  press(code: string, now: number): boolean {
    const previous = this.taps.get(code);
    const doubled =
      previous !== undefined &&
      previous.released &&
      now >= previous.at &&
      now - previous.at <= this.windowMs;
    if (doubled) this.taps.delete(code);
    else this.taps.set(code, { at: now, released: false });
    return doubled;
  }

  release(code: string): void {
    const state = this.taps.get(code);
    if (state) state.released = true;
  }

  clear(): void {
    this.taps.clear();
  }
}

export function heldDodgeDirection(input: {
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
}): DodgeLocalDirection {
  const x =
    Number(input.turnRight || input.strafeRight) - Number(input.turnLeft || input.strafeLeft);
  const z = Number(input.forward) - Number(input.back);
  if (x === 0 && z === 0) return { x: 0, z: -1 };
  const length = Math.hypot(x, z);
  return { x: x / length, z: z / length };
}

export function localDodgeToWorld(
  local: Readonly<DodgeLocalDirection>,
  facing: number,
): DodgeLocalDirection {
  if (!Number.isFinite(local.x) || !Number.isFinite(local.z) || !Number.isFinite(facing)) {
    return { x: 0, z: 0 };
  }
  const length = Math.hypot(local.x, local.z);
  if (length <= 1e-9) return { x: 0, z: 0 };
  const x = local.x / length;
  const z = local.z / length;
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  return { x: z * sin - x * cos, z: z * cos + x * sin };
}
