// Cluster-aware Solana explorer (Solscan) links. A mainnet tx link needs no
// query, but a devnet/testnet link MUST carry ?cluster=… or Solscan resolves it
// against mainnet and shows "not found". The cluster is inferred from the wallet
// RPC URL so links work on whatever network a deploy targets. Pure + tested.

export type SolanaCluster = 'mainnet' | 'devnet' | 'testnet';

export function solanaCluster(rpcUrl: string | undefined | null): SolanaCluster {
  const u = String(rpcUrl ?? '').toLowerCase();
  if (u.includes('devnet')) return 'devnet';
  if (u.includes('testnet')) return 'testnet';
  return 'mainnet';
}

/** A Solscan transaction URL that resolves on the RPC's cluster. */
export function solscanTxUrl(signature: string, rpcUrl?: string | null): string {
  const cluster = solanaCluster(rpcUrl);
  const query = cluster === 'mainnet' ? '' : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${encodeURIComponent(signature)}${query}`;
}
