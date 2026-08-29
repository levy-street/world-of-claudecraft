// One process-local store, which makes the whole desktop signing path
// SINGLE-REALM by construction: registrations (claudium_proxy, the woc-market
// service) must land in the same process that serves /api/desktop-wallet/*,
// and the browser page claims at the shell's baked apiOrigin. Every current
// deployment runs one realm process per origin, so the constraint holds; a
// multi-realm split behind one origin would need this store made shared
// before the desktop signing arms work there (they fail CLOSED until then).
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { recordUsageMetric } from './provider_usage';

export const DESKTOP_WALLET_HANDOFF_TTL_MS = 5 * 60 * 1000;
const HANDOFF_CODE_BYTES = 32;
const MAX_ACTIVE_HANDOFFS = 2_000;
// Per-account slot budget on the authorization maps: an account re-quoting in
// a loop replaces its own oldest registration instead of crowding the shared
// map (the Claudium native quote and the Exchange quotes are co-tenants).
const MAX_AUTHORIZATIONS_PER_ACCOUNT = 8;
// Transaction handoff entries outlive their quote by this much, for the
// record-a-late-signature stance the confirm intake takes (server/woc_market.ts
// records a signature for an expired quote deliberately: the transfer may have
// left the wallet moments before expiry, and dropping it here would orphan an
// on-chain payment with no game-side trace). Claiming and completing both ride
// the entry expiry, so the browser can hand back a signature it broadcast at
// the quote boundary. Step-up handoffs get no grace: signing moves no funds
// and the proof verifier enforces the challenge expiry regardless.
export const DESKTOP_WALLET_TRANSACTION_RECORD_GRACE_MS = 60 * 1000;

export interface DesktopWalletTransactionAuthorization {
  reference: string;
  transactionBase64: string;
  expectedAddress: string;
  rail: 'sol' | 'usdc' | 'woc';
  amountBase: string | null;
  destination: string | null;
  expiresAtMs: number;
}

/** A step-up challenge the woc-market issuer pre-registered for the desktop
 *  browser-signing path: the browser signs the SERVER-STORED message resolved
 *  by nonce, never renderer-supplied text (the transaction stance). */
export interface DesktopWalletStepUpAuthorization {
  nonce: string;
  message: string;
  expectedAddress: string;
  expiresAtMs: number;
}

export type DesktopWalletHandoffAction =
  | { kind: 'link' }
  | ({ kind: 'transaction' } & Omit<DesktopWalletTransactionAuthorization, 'expiresAtMs'>)
  | ({ kind: 'stepup' } & Omit<DesktopWalletStepUpAuthorization, 'expiresAtMs'>);

export type DesktopWalletHandoffResult =
  | { kind: 'link'; address: string; nonce: string; signature: string }
  | { kind: 'transaction'; address: string; signature: string }
  | { kind: 'stepup'; address: string; signature: string };

export type DesktopWalletHandoffStatus =
  | { status: 'missing' }
  | { status: 'pending' }
  | { status: 'complete'; result: DesktopWalletHandoffResult };

interface LinkClaim {
  address: string;
  nonce: string;
  message: string;
}

interface HandoffEntry {
  accountId: number;
  ip: string;
  createdAt: number;
  expiresAtMs: number;
  action: DesktopWalletHandoffAction;
  linkClaimAddress: string | null;
  linkClaimPending: Promise<LinkClaim> | null;
  linkClaim: LinkClaim | null;
  result: DesktopWalletHandoffResult | null;
}

interface StoreOptions {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  /** Observability hook: fired once per authorization-map eviction (either
   *  map, either the per-account budget or the global cap). The process
   *  singleton wires the usage-metric counter so cap pressure is a number on
   *  the ops readout instead of an inference from player reports. */
  onMetric?: (event: 'authorization_evicted') => void;
}

export interface DesktopWalletHandoffStore {
  create(accountId: number, ip: string, action: { kind: 'link' }): HandoffCreated;
  authorizeTransaction(
    accountId: number,
    authorization: DesktopWalletTransactionAuthorization,
  ): void;
  createTransaction(
    accountId: number,
    ip: string,
    request: { reference: string; expectedAddress: string },
  ): HandoffCreated;
  authorizeStepUp(accountId: number, authorization: DesktopWalletStepUpAuthorization): void;
  createStepUp(
    accountId: number,
    ip: string,
    request: { nonce: string; expectedAddress: string },
  ): HandoffCreated;
  claim(code: unknown, ip: string): DesktopWalletHandoffAction;
  claimLink(
    code: unknown,
    ip: string,
    address: string,
    issueChallenge: (
      accountId: number,
      address: string,
    ) => Promise<{ nonce: string; message: string }>,
  ): Promise<{ kind: 'link'; address: string; nonce: string; message: string }>;
  complete(code: unknown, ip: string, result: DesktopWalletHandoffResult): void;
  result(accountId: number, code: unknown): DesktopWalletHandoffStatus;
  clear(): void;
}

interface HandoffCreated {
  code: string;
  expiresInMs: number;
}

interface AuthorizedTransaction extends DesktopWalletTransactionAuthorization {
  accountId: number;
}

interface AuthorizedStepUp extends DesktopWalletStepUpAuthorization {
  accountId: number;
}

const STEPUP_NONCE = /^[0-9a-f]{32}$/;

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function validCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(code);
}

function handoffError(message: string): Error {
  const error = new Error(message);
  error.name = 'DesktopWalletHandoffError';
  return error;
}

export function createDesktopWalletHandoffStore(
  options: StoreOptions = {},
): DesktopWalletHandoffStore {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const onMetric = options.onMetric;
  const entries = new Map<string, HandoffEntry>();
  const authorizedTransactions = new Map<string, AuthorizedTransaction>();
  const authorizedStepUps = new Map<string, AuthorizedStepUp>();

  // Both features share this keyspace (Claudium native quotes and Exchange
  // quotes both mint service-unique references), so a cross-feature collision
  // for one account is a last-write-wins overwrite. The create path only
  // knows (account, reference), so a feature prefix cannot be reconstructed
  // there; the collision odds against two independent unique-reference mints
  // are what carries this, documented rather than engineered away.
  const transactionKey = (accountId: number, reference: string): string =>
    `${accountId}:${reference}`;
  const stepUpKey = (accountId: number, nonce: string): string => `${accountId}:${nonce}`;

  // Bounded insert shared by both authorization maps. A same-key write
  // replaces in place (a re-quote retiring its predecessor). Otherwise the
  // writing account's OLDEST authorization goes first at its per-account
  // budget, and at the global cap the globally oldest entry goes (Map keeps
  // insertion order) instead of refusing: a refusal would hard-fail the
  // co-tenant's quote (claudium_proxy turns it into quote-unavailable for
  // every client), while evicting drops the entry nearest its own expiry.
  const insertAuthorization = <T extends { accountId: number }>(
    map: Map<string, T>,
    key: string,
    value: T,
  ): void => {
    if (!map.has(key)) {
      let accountCount = 0;
      let accountOldestKey: string | null = null;
      for (const [existingKey, existing] of map) {
        if (existing.accountId !== value.accountId) continue;
        accountCount++;
        if (accountOldestKey === null) accountOldestKey = existingKey;
      }
      if (accountCount >= MAX_AUTHORIZATIONS_PER_ACCOUNT && accountOldestKey !== null) {
        map.delete(accountOldestKey);
        onMetric?.('authorization_evicted');
      } else if (map.size >= MAX_ACTIVE_HANDOFFS) {
        const globalOldestKey = map.keys().next().value;
        if (globalOldestKey !== undefined) map.delete(globalOldestKey);
        onMetric?.('authorization_evicted');
      }
    }
    map.set(key, value);
  };

  const prune = (): void => {
    const currentTime = now();
    for (const [code, entry] of entries) {
      if (entry.expiresAtMs <= currentTime) entries.delete(code);
    }
    for (const [key, authorization] of authorizedTransactions) {
      if (authorization.expiresAtMs <= currentTime) authorizedTransactions.delete(key);
    }
    for (const [key, authorization] of authorizedStepUps) {
      if (authorization.expiresAtMs <= currentTime) authorizedStepUps.delete(key);
    }
  };

  const createEntry = (
    accountId: number,
    ip: string,
    action: DesktopWalletHandoffAction,
    absoluteExpiryMs?: number,
  ): HandoffCreated => {
    prune();
    if (entries.size >= MAX_ACTIVE_HANDOFFS) {
      throw handoffError('too many active wallet handoffs');
    }
    const createdAt = now();
    const expiresAtMs = Math.min(
      createdAt + DESKTOP_WALLET_HANDOFF_TTL_MS,
      absoluteExpiryMs ?? Number.POSITIVE_INFINITY,
    );
    if (expiresAtMs <= createdAt) throw handoffError('invalid or expired wallet handoff');
    const code = encodeBase64Url(randomBytes(HANDOFF_CODE_BYTES));
    entries.set(code, {
      accountId,
      ip,
      createdAt,
      expiresAtMs,
      action,
      linkClaimAddress: null,
      linkClaimPending: null,
      linkClaim: null,
      result: null,
    });
    return { code, expiresInMs: expiresAtMs - createdAt };
  };

  const browserEntry = (code: unknown, ip: string): HandoffEntry => {
    if (!validCode(code)) throw handoffError('invalid or expired wallet handoff');
    const entry = entries.get(code);
    if (!entry || entry.ip !== ip || entry.expiresAtMs <= now()) {
      if (entry) entries.delete(code);
      throw handoffError('invalid or expired wallet handoff');
    }
    return entry;
  };

  return {
    create(accountId, ip, action) {
      return createEntry(accountId, ip, action);
    },

    authorizeTransaction(accountId, authorization) {
      prune();
      if (
        !authorization.reference ||
        authorization.reference.length > 256 ||
        !authorization.transactionBase64 ||
        authorization.transactionBase64.length > 16_384 ||
        !Number.isFinite(authorization.expiresAtMs) ||
        authorization.expiresAtMs <= now()
      ) {
        throw handoffError('invalid transaction authorization');
      }
      insertAuthorization(
        authorizedTransactions,
        transactionKey(accountId, authorization.reference),
        { accountId, ...authorization },
      );
    },

    createTransaction(accountId, ip, request) {
      // No pre-prune: createEntry prunes, and the expiry is checked inline.
      const authorization = authorizedTransactions.get(
        transactionKey(accountId, request.reference),
      );
      if (
        !authorization ||
        authorization.expectedAddress !== request.expectedAddress ||
        authorization.expiresAtMs <= now()
      ) {
        throw handoffError('transaction is not backed by an authorized quote');
      }
      return createEntry(
        accountId,
        ip,
        {
          kind: 'transaction',
          reference: authorization.reference,
          transactionBase64: authorization.transactionBase64,
          expectedAddress: authorization.expectedAddress,
          rail: authorization.rail,
          amountBase: authorization.amountBase,
          destination: authorization.destination,
        },
        // The recording grace: see DESKTOP_WALLET_TRANSACTION_RECORD_GRACE_MS.
        authorization.expiresAtMs + DESKTOP_WALLET_TRANSACTION_RECORD_GRACE_MS,
      );
    },

    authorizeStepUp(accountId, authorization) {
      prune();
      if (
        !STEPUP_NONCE.test(authorization.nonce) ||
        !authorization.message ||
        // The real step-up message is a fixed 11-to-16-line template around
        // 400 to 600 characters with 48-code-point free-text caps; this bound
        // keeps the map's worst-case memory meaningful, not just finite.
        authorization.message.length > 2_048 ||
        !authorization.expectedAddress ||
        !Number.isFinite(authorization.expiresAtMs) ||
        authorization.expiresAtMs <= now()
      ) {
        throw handoffError('invalid step-up authorization');
      }
      insertAuthorization(authorizedStepUps, stepUpKey(accountId, authorization.nonce), {
        accountId,
        ...authorization,
      });
    },

    createStepUp(accountId, ip, request) {
      // No pre-prune: createEntry prunes, and the expiry is checked inline.
      const authorization = authorizedStepUps.get(stepUpKey(accountId, request.nonce));
      if (
        !authorization ||
        authorization.expectedAddress !== request.expectedAddress ||
        authorization.expiresAtMs <= now()
      ) {
        throw handoffError('step-up is not backed by an issued Exchange challenge');
      }
      return createEntry(
        accountId,
        ip,
        {
          kind: 'stepup',
          nonce: authorization.nonce,
          message: authorization.message,
          expectedAddress: authorization.expectedAddress,
        },
        authorization.expiresAtMs,
      );
    },

    claim(code, ip) {
      const entry = browserEntry(code, ip);
      if (entry.result) throw handoffError('wallet handoff is already complete');
      return entry.action;
    },

    async claimLink(code, ip, address, issueChallenge) {
      const entry = browserEntry(code, ip);
      if (entry.action.kind !== 'link') throw handoffError('wallet handoff action mismatch');
      if (entry.result) throw handoffError('wallet handoff is already complete');
      if (entry.linkClaim) {
        if (entry.linkClaim.address !== address) {
          throw handoffError('wallet handoff is already claimed');
        }
        return { kind: 'link', ...entry.linkClaim };
      }
      if (entry.linkClaimPending) {
        if (entry.linkClaimAddress !== address) {
          throw handoffError('wallet handoff is already claimed');
        }
        const pending = await entry.linkClaimPending;
        return { kind: 'link', ...pending };
      }
      entry.linkClaimAddress = address;
      entry.linkClaimPending = issueChallenge(entry.accountId, address).then((challenge) => ({
        address,
        ...challenge,
      }));
      try {
        entry.linkClaim = await entry.linkClaimPending;
      } catch (error) {
        entry.linkClaimAddress = null;
        throw error;
      } finally {
        entry.linkClaimPending = null;
      }
      return { kind: 'link', ...entry.linkClaim };
    },

    complete(code, ip, result) {
      const entry = browserEntry(code, ip);
      if (entry.result) throw handoffError('wallet handoff is already complete');
      if (entry.action.kind !== result.kind) throw handoffError('wallet handoff action mismatch');
      if (result.kind === 'link') {
        const claim = entry.linkClaim;
        if (!claim || claim.address !== result.address || claim.nonce !== result.nonce) {
          throw handoffError('wallet handoff link challenge mismatch');
        }
      } else {
        // 'transaction' and 'stepup' both bind the completing wallet to the
        // expected (linked) address the authorization was registered with.
        if (entry.action.kind !== 'transaction' && entry.action.kind !== 'stepup') {
          throw handoffError('wallet handoff action mismatch');
        }
        if (entry.action.expectedAddress !== result.address) {
          throw handoffError('wallet does not match the linked account wallet');
        }
      }
      entry.result = result;
      // A completed step-up frees its authorization slot: the nonce is
      // single-use downstream (the proof verifier consumes it), so a second
      // handoff for it could only produce a signature the market refuses.
      if (entry.action.kind === 'stepup') {
        authorizedStepUps.delete(stepUpKey(entry.accountId, entry.action.nonce));
      }
    },

    result(accountId, code) {
      if (!validCode(code)) return { status: 'missing' };
      prune();
      const entry = entries.get(code);
      if (!entry || entry.accountId !== accountId) return { status: 'missing' };
      if (!entry.result) return { status: 'pending' };
      return { status: 'complete', result: entry.result };
    },

    clear() {
      entries.clear();
      authorizedTransactions.clear();
      authorizedStepUps.clear();
    },
  };
}

export const desktopWalletHandoffs = createDesktopWalletHandoffStore({
  onMetric: () => recordUsageMetric('wallet.handoff.authorization_evicted'),
});
