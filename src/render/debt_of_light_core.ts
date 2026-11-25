import { aegisPoint } from './guardian_covenant_core';
import { PALADIN_BODY_FIT } from './paladin_body_fit';

export const DEBT_CAPACITY = 16;
export const DEBT_SEGMENTS = 32;
export const DEBT_RETURN_DURATION = 0.55;
export const DEBT_FADE_DURATION = 0.2;
export const DEBT_VERTEX_BUDGET = 1200;
export interface DebtShieldPoint {
  x: number;
  y: number;
  z: number;
}
/** A continuous bowed kite, with a pointed base and round shoulders. */
export function debtShieldPoint(t: number, out: DebtShieldPoint): void {
  aegisPoint(t * Math.PI * 2, 0.7, 1, true, out);
  out.y -= PALADIN_BODY_FIT.shieldCenter;
  out.z -= PALADIN_BODY_FIT.shieldFront;
}
export function debtSpikeGrowth(age: number, reduced: boolean): number {
  if (reduced) return 1;
  return 1 - (1 - Math.max(0, Math.min(1, age / 0.09))) ** 3;
}

/** Source damage events retain the display name on the older workshop wire. */
export function isDebtReturn(id: string | null | undefined, name: string | null): boolean {
  return id === 'faithforged_guard' || (!id && name === 'Debt of Light');
}
export function debtEnvelope(age: number): number {
  return Math.max(0, 1 - age / DEBT_RETURN_DURATION) ** 1.5;
}
/** Released spikes and the attacker's burst are brief; the shield lingers after. */
export function debtSpikeRelease(age: number): number {
  if (age < 0.12) return 1;
  return Math.max(0, 1 - (age - 0.12) / 0.2) ** 1.3;
}
/** Two ribbons of light swirl round the wearer while the debt is held. */
export const DEBT_WISPS = 2;
export const DEBT_WISP_SEGMENTS = 12;
