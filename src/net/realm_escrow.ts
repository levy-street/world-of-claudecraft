// Client-side encoder for the realm_stake_escrow lock instruction (#475). The
// browser builds the lock transaction the wallet signs and sends; the server
// (server/realm_escrow.ts) holds the matching PDA derivation + on-chain verify.
// The two bundles are separate (the server must not import src/net), so this
// mirrors the server's lock builder. The instruction discriminator is the Anchor
// convention, sha256("global:lock")[..8], pinned as a constant so the browser
// needs no sync sha256; tests/realm_escrow_client.test.ts asserts this builder
// produces byte-identical instructions to the server's, so the two cannot drift.

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Anchor discriminator for `lock` = first 8 bytes of sha256("global:lock").
const LOCK_DISCRIMINATOR = Uint8Array.from([21, 19, 208, 43, 237, 62, 255, 87]);

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

const REALM_SEED = new TextEncoder().encode('realm');

export function realmStakePda(programId: PublicKey, realmId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([REALM_SEED, u64le(realmId)], programId)[0];
}

export function realmVaultAddress(stakePda: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [stakePda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

// Build the lock instruction for a provision quote. The server quote provides
// programId, mint, realmId, and amount; the staker wallet pubkey and its $WOC
// associated token account complete it. The account order matches the program's
// Lock accounts exactly (staker, stake, mint, vault, staker_token, token,
// associated_token, system).
export function buildRealmLockIx(args: {
  programId: PublicKey;
  staker: PublicKey;
  realmId: bigint;
  amount: bigint;
  mint: PublicKey;
  stakerToken: PublicKey;
}): TransactionInstruction {
  const stake = realmStakePda(args.programId, args.realmId);
  const vault = realmVaultAddress(stake, args.mint);
  const data = new Uint8Array(24);
  data.set(LOCK_DISCRIMINATOR, 0);
  data.set(u64le(args.realmId), 8);
  data.set(u64le(args.amount), 16);
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.staker, isSigner: true, isWritable: true },
      { pubkey: stake, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: args.stakerToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// The $WOC associated token account for an owner (the staker's source account).
export function ownerTokenAccount(owner: PublicKey, mint: PublicKey): PublicKey {
  return realmVaultAddress(owner, mint); // ATA(owner, mint); vault is the same derivation for the PDA
}
