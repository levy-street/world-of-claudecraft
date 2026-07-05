// Byte-level verification of src/net/woc_tx.ts, the dependency-free serializer
// for the $WOC identity payment transaction. Decodes the emitted legacy-format
// bytes with an independent reader and checks the header, account table,
// instruction layout, and amounts, plus the compact-u16 shortvec encoding.
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import {
  buildWocPaymentTx,
  encodeCompactU16,
  MEMO_PROGRAM,
  SPL_TOKEN_PROGRAM,
  type WocPaymentTxInput,
} from '../src/net/woc_tx';

// Deterministic, distinct 32-byte base58 keys for the fixture accounts.
const key = (fill: number): string => bs58.encode(new Uint8Array(32).fill(fill));
const PAYER = key(1);
const PAYER_ATA = key(2);
const MINT = key(3);
const TREASURY_ATA = key(4);
const BLOCKHASH = key(9);

const baseInput = (over: Partial<WocPaymentTxInput> = {}): WocPaymentTxInput => ({
  payer: PAYER,
  payerTokenAccount: PAYER_ATA,
  mint: MINT,
  decimals: 6,
  burnBase: 500_000_000n,
  treasuryTokenAccount: null,
  treasuryBase: 0n,
  memo: 'quote-abc123',
  recentBlockhash: BLOCKHASH,
  ...over,
});

// Minimal independent decoder for the legacy tx format.
function decodeTx(bytes: Uint8Array) {
  let off = 0;
  const readCompact = (): number => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[off++];
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
      shift += 7;
    }
  };
  const sigCount = readCompact();
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < sigCount; i++) {
    signatures.push(bytes.slice(off, off + 64));
    off += 64;
  }
  const header = [bytes[off++], bytes[off++], bytes[off++]];
  const keyCount = readCompact();
  const keys: string[] = [];
  for (let i = 0; i < keyCount; i++) {
    keys.push(bs58.encode(bytes.slice(off, off + 32)));
    off += 32;
  }
  const blockhash = bs58.encode(bytes.slice(off, off + 32));
  off += 32;
  const ixCount = readCompact();
  const ixs: { programIndex: number; accounts: number[]; data: Uint8Array }[] = [];
  for (let i = 0; i < ixCount; i++) {
    const programIndex = bytes[off++];
    const nAccounts = readCompact();
    const accounts: number[] = [];
    for (let j = 0; j < nAccounts; j++) accounts.push(bytes[off++]);
    const dataLen = readCompact();
    ixs.push({ programIndex, accounts, data: bytes.slice(off, off + dataLen) });
    off += dataLen;
  }
  expect(off).toBe(bytes.length); // nothing trailing
  return { signatures, header, keys, blockhash, ixs };
}

const leU64 = (data: Uint8Array, start: number): bigint => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[start + i]);
  return v;
};

describe('encodeCompactU16', () => {
  it('matches the shortvec reference encoding', () => {
    expect(encodeCompactU16(0)).toEqual([0]);
    expect(encodeCompactU16(1)).toEqual([1]);
    expect(encodeCompactU16(127)).toEqual([0x7f]);
    expect(encodeCompactU16(128)).toEqual([0x80, 0x01]);
    expect(encodeCompactU16(300)).toEqual([0xac, 0x02]);
    expect(encodeCompactU16(16383)).toEqual([0xff, 0x7f]);
    expect(encodeCompactU16(16384)).toEqual([0x80, 0x80, 0x01]);
    expect(encodeCompactU16(65535)).toEqual([0xff, 0xff, 0x03]);
  });

  it('rejects out-of-range values', () => {
    expect(() => encodeCompactU16(-1)).toThrow();
    expect(() => encodeCompactU16(65536)).toThrow();
    expect(() => encodeCompactU16(1.5)).toThrow();
  });
});

describe('buildWocPaymentTx (100% burn, no treasury)', () => {
  const tx = buildWocPaymentTx(baseInput());
  const decoded = decodeTx(tx);

  it('has one zeroed signature placeholder for the payer', () => {
    expect(decoded.signatures).toHaveLength(1);
    expect(decoded.signatures[0].every((b) => b === 0)).toBe(true);
  });

  it('has the legacy header: 1 signer, 0 readonly signed, 2 readonly unsigned', () => {
    expect(decoded.header).toEqual([1, 0, 2]);
  });

  it('orders the account table payer, token account, mint, then the programs', () => {
    expect(decoded.keys).toEqual([PAYER, PAYER_ATA, MINT, SPL_TOKEN_PROGRAM, MEMO_PROGRAM]);
  });

  it('embeds the recent blockhash', () => {
    expect(decoded.blockhash).toBe(BLOCKHASH);
  });

  it('emits burnChecked with the exact amount and decimals, then the memo', () => {
    expect(decoded.ixs).toHaveLength(2);
    const [burn, memo] = decoded.ixs;
    expect(burn.programIndex).toBe(decoded.keys.indexOf(SPL_TOKEN_PROGRAM));
    // burnChecked accounts: [tokenAccount, mint, authority]
    expect(burn.accounts).toEqual([1, 2, 0]);
    expect(burn.data[0]).toBe(15); // BurnChecked tag
    expect(leU64(burn.data, 1)).toBe(500_000_000n);
    expect(burn.data[9]).toBe(6); // decimals
    expect(burn.data).toHaveLength(10);
    expect(memo.programIndex).toBe(decoded.keys.indexOf(MEMO_PROGRAM));
    expect(memo.accounts).toEqual([]);
    expect(new TextDecoder().decode(memo.data)).toBe('quote-abc123');
  });
});

describe('buildWocPaymentTx (burn + treasury split)', () => {
  const tx = buildWocPaymentTx(
    baseInput({ burnBase: 400n, treasuryBase: 100n, treasuryTokenAccount: TREASURY_ATA }),
  );
  const decoded = decodeTx(tx);

  it('adds the treasury token account as writable before the programs', () => {
    expect(decoded.keys).toEqual([
      PAYER,
      PAYER_ATA,
      MINT,
      TREASURY_ATA,
      SPL_TOKEN_PROGRAM,
      MEMO_PROGRAM,
    ]);
    expect(decoded.header).toEqual([1, 0, 2]);
  });

  it('emits burnChecked + transferChecked + memo', () => {
    expect(decoded.ixs).toHaveLength(3);
    const [burn, transfer, memo] = decoded.ixs;
    expect(burn.data[0]).toBe(15);
    expect(leU64(burn.data, 1)).toBe(400n);
    // transferChecked accounts: [source, mint, destination, authority]
    expect(transfer.programIndex).toBe(decoded.keys.indexOf(SPL_TOKEN_PROGRAM));
    expect(transfer.accounts).toEqual([1, 2, 3, 0]);
    expect(transfer.data[0]).toBe(12); // TransferChecked tag
    expect(leU64(transfer.data, 1)).toBe(100n);
    expect(transfer.data[9]).toBe(6);
    expect(new TextDecoder().decode(memo.data)).toBe('quote-abc123');
  });
});

describe('buildWocPaymentTx validation', () => {
  it('rejects a non-positive burn amount', () => {
    expect(() => buildWocPaymentTx(baseInput({ burnBase: 0n }))).toThrow(/positive/);
  });

  it('rejects a treasury split without a treasury token account', () => {
    expect(() => buildWocPaymentTx(baseInput({ treasuryBase: 1n }))).toThrow(/treasury/);
  });

  it('rejects duplicate accounts', () => {
    expect(() => buildWocPaymentTx(baseInput({ payerTokenAccount: PAYER }))).toThrow(/duplicate/);
  });

  it('rejects a bad pubkey and a bad memo', () => {
    expect(() => buildWocPaymentTx(baseInput({ mint: 'not-base58-0OIl' }))).toThrow(/base58/);
    expect(() => buildWocPaymentTx(baseInput({ payer: bs58.encode(new Uint8Array(31)) }))).toThrow(
      /32 bytes/,
    );
    expect(() => buildWocPaymentTx(baseInput({ memo: '' }))).toThrow(/memo/);
  });
});
