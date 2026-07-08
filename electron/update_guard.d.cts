// Hand-written declarations for electron/update_guard.cjs so the Vitest suite
// (tests/electron_update_guard.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as shell_guards.d.cts).

export type UpdateChannel = 'latest' | 'dev';

export const PRODUCTION_API_ORIGIN: string;

export function apiOriginKey(value: unknown): string | null;
export function isProductionApiOrigin(origin: unknown): boolean;
export function updateChannelForOrigin(apiOrigin: unknown): UpdateChannel;

export interface UpdateOfferVerdict {
  ok: boolean;
  stamped: boolean;
  offeredOrigin?: string;
  expectedOrigin?: string;
}

export function evaluateUpdateOffer(input?: {
  apiOrigin?: unknown;
  info?: unknown;
}): UpdateOfferVerdict;
