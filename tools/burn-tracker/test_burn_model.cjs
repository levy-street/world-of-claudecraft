'use strict';
/* Real-execution test suite for the WOC burn-tracker model. Zero dependencies,
 * no mocks of the code under test: it requires the exact burn_model.js that
 * build.js embeds into the page. Parser fixtures use REAL captured response
 * shapes from mainnet RPC / Jupiter; two LIVE tests hit the real endpoints. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, 'burn_model.cjs'));

let passed = 0;
const failures = [];
const tests = [];
function test(name, fn) { tests.push({ name, fn }); } // sync and async
function close(actual, expected, name, eps) {
  const e = eps == null ? 1e-9 : eps;
  assert.ok(Math.abs(actual - expected) <= e * Math.max(1, Math.abs(expected)),
    (name || 'value') + ': expected ' + expected + ', got ' + actual);
}

const MINT = M.CHAIN_SOURCE.mint;

/* ---------------- price parsers (ports of the service's oracle) ---------------- */
test('parsePythV2 matches the service math on a Hermes-shaped payload', () => {
  const body = { parsed: [{ price: { price: '17499', expo: -8, publish_time: 1782950400 } }] };
  const p = M.parsePythV2(body);
  close(p.usdPerWoc, 17499e-8, 'price * 10^expo');
  assert.strictEqual(p.publishMs, 1782950400000);
  assert.strictEqual(M.parsePythV2({}), null);
  assert.strictEqual(M.parsePythV2({ parsed: [] }), null);
  assert.strictEqual(M.parsePythV2({ parsed: [{ price: { price: '-5', expo: -8, publish_time: 1 } }] }), null, 'non-positive fails closed');
  assert.strictEqual(M.parsePythV2({ parsed: [{ price: { price: 'x', expo: -8, publish_time: 1 } }] }), null);
});

test('parseJupiterV3 parses the real captured payload shape, fail-closed otherwise', () => {
  // shape captured live from lite-api.jup.ag on 2026-07-19
  const body = {};
  body[MINT] = { createdAt: '2026-06-12T08:29:19Z', liquidity: 21032.54, usdPrice: 0.00017499572561668891, blockId: 433891851, decimals: 6, priceChange24h: -34.65 };
  const p = M.parseJupiterV3(body, MINT);
  close(p.usdPerWoc, 0.00017499572561668891, 'usdPrice');
  assert.strictEqual(p.publishMs, null);
  assert.strictEqual(M.parseJupiterV3({}, MINT), null, 'missing mint');
  assert.strictEqual(M.parseJupiterV3({ [MINT]: { usdPrice: 0 } }, MINT), null, 'zero price fails closed');
  assert.strictEqual(M.parseJupiterV3(null, MINT), null);
});

/* ---------------- chain parsers ---------------- */
test('parseTokenSupply parses the real captured mainnet shape', () => {
  // captured live from api.mainnet-beta.solana.com on 2026-07-19
  const body = { jsonrpc: '2.0', result: { context: { apiVersion: '4.1.0', slot: 433893013 },
    value: { amount: '999557928221353', decimals: 6, uiAmount: 999557928.221353, uiAmountString: '999557928.221353' } }, id: 1 };
  const s = M.parseTokenSupply(body);
  close(s.uiAmount, 999557928.221353, 'uiAmount');
  assert.strictEqual(s.decimals, 6);
  assert.strictEqual(M.parseTokenSupply({}), null);
  assert.strictEqual(M.parseTokenSupply({ result: { value: { uiAmount: 0 } } }), null, 'zero supply fails closed');
  assert.strictEqual(M.parseTokenSupply(null), null);
});

test('parseSignatures keeps blockTime, marks failed txs', () => {
  // shape captured live on 2026-07-19 (memo/err fields as returned)
  const body = { result: [
    { blockTime: 1784462593, confirmationStatus: 'finalized', err: null, memo: null, signature: 'SIG_A', slot: 433891851 },
    { blockTime: 1784462130, err: { InstructionError: [2, { Custom: 6004 }] }, memo: null, signature: 'SIG_B', slot: 433890746 },
    { blockTime: null, err: null, signature: 'SIG_C', slot: 1 }
  ] };
  const sigs = M.parseSignatures(body);
  assert.strictEqual(sigs.length, 3);
  assert.strictEqual(sigs[0].signature, 'SIG_A');
  assert.strictEqual(sigs[0].blockTimeMs, 1784462593000);
  assert.strictEqual(sigs[0].failed, false);
  assert.strictEqual(sigs[1].failed, true, 'errored tx marked failed');
  assert.strictEqual(sigs[2].blockTimeMs, 0, 'null blockTime tolerated');
  assert.strictEqual(M.parseSignatures({}), null);
});

test('parseBurnsFromTx finds burn + burnChecked of OUR mint only, top-level and inner', () => {
  const tx = { result: {
    blockTime: 1784462593,
    meta: { err: null, innerInstructions: [{ index: 3, instructions: [
      { program: 'spl-token', parsed: { type: 'burnChecked', info: { mint: MINT, authority: 'AuthInner11111111111111111111111111111111111', tokenAmount: { uiAmount: 1234.5, decimals: 6 } } } },
      { program: 'spl-token', parsed: { type: 'burn', info: { mint: 'OtherMint1111111111111111111111111111111111', amount: '999000000', authority: 'X' } } }
    ] }] },
    transaction: { signatures: ['SIG_BURN'], message: { instructions: [
      { program: 'spl-token', parsed: { type: 'burn', info: { mint: MINT, amount: '250000000000', authority: 'AuthTop111111111111111111111111111111111111' } } },
      { program: 'spl-token', parsed: { type: 'transfer', info: { mint: MINT, amount: '5' } } }
    ] } }
  } };
  const burns = M.parseBurnsFromTx(tx, MINT, 6);
  assert.strictEqual(burns.length, 2, 'two burns of our mint');
  close(burns[0].amount, 250000, 'base units / 10^6');
  assert.strictEqual(burns[0].authority, 'AuthTop111111111111111111111111111111111111');
  close(burns[1].amount, 1234.5, 'burnChecked uiAmount');
  assert.strictEqual(burns[0].sig, 'SIG_BURN');
  assert.strictEqual(burns[0].ms, 1784462593000);
  // failed tx burns nothing
  const failed = JSON.parse(JSON.stringify(tx));
  failed.result.meta.err = { InstructionError: [0, 'Custom'] };
  assert.strictEqual(M.parseBurnsFromTx(failed, MINT, 6).length, 0, 'failed tx excluded');
  assert.strictEqual(M.parseBurnsFromTx({}, MINT, 6).length, 0);
  assert.strictEqual(M.parseBurnsFromTx(null, MINT, 6).length, 0);
});

test('mergeBurns dedupes by sig+amount and sorts newest first', () => {
  const a = [{ sig: 'S1', ms: 100, amount: 10, authority: 'A' }];
  const b = [
    { sig: 'S1', ms: 100, amount: 10, authority: 'A' },   // dupe
    { sig: 'S1', ms: 100, amount: 20, authority: 'A' },   // same tx, second burn instr
    { sig: 'S2', ms: 300, amount: 5, authority: 'B' }
  ];
  const merged = M.mergeBurns(a, b);
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0].sig, 'S2', 'newest first');
});

test('windowStats computes rolling day/week/month windows', () => {
  const now = 1784462593000;
  const H = 3600000, D = 86400000;
  const burns = [
    { sig: 'a', ms: now - 2 * H, amount: 100 },
    { sig: 'b', ms: now - 20 * H, amount: 50 },
    { sig: 'c', ms: now - 3 * D, amount: 1000 },
    { sig: 'd', ms: now - 20 * D, amount: 10000 },
    { sig: 'e', ms: now - 40 * D, amount: 100000 }
  ];
  const s = M.windowStats(burns, now);
  close(s.day.woc, 150, 'day sum'); assert.strictEqual(s.day.txs, 2);
  close(s.week.woc, 1150, 'week sum'); assert.strictEqual(s.week.txs, 3);
  close(s.month.woc, 11150, 'month sum'); assert.strictEqual(s.month.txs, 4);
  assert.strictEqual(s.latestMs, now - 2 * H);
});

/* ---------------- config override ---------------- */
test('parseRpcOverride accepts only https URLs', () => {
  assert.strictEqual(M.parseRpcOverride('', '#p.rpc=https://rpc.helius.xyz/?api-key=x').rpcUrl, 'https://rpc.helius.xyz/?api-key=x');
  assert.strictEqual(M.parseRpcOverride('?p.rpc=https://api.mainnet-beta.solana.com', '').rpcUrl, 'https://api.mainnet-beta.solana.com');
  const bad = M.parseRpcOverride('?p.rpc=http://evil.example', '');
  assert.strictEqual(bad.rpcUrl, null);
  assert.strictEqual(bad.warnings.length, 1, 'http rejected with warning');
  assert.strictEqual(M.parseRpcOverride('?p.rpc=javascript:alert(1)', '').rpcUrl, null);
  assert.strictEqual(M.parseRpcOverride('', '').rpcUrl, null);
});

/* ---------------- snapshots (stamped by build) ---------------- */
test('price snapshot is a real stamped market price', () => {
  const s = M.PRICE_SNAPSHOT;
  assert.ok(s.usdPerWoc > 0 && isFinite(s.usdPerWoc), 'positive price');
  assert.ok(['jupiter', 'pyth'].includes(s.source), 'source is a real oracle');
  assert.ok(s.fetchedAtMs > 1750000000000, 'stamped with a real fetch time');
});

test('chain snapshot holds a real supply below the 1B initial mint', () => {
  const c = M.CHAIN_SNAPSHOT;
  assert.ok(c.currentSupply > 0 && c.currentSupply <= M.CHAIN_SOURCE.initialSupply, 'supply in range');
  assert.ok(M.CHAIN_SOURCE.initialSupply - c.currentSupply > 0, 'burns have happened on-chain');
  assert.ok(Array.isArray(c.burns), 'burns array');
  c.burns.forEach(b => {
    assert.ok(b.amount > 0 && typeof b.sig === 'string' && b.sig.length > 20, 'well-formed burn row');
  });
  assert.ok(c.fetchedAtMs > 1750000000000, 'stamped');
});

/* ---------------- provenance ---------------- */
test('every mechanic declares kind and source', () => {
  assert.ok(M.MECHANICS.length >= 10);
  M.MECHANICS.forEach(m => {
    assert.ok(['code', 'assumption'].includes(m.kind), m.label + ' kind');
    assert.ok(typeof m.source === 'string' && m.source.length > 5, m.label + ' source');
    assert.ok(typeof m.rate === 'string' && m.rate.length > 3, m.label + ' rate');
  });
});

/* ---------------- formatters ---------------- */
test('formatters behave at magnitude boundaries', () => {
  assert.strictEqual(M.fmt.n(0), '0');
  assert.strictEqual(M.fmt.n(1234), '1.2K');
  assert.strictEqual(M.fmt.n(12500000), '12.5M');
  assert.strictEqual(M.fmt.n(1e9), '1B');
  assert.strictEqual(M.fmt.n(NaN), '-');
  assert.strictEqual(M.fmt.full(1234567.4), '1,234,567');
  assert.strictEqual(M.fmt.full2(442071.778647), '442,071.78');
  assert.strictEqual(M.fmt.pct(0.0442), '0.044%');
  assert.strictEqual(M.fmt.price(0.00017499572561668891), '$0.000175');
  assert.strictEqual(M.fmt.price(1.5), '$1.50');
  assert.strictEqual(M.fmt.price(0), '-');
  assert.strictEqual(M.fmt.ago(15000), '15s');
  assert.strictEqual(M.fmt.ago(3540000), '59m');
  assert.strictEqual(M.fmt.ago(90000000), '1d');
  assert.strictEqual(M.fmt.shortAddr('3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'), '3WjL…cRth');
});

/* ---------------- build parity + self-containment ---------------- */
test('built HTML embeds burn_model.js byte-for-byte', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'burn.html'), 'utf8');
  const model = fs.readFileSync(path.join(__dirname, 'burn_model.cjs'), 'utf8');
  const start = html.indexOf('/* __MODEL_START__');
  const end = html.indexOf('/* __MODEL_END__ */');
  assert.ok(start !== -1 && end !== -1, 'markers present in built HTML');
  const embedded = html.slice(html.indexOf('\n', start) + 1, end);
  assert.strictEqual(embedded.trim(), model.trim(), 'embedded model matches source');
  assert.ok(!html.includes('__MODEL__ - replaced'), 'template marker replaced');
});

test('built HTML loads no external resources (links/fetches are runtime-optional)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'burn.html'), 'utf8');
  // static resource loads would break under the artifact CSP - none allowed
  const external = html.match(/(src|href)\s*=\s*["']https?:\/\//gi);
  assert.strictEqual(external, null, 'no external src/href attributes in static HTML');
  assert.ok(!/@import|url\(\s*["']?https?:/i.test(html), 'no external CSS/font URLs');
});

/* ---------------- LIVE endpoints (real network, same calls the page makes) ---------------- */
test('LIVE: Jupiter price endpoint returns a parseable positive price', async () => {
  const src = M.PRICE_SOURCE;
  const res = await fetch(src.jupiterUrl + src.mint, { signal: AbortSignal.timeout(10000) });
  assert.ok(res.ok, 'HTTP ' + res.status);
  const p = M.parseJupiterV3(await res.json(), src.mint);
  assert.ok(p && p.usdPerWoc > 0, 'live price parses positive');
  console.log('      live $WOC/USD via jupiter: ' + p.usdPerWoc);
});

test('LIVE: getTokenSupply returns a parseable supply at or below 1B', async () => {
  const res = await fetch(M.CHAIN_SOURCE.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [MINT] }),
    signal: AbortSignal.timeout(15000)
  });
  assert.ok(res.ok, 'HTTP ' + res.status);
  const s = M.parseTokenSupply(await res.json());
  assert.ok(s && s.uiAmount > 0 && s.uiAmount <= M.CHAIN_SOURCE.initialSupply, 'live supply in range');
  console.log('      live supply: ' + s.uiAmount + ' (burned ' + (M.CHAIN_SOURCE.initialSupply - s.uiAmount).toFixed(6) + ')');
});

/* ---------------- performance ---------------- */
test('parseBurnsFromTx + windowStats stay fast at scale', () => {
  const tx = { result: { blockTime: 1784462593, meta: { err: null, innerInstructions: [] },
    transaction: { signatures: ['S'], message: { instructions: [
      { parsed: { type: 'burn', info: { mint: MINT, amount: '1000000', authority: 'A' } } }
    ] } } } };
  const burns = [];
  for (let i = 0; i < 5000; i++) burns.push({ sig: 'S' + i, ms: 1784462593000 - i * 60000, amount: 1 });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) M.parseBurnsFromTx(tx, MINT, 6);
  for (let i = 0; i < 200; i++) M.windowStats(burns, 1784462593000);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('      2,000 tx parses + 200 window scans over 5,000 burns: ' + ms.toFixed(1) + 'ms');
  assert.ok(ms < 2000, 'perf budget');
});

/* ---------------- runner + summary ---------------- */
(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ok  ' + t.name); }
    catch (e) { failures.push(t.name); console.error('FAIL  ' + t.name + '\n      ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed'
    + (failures.length ? ': ' + failures.join(', ') : ''));
  process.exit(failures.length ? 1 : 0);
})();
