// Live-devnet proof of every woc_auction_escrow instruction against the deployed
// program. It creates a fresh legacy-SPL test mint, funds a seller and three
// bidders, then drives:
//
//   auction 1: open -> bid(b1) -> bid(b2) -> bid(b3, meets buyout) -> settle
//              (proves the ATOMIC OUTBID REFUND, the seller payout, the rake burn)
//   auction 2: open -> bid(b1) -> cancel                (proves the cancel refund)
//   auction 3: open -> bid(b1) -> reclaim_expired REJECTED before grace (NotEnded)
//              -> cancel cleanup       (reclaim economics equal settle, proven by #1)
//
// The deployer keypair is the fee payer, mint authority, settler, and rent payer,
// so the seller and bidders need zero SOL; each bidder co-signs only its own bid.
// Confirmation is HTTP-polling getSignatureStatuses to Finalized (never the
// websocket confirmTransaction). Every signature is collected, written to a proof
// JSON, and printed with an explorer URL.
//
// Instructions are assembled with a hand-rolled Anchor-ABI encoder (discriminator
// = sha256("global:<snake_name>")[..8] plus borsh-packed args) instead of the
// generated IDL client, because IDL generation is broken on this toolchain
// (anchor-syn 0.30.1 calls proc_macro2::Span::source_file(), gated out in
// proc-macro2 1.0.106) - a workspace-wide condition; the .so builds and deploys
// fine. The encoder mirrors the program's #[derive(Accounts)] field order exactly.
//
// Gated on WOC_DEVNET_TEST=1 (describe.skip otherwise). Run with:
//   WOC_DEVNET_TEST=1 npx ts-mocha -p ./tsconfig.json -t 1000000 \
//     tests/woc_auction_escrow.devnet_alltypes.test.ts

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import { expect } from 'chai';

const RUN = process.env.WOC_DEVNET_TEST === '1';
const RPC =
  process.env.ANCHOR_PROVIDER_URL ?? process.env.WOC_DEVNET_RPC ?? 'https://api.devnet.solana.com';
const WALLET =
  process.env.ANCHOR_WALLET ?? '/Users/futjr/woc/world-of-claudecraft/.secrets/deployer.json';
const SIGS_OUT = process.env.DEVNET_SIGS_OUT ?? 'devnet-proof.json';

const PROGRAM_ID = new PublicKey('GzkjHHkkJqZf5Qa3YZaJo1iHcKkxi4zUT5sV3zpVeyqZ');
const DEPLOY_SIG =
  '5qRF3kstpkp8dHDw1BiVhkgUzCdgHbftzVgMwHSeMvVaBSdL82axKWkehEW6vjbA5CF9YLydU7mnfFVYwddZtaz6';

const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const FUND = 1_000n * UNIT; // minted to each bidder
const MIN_BID = 100n * UNIT;
const BID1 = 100n * UNIT; // == min_bid
const BID2 = 200n * UNIT;
const BID3 = 300n * UNIT; // == buyout
const BUYOUT = 300n * UNIT;
const RAKE_BPS = 500; // 5%
const EXPECT_RAKE = (BID3 * BigInt(RAKE_BPS)) / 10_000n; // 15 tokens
const EXPECT_PAYOUT = BID3 - EXPECT_RAKE; // 285 tokens

const loadKp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// ---- hand-rolled Anchor-ABI encoders ----
const disc = (name: string): Buffer =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64le = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const i64le = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
};
const u16le = (v: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const pk = (p: PublicKey): Buffer => Buffer.from(p.toBytes());
const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta => ({
  pubkey,
  isSigner,
  isWritable,
});

(RUN ? describe : describe.skip)('woc_auction_escrow: all instruction types on live devnet', function () {
  this.timeout(600_000);

  const conn = new Connection(RPC, 'confirmed');
  const deployer = RUN ? loadKp(WALLET) : (null as unknown as Keypair);
  const sigs: Record<string, string> = {};

  // Poll getSignatureStatuses over HTTP until Finalized (no websocket).
  async function confirmFinalized(sig: string, timeoutMs = 120_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const st = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
      const v = st.value[0];
      if (v) {
        if (v.err) throw new Error(`tx ${sig} failed on-chain: ${JSON.stringify(v.err)}`);
        if (v.confirmationStatus === 'finalized') return;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`tx ${sig} was not finalized within ${timeoutMs}ms`);
  }

  async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = deployer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('finalized')).blockhash;
    tx.sign(...signers);
    const sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await confirmFinalized(sig);
    return sig;
  }

  const tokenBal = async (ata: PublicKey): Promise<bigint> =>
    BigInt((await conn.getTokenAccountBalance(ata, 'confirmed')).value.amount);
  const supply = async (): Promise<bigint> =>
    BigInt((await conn.getTokenSupply(mint, 'confirmed')).value.amount);
  const accountExists = async (p: PublicKey): Promise<boolean> =>
    (await conn.getAccountInfo(p, 'confirmed')) !== null;

  // Auction state layout after the 8-byte discriminator.
  async function fetchAuction(pda: PublicKey) {
    const info = await conn.getAccountInfo(pda, 'confirmed');
    if (!info) throw new Error('auction account missing');
    const d = info.data;
    return {
      highBidder: new PublicKey(d.subarray(138, 170)),
      highBid: d.readBigUInt64LE(170),
      status: d.readUInt8(178), // 0 Open, 1 Settled, 2 Cancelled
    };
  }

  let mint: PublicKey;
  let seller: Keypair;
  let b1: Keypair;
  let b2: Keypair;
  let b3: Keypair;
  let sellerAta: PublicKey;
  let b1Ata: PublicKey;
  let b2Ata: PublicKey;
  let b3Ata: PublicKey;

  const auctionPda = (id: bigint): PublicKey =>
    PublicKey.findProgramAddressSync([Buffer.from('auction'), u64le(id)], PROGRAM_ID)[0];
  const vaultOf = (pda: PublicKey): PublicKey =>
    getAssociatedTokenAddressSync(mint, pda, true, TOKEN_PROGRAM_ID);

  const openIx = (
    id: bigint,
    pda: PublicKey,
    vault: PublicKey,
    minBid: bigint,
    rakeBps: number,
    buyout: bigint,
    settler: PublicKey,
    endsAt: bigint,
  ): TransactionInstruction =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(deployer.publicKey, true, true), // opener
        meta(pda, false, true), // auction
        meta(mint, false, false), // mint
        meta(vault, false, true), // vault
        meta(TOKEN_PROGRAM_ID, false, false),
        meta(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
        meta(SystemProgram.programId, false, false),
      ],
      data: Buffer.concat([
        disc('open_auction'),
        u64le(id),
        pk(seller.publicKey),
        u64le(minBid),
        u16le(rakeBps),
        u64le(buyout),
        pk(settler),
        i64le(endsAt),
      ]),
    });

  const bidIx = (
    id: bigint,
    pda: PublicKey,
    vault: PublicKey,
    bidder: Keypair,
    bidderAta: PublicKey,
    amount: bigint,
    priorAta: PublicKey | null,
  ): TransactionInstruction =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(bidder.publicKey, true, true), // bidder
        meta(pda, false, true), // auction
        meta(vault, false, true), // vault
        meta(bidderAta, false, true), // bidder_token
        // prior_bidder_token (Option): the program id is Anchor's None sentinel.
        priorAta ? meta(priorAta, false, true) : meta(PROGRAM_ID, false, false),
        meta(TOKEN_PROGRAM_ID, false, false),
      ],
      data: Buffer.concat([disc('place_bid'), u64le(id), u64le(amount)]),
    });

  const settleIx = (id: bigint, pda: PublicKey, vault: PublicKey): TransactionInstruction =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(deployer.publicKey, true, false), // settler (fee payer forces writable)
        meta(seller.publicKey, false, true), // seller (rent dest)
        meta(pda, false, true), // auction
        meta(mint, false, true), // mint
        meta(vault, false, true), // vault
        meta(sellerAta, false, true), // seller_token
        meta(TOKEN_PROGRAM_ID, false, false),
      ],
      data: Buffer.concat([disc('settle_auction'), u64le(id)]),
    });

  const cancelIx = (
    id: bigint,
    pda: PublicKey,
    vault: PublicKey,
    highBidderAta: PublicKey | null,
  ): TransactionInstruction =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(deployer.publicKey, true, false), // settler
        meta(seller.publicKey, false, true), // seller (rent dest)
        meta(pda, false, true), // auction
        meta(vault, false, true), // vault
        highBidderAta ? meta(highBidderAta, false, true) : meta(PROGRAM_ID, false, false),
        meta(TOKEN_PROGRAM_ID, false, false),
      ],
      data: Buffer.concat([disc('cancel_auction'), u64le(id)]),
    });

  const reclaimIx = (id: bigint, pda: PublicKey, vault: PublicKey): TransactionInstruction =>
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(deployer.publicKey, true, true), // caller (permissionless)
        meta(seller.publicKey, false, true), // seller (rent dest)
        meta(pda, false, true), // auction
        meta(mint, false, true), // mint
        meta(vault, false, true), // vault
        meta(sellerAta, false, true), // seller_token
        meta(TOKEN_PROGRAM_ID, false, false),
      ],
      data: Buffer.concat([disc('reclaim_expired'), u64le(id)]),
    });

  before(async () => {
    seller = Keypair.generate();
    b1 = Keypair.generate();
    b2 = Keypair.generate();
    b3 = Keypair.generate();

    const mintKp = Keypair.generate();
    mint = mintKp.publicKey;
    const rent = await getMinimumBalanceForRentExemptMint(conn);
    sigs.mintCreate = await send(
      [
        SystemProgram.createAccount({
          fromPubkey: deployer.publicKey,
          newAccountPubkey: mint,
          space: MINT_SIZE,
          lamports: rent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint, DECIMALS, deployer.publicKey, null, TOKEN_PROGRAM_ID),
      ],
      [deployer, mintKp],
    );

    sellerAta = getAssociatedTokenAddressSync(mint, seller.publicKey);
    b1Ata = getAssociatedTokenAddressSync(mint, b1.publicKey);
    b2Ata = getAssociatedTokenAddressSync(mint, b2.publicKey);
    b3Ata = getAssociatedTokenAddressSync(mint, b3.publicKey);

    sigs.atasCreate = await send(
      (
        [
          [sellerAta, seller.publicKey],
          [b1Ata, b1.publicKey],
          [b2Ata, b2.publicKey],
          [b3Ata, b3.publicKey],
        ] as [PublicKey, PublicKey][]
      ).map(([ata, owner]) =>
        createAssociatedTokenAccountInstruction(deployer.publicKey, ata, owner, mint),
      ),
      [deployer],
    );

    sigs.mintTo = await send(
      [b1Ata, b2Ata, b3Ata].map((ata) =>
        createMintToInstruction(mint, ata, deployer.publicKey, FUND),
      ),
      [deployer],
    );
  });

  it('auction 1: open -> outbid ladder with atomic refunds -> settle-on-buyout', async () => {
    const id = BigInt(Date.now());
    const pda = auctionPda(id);
    const vault = vaultOf(pda);
    const endsAt = BigInt(Math.floor(Date.now() / 1000) + 300); // buyout lets us settle now

    sigs.open1 = await send(
      [openIx(id, pda, vault, MIN_BID, RAKE_BPS, BUYOUT, deployer.publicKey, endsAt)],
      [deployer],
    );
    expect(await tokenBal(vault)).to.equal(0n);

    // bid 1 (no prior bidder)
    const b1Before = await tokenBal(b1Ata);
    sigs.bid1 = await send([bidIx(id, pda, vault, b1, b1Ata, BID1, null)], [deployer, b1]);
    expect(await tokenBal(vault)).to.equal(BID1);
    expect(await tokenBal(b1Ata)).to.equal(b1Before - BID1);
    let a = await fetchAuction(pda);
    expect(a.highBidder.toBase58()).to.equal(b1.publicKey.toBase58());
    expect(a.highBid).to.equal(BID1);

    // bid 2 -> ATOMIC: pull b2's 200, refund b1's exact 100, vault == 200
    const b2Before = await tokenBal(b2Ata);
    sigs.bid2 = await send([bidIx(id, pda, vault, b2, b2Ata, BID2, b1Ata)], [deployer, b2]);
    expect(await tokenBal(b1Ata)).to.equal(b1Before); // b1 made whole
    expect(await tokenBal(vault)).to.equal(BID2); // vault holds exactly the new bid
    expect(await tokenBal(b2Ata)).to.equal(b2Before - BID2);
    a = await fetchAuction(pda);
    expect(a.highBidder.toBase58()).to.equal(b2.publicKey.toBase58());
    expect(a.highBid).to.equal(BID2);

    // bid 3 (meets buyout) -> refund b2's exact 200, vault == 300
    const b3Before = await tokenBal(b3Ata);
    sigs.bid3 = await send([bidIx(id, pda, vault, b3, b3Ata, BID3, b2Ata)], [deployer, b3]);
    expect(await tokenBal(b2Ata)).to.equal(b2Before); // b2 made whole
    expect(await tokenBal(vault)).to.equal(BID3);
    expect(await tokenBal(b3Ata)).to.equal(b3Before - BID3);

    // settle (buyout met -> allowed immediately). Seller paid high_bid - rake, rake burned.
    const sellerBefore = await tokenBal(sellerAta);
    const supplyBefore = await supply();
    sigs.settle1 = await send([settleIx(id, pda, vault)], [deployer]);
    expect(await tokenBal(sellerAta)).to.equal(sellerBefore + EXPECT_PAYOUT); // 285 tokens
    expect(supplyBefore - (await supply())).to.equal(EXPECT_RAKE); // 15 tokens burned
    expect(await accountExists(vault)).to.equal(false); // vault closed
    a = await fetchAuction(pda);
    expect(a.status).to.equal(1); // Settled
  });

  it('auction 2: open -> one bid -> cancel refunds the bidder', async () => {
    const id = BigInt(Date.now()) + 1n;
    const pda = auctionPda(id);
    const vault = vaultOf(pda);
    const endsAt = BigInt(Math.floor(Date.now() / 1000) + 300);

    sigs.open2 = await send(
      [openIx(id, pda, vault, MIN_BID, RAKE_BPS, 0n, deployer.publicKey, endsAt)],
      [deployer],
    );

    const b1Before = await tokenBal(b1Ata);
    sigs.bidCancel = await send([bidIx(id, pda, vault, b1, b1Ata, BID1, null)], [deployer, b1]);
    expect(await tokenBal(b1Ata)).to.equal(b1Before - BID1);

    sigs.cancel2 = await send([cancelIx(id, pda, vault, b1Ata)], [deployer]);
    expect(await tokenBal(b1Ata)).to.equal(b1Before); // fully refunded
    expect(await accountExists(vault)).to.equal(false);
    expect((await fetchAuction(pda)).status).to.equal(2); // Cancelled
  });

  it('auction 3: reclaim_expired is rejected before the grace window (NotEnded)', async () => {
    const id = BigInt(Date.now()) + 2n;
    const pda = auctionPda(id);
    const vault = vaultOf(pda);
    const endsAt = BigInt(Math.floor(Date.now() / 1000) + 300);

    sigs.open3 = await send(
      [openIx(id, pda, vault, MIN_BID, RAKE_BPS, 0n, deployer.publicKey, endsAt)],
      [deployer],
    );
    const b1Before = await tokenBal(b1Ata);
    sigs.bidReclaim = await send([bidIx(id, pda, vault, b1, b1Ata, BID1, null)], [deployer, b1]);

    // The permissionless reclaim must reject before ends_at + grace. The full
    // reclaim happy path needs a >24h time advance unavailable on devnet; its
    // economics are identical to settle (proven by auction 1). Simulate so the
    // guard rejection does not consume a real (failed) tx.
    const guardTx = new Transaction().add(reclaimIx(id, pda, vault));
    guardTx.feePayer = deployer.publicKey;
    guardTx.recentBlockhash = (await conn.getLatestBlockhash('finalized')).blockhash;
    guardTx.sign(deployer);
    const sim = await conn.simulateTransaction(guardTx);
    expect(sim.value.err, 'reclaim before grace must error').to.not.equal(null);
    const logs = (sim.value.logs ?? []).join('\n');
    expect(logs).to.match(/NotEnded|6012/);

    // Clean up: settler cancels so b1 is made whole (no stranded devnet funds).
    sigs.cleanupCancel3 = await send([cancelIx(id, pda, vault, b1Ata)], [deployer]);
    expect(await tokenBal(b1Ata)).to.equal(b1Before);
  });

  after(() => {
    if (!RUN) return;
    const proof = {
      programId: PROGRAM_ID.toBase58(),
      cluster: 'devnet',
      mint: mint?.toBase58(),
      commitment: 'finalized',
      deploySignature: DEPLOY_SIG,
      signatures: sigs,
      explorer: Object.fromEntries(
        [['deploy', DEPLOY_SIG] as [string, string], ...Object.entries(sigs)].map(([k, v]) => [
          k,
          explorer(v),
        ]),
      ),
    };
    writeFileSync(SIGS_OUT, JSON.stringify(proof, null, 2));
    // eslint-disable-next-line no-console
    console.log('DEVNET_PROOF ' + JSON.stringify(proof, null, 2));
  });
});
