// Korgath the Bound's fight state (encounters/gravewyrm_sanctum/korgath.ts), on
// the boss as Entity.sanctumFight. A type-only leaf so src/sim/types.ts can name
// it in the SanctumFightState union. Sim authority only: the client reads the
// fight from casts, auras and the encounter objects (the chain objects carry
// each chain's state in their template id).

import type { SealTool } from './boss_ids';

/** One of the four seal chains, in SEAL_TOOLS order. */
export interface KorgathChain {
  tool: SealTool;
  /** Broken right now (its shackle fell and no Re-rivet has pinned it again). */
  broken: boolean;
  /** Broken at any time this pull (the deeds and the story read it). */
  everBroken: boolean;
  /** The Seal Shackle's entity id while one stands, else null. */
  shackleId: number | null;
  /** The chain state object's entity id (sealChainTemplate). */
  objectId: number | null;
  /** Heroic Re-rivet: seconds until a Goadsmith comes for this broken chain
   *  (null when none is due). */
  rivetIn: number | null;
  /** Heroic Re-rivet in progress: the Goadsmith, where it is held, and whether
   *  it is still walking ('run') or channelling ('channel'). */
  rivet: {
    goadsmithId: number;
    at: { x: number; y: number; z: number };
    phase: 'run' | 'channel';
  } | null;
}

export interface KorgathFightState {
  kind: 'korgath';
  /** The pull is live (false while the chains wait for the group). */
  engaged: boolean;
  /** He has fallen and his death was resolved (deeds, the last line). */
  finished: boolean;
  chains: KorgathChain[];
  maulTimer: number;
  flailTimer: number;
  chargeTimer: number;
  bellowTimer: number;
  strainTimer: number;
  stompTimer: number;
  /** The Maul Arc's locked aim while its bar runs. */
  maulYaw: number | null;
  /** Chain Flail or Threshold Charge: the lane locked at the bar's start
   *  (instance-local start, yaw, length, half width). */
  lane: { x: number; z: number; yaw: number; length: number; halfWidth: number } | null;
  /** The Threshold Charge in flight (instance-local), `t` seconds into the run. */
  charge: { x: number; z: number; yaw: number; length: number; t: number } | null;
  /** Seconds before his next bar may start (KORGATH_TUNING.barGap after a
   *  strike lands); his melee carries on through it. */
  recover: number;
  /** Which voice lines he has spoken this pull (KORGATH_LINES keys). */
  lines: string[];
  enraged: boolean;
  /** Mechanic casts started (the deterministic salt). */
  casts: number;
}
