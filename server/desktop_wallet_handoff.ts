import { randomBytes as nodeRandomBytes } from 'node:crypto';

export const DESKTOP_WALLET_HANDOFF_TTL_MS = 5 * 60 * 1000;
const HANDOFF_CODE_BYTES = 32;
const MAX_ACTIVE_HANDOFFS = 2_000;

export interface DesktopWalletTransactionAuthorization {
  reference: string;
  transactionBase64: string;
  expectedAddress: string;
  rail: 'sol' | 'usdc' | 'woc';
  amountBase: string | null;
  destination: string | null;
  expiresAtMs: number;
}

export type DesktopWalletHandoffAction =
  | { kind: 'link' }
  | ({ kind: 'transaction' } & Omit<DesktopWalletTransactionAuthorization, 'expiresAtMs'>);

export type DesktopWalletHandoffResult =
  | { kind: 'link'; address: string; nonce: string; signature: string }
  | { kind: 'transaction'; address: string; signature: string };

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
  const entries = new Map<string, HandoffEntry>();
  const authorizedTransactions = new Map<string, AuthorizedTransaction>();

  const transactionKey = (accountId: number, reference: string): string =>
    `${accountId}:${reference}`;

  const prune = (): void => {
    const currentTime = now();
    for (const [code, entry] of entries) {
      if (entry.expiresAtMs <= currentTime) entries.delete(code);
    }
    for (const [key, authorization] of authorizedTransactions) {
      if (authorization.expiresAtMs <= currentTime) authorizedTransactions.delete(key);
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
      if (authorizedTransactions.size >= MAX_ACTIVE_HANDOFFS) {
        throw handoffError('too many active wallet handoffs');
      }
      if (
        !authorization.reference ||
        authorization.reference.length > 256 ||
        !authorization.transactionBase64 ||
        authorization.transactionBase64.length > 16_384 ||
        !Number.isFinite(authorization.expiresAtMs) ||
        authorization.expiresAtMs <= now()
      ) {
        throw handoffError('invalid Claudium transaction authorization');
      }
      authorizedTransactions.set(transactionKey(accountId, authorization.reference), {
        accountId,
        ...authorization,
      });
    },

    createTransaction(accountId, ip, request) {
      prune();
      const authorization = authorizedTransactions.get(
        transactionKey(accountId, request.reference),
      );
      if (
        !authorization ||
        authorization.expectedAddress !== request.expectedAddress ||
        authorization.expiresAtMs <= now()
      ) {
        throw handoffError('transaction is not backed by an authorized Claudium quote');
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
        if (entry.action.kind !== 'transaction') {
          throw handoffError('wallet handoff action mismatch');
        }
        if (entry.action.expectedAddress !== result.address) {
          throw handoffError('wallet does not match the linked account wallet');
        }
      }
      entry.result = result;
    },

    result(accountId, code) {
      prune();
      if (!validCode(code)) return { status: 'missing' };
      const entry = entries.get(code);
      if (!entry || entry.accountId !== accountId) return { status: 'missing' };
      if (!entry.result) return { status: 'pending' };
      return { status: 'complete', result: entry.result };
    },

    clear() {
      entries.clear();
      authorizedTransactions.clear();
    },
  };
}

export const desktopWalletHandoffs = createDesktopWalletHandoffStore();
