// Solana Digital Asset Standard (DAS) read API wire, mirroring server/eth_rpc.ts.
//
// DAS `getAsset` returns a Solana NFT's current owner, its collection grouping,
// and its off-chain metadata attributes in one call, and it works UNIFORMLY for
// both standard (token-account) NFTs and compressed NFTs (cNFTs like Mad Lads,
// which have no token/mint account and are otherwise unreadable by plain RPC).
// Using DAS for all Solana avoids hand-deserializing Metaplex metadata PDAs in a
// web3.js-free server. It is optional: with no SOLANA_DAS_URL configured, Solana
// NFT claims are unavailable (Ethereum remains the no-extra-dependency path).
export const SOLANA_DAS_URL = (process.env.SOLANA_DAS_URL ?? '').trim();

/** True when a DAS endpoint (e.g. Helius) is configured. */
export function solanaDasConfigured(): boolean {
  return SOLANA_DAS_URL.length > 0;
}

// The narrow slice of a DAS `getAsset` response the ownership reader touches.
export interface DasAsset {
  id?: string;
  ownership?: { owner?: string };
  grouping?: Array<{ group_key?: string; group_value?: string }>;
  content?: {
    metadata?: { attributes?: Array<{ trait_type?: string; value?: unknown }> };
    links?: { image?: string };
    files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
  };
  burnt?: boolean;
  compression?: { compressed?: boolean };
}

/** `getAsset(assetId)` against the configured DAS endpoint, or null on any
 *  transport/RPC failure (caller fail-closes). `assetId` is the mint (standard)
 *  or the leaf asset id (compressed). */
export async function dasGetAsset(assetId: string, timeoutMs = 8000): Promise<DasAsset | null> {
  if (!solanaDasConfigured()) return null;
  let res: Response;
  try {
    res = await fetch(SOLANA_DAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: assetId } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: DasAsset; error?: unknown };
  if (data.error || data.result == null) return null;
  return data.result;
}
