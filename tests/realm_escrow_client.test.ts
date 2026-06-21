// Proves the browser-side lock encoder (src/net/realm_escrow.ts) produces a
// byte-identical instruction to the server's verified builder (server/
// realm_escrow.ts). The two live in separate bundles (the server cannot import
// src/net), so without this guard the discriminator or account order could drift
// and the server would reject every client lock. No browser needed: both
// builders run in Node.

import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  buildRealmLockIx,
  realmStakePda as clientStakePda,
  realmVaultAddress as clientVault,
} from '../src/net/realm_escrow';
import {
  REALM_ESCROW_PROGRAM_ID,
  buildLockIx,
  realmStakePda as serverStakePda,
  realmVaultAddress as serverVault,
} from '../server/realm_escrow';

describe('client realm-escrow encoding matches the server', () => {
  const staker = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const realmId = 4242n;
  const amount = 250_000_000n;
  const stakerToken = clientVault(staker, mint);

  it('derives the same stake PDA and vault address', () => {
    expect(clientStakePda(REALM_ESCROW_PROGRAM_ID, realmId).toBase58()).toBe(serverStakePda(realmId).toBase58());
    const pda = serverStakePda(realmId);
    expect(clientVault(pda, mint).toBase58()).toBe(serverVault(pda, mint).toBase58());
  });

  it('builds a byte-identical lock instruction (program, data, account metas)', () => {
    const client = buildRealmLockIx({ programId: REALM_ESCROW_PROGRAM_ID, staker, realmId, amount, mint, stakerToken });
    const server = buildLockIx({ staker, realmId, amount, mint, stakerToken });

    expect(client.programId.toBase58()).toBe(server.programId.toBase58());
    expect(Buffer.from(client.data).toString('hex')).toBe(Buffer.from(server.data).toString('hex'));
    expect(client.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(
      server.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    );
  });
});
