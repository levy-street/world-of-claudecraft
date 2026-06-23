// Live-devnet integration test for the ArenaEscrow money rail against the deployed
// woc_escrow program (Fn4L...). Real chain, real program, real SPL token: the
// orchestrator builds the stake txs, the (test-held) player keypairs sign them,
// and the orchestrator settles with the settler key. Asserts the winner's on-chain
// balance and the mint supply (the burned rake) directly.
//
// Gated on WOC_DEVNET_TEST=1 (skipped in CI and normal runs) and on three funded
// keypairs at /tmp/wager_{creator,opponent,settler}.json. The ledger is the real
// FlowLedger over an in-memory db (the SQL is covered by flow_ledger_db.integration).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ArenaEscrow } from '../server/arena_escrow';
import { FlowLedger, emissionDecision, type FlowLedgerDb, type FlowEntryInput } from '../server/flow_ledger';
import { vaultAta } from '../server/woc_escrow_client';

const RUN = process.env.WOC_DEVNET_TEST === '1';
const PROGRAM = new PublicKey('Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ');
const MINT = new PublicKey('E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx');

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
const tokenAmount = async (conn: Connection, owner: PublicKey) => BigInt((await conn.getTokenAccountBalance(vaultAta(owner, MINT))).value.amount);

(RUN ? describe : describe.skip)('ArenaEscrow on live devnet woc_escrow', () => {
  it('open -> join -> settle pays the winner the pot minus the burned rake on-chain', async () => {
    const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
    const creator = kp('/tmp/wager_creator.json');
    const opponent = kp('/tmp/wager_opponent.json');
    const settler = kp('/tmp/wager_settler.json');
    const stakeBase = 10_000_000n; // 10 mock $WOC
    const matchId = BigInt(Date.now()); // unique per run so the match PDA is fresh
    const ref = { matchId, creator: creator.publicKey, opponent: opponent.publicKey, stakeBase };

    const escrow = new ArenaEscrow({
      connection: conn, programId: PROGRAM, mint: MINT, settler,
      ledger: new FlowLedger(new MemFlowDb()), seasonId: 1, rakeBps: 500, // 5%
    });

    const supplyBefore = BigInt((await conn.getTokenSupply(MINT)).value.amount);

    const openTx = await escrow.buildOpenTx({ matchId, creator: creator.publicKey, stakeBase });
    openTx.sign(creator);
    const openSig = await conn.sendRawTransaction(openTx.serialize());
    await conn.confirmTransaction(openSig, 'confirmed');

    const joinTx = await escrow.buildJoinTx({ matchId, opponent: opponent.publicKey });
    joinTx.sign(opponent);
    const joinSig = await conn.sendRawTransaction(joinTx.serialize());
    await conn.confirmTransaction(joinSig, 'confirmed');

    expect(await escrow.bothStaked({ matchId })).toBe(true);

    const r = await escrow.settle(ref, creator.publicKey, openSig, joinSig);
    expect(r.potBase).toBe(20_000_000n);
    expect(r.burnBase).toBe(1_000_000n);
    expect(r.payoutBase).toBe(19_000_000n);
    expect(r.headroomBase).toBe(1_000_000n); // net sink == burn

    // On-chain truth: the winner now holds the payout, and supply dropped by the rake.
    expect(await tokenAmount(conn, creator.publicKey)).toBe(19_000_000n);
    expect(await tokenAmount(conn, opponent.publicKey)).toBe(0n);
    const supplyAfter = BigInt((await conn.getTokenSupply(MINT)).value.amount);
    expect(supplyBefore - supplyAfter).toBe(1_000_000n);

    console.log('DEVNET_WAGER ' + JSON.stringify({ matchId: matchId.toString(), openSig, joinSig, settleSig: r.signature }));
  }, 180_000);
});
