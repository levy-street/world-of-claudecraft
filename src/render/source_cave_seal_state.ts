import type { SourceCaveInfo, SourceCaveSealState } from '../world_api';

export interface SourceCaveSealVisualState {
  mode: SourceCaveSealState;
  occupancy: number;
  energy: number;
  pulseSpeed: number;
  flowDirection: -1 | 0 | 1;
  /** Animated luminous perimeter, the do-not-cross hint of the contained phase. */
  boundaryGlow: 0 | 1;
}

export function sourceCaveSealVisualState(info: SourceCaveInfo): SourceCaveSealVisualState {
  const occupancy =
    info.playersInInstance > 0
      ? Math.max(0, Math.min(1, info.playersInsideSeal / info.playersInInstance))
      : 0;
  if (info.sealState === 'breached') {
    return {
      mode: 'breached',
      occupancy,
      energy: 1,
      pulseSpeed: 5.5,
      flowDirection: 1,
      boundaryGlow: 0,
    };
  }
  if (info.sealState === 'active') {
    return {
      mode: 'active',
      occupancy,
      energy: 0.42,
      pulseSpeed: 0.65,
      flowDirection: -1,
      boundaryGlow: 1,
    };
  }
  if (info.sealState === 'cleared') {
    // The wreck. Clearing this room is vandalism, not a repair, so the seal is
    // not "off" and not "restored": it is visibly broken for good, and stays
    // that way. `energy` scales the few surviving circuit traces and
    // `pulseSpeed` is the rim's breathing rate in radians per second (1.6 gives
    // a ~3.9s ease-in/out cycle, slow enough that nothing here reads as a
    // flash). `flowDirection` is unused in this mode: the wreck has no flow
    // left. `boundaryGlow` stays 0 because the perimeter switches from the
    // containment chase to its own fault breath inside the shader's wreck branch.
    return {
      mode: 'cleared',
      occupancy: 0,
      energy: 0.5,
      pulseSpeed: 1.6,
      flowDirection: 0,
      boundaryGlow: 0,
    };
  }
  return {
    mode: 'idle',
    occupancy,
    energy: occupancy,
    pulseSpeed: occupancy > 0 ? 0.45 + occupancy * 0.35 : 0,
    flowDirection: occupancy > 0 ? -1 : 0,
    boundaryGlow: 0,
  };
}

export function sourceCaveSealModeNumber(mode: SourceCaveSealState): number {
  if (mode === 'active') return 1;
  if (mode === 'breached') return 2;
  if (mode === 'cleared') return 3;
  return 0;
}
