// server/sns.ts, the pure half of SNS subdomain minting: label slugification,
// name-account key derivation (pinned against the public bonfida.sol vector),
// registry parsing, and a byte-level decode of the hand-rolled 2-signer
// burn + subdomain-create transaction, including verifying the execution
// wallet's partial signature against the serialized message.
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import {
  buildSubdomainMintTx,
  domainKey,
  fullSubdomain,
  hashedName,
  keypairFromSecret,
  MEMO_PROGRAM,
  NAME_PROGRAM,
  nameAccountKey,
  parentDomainKey,
  parseRegistryOwner,
  REGISTRY_HEADER_LEN,
  ROOT_DOMAIN_ACCOUNT,
  SPL_TOKEN_PROGRAM,
  type SubdomainMintTxInput,
  SYSTEM_PROGRAM,
  slugifyLabel,
  subdomainKey,
} from '../server/sns';

describe('slugifyLabel', () => {
  it('lowercases and hyphenates a display name', () => {
    expect(slugifyLabel('Aragorn')).toBe('aragorn');
    expect(slugifyLabel("O'Brien The Bold")).toBe('o-brien-the-bold');
    expect(slugifyLabel('Mc Coy')).toBe('mc-coy');
  });

  it('strips accents to ASCII', () => {
    expect(slugifyLabel('Légolas')).toBe('legolas');
    expect(slugifyLabel('Renée')).toBe('renee');
  });

  it('returns null when nothing valid remains', () => {
    expect(slugifyLabel('???')).toBeNull();
    expect(slugifyLabel('   ')).toBeNull();
    expect(slugifyLabel('')).toBeNull();
  });

  it('caps the label at 63 characters with no trailing hyphen', () => {
    const slug = slugifyLabel('a'.repeat(80));
    expect(slug).not.toBeNull();
    expect((slug as string).length).toBe(63);
    expect((slug as string).endsWith('-')).toBe(false);
    // A name that would slice to a trailing hyphen is trimmed, not left dangling.
    const trimmed = slugifyLabel(`${'b'.repeat(62)} tail`);
    expect(trimmed).not.toBeNull();
    expect((trimmed as string).endsWith('-')).toBe(false);
  });

  it('composes the full subdomain under the parent domain', () => {
    expect(fullSubdomain('aragorn')).toBe('aragorn.worldofclaudecraft.sol');
  });
});

describe('SNS key derivation', () => {
  it('matches the public bonfida.sol registry key', () => {
    // Known mainnet vector: the bonfida.sol name account. Pins the whole
    // derivation chain (hash prefix, PDA walk, root TLD constant).
    expect(nameAccountKey(hashedName('bonfida'), ROOT_DOMAIN_ACCOUNT)).toBe(
      'Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb',
    );
    expect(domainKey('bonfida.sol')).toBe('Crf8hzfthWGbGbLTVCiqRqV5MVnbpHB1L9KQMd6gsinb');
  });

  it('is deterministic and distinguishes labels and levels', () => {
    expect(subdomainKey('aragorn')).toBe(subdomainKey('aragorn'));
    expect(subdomainKey('aragorn')).not.toBe(subdomainKey('boromir'));
    // A subdomain label hashes with the "\0" prefix under the parent key, so it
    // never collides with a same-named top-level domain.
    expect(subdomainKey('aragorn')).not.toBe(domainKey('aragorn.sol'));
    expect(domainKey(fullSubdomain('aragorn'))).toBe(subdomainKey('aragorn'));
  });

  it('rejects domain depths it does not model', () => {
    expect(() => domainKey('a.b.c.sol')).toThrow(/depth/);
  });
});

describe('parseRegistryOwner', () => {
  it('reads the owner out of the 96-byte registry header', () => {
    const owner = new Uint8Array(32).fill(7);
    const data = new Uint8Array(REGISTRY_HEADER_LEN + 10);
    data.set(owner, 32);
    expect(parseRegistryOwner(data)).toBe(bs58.encode(owner));
  });

  it('returns null for a short buffer', () => {
    expect(parseRegistryOwner(new Uint8Array(64))).toBeNull();
  });
});

describe('keypairFromSecret', () => {
  const seed = new Uint8Array(32).fill(5);
  const pub = ed25519.getPublicKey(seed);

  it('accepts a 32-byte seed and a 64-byte solana keypair', () => {
    const fromSeed = keypairFromSecret(bs58.encode(seed));
    expect(fromSeed.publicKey).toBe(bs58.encode(pub));
    const solana = new Uint8Array(64);
    solana.set(seed, 0);
    solana.set(pub, 32);
    expect(keypairFromSecret(bs58.encode(solana)).publicKey).toBe(bs58.encode(pub));
  });

  it('rejects a 64-byte secret whose embedded pubkey mismatches', () => {
    const solana = new Uint8Array(64);
    solana.set(seed, 0);
    solana.set(new Uint8Array(32).fill(9), 32);
    expect(() => keypairFromSecret(bs58.encode(solana))).toThrow(/inconsistent/);
  });

  it('rejects other lengths', () => {
    expect(() => keypairFromSecret(bs58.encode(new Uint8Array(31)))).toThrow(/32 or 64/);
  });
});

// ── the burn + mint transaction, decoded byte by byte ───────────────────────

const key = (fill: number): string => bs58.encode(new Uint8Array(32).fill(fill));
const PAYER = key(1);
const PAYER_ATA = key(2);
const MINT = key(3);
const TREASURY_ATA = key(4);
const BLOCKHASH = key(9);
const EXEC_SEED = new Uint8Array(32).fill(11);
const EXEC_SECRET = bs58.encode(EXEC_SEED);
const EXEC_PUB = bs58.encode(ed25519.getPublicKey(EXEC_SEED));

const baseInput = (over: Partial<SubdomainMintTxInput> = {}): SubdomainMintTxInput => ({
  payer: PAYER,
  payerTokenAccount: PAYER_ATA,
  mint: MINT,
  decimals: 6,
  burnBase: 1_000_000_000n,
  treasuryTokenAccount: null,
  treasuryBase: 0n,
  memo: 'quote-abc123',
  recentBlockhash: BLOCKHASH,
  label: 'aragorn',
  rentLamports: 15_616_720n,
  space: 2_000,
  executionSecret: EXEC_SECRET,
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
  const messageStart = off;
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
  return { signatures, header, keys, blockhash, ixs, message: bytes.slice(messageStart) };
}

const leU64 = (data: Uint8Array, start: number): bigint => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[start + i]);
  return v;
};
const leU32 = (data: Uint8Array, start: number): number =>
  data[start] | (data[start + 1] << 8) | (data[start + 2] << 16) | (data[start + 3] << 24);

describe('buildSubdomainMintTx (100% burn, no treasury)', () => {
  const tx = buildSubdomainMintTx(baseInput());
  const decoded = decodeTx(tx);
  const NAME_ACCOUNT = subdomainKey('aragorn');
  const PARENT_ACCOUNT = parentDomainKey();

  it('has two signature slots: zeroed payer, then a VALID execution signature', () => {
    expect(decoded.signatures).toHaveLength(2);
    expect(decoded.signatures[0].every((b) => b === 0)).toBe(true);
    expect(ed25519.verify(decoded.signatures[1], decoded.message, bs58.decode(EXEC_PUB))).toBe(
      true,
    );
  });

  it('has the legacy header: 2 signers, 1 readonly signed, 5 readonly unsigned', () => {
    expect(decoded.header).toEqual([2, 1, 5]);
  });

  it('orders the account table signers, writables, then readonly accounts', () => {
    expect(decoded.keys).toEqual([
      PAYER,
      EXEC_PUB,
      PAYER_ATA,
      MINT,
      NAME_ACCOUNT,
      SYSTEM_PROGRAM,
      PARENT_ACCOUNT,
      SPL_TOKEN_PROGRAM,
      MEMO_PROGRAM,
      NAME_PROGRAM,
    ]);
    expect(decoded.blockhash).toBe(BLOCKHASH);
  });

  it('emits burnChecked, the quote memo, then the SNS create instruction', () => {
    expect(decoded.ixs).toHaveLength(3);
    const [burn, memo, create] = decoded.ixs;

    expect(burn.programIndex).toBe(decoded.keys.indexOf(SPL_TOKEN_PROGRAM));
    // burnChecked accounts: [tokenAccount, mint, authority]
    expect(burn.accounts).toEqual([
      decoded.keys.indexOf(PAYER_ATA),
      decoded.keys.indexOf(MINT),
      decoded.keys.indexOf(PAYER),
    ]);
    expect(burn.data[0]).toBe(15); // BurnChecked tag
    expect(leU64(burn.data, 1)).toBe(1_000_000_000n);
    expect(burn.data[9]).toBe(6); // decimals

    expect(memo.programIndex).toBe(decoded.keys.indexOf(MEMO_PROGRAM));
    expect(memo.accounts).toEqual([]);
    expect(new TextDecoder().decode(memo.data)).toBe('quote-abc123');

    // SNS create accounts: [system, payer, name, owner, class, parent, parentOwner].
    expect(create.programIndex).toBe(decoded.keys.indexOf(NAME_PROGRAM));
    expect(create.accounts).toEqual([
      decoded.keys.indexOf(SYSTEM_PROGRAM),
      decoded.keys.indexOf(PAYER),
      decoded.keys.indexOf(NAME_ACCOUNT),
      decoded.keys.indexOf(PAYER),
      decoded.keys.indexOf(SYSTEM_PROGRAM),
      decoded.keys.indexOf(PARENT_ACCOUNT),
      decoded.keys.indexOf(EXEC_PUB),
    ]);
    // Data: tag 0 + Vec<u8> hashed name ("\0" + label) + lamports u64 + space u32.
    expect(create.data[0]).toBe(0);
    expect(leU32(create.data, 1)).toBe(32);
    expect(bs58.encode(create.data.slice(5, 37))).toBe(bs58.encode(hashedName('\0aragorn')));
    expect(leU64(create.data, 37)).toBe(15_616_720n);
    expect(leU32(create.data, 45)).toBe(2_000);
    expect(create.data).toHaveLength(49);
  });
});

describe('buildSubdomainMintTx (burn + treasury split)', () => {
  const tx = buildSubdomainMintTx(
    baseInput({ burnBase: 400n, treasuryBase: 100n, treasuryTokenAccount: TREASURY_ATA }),
  );
  const decoded = decodeTx(tx);

  it('adds the treasury token account and the transferChecked instruction', () => {
    expect(decoded.header).toEqual([2, 1, 5]);
    expect(decoded.keys).toContain(TREASURY_ATA);
    expect(decoded.ixs).toHaveLength(4);
    const transfer = decoded.ixs[1];
    expect(transfer.programIndex).toBe(decoded.keys.indexOf(SPL_TOKEN_PROGRAM));
    // transferChecked accounts: [source, mint, destination, authority]
    expect(transfer.accounts).toEqual([
      decoded.keys.indexOf(PAYER_ATA),
      decoded.keys.indexOf(MINT),
      decoded.keys.indexOf(TREASURY_ATA),
      decoded.keys.indexOf(PAYER),
    ]);
    expect(transfer.data[0]).toBe(12); // TransferChecked tag
    expect(leU64(transfer.data, 1)).toBe(100n);
  });
});

describe('buildSubdomainMintTx validation', () => {
  it('rejects a non-positive burn amount', () => {
    expect(() => buildSubdomainMintTx(baseInput({ burnBase: 0n }))).toThrow(/positive/);
  });

  it('rejects a treasury split without a treasury token account', () => {
    expect(() => buildSubdomainMintTx(baseInput({ treasuryBase: 1n }))).toThrow(/treasury/);
  });

  it('rejects an unslugified label and a bad rent amount', () => {
    expect(() => buildSubdomainMintTx(baseInput({ label: 'Aragorn' }))).toThrow(/label/);
    expect(() => buildSubdomainMintTx(baseInput({ label: '' }))).toThrow(/label/);
    expect(() => buildSubdomainMintTx(baseInput({ rentLamports: 0n }))).toThrow(/rent/);
  });

  it('rejects duplicate accounts and a bad memo', () => {
    expect(() => buildSubdomainMintTx(baseInput({ payerTokenAccount: PAYER }))).toThrow(
      /duplicate/,
    );
    expect(() => buildSubdomainMintTx(baseInput({ memo: '' }))).toThrow(/memo/);
  });
});
