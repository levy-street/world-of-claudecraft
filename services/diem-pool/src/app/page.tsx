'use client';

import { useCallback, useEffect, useState } from 'react';

// Provider dashboard: connect a Solana wallet (Phantom-style provider),
// attach API keys from supported vendors, watch usage/rewards, revoke anytime.

const VENDORS = [
  { id: 'venice', label: 'Venice (staked DIEM)', capacityLabel: 'Staked DIEM (capacity = $1 × DIEM per day)' },
  { id: 'openai', label: 'OpenAI', capacityLabel: 'Daily donation budget (USD you allow the game to spend)' },
  { id: 'anthropic', label: 'Anthropic', capacityLabel: 'Daily donation budget (USD you allow the game to spend)' },
  { id: 'kimi', label: 'Kimi (Moonshot)', capacityLabel: 'Daily donation budget (USD you allow the game to spend)' },
] as const;
type VendorId = (typeof VENDORS)[number]['id'];

interface PhantomProvider {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display: 'utf8'): Promise<{ signature: Uint8Array }>;
}

interface KeyStats {
  id: string;
  vendor: VendorId;
  displayName: string;
  status: string;
  keyLast4: string | null;
  dailyCapacityUsd: number;
  trustTier: string;
  consecutiveHealthyDays: number;
  todayConsumedUsd: number;
  lifetimeConsumedUsd: number;
  claudiumVested: number;
  claudiumPending: number;
}

interface WalletStats {
  keys: KeyStats[];
  totals: { lifetimeConsumedUsd: number; claudiumVested: number; claudiumPending: number };
}

function phantom(): PhantomProvider | null {
  const w = window as unknown as { solana?: PhantomProvider & { isPhantom?: boolean } };
  return w.solana ?? null;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function signWithNonce(
  wallet: string,
  purpose: 'register' | 'revoke',
  vendor?: VendorId,
): Promise<{ nonce: string; signedMessage: string }> {
  const res = await fetch('/api/providers/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: wallet, purpose, vendor }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? 'nonce request failed');
  const { nonce, message } = await res.json();
  const ph = phantom();
  if (!ph) throw new Error('no Solana wallet found');
  const { signature } = await ph.signMessage(new TextEncoder().encode(message), 'utf8');
  return { nonce, signedMessage: toBase64(signature) };
}

export default function ProviderDashboard() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [stats, setStats] = useState<WalletStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [vendor, setVendor] = useState<VendorId>('venice');
  const [displayName, setDisplayName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [capacity, setCapacity] = useState('10');

  const refresh = useCallback(async (w: string) => {
    const res = await fetch(`/api/providers/by-wallet/${w}`);
    if (res.status === 404) {
      setStats({ keys: [], totals: { lifetimeConsumedUsd: 0, claudiumVested: 0, claudiumPending: 0 } });
      return;
    }
    if (res.ok) setStats(await res.json());
  }, []);

  useEffect(() => {
    if (wallet) void refresh(wallet);
  }, [wallet, refresh]);

  async function connect() {
    setMsg(null);
    const ph = phantom();
    if (!ph) {
      setMsg({ kind: 'error', text: 'No Solana wallet extension found (e.g. Phantom).' });
      return;
    }
    const { publicKey } = await ph.connect();
    setWallet(publicKey.toString());
  }

  // Vendors this wallet can still register (no ACTIVE/DEGRADED key yet).
  const openVendors = VENDORS.filter(
    (v) => !stats?.keys.some((k) => k.vendor === v.id && (k.status === 'ACTIVE' || k.status === 'DEGRADED')),
  );
  const selectedVendor = VENDORS.find((v) => v.id === vendor) ?? VENDORS[0];

  useEffect(() => {
    // Keep the picker on a vendor that is actually still open for this wallet.
    if (openVendors.length > 0 && !openVendors.some((v) => v.id === vendor)) {
      setVendor(openVendors[0].id);
    }
  }, [stats, vendor, openVendors]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    setBusy(true);
    setMsg(null);
    try {
      const { nonce, signedMessage } = await signWithNonce(wallet, 'register', vendor);
      const capacityField =
        vendor === 'venice'
          ? { declaredDiem: Number(capacity) }
          : { dailyBudgetUsd: Number(capacity) };
      const res = await fetch('/api/providers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          signedMessage,
          nonce,
          vendor,
          veniceApiKey: apiKey,
          displayName,
          ...capacityField,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'registration failed');
      setApiKey('');
      setMsg({ kind: 'ok', text: `Registered — ${vendor} key …${body.keyLast4} is in the pool.` });
      await refresh(wallet);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'registration failed' });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: KeyStats) {
    if (!wallet) return;
    if (!confirm(`Revoke your ${key.vendor} key? It is wiped immediately, routing stops, and any unvested rewards are voided.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const { nonce, signedMessage } = await signWithNonce(wallet, 'revoke');
      const res = await fetch(`/api/providers/${key.id}/key`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedMessage, nonce }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'revocation failed');
      setMsg({ kind: 'ok', text: `${key.vendor} key revoked and wiped.` });
      await refresh(wallet);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'revocation failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Delegate your AI compute</h1>
      <p className="muted">
        Stake DIEM on Venice — or bring your own OpenAI, Anthropic, or Kimi key — and the game
        routes NPC dialogue, quests and dungeon-master inference through your capacity. You earn
        Claudium for compute actually served. Non-custodial: keys are encrypted, revocable
        anytime, and never shown again. New bring-your-own keys ramp up over their first weeks
        and rewards vest after a short window.
      </p>

      {msg && <p className={msg.kind}>{msg.text}</p>}

      {!wallet ? (
        <div className="panel">
          <button onClick={() => void connect()}>Connect wallet</button>
        </div>
      ) : (
        <p className="muted">
          Connected: <code>{wallet}</code>
        </p>
      )}

      {wallet && stats && stats.keys.length > 0 && (
        <div className="panel">
          <h2>Wallet totals</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="num">${stats.totals.lifetimeConsumedUsd.toFixed(2)}</div>
              <div className="cap">lifetime compute served</div>
            </div>
            <div className="stat">
              <div className="num">{stats.totals.claudiumVested.toLocaleString()}</div>
              <div className="cap">Claudium earned</div>
            </div>
            <div className="stat">
              <div className="num">{stats.totals.claudiumPending.toLocaleString()}</div>
              <div className="cap">Claudium pending vest</div>
            </div>
          </div>
        </div>
      )}

      {wallet &&
        stats?.keys.map((key) => (
          <div className="panel" key={key.id}>
            <h2>
              {key.vendor}: {key.displayName} —{' '}
              <span className={`status-${key.status}`}>{key.status}</span>
              {key.keyLast4 && <span className="muted"> (key …{key.keyLast4})</span>}
            </h2>
            <div className="stat-grid">
              <div className="stat">
                <div className="num">${key.todayConsumedUsd.toFixed(4)}</div>
                <div className="cap">consumed today (of ${key.dailyCapacityUsd.toFixed(2)} cap)</div>
              </div>
              <div className="stat">
                <div className="num">${key.lifetimeConsumedUsd.toFixed(2)}</div>
                <div className="cap">lifetime served</div>
              </div>
              <div className="stat">
                <div className="num">
                  {key.claudiumVested.toLocaleString()}
                  {key.claudiumPending > 0 && (
                    <span className="muted"> (+{key.claudiumPending.toLocaleString()} pending)</span>
                  )}
                </div>
                <div className="cap">Claudium</div>
              </div>
              <div className="stat">
                <div className="num">
                  {key.consecutiveHealthyDays}d <span className="muted">{key.trustTier}</span>
                </div>
                <div className="cap">health streak / trust tier</div>
              </div>
            </div>
            {key.status !== 'REVOKED' && (
              <p>
                <button className="danger" disabled={busy} onClick={() => void revoke(key)}>
                  Revoke {key.vendor} key
                </button>
              </p>
            )}
          </div>
        ))}

      {wallet && stats && openVendors.length > 0 && (
        <form className="panel" onSubmit={(e) => void register(e)}>
          <h2>Attach an API key</h2>
          <label>
            Vendor
            <select value={vendor} onChange={(e) => setVendor(e.target.value as VendorId)}>
              {openVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              minLength={3}
              maxLength={32}
              required
            />
          </label>
          <label>
            API key (validated with a ~1-token call, stored encrypted, shown only as last 4 chars)
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          </label>
          <label>
            {selectedVendor.capacityLabel}
            <input
              type="number"
              min={vendor === 'venice' ? 1 : 0.01}
              step={vendor === 'venice' ? 1 : 0.01}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Validating key…' : 'Sign & register'}
          </button>
        </form>
      )}
    </>
  );
}
