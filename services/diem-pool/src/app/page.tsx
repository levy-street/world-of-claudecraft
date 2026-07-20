'use client';

import { useCallback, useEffect, useState } from 'react';

// Provider dashboard: connect a Solana wallet (Phantom-style provider),
// register a scoped Venice key, watch usage/rewards, revoke anytime.

interface PhantomProvider {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display: 'utf8'): Promise<{ signature: Uint8Array }>;
}

interface ProviderStats {
  id: string;
  displayName: string;
  status: string;
  keyLast4: string | null;
  dailyCapacityUsd: number;
  todayConsumedUsd: number;
  lifetimeConsumedUsd: number;
  lifetimeRequests: number;
  claudiumEarned: number;
  consecutiveHealthyDays: number;
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
): Promise<{ nonce: string; signedMessage: string }> {
  const res = await fetch('/api/providers/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: wallet, purpose }),
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
  const [stats, setStats] = useState<ProviderStats | null>(null);
  const [notRegistered, setNotRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [veniceApiKey, setVeniceApiKey] = useState('');
  const [declaredDiem, setDeclaredDiem] = useState('10');

  const refresh = useCallback(async (w: string) => {
    const res = await fetch(`/api/providers/by-wallet/${w}`);
    if (res.status === 404) {
      setStats(null);
      setNotRegistered(true);
      return;
    }
    if (res.ok) {
      setStats(await res.json());
      setNotRegistered(false);
    }
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

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) return;
    setBusy(true);
    setMsg(null);
    try {
      const { nonce, signedMessage } = await signWithNonce(wallet, 'register');
      const res = await fetch('/api/providers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          signedMessage,
          nonce,
          veniceApiKey,
          displayName,
          declaredDiem: Number(declaredDiem),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'registration failed');
      setVeniceApiKey('');
      setMsg({ kind: 'ok', text: `Registered — key …${body.keyLast4} is in the pool.` });
      await refresh(wallet);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'registration failed' });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!wallet || !stats) return;
    if (!confirm('Revoke your key? It is wiped immediately and routing stops.')) return;
    setBusy(true);
    setMsg(null);
    try {
      const { nonce, signedMessage } = await signWithNonce(wallet, 'revoke');
      const res = await fetch(`/api/providers/${stats.id}/key`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedMessage, nonce }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'revocation failed');
      setMsg({ kind: 'ok', text: 'Key revoked and wiped.' });
      await refresh(wallet);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'revocation failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Delegate your DIEM compute</h1>
      <p className="muted">
        Stake DIEM on Venice → register a scoped API key here → the game routes NPC dialogue,
        quests and dungeon-master inference through your daily credit → you earn Claudium every
        night. Non-custodial: your tokens never move.
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

      {wallet && stats && (
        <div className="panel">
          <h2>
            {stats.displayName} — <span className={`status-${stats.status}`}>{stats.status}</span>
            {stats.keyLast4 && <span className="muted"> (key …{stats.keyLast4})</span>}
          </h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="num">${stats.todayConsumedUsd.toFixed(4)}</div>
              <div className="cap">consumed today (of ${stats.dailyCapacityUsd.toFixed(2)} cap)</div>
            </div>
            <div className="stat">
              <div className="num">${stats.lifetimeConsumedUsd.toFixed(2)}</div>
              <div className="cap">lifetime compute served</div>
            </div>
            <div className="stat">
              <div className="num">{stats.claudiumEarned.toLocaleString()}</div>
              <div className="cap">Claudium earned</div>
            </div>
            <div className="stat">
              <div className="num">{stats.consecutiveHealthyDays}d</div>
              <div className="cap">health streak (1.25× at 30d)</div>
            </div>
          </div>
          {stats.status !== 'REVOKED' && (
            <p>
              <button className="danger" disabled={busy} onClick={() => void revoke()}>
                Revoke key
              </button>
            </p>
          )}
        </div>
      )}

      {wallet && (notRegistered || stats?.status === 'REVOKED' || stats?.status === 'INVALID') && (
        <form className="panel" onSubmit={(e) => void register(e)}>
          <h2>Register a Venice API key</h2>
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
            Venice API key (scoped; validated with a ~1-token call, stored encrypted, shown only as
            last 4 chars)
            <input
              type="password"
              value={veniceApiKey}
              onChange={(e) => setVeniceApiKey(e.target.value)}
              required
            />
          </label>
          <label>
            Staked DIEM (your daily capacity = $1 × DIEM)
            <input
              type="number"
              min={1}
              value={declaredDiem}
              onChange={(e) => setDeclaredDiem(e.target.value)}
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
