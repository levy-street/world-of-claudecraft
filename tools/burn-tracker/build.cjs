'use strict';
/* Build the WOC burn tracker:
 *   1. Fetch the live $WOC/USD price (Pyth if a feed id is configured, else
 *      Jupiter - the game's chain) and stamp PRICE_SNAPSHOT.
 *   2. Fetch the mint's current supply (getTokenSupply) and scan its
 *      transaction history for burn instructions, stamping CHAIN_SNAPSHOT.
 *      Scan budget: BUILD_SCAN_TX txs (default 120), env-overridable.
 *   3. Inject burn_model.cjs verbatim into page-template.html at the marker.
 * Fail-closed: price or supply fetch failure fails the build unless
 * ALLOW_STALE_PRICE=1 / ALLOW_STALE_CHAIN=1; a partial burn scan only warns
 * (the headline total never depends on the feed). */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const MODEL_PATH = path.join(dir, 'burn_model.cjs');
const MARKER = '/* __MODEL__ - replaced by build.js with the exact contents of burn_model.cjs */';
const PRICE_RE = /\/\*__PRICE_SNAPSHOT_START__\*\/[\s\S]*?\/\*__PRICE_SNAPSHOT_END__\*\//;
const CHAIN_RE = /\/\*__CHAIN_SNAPSHOT_START__\*\/[\s\S]*?\/\*__CHAIN_SNAPSHOT_END__\*\//;

const RPC_URL = process.env.BUILD_RPC_URL || null; // optional private RPC for the build scan
const SCAN_TX_BUDGET = Number(process.env.BUILD_SCAN_TX || 120);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rpc(M, method, params, attempt) {
  const url = RPC_URL || M.CHAIN_SOURCE.rpcUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20000)
  });
  if (res.status === 429 && (attempt || 0) < 4) {
    const wait = 1500 * ((attempt || 0) + 1);
    await sleep(wait);
    return rpc(M, method, params, (attempt || 0) + 1);
  }
  if (!res.ok) throw new Error(method + ' HTTP ' + res.status);
  return res.json();
}

async function fetchLivePrice(M) {
  const src = M.PRICE_SOURCE;
  if (src.pythFeedId) {
    try {
      const url = src.hermesUrl.replace(/\/$/, '') + '/v2/updates/price/latest?ids[]=' + encodeURIComponent(src.pythFeedId);
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const p = M.parsePythV2(await res.json());
        if (p && Date.now() - p.publishMs <= src.maxAgeMs) {
          return { usdPerWoc: p.usdPerWoc, source: 'pyth', fetchedAtMs: Date.now() };
        }
      }
      console.warn('build: pyth failed/stale, falling through to jupiter');
    } catch (e) {
      console.warn('build: pyth error (' + e.message + '), falling through to jupiter');
    }
  }
  const res = await fetch(src.jupiterUrl + src.mint, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('jupiter price HTTP ' + res.status);
  const p = M.parseJupiterV3(await res.json(), src.mint);
  if (!p) throw new Error('jupiter price payload unparseable');
  return { usdPerWoc: p.usdPerWoc, source: 'jupiter', fetchedAtMs: Date.now() };
}

async function scanChain(M) {
  const supplyBody = await rpc(M, 'getTokenSupply', [M.CHAIN_SOURCE.mint]);
  const supply = M.parseTokenSupply(supplyBody);
  if (!supply) throw new Error('unparseable getTokenSupply response');
  console.log('current supply:', supply.uiAmount, '=> burned:',
    (M.CHAIN_SOURCE.initialSupply - supply.uiAmount).toFixed(6), 'WOC');

  let burns = [];
  let scanned = 0;
  let cursor = '';
  let oldestMs = 0;
  try {
    while (scanned < SCAN_TX_BUDGET) {
      const opts = { limit: M.CHAIN_SOURCE.sigPageLimit };
      if (cursor) opts.before = cursor;
      const sigsBody = await rpc(M, 'getSignaturesForAddress', [M.CHAIN_SOURCE.mint, opts]);
      const sigs = M.parseSignatures(sigsBody);
      if (!sigs || !sigs.length) break;
      cursor = sigs[sigs.length - 1].signature;
      oldestMs = sigs[sigs.length - 1].blockTimeMs || oldestMs;
      const ok = sigs.filter(s => !s.failed).slice(0, SCAN_TX_BUDGET - scanned);
      for (const s of ok) {
        try {
          const txBody = await rpc(M, 'getTransaction',
            [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
          const found = M.parseBurnsFromTx(txBody, M.CHAIN_SOURCE.mint, M.CHAIN_SOURCE.decimals);
          if (found.length) {
            burns = M.mergeBurns(burns, found);
            console.log('  burn found:', found.map(b => b.amount + ' WOC @ ' + b.sig.slice(0, 12)).join(', '));
          }
        } catch (e) {
          console.warn('  tx hydrate failed (' + s.signature.slice(0, 12) + '…): ' + e.message);
        }
        scanned++;
        await sleep(220);
      }
      if (sigs.length < M.CHAIN_SOURCE.sigPageLimit) break; // history exhausted
    }
  } catch (e) {
    console.warn('build: burn scan stopped early (' + e.message + ') - shipping partial feed');
  }
  console.log('scanned', scanned, 'txs; burns found:', burns.length);
  return {
    currentSupply: supply.uiAmount,
    burns,
    scannedSigs: scanned,
    oldestScannedMs: oldestMs,
    cursor,
    fetchedAtMs: Date.now()
  };
}

function stamp(modelSrc, re, name, obj) {
  const block = '/*__' + name + '_START__*/ ' + JSON.stringify(obj) + ' /*__' + name + '_END__*/';
  if (!re.test(modelSrc)) throw new Error(name + ' markers missing in burn_model.js');
  return modelSrc.replace(re, () => block);
}

(async () => {
  const M = require(MODEL_PATH);
  let modelSrc = fs.readFileSync(MODEL_PATH, 'utf8');

  // 1. price snapshot
  try {
    const live = await fetchLivePrice(M);
    modelSrc = stamp(modelSrc, PRICE_RE, 'PRICE_SNAPSHOT', live);
    console.log('price snapshot:', live.usdPerWoc, 'USD/WOC via', live.source);
  } catch (e) {
    if (process.env.ALLOW_STALE_PRICE === '1') {
      console.warn('build: price fetch FAILED (' + e.message + '); shipping previous snapshot');
    } else {
      console.error('build FAILED: cannot fetch live price (' + e.message + '). ALLOW_STALE_PRICE=1 to override.');
      process.exit(1);
    }
  }

  // 2. chain snapshot
  try {
    const chain = await scanChain(M);
    modelSrc = stamp(modelSrc, CHAIN_RE, 'CHAIN_SNAPSHOT', chain);
  } catch (e) {
    if (process.env.ALLOW_STALE_CHAIN === '1') {
      console.warn('build: chain fetch FAILED (' + e.message + '); shipping previous snapshot');
    } else {
      console.error('build FAILED: cannot fetch chain state (' + e.message + '). ALLOW_STALE_CHAIN=1 to override.');
      process.exit(1);
    }
  }

  fs.writeFileSync(MODEL_PATH, modelSrc);

  // final parse check on the stamped model
  delete require.cache[require.resolve(MODEL_PATH)];
  const M2 = require(MODEL_PATH);
  if (!(M2.PRICE_SNAPSHOT.usdPerWoc > 0)) {
    console.error('build FAILED: snapshot price not positive after stamp');
    process.exit(1);
  }

  // 3. inject into the template
  const template = fs.readFileSync(path.join(dir, 'page-template.html'), 'utf8');
  if (!template.includes(MARKER)) {
    console.error('build FAILED: model marker not found in template');
    process.exit(1);
  }
  // NB: replacer must be a function - a replacement STRING would interpret
  // `$'` / `$&` sequences inside the model source as replace() patterns.
  const out = template.replace(MARKER, () =>
    '/* __MODEL_START__ (generated from burn_model.js - do not edit here) */\n'
    + modelSrc + '\n/* __MODEL_END__ */');

  const outPath = path.join(dir, '..', '..', 'burn.html');
  fs.writeFileSync(outPath, out);
  console.log('built', outPath, out.length, 'bytes');
})();
