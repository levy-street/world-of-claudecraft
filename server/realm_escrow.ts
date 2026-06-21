// Client interface to the realm_stake_escrow Anchor program (#475): PDA and
// vault derivation, instruction builders, and the on-chain account decoder. The
// server uses the derivations + decoder to verify a stake lock; the client/test
// uses the builders to drive lock / request_decommission / release. Encodes
// instructions from the Anchor discriminator convention (sha256("global:<ix>")
// truncated to 8 bytes) so it needs no generated IDL, and depends only on
// @solana/web3.js + node crypto (no @solana/spl-token).

import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

// Standard SPL program ids (the program uses the legacy Token program, matching
// the server verifier which rejects Token-2022).
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// The deployed realm_stake_escrow program id. Overridable per cluster.
export const REALM_ESCROW_PROGRAM_ID = new PublicKey(
  (process.env.REALM_ESCROW_PROGRAM_ID ?? '6Dg85JcaHyJqzewtaYzJCjNgX1s64QPqSuATYD2Tukjj').trim(),
);

const REALM_SEED = Buffer.from('realm');

function u64le(v: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

// Anchor instruction discriminator: first 8 bytes of sha256("global:<name>").
function ixDisc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

// The per-realm stake PDA: holds the escrow metadata and is the vault authority.
export function realmStakePda(realmId: bigint | number): PublicKey {
  return PublicKey.findProgramAddressSync([REALM_SEED, u64le(realmId)], REALM_ESCROW_PROGRAM_ID)[0];
}

// The program-owned vault: the associated token account for `mint` whose
// authority is the stake PDA, so only a program-signed CPI can move the stake.
export function realmVaultAddress(stakePda: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [stakePda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function buildLockIx(args: {
  staker: PublicKey;
  realmId: bigint | number;
  amount: bigint | number;
  mint: PublicKey;
  stakerToken: PublicKey;
}): TransactionInstruction {
  const stake = realmStakePda(args.realmId);
  const vault = realmVaultAddress(stake, args.mint);
  return new TransactionInstruction({
    programId: REALM_ESCROW_PROGRAM_ID,
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
    data: Buffer.concat([ixDisc('lock'), u64le(args.realmId), u64le(args.amount)]),
  });
}

export function buildRequestDecommissionIx(args: {
  owner: PublicKey;
  realmId: bigint | number;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: REALM_ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: false },
      { pubkey: realmStakePda(args.realmId), isSigner: false, isWritable: true },
    ],
    data: ixDisc('request_decommission'),
  });
}

export function buildReleaseIx(args: {
  owner: PublicKey;
  realmId: bigint | number;
  mint: PublicKey;
  ownerToken: PublicKey;
}): TransactionInstruction {
  const stake = realmStakePda(args.realmId);
  const vault = realmVaultAddress(stake, args.mint);
  return new TransactionInstruction({
    programId: REALM_ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: true },
      { pubkey: stake, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: args.ownerToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ixDisc('release'), u64le(args.realmId)]),
  });
}

export type StakeStatus = 'locked' | 'decommissioning' | 'released';
const STATUS_BY_INDEX: readonly StakeStatus[] = ['locked', 'decommissioning', 'released'];

export interface RealmStakeAccount {
  owner: PublicKey;
  realmId: bigint;
  mint: PublicKey;
  amount: bigint;
  lockedAtSlot: bigint;
  unlockEligibleSlot: bigint;
  status: StakeStatus;
  bump: number;
}

// Decode a RealmStake account: 8-byte Anchor discriminator, then the borsh
// layout (owner, realm_id, mint, amount, locked_at_slot, unlock_eligible_slot,
// status as a 1-byte enum index, bump). Mirrors the program's account struct.
export function decodeRealmStake(data: Buffer): RealmStakeAccount {
  let o = 8;
  const owner = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const realmId = data.readBigUInt64LE(o);
  o += 8;
  const mint = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const amount = data.readBigUInt64LE(o);
  o += 8;
  const lockedAtSlot = data.readBigUInt64LE(o);
  o += 8;
  const unlockEligibleSlot = data.readBigUInt64LE(o);
  o += 8;
  const status = STATUS_BY_INDEX[data.readUInt8(o)] ?? 'locked';
  o += 1;
  const bump = data.readUInt8(o);
  return { owner, realmId, mint, amount, lockedAtSlot, unlockEligibleSlot, status, bump };
}
