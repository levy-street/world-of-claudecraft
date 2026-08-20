// Reconnect-safe projection for Varkhul's Forgestorm warnings. Encounter state
// owns damage and timing; this leaf owns the minimal presentation contract.

export interface ActiveVarkhulForgestormWarning {
  id: number;
  sourceId: number;
  x: number;
  z: number;
  radius: number;
  duration: number;
  remaining: number;
}

export interface VarkhulForgestormWarningState {
  forgestormCastKey: number;
  forgestormWaveIndex: number;
  forgestormWarningRemaining: number;
  forgestormPoints: ReadonlyArray<{ x: number; z: number }>;
}

export const VARKHUL_FORGESTORM_WARNING_SECONDS = 2.5;
export const VARKHUL_FORGESTORM_RADIUS = 4;

export function varkhulForgestormWarningId(
  bossId: number,
  castKey: number,
  waveIndex: number,
  pointIndex: number,
): number {
  return bossId * 1_000_000 + castKey * 100 + waveIndex * 10 + pointIndex;
}

export function activeVarkhulForgestormWarnings(
  bossId: number,
  state: VarkhulForgestormWarningState,
): ActiveVarkhulForgestormWarning[] {
  if (state.forgestormWarningRemaining <= 0) return [];
  return state.forgestormPoints.map((point, pointIndex) => ({
    id: varkhulForgestormWarningId(
      bossId,
      state.forgestormCastKey,
      state.forgestormWaveIndex,
      pointIndex,
    ),
    sourceId: bossId,
    x: point.x,
    z: point.z,
    radius: VARKHUL_FORGESTORM_RADIUS,
    duration: VARKHUL_FORGESTORM_WARNING_SECONDS,
    remaining: Math.min(state.forgestormWarningRemaining, VARKHUL_FORGESTORM_WARNING_SECONDS),
  }));
}
