import type { LancePhase } from '../sim/lance_trial';

// The Shardpike trial (src/sim/lance_trial.ts): the balance-beam readout the HUD meter
// paints every frame while the player has the pike couched, plus the three verbs.
//
// The view is SELF-ONLY on purpose: only the wielder's client needs the beam at 20Hz
// (other players render the brace from the Entity.bracing wire flag), so the state rides
// the self snapshot's delta keys, never the entity stream.

/** One frame of the wielder's own trial. Null whenever no session is live. */
export interface LanceTrialView {
  phase: LancePhase;
  /** Beam position, -1..1; either rail is the fumble the meter is warning about. */
  balance: number;
  /** 0..1 through the set while bracing; holds at 1 once steadied. */
  setProgress: number;
  /** Seconds left to land the thrust while steadied; 0 while still bracing. */
  windowRemaining: number;
}

/**
 * What the wielder should do RIGHT NOW, and how the fight is answering.
 *
 * Separate from `LanceTrialView` because the two have different lifetimes: the trial view
 * exists only inside a live brace, while this exists whenever the pike is in hand, which is
 * exactly when a player needs to be told what the pike is for. Null means no pike.
 */
export interface LanceGuidanceView {
  /** A warded boss is close enough to be what the pike is about. */
  targetPresent: boolean;
  /** Yards to that boss, or null when there is none. */
  targetDistance: number | null;
  /** Inside thrust reach: the thrust would find him. */
  inRange: boolean;
  /** His ward is up and unsealed, so a landed thrust would break it. */
  vulnerable: boolean;
  /** His eye is already out: the window is open and poking again does nothing. */
  blinded: boolean;
  /** Seconds left on the open window (0 when the ward is up). */
  blindRemaining: number;
  /** Seconds until the refractory seal lifts (0 when it already has). */
  sealRemaining: number;
  /** Loomshard Thrusts this character has landed, ever. The bar's tally. */
  thrusts: number;
}

export interface IWorldLanceTrial {
  /** The live trial, or null. Drives the HUD meter and the special bar's state. */
  lanceTrial: LanceTrialView | null;
  /** Seconds until the pike can be braced again (0 = ready); the bar's cooldown swirl. */
  lanceRestRemaining: number;
  /** The loud on-screen prompt's whole input. Null whenever the pike is not in hand. */
  lanceGuidance: LanceGuidanceView | null;
  /** Couch the pike and start balancing. The sim emits the refusal on a closed gate. */
  lanceBrace(): void;
  /** Land the Loomshard Thrust off a SET pike. */
  lanceThrust(): void;
  /** Put the pike up deliberately (no penalty). */
  lanceRelease(): void;
}
