// Buy-and-burn keeper LIVE READ-PATH preflight (operator tool, networked machine).
//
// Validates that the EXACT external API shapes server/burn_keeper.ts
// buildProductionDeps() depends on actually work against the configured mainnet
// endpoints — WITHOUT any funds and WITHOUT the vault signing key — before a real
// deploy. It only READS: it quotes, builds (but never signs/sends) a swap tx,
// reads the $WOC mint decimals, derives the vault ATA, and (optionally) replays
// the $WOC-received parse against a real signature. Nothing here moves money or
// needs MARKETPLACE_BURN_VAULT_SECRET.
//
// Each step prints a clear "PASS"/"FAIL" line. Non-optional FAILs exit non-zero.
//
// Usage:
//   # Defaults: mainnet RPC, Jupiter v6, canonical USDC + $WOC mints, $1 quote.
//   # MARKETPLACE_BURN_VAULT (the PUBKEY only) is required for steps 2 + 4.
//   MARKETPLACE_BURN_VAULT=<vaultPubkey> node scripts/burn-keeper-preflight.mjs
//
//   # Custom endpoints / amount, and an optional real swap signature for step 5:
//   BURN_RPC_URL=https://my-rpc \
//   JUPITER_API=https://quote-api.jup.ag/v6 \
//   USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
//   WOC_MINT=3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth \
//   MARKETPLACE_BURN_VAULT=<vaultPubkey> \
//   node scripts/burn-keeper-preflight.mjs --amount=5000000 --sig=<swapSignature>
//
//   # argv overrides env: --vault=, --amount=, --sig=, --rpc=, --jupiter=,
//   #                     --usdc=, --woc=
//
// Deps: @solana/web3.js + node builtins only. global fetch. Node >= 18.

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

// --- argv parsing (--key=value), argv overrides env ----------------------
const argv = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) argv.set(m[1], m[2]);
}
const arg = (k) => argv.get(k);

// --- config (env + argv), mirroring burn_keeper.ts defaults exactly --------
const BURN_RPC_URL = (arg('rpc') ?? process.env.BURN_RPC_URL ?? process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com').trim();
const JUPITER_API = (arg('jupiter') ?? process.env.JUPITER_API ?? 'https://quote-api.jup.ag/v6').trim();
const USDC_MINT = (arg('usdc') ?? process.env.USDC_MINT ?? process.env.VITE_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').trim();
const WOC_MINT = (arg('woc') ?? process.env.WOC_MINT ?? process.env.VITE_WOC_MINT ?? '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth').trim();
const BURN_VAULT = (arg('vault') ?? process.env.MARKETPLACE_BURN_VAULT ?? '').trim();
const SWAP_SIG = (arg('sig') ?? '').trim();

// Default $1 of USDC (6 decimals) = 1_000_000 base units.
const QUOTE_AMOUNT = (() => {
  const v = arg('amount') ?? process.env.QUOTE_AMOUNT;
  if (v && /^[0-9]+$/.test(v) && BigInt(v) > 0n) return BigInt(v);
  return 1_000_000n;
})();

// The keeper's quote slippage cap default (DEFAULT_BURN_POLICY.maxSlippageBps).
// Only affects the quote's otherAmountThreshold; immaterial to a read-only check.
const SLIPPAGE_BPS = 100n;

// SPL programs (same constants burn_keeper.ts uses for ATA derivation).
const SPL_TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const FETCH_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 8_000;

// --- pass/fail tracking ----------------------------------------------------
let failures = 0;
function pass(step, detail) {
  console.log(`PASS  [${step}] ${detail}`);
}
function fail(step, detail) {
  failures++;
  console.log(`FAIL  [${step}] ${detail}`);
}
function info(line) {
  console.log(`      ${line}`);
}

// Raw JSON-RPC, mirroring server/solana_rpc.ts solanaRpc() exactly.
async function solanaRpc(method, params, timeoutMs = RPC_TIMEOUT_MS) {
  const res = await fetch(BURN_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error || data.result === undefined || data.result === null) return null;
  return data.result;
}

console.log('Burn-keeper LIVE read-path preflight (no funds, no signing key)');
console.log(`  BURN_RPC_URL : ${BURN_RPC_URL}`);
console.log(`  JUPITER_API  : ${JUPITER_API}`);
console.log(`  USDC_MINT    : ${USDC_MINT}`);
console.log(`  WOC_MINT     : ${WOC_MINT}`);
console.log(`  BURN_VAULT   : ${BURN_VAULT || '(unset — steps 2 + 4 will FAIL)'}`);
console.log(`  quote amount : ${QUOTE_AMOUNT.toString()} USDC base units`);
console.log('');

// Validate the vault pubkey up front (read-only); used by steps 2 + 4.
let vaultPubkey = null;
if (BURN_VAULT) {
  try {
    vaultPubkey = new PublicKey(BURN_VAULT);
  } catch {
    vaultPubkey = null;
  }
}

// --- Step 1: Jupiter /quote USDC -> $WOC -----------------------------------
// Mirrors exec.quote(): GET /quote?inputMint&outputMint&amount&slippageBps&swapMode=ExactIn,
// reads outAmount + routePlan. A missing route is a hard FAIL (keeper premise broken).
let quoteRaw = null;
{
  const step = '1 quote';
  const url = `${JUPITER_API}/quote?inputMint=${USDC_MINT}&outputMint=${WOC_MINT}&amount=${QUOTE_AMOUNT.toString()}&slippageBps=${SLIPPAGE_BPS.toString()}&swapMode=ExactIn`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      fail(step, `Jupiter /quote HTTP ${res.status} — ${url}`);
    } else {
      const data = await res.json();
      const out = data?.outAmount;
      const route = data?.routePlan;
      const outOk = typeof out === 'string' && BigInt(out) > 0n;
      const routeOk = Array.isArray(route) && route.length > 0;
      if (outOk && routeOk) {
        quoteRaw = data; // full quote object, handed to /swap unchanged (step 2)
        const outWoc = BigInt(out);
        // Implied price: how much USDC per 1 $WOC, in raw base-unit terms, plus a
        // human-readable USDC-per-WOC using fixed USDC(6) decimals (WOC decimals
        // come from step 3 — we keep this in base units to avoid guessing here).
        const usdcPerWocBaseUnits = Number(QUOTE_AMOUNT) / Number(outWoc);
        pass(step, `outAmount=${outWoc.toString()} $WOC base units, routePlan length=${route.length}`);
        info(`implied price: ${QUOTE_AMOUNT.toString()} USDC base units -> ${outWoc.toString()} $WOC base units (${usdcPerWocBaseUnits.toExponential(4)} USDC-bu per $WOC-bu)`);
      } else if (!routeOk) {
        fail(step, 'no route returned (empty/absent routePlan) — $WOC is NOT swappable on Jupiter; keeper premise is broken');
      } else {
        fail(step, `outAmount not a positive integer string (got ${JSON.stringify(out)})`);
      }
    }
  } catch (e) {
    fail(step, `request failed: ${e?.message ?? e}`);
  }
}

// --- Step 2: Jupiter /swap build (no sign, no send) ------------------------
// Mirrors exec.signSwap(): POST /swap with the FULL quote as quoteResponse +
// userPublicKey = vault (read-only) + wrapAndUnwrapSol:false + dynamicComputeUnitLimit:true.
// Reads swapTransaction (base64), deserializes with VersionedTransaction.deserialize.
{
  const step = '2 swap';
  if (!vaultPubkey) {
    fail(step, BURN_VAULT ? `MARKETPLACE_BURN_VAULT is not a valid pubkey: ${BURN_VAULT}` : 'MARKETPLACE_BURN_VAULT unset — cannot build a swap tx');
  } else if (!quoteRaw) {
    fail(step, 'skipped — step 1 produced no quote to build from');
  } else {
    try {
      const res = await fetch(`${JUPITER_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quoteRaw,
          userPublicKey: BURN_VAULT,
          wrapAndUnwrapSol: false,
          dynamicComputeUnitLimit: true,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        fail(step, `Jupiter /swap build failed (HTTP ${res.status})`);
      } else {
        const body = await res.json();
        const swapTransaction = body?.swapTransaction;
        if (typeof swapTransaction !== 'string' || swapTransaction.length === 0) {
          fail(step, 'response missing swapTransaction (expected non-empty base64 string)');
        } else {
          // Assert it is genuinely base64 (round-trips) before deserializing.
          const buf = Buffer.from(swapTransaction, 'base64');
          const base64Ok = buf.length > 0 && buf.toString('base64') === swapTransaction;
          if (!base64Ok) {
            fail(step, 'swapTransaction is not valid base64');
          } else {
            const tx = VersionedTransaction.deserialize(buf); // never signed, never sent
            const ixCount = tx.message.compiledInstructions.length;
            if (ixCount >= 1) {
              pass(step, `swapTransaction parsed (base64, ${buf.length} bytes); ${ixCount} instruction(s); NOT signed, NOT sent`);
            } else {
              fail(step, 'deserialized swap tx has 0 instructions');
            }
          }
        }
      }
    } catch (e) {
      fail(step, `request/deserialize failed: ${e?.message ?? e}`);
    }
  }
}

// --- Step 3: getTokenSupply(WOC_MINT) decimals -----------------------------
// Mirrors wocDecimals(): solanaRpc('getTokenSupply', [WOC_MINT]) -> value.decimals.
let wocDecimals = null;
{
  const step = '3 decimals';
  try {
    const res = await solanaRpc('getTokenSupply', [WOC_MINT]);
    const d = res?.value?.decimals;
    if (typeof d === 'number') {
      wocDecimals = d;
      pass(step, `getTokenSupply($WOC).value.decimals = ${d}`);
    } else {
      fail(step, `decimals not a number (getTokenSupply returned ${JSON.stringify(res)})`);
    }
  } catch (e) {
    fail(step, `request failed: ${e?.message ?? e}`);
  }
}

// --- Step 4: derive vault $WOC ATA -----------------------------------------
// Mirrors associatedTokenAccount(owner, mint): findProgramAddressSync(
//   [owner, TOKEN_PROGRAM, mint], ATA_PROGRAM)[0].
{
  const step = '4 ata';
  if (!vaultPubkey) {
    fail(step, BURN_VAULT ? `MARKETPLACE_BURN_VAULT is not a valid pubkey: ${BURN_VAULT}` : 'MARKETPLACE_BURN_VAULT unset — cannot derive ATA');
  } else {
    try {
      const mint = new PublicKey(WOC_MINT);
      const [ata] = PublicKey.findProgramAddressSync(
        [vaultPubkey.toBuffer(), SPL_TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
        SPL_ATA_PROGRAM,
      );
      pass(step, `vault $WOC ATA = ${ata.toBase58()}`);
      info('confirm this account exists / is rent-funded before the keeper burns');
    } catch (e) {
      fail(step, `derivation failed: ${e?.message ?? e}`);
    }
  }
}

// --- Step 5 (OPTIONAL): replay wocReceived parse against a real signature --
// Mirrors exec.wocReceived(): getTransaction jsonParsed finalized, then the
// (post - pre) $WOC delta for the vault OWNER — the exact measurement the keeper
// uses to decide how much to burn. Only runs if a --sig / SWAP_SIG is given.
if (SWAP_SIG) {
  const step = '5 wocReceived';
  if (!BURN_VAULT) {
    fail(step, 'a signature was given but MARKETPLACE_BURN_VAULT is unset — cannot measure the vault owner delta');
  } else {
    try {
      const tx = await solanaRpc('getTransaction', [
        SWAP_SIG,
        { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
      ]);
      if (!tx) {
        fail(step, `getTransaction returned null for ${SWAP_SIG} (unknown or not yet finalized)`);
      } else {
        // Inline the parseSplitPayment delta logic for WOC_MINT, owner = BURN_VAULT.
        const pre = new Map();
        const post = new Map();
        const accumulate = (into, rows) => {
          for (const row of rows ?? []) {
            if (row?.mint !== WOC_MINT) continue;
            if (typeof row?.owner !== 'string') continue;
            const amt = row?.uiTokenAmount?.amount;
            if (typeof amt !== 'string') continue;
            into.set(row.owner, (into.get(row.owner) ?? 0n) + BigInt(amt));
          }
        };
        accumulate(pre, tx.meta?.preTokenBalances);
        accumulate(post, tx.meta?.postTokenBalances);
        const delta = (post.get(BURN_VAULT) ?? 0n) - (pre.get(BURN_VAULT) ?? 0n);
        const wocReceived = delta > 0n ? delta : 0n;
        const txErr = tx.meta?.err;
        if (txErr != null) {
          fail(step, `tx ${SWAP_SIG} failed on-chain (meta.err=${JSON.stringify(txErr)}); wocReceived would be 0`);
        } else if (wocReceived > 0n) {
          const human = wocDecimals != null ? ` (~${(Number(wocReceived) / 10 ** wocDecimals).toString()} $WOC at ${wocDecimals} decimals)` : '';
          pass(step, `vault owner $WOC delta = ${wocReceived.toString()} base units${human}`);
        } else {
          fail(step, `vault owner $WOC delta is ${delta.toString()} (<= 0) — keeper would mark this batch "no $WOC received"`);
        }
      }
    } catch (e) {
      fail(step, `request/parse failed: ${e?.message ?? e}`);
    }
  }
} else {
  info('[5 wocReceived] skipped (optional) — pass --sig=<swapSignature> to replay the $WOC-received parse against a real tx');
}

console.log('');
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED — do NOT deploy until resolved.`);
  process.exit(1);
} else {
  console.log('RESULT: all non-optional checks PASSED.');
  process.exit(0);
}
