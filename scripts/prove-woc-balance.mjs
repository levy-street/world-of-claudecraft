// Proves the server's real fetchWocBalance() reads a non-zero $WOC balance from
// a real on-chain holder on MAINNET. Finds the mint's largest token account,
// resolves its owner, then calls the EXACT fetchWocBalance the portal uses
// (default mint + RPC). Retries through the public RPC's rate limiting.
const MINT = '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';
const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const j = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
    if (j.error?.code === 429) { await sleep(2500); continue; }
    return j;
  }
  throw new Error(`${method}: rate-limited after ${tries} tries`);
}

const largest = await rpc('getTokenLargestAccounts', [MINT]);
const top = largest.result?.value?.[0];
if (!top) { console.error('no holders:', JSON.stringify(largest).slice(0, 200)); process.exit(2); }
const info = await rpc('getAccountInfo', [top.address, { encoding: 'jsonParsed' }]);
const owner = info.result.value.data.parsed.info.owner;
console.log(`largest holder: owner=${owner} token-acct=${top.address} ui=${top.uiAmount}`);

await sleep(1500);
const { fetchWocBalance } = await import('../server/devs.ts');
const bal = await fetchWocBalance(owner);
console.log(`fetchWocBalance(owner) -> ${bal.uiAmount} $WOC (mint ${bal.mint}, decimals ${bal.decimals})`);
const pass = bal.uiAmount > 0 && Math.abs(bal.uiAmount - top.uiAmount) < Math.max(1, top.uiAmount * 0.0001);
console.log(pass ? 'PASS ✓ — fetchWocBalance read the real on-chain balance via the {mint} filter' : 'FAIL ✗ (got ' + bal.uiAmount + ', largest acct held ' + top.uiAmount + ')');
process.exit(pass ? 0 : 1);
