export type SeekerEntitlementSyncOutcome =
  | 'not_applicable'
  | 'already_entitled'
  | 'claimed'
  | 'transient_failure'
  | 'permanent_failure';

export interface SeekerEntitlementSyncInput {
  accountKey: string;
  walletPubkey: string | null;
  eligible: boolean;
}

export interface SeekerEntitlementSyncDeps {
  entitlement(): Promise<boolean>;
  createClaimProof(): Promise<unknown | null>;
  claim(proof: unknown): Promise<boolean>;
  onPermanentFailure?(error: unknown): void;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

export function seekerEntitlementFailureIsTransient(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const status = errorStatus(error);
  return status === null || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function createSeekerEntitlementSync(deps: SeekerEntitlementSyncDeps): {
  sync(input: SeekerEntitlementSyncInput): Promise<SeekerEntitlementSyncOutcome>;
  reset(): void;
} {
  const flights = new Map<string, Promise<SeekerEntitlementSyncOutcome>>();
  const permanentlyRejected = new Set<string>();
  let generation = 0;

  const syncOnce = async (
    key: string,
    startedGeneration: number,
  ): Promise<SeekerEntitlementSyncOutcome> => {
    try {
      if (await deps.entitlement()) return 'already_entitled';
      const proof = await deps.createClaimProof();
      if (!proof) return 'transient_failure';
      return (await deps.claim(proof)) ? 'claimed' : 'transient_failure';
    } catch (error) {
      if (seekerEntitlementFailureIsTransient(error)) return 'transient_failure';
      if (generation === startedGeneration) {
        permanentlyRejected.add(key);
        deps.onPermanentFailure?.(error);
      }
      return 'permanent_failure';
    }
  };

  return {
    sync(input) {
      const accountKey = input.accountKey.trim();
      const walletPubkey = input.walletPubkey?.trim() ?? '';
      if (!input.eligible || !accountKey || !walletPubkey) {
        return Promise.resolve('not_applicable');
      }
      const key = `${accountKey}\u0000${walletPubkey}`;
      if (permanentlyRejected.has(key)) return Promise.resolve('permanent_failure');
      const existing = flights.get(key);
      if (existing) return existing;
      let flight: Promise<SeekerEntitlementSyncOutcome>;
      flight = syncOnce(key, generation).finally(() => {
        if (flights.get(key) === flight) flights.delete(key);
      });
      flights.set(key, flight);
      return flight;
    },
    reset() {
      generation += 1;
      permanentlyRejected.clear();
      flights.clear();
    },
  };
}
