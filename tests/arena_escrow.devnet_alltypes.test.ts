// Live-devnet proof of ALL FIVE woc_escrow instruction types against the deployed
// program (Fn4L..., upgraded with refund_match). Each match uses a fresh id; players
// sign open/join/cancel, the settler signs settle/refund. Asserts on-chain truth
// (Match.status, token balances, mint supply) and prints every signature as a
// DEVNET_ALLTYPES line for the solscan write-up.
//
// Gated on WOC_DEVNET_TEST=1 (skipped in CI / normal runs). The two players must
// already hold mock $WOC (minted via the spl-token CLI in the harness step) and a
// little SOL for fees.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ArenaEscrow } from '../server/arena_escrow';
import { FlowLedger, emissionDecision, type FlowLedgerDb, type FlowEntryInput } from '../server/flow_ledger';
import { vaultAta } from '../server/woc_escrow_client';

const RUN = process.env.WOC_DEVNET_TEST === '1';
const PROGRAM = new PublicKey('Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ');
const MINT = new PublicKey('E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx');
const RPC = process.env.WOC_DEVNET_RPC ?? 'https://api.devnet.solana.com';
const STAKE = 10_000_000n; // 10 mock $WOC
const RAKE_BPS = 500; // 5%

class MemFlowDb implements FlowLedgerDb {
  entries: { dir: 'in' | 'out'; amount: bigint; txSig: string | null }[] = [];
  async ensureSeason() {}
  async seasonHeadroom() { return this.entries.reduce((h, e) => (e.dir === 'in' ? h + e.amount : h - e.amount), 0n); }
  async seasonIsOpen() { return true; }
  async recordInflow(i: FlowEntryInput) {
    if (i.txSig && this.entries.some((e) => e.txSig === i.txSig)) return { ok: false as const, reason: 'duplicate' as const };
    this.entries.push({ dir: 'in', amount: i.amountBase, txSig: i.txSig ?? null });
    return { ok: true as const };
  }
  async recordOutflowWithinBudget(i: FlowEntryInput) {
    const headroomBase = await this.seasonHeadroom();
    const d = emissionDecision(headroomBase, i.amountBase);
    if (!d.allow) return { ok: false as const, reason: d.reason, headroomBase };
    this.entries.push({ dir: 'out', amount: i.amountBase, txSig: i.txSig ?? null });
    return { ok: true as const, headroomBase: await this.seasonHeadroom() };
  }
}

const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const woc = async (conn: Connection, owner: PublicKey) =>
  BigInt((await conn.getTokenAccountBalance(vaultAta(owner, MINT))).value.amount);
const supply = async (conn: Connection) => BigInt((await conn.getTokenSupply(MINT)).value.amount);

(RUN ? describe : describe.skip)('woc_escrow: all five instruction types on live devnet', () => {
  const conn = new Connection(RPC, 'confirmed');
  const creator = kp('/tmp/wager_creator.json');
  const opponent = kp('/tmp/wager_opponent.json');
  const settler = kp('/tmp/wager_settler.json');
  const escrow = new ArenaEscrow({
    connection: conn, programId: PROGRAM, mint: MINT, settler,
    ledger: new FlowLedger(new MemFlowDb()), seasonId: 1, rakeBps: RAKE_BPS,
  });
  const sigs: Record<string, string> = {};
  const send = async (tx: import('@solana/web3.js').Transaction, signer: Keypair) => {
    tx.sign(signer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  };

  it('open -> join -> settle: winner takes the pot minus the burned rake', async () => {
    const matchId = BigInt(Date.now());
    const supplyBefore = await supply(conn);
    const winnerBefore = await woc(conn, creator.publicKey);

    sigs.openSettle = await send(await escrow.buildOpenTx({ matchId, creator: creator.publicKey, stakeBase: STAKE }), creator);
    sigs.joinSettle = await send(await escrow.buildJoinTx({ matchId, opponent: opponent.publicKey }), opponent);
    expect(await escrow.bothStaked({ matchId })).toBe(true);

    const r = await escrow.settle({ matchId, creator: creator.publicKey, opponent: opponent.publicKey, stakeBase: STAKE }, creator.publicKey, sigs.openSettle, sigs.joinSettle);
    sigs.settle = r.signature;
    expect(r.potBase).toBe(20_000_000n);
    expect(r.burnBase).toBe(1_000_000n);
    expect(r.payoutBase).toBe(19_000_000n);
    expect(await escrow.matchStatus(matchId)).toBe(null); // settle_match closes the match PDA (rent reclaimed)
    // On-chain truth: winner gained pot-minus-rake net of their own stake; supply burned the rake.
    expect(await woc(conn, creator.publicKey) - winnerBefore).toBe(9_000_000n); // +19 paid, -10 staked
    expect(supplyBefore - await supply(conn)).toBe(1_000_000n);
  }, 180_000);

  it('open -> cancel: creator reclaims the full stake when no opponent joins', async () => {
    const matchId = BigInt(Date.now()) + 1n;
    const before = await woc(conn, creator.publicKey);
    sigs.openCancel = await send(await escrow.buildOpenTx({ matchId, creator: creator.publicKey, stakeBase: STAKE }), creator);
    expect(await woc(conn, creator.publicKey)).toBe(before - STAKE); // staked
    sigs.cancel = await send(await escrow.buildCancelTx({ matchId, creator: creator.publicKey }), creator);
    expect(await escrow.matchStatus(matchId)).toBe(null); // cancel_match closes the match PDA (rent reclaimed)
    expect(await woc(conn, creator.publicKey)).toBe(before); // fully reclaimed
  }, 180_000);

  it('open -> join -> refund: a drawn bout returns both stakes, supply-neutral', async () => {
    const matchId = BigInt(Date.now()) + 2n;
    const cBefore = await woc(conn, creator.publicKey);
    const oBefore = await woc(conn, opponent.publicKey);
    const supplyBefore = await supply(conn);

    sigs.openRefund = await send(await escrow.buildOpenTx({ matchId, creator: creator.publicKey, stakeBase: STAKE }), creator);
    sigs.joinRefund = await send(await escrow.buildJoinTx({ matchId, opponent: opponent.publicKey }), opponent);
    expect(await escrow.bothStaked({ matchId })).toBe(true);

    const r = await escrow.refundDraw({ matchId, creator: creator.publicKey, opponent: opponent.publicKey, stakeBase: STAKE });
    sigs.refund = r.signature;
    expect(await escrow.matchStatus(matchId)).toBe(null); // refund_match closes the match PDA (rent reclaimed)
    // Both made whole, nothing burned.
    expect(await woc(conn, creator.publicKey)).toBe(cBefore);
    expect(await woc(conn, opponent.publicKey)).toBe(oBefore);
    expect(await supply(conn)).toBe(supplyBefore);

    const out = process.env.DEVNET_SIGS_OUT;
    if (out) writeFileSync(out, JSON.stringify(sigs, null, 2));
    console.log('DEVNET_ALLTYPES ' + JSON.stringify(sigs));
  }, 180_000);
});
