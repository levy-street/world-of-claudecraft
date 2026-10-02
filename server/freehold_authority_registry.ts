// THE PROCESS-WIDE HANDLE on the realm's housing AUTHORITY counters (07a): the
// global plot claims this process holds and what happened to them, and the
// remote Hearth trips. The server/freehold_persist_registry.ts shape: the
// coordinator registers the two live sources, and the metrics scrape reads them
// here rather than through GameServer, answering zeros when none is registered
// (a test host, or a realm before its first construction). Counts only: no
// account id, owner key, plot id, token or holder can reach a scrape from here.
import {
  createFreeholdClaimCounters,
  type FreeholdClaimCounters,
  type FreeholdClaimRegistry,
} from './freehold_claim_registry';
import {
  createFreeholdHearthTripCounters,
  type FreeholdHearthTripCounters,
} from './freehold_hearth_trip';
import {
  createFreeholdOperationRecoveryCounters,
  type FreeholdOperationRecoveryCounters,
} from './freehold_operation_recovery';

export interface FreeholdAuthorityStats {
  /** Claims this process holds right now. */
  readonly claimsHeld: number;
  readonly claims: Readonly<FreeholdClaimCounters>;
  readonly trips: Readonly<FreeholdHearthTripCounters>;
  /** The operation recovery passes (zero while no kind is registered). */
  readonly recovery: Readonly<FreeholdOperationRecoveryCounters>;
}

// The unregistered answer: the same initializers the live sources use, so a
// counter added to either can never be missing from a scrape of zeros.
const ZERO_CLAIMS: FreeholdClaimCounters = Object.freeze(createFreeholdClaimCounters());
const ZERO_TRIPS: FreeholdHearthTripCounters = Object.freeze(createFreeholdHearthTripCounters());
const ZERO_RECOVERY: FreeholdOperationRecoveryCounters = Object.freeze(
  createFreeholdOperationRecoveryCounters(),
);

let claims: FreeholdClaimRegistry | null = null;
let trips: { readonly counters: FreeholdHearthTripCounters } | null = null;
let recovery: FreeholdOperationRecoveryCounters | null = null;

/** Passing nulls unregisters, which is what a test teardown does. */
export function registerFreeholdAuthority(
  source: {
    readonly claims: FreeholdClaimRegistry;
    readonly trips: { readonly counters: FreeholdHearthTripCounters };
  } | null,
): void {
  claims = source?.claims ?? null;
  trips = source?.trips ?? null;
}

/** The realm store's operation recovery counters (registered by its
 *  composition root, server/freehold_persist_wiring.ts); null unregisters. */
export function registerFreeholdRecovery(counters: FreeholdOperationRecoveryCounters | null): void {
  recovery = counters;
}

/** The LIVE registry, for the one caller that must act on it rather than read
 *  it: the shutdown release (server/main.ts), so a release at exit leaves the
 *  registry and books claim_released like any other. Undefined when none is
 *  registered. */
export function heldClaims(): FreeholdClaimRegistry | undefined {
  return claims ?? undefined;
}

/** One scrape: COPIES, so a caller can never reach the live counters. */
export function freeholdAuthorityStats(): FreeholdAuthorityStats {
  return {
    claimsHeld: claims ? claims.count() : 0,
    claims: { ...(claims?.counters ?? ZERO_CLAIMS) },
    trips: { ...(trips?.counters ?? ZERO_TRIPS) },
    recovery: { ...(recovery ?? ZERO_RECOVERY) },
  };
}
