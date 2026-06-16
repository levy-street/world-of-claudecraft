// STUB (RFC) — thin Solana RPC wrapper. ALL web3 lives here in server/, NEVER in src/sim/.
// Keeps @solana/web3.js behind a small, mockable seam so billing.ts can be unit-tested with a fake.
// This stub is intentionally dependency-free so it typechecks before @solana/web3.js is installed.
// TODO(eliza): back these with @solana/web3.js (+ @solana/spl-token, tweetnacl for ed25519).
//
// Boundary note: no file under src/sim/ may import this module. See docs/prd/eliza-agents.md §3.1.

export interface ConfirmedTransfer {
  signature: string;
  from: string;
  to: string;
  lamports: number;
  mint: string | null; // null = native SOL, else SPL mint
  memo: string | null;
  finalized: boolean;
}

/** Read a transaction by signature and normalize it for billing verification. */
export interface SolanaClient {
  /** Fetch + confirm a transfer at 'finalized' commitment. Returns null if not found/unconfirmed. */
  getConfirmedTransfer(signature: string): Promise<ConfirmedTransfer | null>;

  /** Current SPL token balance (base units) for `mint` held by `owner`. */
  getTokenBalance(owner: string, mint: string): Promise<bigint>;

  /** Verify an ed25519 signature of `message` by `address` (wallet-control challenge). */
  verifySignedMessage(address: string, message: string, signatureB58: string): boolean;
}

/** Real implementation (TODO) — constructs a Connection to the configured cluster. */
export function createSolanaClient(_rpcUrl: string): SolanaClient {
  throw new Error('TODO(eliza): createSolanaClient — wire @solana/web3.js');
}
