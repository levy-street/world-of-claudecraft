// End-to-end check for the non-custodial wallet-link feature against a REAL
// running server + Postgres (no mocks). This is the live counterpart to the
// CI unit tests in tests/wallet_server.test.ts (which mock pg).
//
// Usage:
//   npm run db:up          # Postgres on :5433
//   npm run server         # game server on :8787 (reads .env / DATABASE_URL)
//   node scripts/wallet_e2e.mjs            # against http://127.0.0.1:8787
//   WOC_E2E_BASE=https://realm.example node scripts/wallet_e2e.mjs
//
// A throwaway ed25519 keypair stands in for a Solana wallet (signMessage is
// exactly ed25519 over the UTF-8 message bytes). Exits non-zero on any failure.
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';

const BASE = process.env.WOC_E2E_BASE ?? 'http://127.0.0.1:8787';
const checks = [];
const check = (name, cond) => { checks.push({ name, ok: !!cond }); console.log(`${cond ? '✅' : '❌'} ${name}`); };

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const register = async (u) => (await api('/api/register', { method: 'POST', body: { username: u, password: 'test1234' } })).data.token;
function newWallet() {
  const priv = ed25519.utils.randomPrivateKey();
  return { priv, address: bs58.encode(ed25519.getPublicKey(priv)) };
}
async function link(token, wallet, { tamper = false } = {}) {
  const ch = await api('/api/wallet/link/challenge', { method: 'POST', token, body: { address: wallet.address } });
  const msg = tamper ? ch.data.message + ' tampered' : ch.data.message;
  const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(msg), wallet.priv));
  return api('/api/wallet/link', { method: 'POST', token, body: { address: wallet.address, signature, nonce: ch.data.nonce } });
}

const stamp = Date.now();
const tokenA = await register('e2eA' + stamp);
const tokenB = await register('e2eB' + stamp);
const wallet = newWallet();

check('unauthenticated GET /api/wallet -> 401', (await api('/api/wallet')).status === 401);
check('no wallet linked initially', (await api('/api/wallet', { token: tokenA })).data.wallet === null);

const linked = await link(tokenA, wallet);
check('valid sign-to-link -> 200 + linked', linked.status === 200 && linked.data.linked === true);
check('GET reflects the linked wallet', (await api('/api/wallet', { token: tokenA })).data.wallet?.pubkey === wallet.address);

// replay: the same challenge nonce was consumed, so re-submitting must fail
const ch = await api('/api/wallet/link/challenge', { method: 'POST', token: tokenA, body: { address: wallet.address } });
const sig = bs58.encode(ed25519.sign(new TextEncoder().encode(ch.data.message), wallet.priv));
await api('/api/wallet/link', { method: 'POST', token: tokenA, body: { address: wallet.address, signature: sig, nonce: ch.data.nonce } });
const replay = await api('/api/wallet/link', { method: 'POST', token: tokenA, body: { address: wallet.address, signature: sig, nonce: ch.data.nonce } });
check('challenge replay -> 400', replay.status === 400);

check('forged signature -> 401', (await link(tokenA, wallet, { tamper: true })).status === 401);
check('linking the same wallet to another account -> 409', (await link(tokenB, wallet)).status === 409);
check('unlink -> 200', (await api('/api/wallet/link', { method: 'DELETE', token: tokenA })).status === 200);
check('wallet is null after unlink', (await api('/api/wallet', { token: tokenA })).data.wallet === null);
check('freed wallet can now link to the other account', (await link(tokenB, wallet)).status === 200);

const passed = checks.filter((c) => c.ok).length;
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed !== checks.length) process.exit(1);
console.log('✅ wallet-link e2e passed against', BASE);
