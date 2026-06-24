import { describe, expect, it } from 'vitest';
import { solanaCluster, solscanTxUrl } from '../src/net/explorer';

describe('solanaCluster', () => {
  it('infers the cluster from the RPC URL', () => {
    expect(solanaCluster('https://api.mainnet-beta.solana.com')).toBe('mainnet');
    expect(solanaCluster('https://api.devnet.solana.com')).toBe('devnet');
    expect(solanaCluster('https://api.testnet.solana.com')).toBe('testnet');
    expect(solanaCluster(undefined)).toBe('mainnet'); // default
    expect(solanaCluster('')).toBe('mainnet');
  });
});

describe('solscanTxUrl', () => {
  it('omits the query on mainnet but tags devnet/testnet so links resolve', () => {
    expect(solscanTxUrl('SIG', 'https://api.mainnet-beta.solana.com')).toBe('https://solscan.io/tx/SIG');
    expect(solscanTxUrl('SIG', 'https://api.devnet.solana.com')).toBe('https://solscan.io/tx/SIG?cluster=devnet');
    expect(solscanTxUrl('SIG', 'https://api.testnet.solana.com')).toBe('https://solscan.io/tx/SIG?cluster=testnet');
  });
  it('url-encodes the signature', () => {
    expect(solscanTxUrl('a/b+c', 'https://api.devnet.solana.com')).toBe('https://solscan.io/tx/a%2Fb%2Bc?cluster=devnet');
  });
});
