import type { InvSlot } from '../types';

export const COURIER_CAPACITY = 24;
export const COURIER_PAYLOAD_BYTES = 12 * 1024;
/** Reserve bounded metadata separately so flight coordinates never invalidate custody. */
export const COURIER_CUSTODY_BYTES = COURIER_PAYLOAD_BYTES - 512;
/** Admission leaves room for bounded load normalization and armour perfection. */
export const COURIER_ADMISSION_BYTES = COURIER_CUSTODY_BYTES - 512;
export type CourierPhase = 'ready' | 'outbound' | 'returning' | 'waiting';
/** Whole-stack selection. The fingerprint includes quantity and all provenance. */
export interface CourierSelection {
  index: number;
  fingerprint: string;
}
/** Selected stacks for one trip. No selections at all dismisses a ready,
 * empty courier instead (the window closed without a delivery). */
export interface CourierDispatchRequest {
  deposits: CourierSelection[];
  withdrawals: CourierSelection[];
}
export interface CourierState {
  phase: CourierPhase;
  x: number;
  z: number;
  bankerId: number | null;
  /** Legacy pose distance, saturated at eight units for older clients. */
  travelDistance: number;
  /** Elapsed fixed simulation ticks in this leg; absent on legacy saves. */
  travelTicks?: number;
  legStartX?: number;
  legStartZ?: number;
  /** Route length when the leg started; it alone fixes the leg's duration and speeds. */
  legDistance?: number;
  /** Owner facing locked when the return leg starts: the side it lands on. */
  landingYaw?: number;
  cargo: InvSlot[];
  withdrawals: CourierSelection[];
  revision: number;
  /** Remaining simulation seconds, so logout never advances custody. */
  retryRemaining: number;
}
/** True resolves arrival (including returning an unadmittable trip unchanged);
 * false retries transient host pressure without moving either leg. */
export type CourierBankExchange = (
  pid: number,
  deposit: () => void,
  withdraw: () => void,
) => boolean;
export interface CourierInfo
  extends Omit<
    CourierState,
    'retryRemaining' | 'legStartX' | 'legStartZ' | 'legDistance' | 'landingYaw'
  > {
  /** Total ticks of the current leg (at most fifteen seconds); absent while unplanned. */
  legTicks?: number;
  /** Current authoritative target distance; zero while grounded or paused. */
  remainingDistance: number;
  active: boolean;
  bankSlots: InvSlot[];
  bankCapacity: number;
  inventoryRevision: number;
  bankRevision: number;
}
export type CourierPose = Pick<
  CourierInfo,
  | 'phase'
  | 'x'
  | 'z'
  | 'bankerId'
  | 'inventoryRevision'
  | 'travelDistance'
  | 'remainingDistance'
  | 'travelTicks'
  | 'legTicks'
>;
