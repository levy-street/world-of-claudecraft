// Low-level Ethereum JSON-RPC for the server, mirroring server/solana_rpc.ts: a
// raw `fetch` against a single configured endpoint (no web3 SDK in the server
// bundle), reading ETH_RPC_URL from the SERVER environment so any embedded API key
// never ships to the client. The pure ABI encode/decode + ownership logic live in
// server/nft_ownership.ts so they are unit-testable; this file is just the wire.
//
// Mainnet by default: PFP NFTs (BAYC, CryptoPunks, ...) live on Ethereum mainnet,
// independent of the marketplace's USDC payment cluster.

// The single server-side Ethereum RPC. Empty when unconfigured, which the caller
// treats as "EVM reads unavailable" (fail-closed: deny, never grant).
export const ETH_RPC_URL = (process.env.ETH_RPC_URL ?? process.env.VITE_ETH_RPC_URL ?? '').trim();
export const ETH_CHAIN_ID = Number(process.env.ETH_CHAIN_ID ?? '1');

/** True when an Ethereum RPC endpoint is configured. */
export function ethRpcConfigured(): boolean {
  return ETH_RPC_URL.length > 0;
}

interface RpcEnvelope<T> { result?: T; error?: { code?: number; message?: string } | null }

/** One JSON-RPC round trip returning the full envelope, or null on a transport
 *  failure / non-200 (which is distinct from an RPC-level `error` in the body). */
async function rpcEnvelope<T>(method: string, params: unknown[], timeoutMs: number): Promise<RpcEnvelope<T> | null> {
  if (!ethRpcConfigured()) return null;
  let res: Response;
  try {
    res = await fetch(ETH_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()) as RpcEnvelope<T>;
}

/**
 * One JSON-RPC round trip. Returns the `result` or null on any transport error,
 * non-200, RPC `error`, or absent result. Use this when "any failure" collapses
 * to the same handling (e.g. tokenURI reads).
 */
export async function ethRpc<T>(method: string, params: unknown[], timeoutMs = 8000): Promise<T | null> {
  const env = await rpcEnvelope<T>(method, params, timeoutMs);
  if (!env || env.error || env.result == null) return null;
  return env.result;
}

// An `eth_call` either returns data, reverts on-chain (a DEFINITE answer: the
// token does not exist / is not owned), or fails at the transport/RPC layer (an
// UNKNOWN, which must fail-closed and never be read as "not owned"). Ownership
// reads depend on telling these apart so an RPC outage cannot revoke a skin.
export type EthCallOutcome =
  | { kind: 'ok'; data: string }
  | { kind: 'reverted' }
  | { kind: 'error' };

function classifyError(message: string | undefined, code: number | undefined): 'reverted' | 'error' {
  const m = (message ?? '').toLowerCase();
  if (code === 3 || m.includes('revert') || m.includes('invalid opcode') || m.includes('out of gas')) return 'reverted';
  return 'error';
}

/** `eth_call` against `to` with hex `data`, classifying the result as readable
 *  data, an on-chain revert, or a transport/RPC error. */
export async function ethCallOutcome(to: string, data: string, timeoutMs = 8000): Promise<EthCallOutcome> {
  const env = await rpcEnvelope<string>('eth_call', [{ to, data }, 'latest'], timeoutMs);
  if (!env) return { kind: 'error' };
  if (env.error) return { kind: classifyError(env.error.message, env.error.code) };
  // An empty result on a getter we expect to return a word means "not readable"
  // (e.g. a non-existent mapping slot on a non-standard contract): treat as a
  // definite negative, not an error, so it does not block a sweep forever.
  if (env.result == null || env.result === '0x') return { kind: 'reverted' };
  return { kind: 'ok', data: env.result };
}

/** `eth_call` returning hex data or null on any failure (revert or transport). */
export async function ethCall(to: string, data: string): Promise<string | null> {
  const out = await ethCallOutcome(to, data);
  return out.kind === 'ok' ? out.data : null;
}

/** `eth_getCode`: '0x' (empty) for an EOA, deployed bytecode for a contract, null
 *  on RPC failure. Distinguishes an externally-owned account from a smart wallet. */
export async function ethGetCode(address: string): Promise<string | null> {
  return ethRpc<string>('eth_getCode', [address, 'latest']);
}
