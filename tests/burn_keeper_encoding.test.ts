import { describe, expect, it, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';

// burn_keeper transitively imports server/db (pg Pool + DATABASE_URL at import).
// Stub both so the module loads; these tests only touch the pure encoders.
vi.hoisted(() => { process.env.DATABASE_URL = 'postgres://test/test'; });
vi.mock('pg', () => ({ Pool: function Pool() { return { query: vi.fn(), connect: vi.fn() }; } }));

import { burnCheckedIx, associatedTokenAccount } from '../server/burn_keeper';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const WOC = new PublicKey('3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth');
const VAULT = new PublicKey('Vote111111111111111111111111111111111111111');

// The keeper burns the $WOC it bought via SPL BurnChecked. Validate the byte
// encoding + key roles against the SPL wire format so a mis-encoded burn (which
// would revert on-chain or destroy the wrong amount) is caught offline.
describe('burnCheckedIx — SPL BurnChecked (tag 15, u64-LE amount, u8 decimals)', () => {
  it('encodes the instruction data exactly', () => {
    const ata = associatedTokenAccount(VAULT, WOC);
    const ix = burnCheckedIx(ata, WOC, VAULT, 1_234_567n, 9);
    expect(ix.programId.equals(TOKEN_PROGRAM)).toBe(true);
    expect(ix.data).toHaveLength(10);
    expect(ix.data[0]).toBe(15);                      // BurnChecked tag
    expect(ix.data.readBigUInt64LE(1)).toBe(1_234_567n);
    expect(ix.data[9]).toBe(9);                        // mint decimals
  });

  it('orders keys [token account (w), mint (w), authority (signer)]', () => {
    const ata = associatedTokenAccount(VAULT, WOC);
    const ix = burnCheckedIx(ata, WOC, VAULT, 1n, 9);
    expect(ix.keys[0].pubkey.toBase58()).toBe(ata.toBase58());
    expect(ix.keys[0]).toMatchObject({ isSigner: false, isWritable: true });
    expect(ix.keys[1].pubkey.equals(WOC)).toBe(true);
    expect(ix.keys[1]).toMatchObject({ isSigner: false, isWritable: true });
    expect(ix.keys[2].pubkey.equals(VAULT)).toBe(true);
    expect(ix.keys[2]).toMatchObject({ isSigner: true, isWritable: false });
  });

  it('handles a full u64 amount without overflow', () => {
    const ix = burnCheckedIx(associatedTokenAccount(VAULT, WOC), WOC, VAULT, 18_446_744_073_709_551_615n, 0);
    expect(ix.data.readBigUInt64LE(1)).toBe(18_446_744_073_709_551_615n);
  });
});

describe('associatedTokenAccount — legacy SPL ATA derivation', () => {
  it('matches the canonical findProgramAddress derivation', () => {
    const expected = PublicKey.findProgramAddressSync(
      [VAULT.toBuffer(), TOKEN_PROGRAM.toBuffer(), WOC.toBuffer()],
      ATA_PROGRAM,
    )[0];
    expect(associatedTokenAccount(VAULT, WOC).toBase58()).toBe(expected.toBase58());
  });
});
