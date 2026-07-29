import type { SceneAttachFrame } from '../sim/types';
import type { PropPathSample } from './prop_path_core';

export interface HarborShipBasePose {
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly baseRot: number;
}

export interface PendingHarborShipCue {
  readonly cue: string;
  readonly startSec: number;
}

export interface ResolvedHarborShipCue<TSegment> {
  readonly segment: TSegment;
  readonly cueStartSec: number;
}

/** Resolve a recorded cue without replacing its original start time. */
export function resolvePendingCue<TSegment>(
  pending: PendingHarborShipCue | undefined,
  segments: Readonly<Record<string, TSegment | undefined>>,
): ResolvedHarborShipCue<TSegment> | null {
  if (!pending) return null;
  const segment = segments[pending.cue];
  if (segment === undefined) return null;
  return { segment, cueStartSec: pending.startSec };
}

/** Own deterministic pending cue state while the Three-side ship handle is absent. */
export class HarborShipPendingCueState<TSegment> {
  private readonly pending = new Map<string, PendingHarborShipCue>();

  constructor(private readonly segments: Readonly<Record<string, TSegment | undefined>>) {}

  routeCue(
    target: string,
    cue: string,
    startSec: number,
    handleAvailable: boolean,
  ): ResolvedHarborShipCue<TSegment> | null {
    if (!handleAvailable) {
      this.pending.set(target, { cue, startSec });
      return null;
    }
    this.pending.delete(target);
    return resolvePendingCue({ cue, startSec }, this.segments);
  }

  consumePending(target: string): ResolvedHarborShipCue<TSegment> | null {
    const pending = this.pending.get(target);
    this.pending.delete(target);
    return resolvePendingCue(pending, this.segments);
  }

  clearPending(): void {
    this.pending.clear();
  }
}

/** Compose a parked or live ship pose into its world attach frame. */
export function composeHarborShipAttachFrame(
  base: HarborShipBasePose,
  pose: PropPathSample | null,
  out: SceneAttachFrame,
): SceneAttachFrame {
  if (pose === null) {
    out.position.x = base.baseX;
    out.position.y = base.baseY;
    out.position.z = base.baseZ;
    out.yaw = base.baseRot;
    return out;
  }

  const yaw = base.baseRot + pose.yaw;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  out.position.x = base.baseX + pose.x * cosYaw + pose.z * sinYaw;
  out.position.y = base.baseY + pose.y;
  out.position.z = base.baseZ - pose.x * sinYaw + pose.z * cosYaw;
  out.yaw = yaw;
  return out;
}
