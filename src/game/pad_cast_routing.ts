import type { PadCastHold } from './gamepad_map';

type PadCastAction = { type: 'ability' | 'item'; id: string };

export interface PadCastHud {
  pressCrossHotbarAction(action: PadCastAction): void;
  releaseCrossHotbarAction(action: PadCastAction): void;
  releaseSlot(slot: number): void;
}

export function padCastPress(
  hud: PadCastHud,
  autoTarget: (action: PadCastAction) => void,
  action: PadCastAction,
): void {
  autoTarget(action);
  hud.pressCrossHotbarAction(action);
}

export function padCastRelease(hud: PadCastHud, hold: PadCastHold): void {
  if (hold.kind === 'slot') hud.releaseSlot(hold.slot);
  else hud.releaseCrossHotbarAction(hold.action);
}
