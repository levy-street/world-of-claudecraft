// Built-in TEST economy service for the CLAUDIUM surface.
//
// Upstream Claudium pricing/ownership lives in a separate economy-service repo
// this fork does not run, so without it the whole WOC store renders unavailable.
// WOC_TEST_ECONOMY=1 swaps server/claudium_proxy.ts's transport from the remote
// service to this module: same request/response shapes, test-only semantics.
//
// Test mode contract:
//   - Peg is fixed: 1 Claudium = $0.01 (USD_CENTS_PER_CLAUDIUM).
//   - The only live rail is 'sol' (usdc/woc answer rail_disabled). The SOL rail
//     builds a real legacy System transfer payer→WOC_TEST_TREASURY on the
//     cluster SOLANA_RPC_URL points at (devnet in our deployment), so players
//     pay a throwaway test address, never the upstream treasury.
//   - confirm() credits Claudium once an RPC signature reaches 'confirmed'.
//     It checks landing/finality only — it does not re-parse the transfer
//     instruction, which is fine for a test rail but would not be for real money.
//   - Balances, ownership, ledger and purchase state persist in the game
//     Postgres under woc_test_* tables (created lazily; the game DB is the only
//     store this fork has).

import { randomBytes } from 'node:crypto';
import { WEAPON_SKINS, type WeaponSkinRarity } from '../src/sim/content/weapon_skins';
import { pool } from './db';
import { isSolanaAddress } from './wallet_link';

const USD_CENTS_PER_CLAUDIUM = 1; // 1 Claudium = $0.01
const RARITY_COST_CLAUDIUM: Record<WeaponSkinRarity, number> = {
  uncommon: 250,
  rare: 750,
  epic: 2000,
  legendary: 5000,
};
const SKU_LADDER_USD = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100];
const QUOTE_TTL_MS = 90_000; // legacy-tx blockhash validity window
const RPC_TIMEOUT_MS = 8000;
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

function treasuryAddress(): string {
  return (process.env.WOC_TEST_TREASURY ?? '').trim();
}

function solUsdRate(): number {
  const raw = Number(process.env.WOC_TEST_SOL_USD ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 150;
}

/** The SOL/USD rate the test economy quotes packs at (shared by daily rewards). */
export function testSolUsdRate(): number {
  return solUsdRate();
}

/** Fixed test-only $WOC price so daily-rewards eligibility can compute usdValue. */
export const TEST_WOC_USD_PRICE = 0.01;

function rpcUrl(): string {
  return (process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com').trim();
}

// Public test-cluster RPCs rate-limit hard per IP (the packs modal polls balances
// every ~15s per player), so every RPC read goes through a small cache and the
// blockhash fetch retries before a quote is refused.
const BLOCKHASH_CACHE_TTL_MS = 45_000; // blockhashes stay valid ~60-90s
const SOL_BALANCE_CACHE_TTL_MS = 20_000;
const BLOCKHASH_RETRIES = 3;

let cachedBlockhash: { hash: string; at: number } | null = null;

async function latestBlockhash(): Promise<string> {
  if (cachedBlockhash && Date.now() - cachedBlockhash.at < BLOCKHASH_CACHE_TTL_MS) {
    return cachedBlockhash.hash;
  }
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= BLOCKHASH_RETRIES; attempt++) {
    try {
      const result = await rpc<{ value?: { blockhash?: string } }>('getLatestBlockhash', [
        { commitment: 'finalized' },
      ]);
      const hash = result?.value?.blockhash ?? '';
      if (hash !== '') {
        cachedBlockhash = { hash, at: Date.now() };
        return hash;
      }
      throw new Error('empty blockhash');
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('blockhash fetch failed');
}

const solBalanceCache = new Map<string, { lamports: string; at: number }>();

async function cachedSolBalance(owner: string): Promise<string> {
  const hit = solBalanceCache.get(owner);
  if (hit && Date.now() - hit.at < SOL_BALANCE_CACHE_TTL_MS) return hit.lamports;
  const result = await rpc<{ value?: number }>('getBalance', [owner, { commitment: 'confirmed' }]);
  const lamports = String(result?.value ?? 0);
  solBalanceCache.set(owner, { lamports, at: Date.now() });
  if (solBalanceCache.size > 512) {
    const oldest = solBalanceCache.keys().next().value;
    if (oldest !== undefined) solBalanceCache.delete(oldest);
  }
  return lamports;
}

/** Test mode is on only when explicitly requested AND a valid treasury address exists. */
export function testEconomyEnabled(): boolean {
  return (process.env.WOC_TEST_ECONOMY ?? '').trim() === '1' && isSolanaAddress(treasuryAddress());
}

// ── Solana wire helpers (no @solana/web3.js server dependency) ────────────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(text: string): Uint8Array | null {
  const map = new Map<string, number>();
  for (let i = 0; i < B58_ALPHABET.length; i++) map.set(B58_ALPHABET[i], i);
  let n = 0n;
  for (const ch of text) {
    const digit = map.get(ch);
    if (digit === undefined) return null;
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.unshift(0);
    if (bytes.length > 64) return null;
  }
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i];
  return out;
}

/** shortvec (compact-u16) encoding used by Solana message serialization. */
function compactU16(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    let b = n & 0x7f;
    n >>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
    if (n === 0) return out;
  }
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

function u64le(n: number): number[] {
  let v = BigInt(Math.round(n));
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return out;
}

interface LegacyTransferTxInput {
  payer: string;
  destination: string;
  lamports: number;
  blockhash: string;
  memo: string;
}

/**
 * Serialize a legacy (pre-versioned) Solana transaction paying `lamports` from
 * payer to destination, tagged with a memo. Account order fixes signer ordering:
 * [payer(writable, signer), destination(writable), system(readonly), memo(readonly)]
 * → header [numRequiredSignatures=1, numReadonlySigned=0, numReadonlyUnsigned=2].
 */
function buildLegacyTransferTxBase64(input: LegacyTransferTxInput): string | null {
  const payer = base58Decode(input.payer);
  const destination = base58Decode(input.destination);
  const system = base58Decode(SYSTEM_PROGRAM_ID);
  const memoProgram = base58Decode(MEMO_PROGRAM_ID);
  const blockhash = base58Decode(input.blockhash);
  if (
    !payer ||
    !destination ||
    !system ||
    !memoProgram ||
    !blockhash ||
    payer.length !== 32 ||
    destination.length !== 32 ||
    blockhash.length !== 32
  ) {
    return null;
  }
  const memoData = Array.from(new TextEncoder().encode(input.memo), (b) => b);
  const transferData = [...u32le(2), ...u64le(input.lamports)]; // System transfer ix
  const message: number[] = [
    1,
    0,
    2,
    ...compactU16(4),
    ...payer,
    ...destination,
    ...system,
    ...memoProgram,
    ...blockhash,
    ...compactU16(2),
    // memo ix: programIdIndex=3 (memo program), no accounts
    ...compactU16(3),
    ...compactU16(0),
    ...compactU16(memoData.length),
    ...memoData,
    // transfer ix: programIdIndex=2 (system), accounts [payer=0, destination=1]
    ...compactU16(2),
    ...compactU16(2),
    0,
    1,
    ...compactU16(transferData.length),
    ...transferData,
  ];
  const wire: number[] = [...compactU16(1), ...new Array<number>(64).fill(0), ...message];
  return Buffer.from(wire).toString('base64');
}

async function rawRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}`);
  const data = (await res.json()) as { result?: T; error?: { message?: string } };
  if (data.error) throw new Error(`${method}: ${data.error.message ?? 'rpc error'}`);
  return data.result as T;
}

let devnetVerification: Promise<void> | null = null;

/**
 * Fail closed if the TEST rail is pointed at anything other than Solana
 * Devnet. Checking the genesis hash works with the public endpoint and with
 * private Devnet RPC providers whose hostnames do not contain "devnet".
 */
export function verifyTestEconomyDevnet(): Promise<void> {
  if (devnetVerification) return devnetVerification;
  devnetVerification = rawRpc<string>('getGenesisHash', []).then((genesisHash) => {
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      throw new Error('test economy RPC is not Solana Devnet');
    }
  });
  devnetVerification = devnetVerification.catch((error) => {
    devnetVerification = null;
    throw error;
  });
  return devnetVerification;
}

export function resetTestEconomyRpcForTests(): void {
  devnetVerification = null;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  await verifyTestEconomyDevnet();
  return rawRpc<T>(method, params);
}

// ── Lazy schema ──────────────────────────────────────────────────────────────

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS woc_test_balance (
        account_id integer PRIMARY KEY,
        balance bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS woc_test_ledger (
        entry_id bigserial PRIMARY KEY,
        account_id integer NOT NULL,
        delta bigint NOT NULL,
        reason text NOT NULL,
        ref text NOT NULL,
        at_ms bigint NOT NULL
      );
      CREATE TABLE IF NOT EXISTS woc_test_owned (
        account_id integer NOT NULL,
        item_id text NOT NULL,
        PRIMARY KEY (account_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS woc_test_purchase (
        reference text PRIMARY KEY,
        account_id integer NOT NULL,
        rail text NOT NULL,
        sku text NOT NULL,
        claudium integer NOT NULL,
        amount_base text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        signature text,
        created_at timestamptz NOT NULL DEFAULT now(),
        credited_at timestamptz
      );
    `);
  })().catch((err) => {
    schemaReady = null; // retry on the next request after a transient failure
    throw err;
  });
  return schemaReady;
}

// ── Catalog ──────────────────────────────────────────────────────────────────

interface TestSku {
  sku: string;
  usd: number;
  claudium: number;
}

const SKU_LADDER: TestSku[] = SKU_LADDER_USD.map((usd) => ({
  sku: `test_usd_${usd}`,
  usd,
  claudium: usd * (100 / USD_CENTS_PER_CLAUDIUM),
}));

function findSku(sku: string): TestSku | null {
  return SKU_LADDER.find((s) => s.sku === sku) ?? null;
}

function usdToLamports(usd: number): number {
  return Math.max(5000, Math.ceil((usd / solUsdRate()) * 1_000_000_000));
}

function skinDisplayName(id: string): string {
  return id
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function balanceOf(accountId: number): Promise<number> {
  const { rows } = await pool.query<{ balance: string }>(
    'SELECT balance FROM woc_test_balance WHERE account_id = $1',
    [accountId],
  );
  return rows.length > 0 ? Number(rows[0].balance) : 0;
}

async function ownedItemIds(accountId: number): Promise<Set<string>> {
  const { rows } = await pool.query<{ item_id: string }>(
    'SELECT item_id FROM woc_test_owned WHERE account_id = $1',
    [accountId],
  );
  return new Set(rows.map((r) => r.item_id));
}

function parseAccountId(segment: string): number | null {
  const id = Number(segment);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// ── Request surface (mirrors the remote service paths the proxy calls) ───────

interface TestRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

export async function callTestEconomy(req: TestRequest): Promise<unknown> {
  if (!testEconomyEnabled()) return null;
  await ensureSchema();
  const path = req.path.replace(/^\//, '').split('?')[0];
  const query = new URLSearchParams(req.path.split('?')[1] ?? '');

  const balanceMatch = /^balance\/(\w+)$/.exec(path);
  if (req.method === 'GET' && balanceMatch) {
    const accountId = parseAccountId(balanceMatch[1]);
    if (!accountId) return { balance: 0 };
    return { balance: await balanceOf(accountId) };
  }

  const priceMatch = /^price\/(\w+)$/.exec(path);
  if (req.method === 'GET' && priceMatch) {
    return {
      rail: priceMatch[1],
      usdPerClaudium: USD_CENTS_PER_CLAUDIUM / 100,
      wocBaseUnitsPerClaudium: null,
    };
  }

  const nativePriceMatch = /^native\/price\/(\w+)$/.exec(path);
  if (req.method === 'GET' && nativePriceMatch) {
    const rail = nativePriceMatch[1];
    const sku = findSku(query.get('sku') ?? '');
    if (!sku) return { rail, claudium: null, amountBase: null, reason: 'unknown_sku' };
    if (rail !== 'sol') return { rail, claudium: null, amountBase: null, reason: 'rail_disabled' };
    return {
      rail,
      claudium: sku.claudium,
      amountBase: String(usdToLamports(sku.usd)),
      discountBps: null,
    };
  }

  const solBalanceMatch = /^native\/balance\/sol\/(\w+)$/.exec(path);
  if (req.method === 'GET' && solBalanceMatch) {
    const owner = decodeURIComponent(solBalanceMatch[1]);
    if (!isSolanaAddress(owner)) return { owner, lamports: null };
    try {
      return { owner, lamports: await cachedSolBalance(owner) };
    } catch {
      return { owner, lamports: null };
    }
  }

  const usdcBalanceMatch = /^native\/balance\/usdc\/(\w+)$/.exec(path);
  if (req.method === 'GET' && usdcBalanceMatch) {
    return { owner: decodeURIComponent(usdcBalanceMatch[1]), amountBase: null };
  }

  if (req.method === 'GET' && path === 'native/rails') {
    return { rails: { sol: true, usdc: false, woc: false } };
  }

  if (req.method === 'GET' && path === 'skus') {
    return SKU_LADDER.map((s) => ({ ...s, stripeConfigured: false }));
  }

  const storeMatch = /^store\/(\w+)$/.exec(path);
  if (req.method === 'GET' && storeMatch) {
    const accountId = parseAccountId(storeMatch[1]);
    if (!accountId) return [];
    const owned = await ownedItemIds(accountId);
    return Object.values(WEAPON_SKINS).map((skin) => ({
      itemId: skin.id,
      name: skinDisplayName(skin.id),
      kind: 'skin' as const,
      costClaudium: RARITY_COST_CLAUDIUM[skin.rarity],
      owned: owned.has(skin.id),
    }));
  }

  const historyMatch = /^history\/(\w+)$/.exec(path);
  if (req.method === 'GET' && historyMatch) {
    const accountId = parseAccountId(historyMatch[1]);
    if (!accountId) return [];
    const { rows } = await pool.query<{
      entry_id: string;
      delta: string;
      reason: string;
      ref: string;
      at_ms: string;
    }>(
      'SELECT entry_id, delta, reason, ref, at_ms FROM woc_test_ledger WHERE account_id = $1 ORDER BY entry_id DESC LIMIT 50',
      [accountId],
    );
    return rows.map((row) => ({
      entryId: row.entry_id,
      accountId,
      delta: Number(row.delta),
      reason: row.reason,
      ref: row.ref,
      atMs: Number(row.at_ms),
    }));
  }

  if (req.method === 'POST' && path === 'purchase') {
    // Stripe rail: no Stripe keys exist in a test deployment.
    return { reason: 'test_mode_stripe_disabled' };
  }

  if (req.method === 'POST' && path === 'native/quote') {
    return quoteNative(req.body);
  }

  if (req.method === 'POST' && path === 'native/confirm') {
    return confirmNative(req.body);
  }

  if (req.method === 'POST' && path === 'spend') {
    return spendClaudium(req.body);
  }

  return null;
}

interface QuoteBody {
  rail?: unknown;
  sku?: unknown;
  payer?: unknown;
  fulfillment?: { kind?: unknown; accountId?: unknown };
}

async function quoteNative(body: unknown): Promise<Record<string, unknown>> {
  const input = (body ?? {}) as QuoteBody;
  const rail = input.rail === 'sol' ? 'sol' : null;
  const sku = typeof input.sku === 'string' ? findSku(input.sku) : null;
  const payer = typeof input.payer === 'string' ? input.payer : '';
  const accountId = Number(input.fulfillment?.accountId);
  if (!rail || !sku || !isSolanaAddress(payer) || !Number.isSafeInteger(accountId)) {
    console.warn(
      `[claudium-test] quote refused (invalid_request): rail=${String(input.rail)} sku=${String(input.sku)} payer=${payer.slice(0, 8)}… account=${accountId}`,
    );
    return { reason: 'invalid_request' };
  }
  const lamports = usdToLamports(sku.usd);
  const reference = `tst_${randomBytes(12).toString('hex')}`;
  let blockhash = '';
  try {
    blockhash = await latestBlockhash();
  } catch (err) {
    console.warn(
      `[claudium-test] quote refused (rpc_unavailable): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { reason: 'rpc_unavailable' };
  }
  const transactionBase64 = buildLegacyTransferTxBase64({
    payer,
    destination: treasuryAddress(),
    lamports,
    blockhash,
    memo: reference,
  });
  if (!transactionBase64) return { reason: 'invalid_request' };
  await pool.query(
    `INSERT INTO woc_test_purchase (reference, account_id, rail, sku, claudium, amount_base)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [reference, accountId, rail, sku.sku, sku.claudium, String(lamports)],
  );
  return {
    reference,
    rail,
    claudium: sku.claudium,
    amountBase: String(lamports),
    destination: treasuryAddress(),
    mint: null,
    memo: reference,
    quoteExpiryMs: Date.now() + QUOTE_TTL_MS,
    transactionBase64,
    split: null,
  };
}

interface ConfirmBody {
  accountId?: unknown;
  reference?: unknown;
  signature?: unknown;
}

async function confirmNative(body: unknown): Promise<Record<string, unknown>> {
  const input = (body ?? {}) as ConfirmBody;
  const reference = typeof input.reference === 'string' ? input.reference : '';
  const signature = typeof input.signature === 'string' ? input.signature : '';
  const accountId = Number(input.accountId);
  if (reference === '' || signature === '' || !Number.isSafeInteger(accountId)) {
    return { settled: false, reason: 'invalid_request' };
  }
  const { rows } = await pool.query<{
    account_id: number;
    claudium: number;
    status: string;
  }>('SELECT account_id, claudium, status FROM woc_test_purchase WHERE reference = $1', [
    reference,
  ]);
  const purchase = rows[0];
  if (!purchase || purchase.account_id !== accountId) {
    return { settled: false, reason: 'not_found' };
  }
  if (purchase.status === 'settled') {
    return { settled: true, fulfillment: { balance: await balanceOf(accountId) } };
  }

  let confirmationStatus = '';
  try {
    const statuses = await rpc<{
      value?: Array<{ confirmationStatus?: string } | null>;
    }>('getSignatureStatuses', [[signature], { searchTransactionHistory: false }]);
    const status = statuses?.value?.[0];
    if (!status) return { settled: false, reason: 'not_found_onchain' };
    if (status.confirmationStatus !== 'confirmed' && status.confirmationStatus !== 'finalized') {
      return { settled: false, reason: 'not_finalized' };
    }
    confirmationStatus = status.confirmationStatus;
  } catch {
    return { settled: false, reason: 'cannot_verify' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const credited = await client.query(
      `UPDATE woc_test_purchase
         SET status = 'settled', signature = $2, credited_at = now()
       WHERE reference = $1 AND status = 'pending'
       RETURNING reference`,
      [reference, signature],
    );
    if (credited.rowCount === 0) {
      await client.query('ROLLBACK');
      return { settled: true, fulfillment: { balance: await balanceOf(accountId) } };
    }
    await client.query(
      `INSERT INTO woc_test_balance (account_id, balance)
       VALUES ($1, $2)
       ON CONFLICT (account_id)
       DO UPDATE SET balance = woc_test_balance.balance + $2, updated_at = now()`,
      [accountId, purchase.claudium],
    );
    await client.query(
      `INSERT INTO woc_test_ledger (account_id, delta, reason, ref, at_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [accountId, purchase.claudium, 'purchase', reference, Date.now()],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(
    `[claudium-test] purchase ${reference} settled (${confirmationStatus}) for account ${accountId}: +${purchase.claudium}`,
  );
  return { settled: true, fulfillment: { balance: await balanceOf(accountId) } };
}

interface SpendBody {
  accountId?: unknown;
  itemId?: unknown;
  kind?: unknown;
  expectedCostClaudium?: unknown;
  idempotencyKey?: unknown;
}

async function spendClaudium(body: unknown): Promise<Record<string, unknown>> {
  const input = (body ?? {}) as SpendBody;
  const accountId = Number(input.accountId);
  const itemId = typeof input.itemId === 'string' ? input.itemId : '';
  const expectedCost = Number(input.expectedCostClaudium);
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : '';
  const skin = itemId !== '' ? WEAPON_SKINS[itemId] : undefined;
  if (
    !Number.isSafeInteger(accountId) ||
    !skin ||
    input.kind !== 'skin' ||
    !Number.isSafeInteger(expectedCost) ||
    idempotencyKey === ''
  ) {
    return { granted: false, balance: null, costClaudium: null, reason: 'invalid_request' };
  }
  const cost = RARITY_COST_CLAUDIUM[skin.rarity];
  if (expectedCost !== cost) {
    return { granted: false, balance: null, costClaudium: cost, reason: 'price_changed' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const alreadyOwned = await client.query(
      'SELECT 1 FROM woc_test_owned WHERE account_id = $1 AND item_id = $2',
      [accountId, itemId],
    );
    if ((alreadyOwned.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return {
        granted: false,
        balance: await balanceOf(accountId),
        costClaudium: cost,
        reason: 'already_granted',
      };
    }
    const debited = await client.query<{ balance: string }>(
      `UPDATE woc_test_balance
         SET balance = balance - $2, updated_at = now()
       WHERE account_id = $1 AND balance >= $2
       RETURNING balance`,
      [accountId, cost],
    );
    if (debited.rowCount === 0) {
      await client.query('ROLLBACK');
      return {
        granted: false,
        balance: await balanceOf(accountId),
        costClaudium: cost,
        reason: 'insufficient_balance',
      };
    }
    await client.query(
      'INSERT INTO woc_test_owned (account_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [accountId, itemId],
    );
    await client.query(
      `INSERT INTO woc_test_ledger (account_id, delta, reason, ref, at_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [accountId, -cost, 'spend', idempotencyKey, Date.now()],
    );
    await client.query('COMMIT');
    return {
      granted: true,
      balance: Number(debited.rows[0].balance),
      costClaudium: cost,
      reason: null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
