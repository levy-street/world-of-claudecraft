// Tests the ArenaEscrow money rail (server/arena_escrow.ts). The chain is a fake
// Connection (records sent txs, serves a settable vault balance), but the ledger
// is the REAL FlowLedger over an in-memory FlowLedgerDb that uses the REAL
// emissionDecision invariant, so the buy>sell accounting is exercised, not mocked.
// A separate real-Postgres test covers the SQL; a devnet test covers the real chain.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ArenaEscrow } from '../server/arena_escrow';
import { FlowLedger, emissionDecision, type FlowLedgerDb, type FlowEntryInput } from '../server/flow_ledger';
import { matchPda, vaultAta } from '../server/woc_escrow_client';

const disc = (n: string) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);

// In-memory persistence: real-invariant headroom, txSig replay guard. Mirrors the
// production DB's contract (recordOutflowWithinBudget gates via emissionDecision).
class MemFlowDb implements FlowLedgerDb {
  seasons = new Set<number>();
  entries: { seasonId: number; dir: 'in' | 'out'; amount: bigint; txSig: string | null }[] = [];
  async ensureSeason(id: number) { this.seasons.add(id); }
  async seasonHeadroom(id: number) {
    return this.entries.filter((e) => e.seasonId === id).reduce((h, e) => (e.dir === 'in' ? h + e.amount : h - e.amount), 0n);
  }
  async seasonIsOpen(id: number) { return this.seasons.has(id); }
  async recordInflow(input: FlowEntryInput) {
    if (input.txSig && this.entries.some((e) => e.txSig === input.txSig)) return { ok: false as const, reason: 'duplicate' as const };
    this.entries.push({ seasonId: input.seasonId, dir: 'in', amount: input.amountBase, txSig: input.txSig ?? null });
    return { ok: true as const, entryId: this.entries.length };
  }
  async recordOutflowWithinBudget(input: FlowEntryInput) {
    const headroomBase = await this.seasonHeadroom(input.seasonId);
    if (input.txSig && this.entries.some((e) => e.txSig === input.txSig)) return { ok: false as const, reason: 'duplicate' as const, headroomBase };
    const d = emissionDecision(headroomBase, input.amountBase);
    if (!d.allow) return { ok: false as const, reason: d.reason, headroomBase };
    this.entries.push({ seasonId: input.seasonId, dir: 'out', amount: input.amountBase, txSig: input.txSig ?? null });
    return { ok: true as const, headroomBase: await this.seasonHeadroom(input.seasonId), entryId: this.entries.length, payoutId: this.entries.length };
  }
}

class FakeConnection {
  sent: { ixData: Buffer; feePayer: string }[] = [];
  vaultAmount: bigint | null = null; // null => vault account does not exist
  matchStatusByte: number | null = null; // null => match account does not exist
  private n = 0;
  async getLatestBlockhash() { return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1000 }; }
  async getParsedAccountInfo(_pk: PublicKey) {
    if (this.vaultAmount === null) return { value: null };
    return { value: { data: { parsed: { info: { tokenAmount: { amount: this.vaultAmount.toString() } } } } } };
  }
  async getAccountInfo(_pk: PublicKey) {
    if (this.matchStatusByte === null) return null;
    const data = Buffer.alloc(156);
    data[154] = this.matchStatusByte; // Match.status byte
    return { data };
  }
  async sendTransaction(tx: any) {
    this.sent.push({ ixData: tx.instructions[0].data, feePayer: tx.feePayer.toBase58() });
    return `sig-${++this.n}`;
  }
  async confirmTransaction() { return { value: { err: null } }; }
}

const programId = new PublicKey('Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ');
const mint = new PublicKey('E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx');
const creator = Keypair.generate().publicKey;
const opponent = Keypair.generate().publicKey;
const STAKE = 100_000_000n; // 100 mock $WOC (6 decimals)

function setup(rakeBps = 500) {
  const conn = new FakeConnection();
  const db = new MemFlowDb();
  const settler = Keypair.generate();
  const escrow = new ArenaEscrow({
    connection: conn as unknown as Connection, programId, mint, settler,
    ledger: new FlowLedger(db), seasonId: 1, rakeBps,
  });
  const m = { matchId: 1n, creator, opponent, stakeBase: STAKE };
  return { conn, db, settler, escrow, m };
}

describe('ArenaEscrow stake-transaction building', () => {
  it('builds an open_match tx the creator pays for', async () => {
    const { escrow } = setup();
    const tx = await escrow.buildOpenTx({ matchId: 1n, creator, stakeBase: STAKE });
    expect(tx.feePayer!.equals(creator)).toBe(true);
    expect(tx.recentBlockhash).toBeTruthy();
    expect(tx.instructions[0].data.subarray(0, 8).equals(disc('open_match'))).toBe(true);
  });
  it('builds a join_match tx the opponent pays for', async () => {
    const { escrow } = setup();
    const tx = await escrow.buildJoinTx({ matchId: 1n, opponent });
    expect(tx.feePayer!.equals(opponent)).toBe(true);
    expect(tx.instructions[0].data.subarray(0, 8).equals(disc('join_match'))).toBe(true);
  });
  it('builds a cancel_match tx the creator pays for', async () => {
    const { escrow } = setup();
    const tx = await escrow.buildCancelTx({ matchId: 1n, creator });
    expect(tx.feePayer!.equals(creator)).toBe(true);
    expect(tx.instructions[0].data.subarray(0, 8).equals(disc('cancel_match'))).toBe(true);
  });
  it('targets the right pot vault (ATA of the match PDA)', () => {
    const { escrow } = setup();
    expect(escrow.vault(1n).equals(vaultAta(matchPda(programId, 1n), mint))).toBe(true);
  });
});

describe('ArenaEscrow stake detection', () => {
  it('vaultBalanceBase reads 0 when the vault account does not exist, else parses the amount', async () => {
    const { escrow, conn } = setup();
    conn.vaultAmount = null;
    expect(await escrow.vaultBalanceBase(1n)).toBe(0n);
    conn.vaultAmount = 1_234n;
    expect(await escrow.vaultBalanceBase(1n)).toBe(1_234n);
  });
  it('bothStaked reads the on-chain Match.status, not the vault balance (no donation can fake it)', async () => {
    const { escrow, conn } = setup();
    conn.vaultAmount = 2n * STAKE; // a donated/funded vault must NOT, by itself, count as both-staked
    conn.matchStatusByte = null; // match account missing
    expect(await escrow.bothStaked({ matchId: 1n })).toBe(false);
    conn.matchStatusByte = 0; // Open (only the creator has staked)
    expect(await escrow.bothStaked({ matchId: 1n })).toBe(false);
    conn.matchStatusByte = 1; // Locked (the program flipped it on a real join)
    expect(await escrow.bothStaked({ matchId: 1n })).toBe(true);
    conn.matchStatusByte = 2; // Settled is not "awaiting the bout"
    expect(await escrow.bothStaked({ matchId: 1n })).toBe(false);
  });
  it('matchStatus reads the status byte at the documented offset', async () => {
    const { escrow, conn } = setup();
    conn.matchStatusByte = 1;
    expect(await escrow.matchStatus(1n)).toBe(1);
    conn.matchStatusByte = null;
    expect(await escrow.matchStatus(1n)).toBe(null);
  });
});

describe('ArenaEscrow settle (winner take + burn, ledger net sink = burn)', () => {
  it('settles, computes pot/burn/payout, and leaves headroom == burn', async () => {
    const { escrow, db, m } = setup(500); // 5% rake
    const r = await escrow.settle(m, creator, 'open-sig', 'join-sig');
    expect(r.potBase).toBe(200_000_000n);
    expect(r.burnBase).toBe(10_000_000n); // 5% of 200
    expect(r.payoutBase).toBe(190_000_000n);
    // The match is a self-funded payout: the only net sink is the burned rake.
    expect(r.headroomBase).toBe(10_000_000n);
    expect(await db.seasonHeadroom(1)).toBe(10_000_000n);
    // Ledger inspection: two stake inflows (open/join sigs) + one payout outflow (settle sig).
    expect(db.entries.filter((e) => e.dir === 'in').map((e) => e.amount)).toEqual([100_000_000n, 100_000_000n]);
    expect(db.entries.filter((e) => e.dir === 'out')).toEqual([{ seasonId: 1, dir: 'out', amount: 190_000_000n, txSig: 'sig-1' }]);
  });
  it('signs settle_match with the settler as fee payer', async () => {
    const { escrow, conn, settler, m } = setup();
    await escrow.settle(m, opponent, 'open-sig', 'join-sig');
    expect(conn.sent[0].ixData.subarray(0, 8).equals(disc('settle_match'))).toBe(true);
    expect(conn.sent[0].feePayer).toBe(settler.publicKey.toBase58());
  });
  it('rejects a winner who is not one of the two players (no chain call)', async () => {
    const { escrow, conn, m } = setup();
    const stranger = Keypair.generate().publicKey;
    await expect(escrow.settle(m, stranger, 'o', 'j')).rejects.toThrow('winner must be one of the two staked players');
    expect(conn.sent.length).toBe(0);
  });
  it('zero rake: full pot pays out, leaving zero net sink (payout == headroom boundary)', async () => {
    const { escrow, db, m } = setup(0);
    const r = await escrow.settle(m, creator, 'open-sig', 'join-sig');
    expect(r.burnBase).toBe(0n);
    expect(r.payoutBase).toBe(200_000_000n);
    expect(r.headroomBase).toBe(0n);
    expect(await db.seasonHeadroom(1)).toBe(0n);
  });
  it('tolerates a duplicate stake inflow (replayed open/join sig) without double-crediting', async () => {
    const { escrow, db, m } = setup(500);
    // Pre-credit the creator stake under the same sig the settle will use.
    await db.recordInflow({ seasonId: 1, source: 'gamblefi_stake', amountBase: STAKE, txSig: 'open-sig' });
    const r = await escrow.settle(m, creator, 'open-sig', 'join-sig');
    expect(r.headroomBase).toBe(10_000_000n); // still exactly the burn, not double-counted
    expect(db.entries.filter((e) => e.dir === 'in').length).toBe(2); // open-sig not re-added
  });
});

describe('ArenaEscrow refund (draw)', () => {
  it('signs refund_match and records nothing in the ledger (supply-neutral)', async () => {
    const { escrow, conn, db, m } = setup(500);
    const r = await escrow.refundDraw(m);
    expect(conn.sent[0].ixData.subarray(0, 8).equals(disc('refund_match'))).toBe(true);
    expect(r.signature).toBe('sig-1');
    expect(db.entries.length).toBe(0);
    expect(await db.seasonHeadroom(1)).toBe(0n);
  });
});
