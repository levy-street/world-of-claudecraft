// The ops monitor's stuck-custody vocabulary, extracted from woc_market.ts on
// the monolith ratchet (a leaf types module: no imports, so the monitor, the
// db layer and the service can all name these shapes without a cycle).
// woc_market.ts re-exports the pair, so existing importers keep their path.

/** The stuck classes the ops monitor surfaces (stuckCustodyReadout).
 *  Counts SATURATE at the readout's countCap; saturated makes the "cap or
 *  more" case explicit on the wire. Samples are separately capped. */
export interface WocStuckCustodyClasses {
  unbookedClaims: {
    count: number;
    saturated: boolean;
    sample: {
      custodyRef: string;
      claimedAtMs: number;
      grantCharacterId: number | null;
      mailIntent: boolean;
    }[];
  };
  stuckDelivering: {
    count: number;
    saturated: boolean;
    /** updatedAtMs is the class's age signal (stamped at the delivering
     *  claim); createdAtMs is kept for provenance (when the settlement
     *  itself began). */
    sample: { id: number; listingId: number; createdAtMs: number; updatedAtMs: number }[];
  };
  undisposedListings: {
    count: number;
    saturated: boolean;
    sample: { id: number; resolution: string | null; updatedAtMs: number }[];
  };
  /** Settlements the overdue sweep parked in 'review' (the H15 bound): every
   *  row is operator-actionable NOW, so this class carries no age filter.
   *  Operator semantics: verify the payment reference on chain (the service
   *  release tooling), then transitionSettlement review -> confirmed (paid:
   *  delivery resumes) or review -> failed (unpaid: the overdue default pass
   *  takes it from there). updatedAtMs is when the row entered review. */
  reviewSettlements: {
    count: number;
    saturated: boolean;
    sample: { id: number; listingId: number; createdAtMs: number; updatedAtMs: number }[];
  };
  /** Paid-but-undecided bonds (pending_bond with a recorded signature) older
   *  than the same H15-scale bound: the poll still re-checks them, but past
   *  this age the chain verdict is overdue and an operator should verify the
   *  signature by hand (the exit paths are the chain deciding, or an operator
   *  resolving via the service tooling; there is deliberately no automatic
   *  time-based void, because the money may have landed). */
  stuckBonds: {
    count: number;
    saturated: boolean;
    /** stuckSinceMs is the class's AGE axis (the signature recording,
     *  placed_at only for legacy rows): compute stuck age from it, never
     *  from placedAtMs, which is placement provenance and always older. */
    sample: {
      id: number;
      listingId: number;
      account: number;
      placedAtMs: number;
      stuckSinceMs: number;
    }[];
  };
}

/** What the monitor serves: the classes plus the refresh stamp. The cached
 *  read stale-serves through a DB outage, so asOfMs is what lets a consumer
 *  (and the log beat) tell a fresh readout from an hour-old one. */
export interface WocStuckCustodyReadout extends WocStuckCustodyClasses {
  asOfMs: number;
}
