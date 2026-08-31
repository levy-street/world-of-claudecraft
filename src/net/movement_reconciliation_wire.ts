export class ReconWireState {
  reconAuthoritativeX: number | null = null;
  reconAuthoritativeY: number | null = null;
  reconAuthoritativeZ: number | null = null;
  reconPreviousAuthoritativeFacing: number | null = null;
  reconAuthoritativeFacing: number | null = null;
  reconAckClientTick = -1;
  reconOverrideEpoch = 0;
  reconOverrideActive = false;
  reconMoveSpeedMult = 1;

  resetReconWireState(): void {
    this.reconAuthoritativeX = null;
    this.reconAuthoritativeY = null;
    this.reconAuthoritativeZ = null;
    this.reconPreviousAuthoritativeFacing = null;
    this.reconAuthoritativeFacing = null;
    this.reconAckClientTick = -1;
    this.reconOverrideEpoch = 0;
    this.reconOverrideActive = false;
    this.reconMoveSpeedMult = 1;
  }
}

interface MovementReconciliationSelfWire {
  rpx?: unknown;
  rpy?: unknown;
  rpz?: unknown;
  rpf?: unknown;
  ackCt?: unknown;
  ovE?: unknown;
  ovA?: unknown;
  msm?: unknown;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function applyReconSelfWire(
  target: ReconWireState,
  self: MovementReconciliationSelfWire,
  movementWireVersion: 1 | 2,
): void {
  if (
    movementWireVersion !== 2 ||
    !finiteNumber(self.rpx) ||
    !finiteNumber(self.rpy) ||
    !finiteNumber(self.rpz) ||
    !finiteNumber(self.rpf) ||
    !Number.isSafeInteger(self.ackCt) ||
    (self.ackCt as number) < -1 ||
    !Number.isSafeInteger(self.ovE) ||
    (self.ovE as number) < 0 ||
    (self.msm !== undefined && (!finiteNumber(self.msm) || self.msm < 0))
  ) {
    return;
  }
  const previousFacing = target.reconAuthoritativeFacing ?? self.rpf;
  target.reconAuthoritativeX = self.rpx;
  target.reconAuthoritativeY = self.rpy;
  target.reconAuthoritativeZ = self.rpz;
  target.reconPreviousAuthoritativeFacing = previousFacing;
  target.reconAuthoritativeFacing = self.rpf;
  target.reconAckClientTick = self.ackCt as number;
  target.reconOverrideEpoch = self.ovE as number;
  target.reconOverrideActive = self.ovA === 1;
  target.reconMoveSpeedMult = self.msm === undefined ? 1 : self.msm;
}
