import type { InvSlot } from '../types';

export const COURIER_CAPACITY = 24;
export const COURIER_PAYLOAD_BYTES = 12 * 1024;
/** Reserve bounded metadata separately so flight coordinates never invalidate custody. */
export const COURIER_CUSTODY_BYTES = COURIER_PAYLOAD_BYTES - 512;
/** Admission leaves room for bounded load normalization and armour perfection. */
export const COURIER_ADMISSION_BYTES = COURIER_CUSTODY_BYTES - 512;
/** +150% of the ordinary 7 units/second movement speed. */
export const COURIER_SPEED = 17.5;
export type CourierPhase = 'ready' | 'outbound' | 'returning' | 'waiting';
/** Whole-stack selection. The fingerprint includes quantity and all provenance. */
export interface CourierSelection {
  index: number;
  fingerprint: string;
}
export interface CourierDispatchRequest {
  deposits: CourierSelection[];
  withdrawals: CourierSelection[];
}
export interface CourierState {
  phase: CourierPhase;
  x: number;
  z: number;
  bankerId: number | null;
  cargo: InvSlot[];
  withdrawals: CourierSelection[];
  revision: number;
  /** Remaining simulation seconds, so logout never advances custody. */
  retryRemaining: number;
}
export type CourierBankExchange = (
  pid: number,
  deposit: () => void,
  withdraw: () => void,
) => boolean;
export interface CourierInfo extends Omit<CourierState, 'retryRemaining'> {
  active: boolean;
  bankSlots: InvSlot[];
  bankCapacity: number;
  inventoryRevision: number;
  bankRevision: number;
}
export type CourierPose = Pick<CourierInfo, 'phase' | 'x' | 'z' | 'bankerId' | 'inventoryRevision'>;
