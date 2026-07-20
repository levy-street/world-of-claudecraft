'use client';

import { useCallback, useState } from 'react';

// Admin console: pool overview, pricing editor, kill switch. Gated by
// ADMIN_TOKEN — the token is held in component state only and sent as
// `x-admin-token` on every call; the server does the actual gating.

interface AdminProvider {
  id: string;
  wallet: string;
  displayName: string;
  status: string;
  keyLast4: string | null;
  dailyCapacityUsd: number;
  todayConsumedUsd: number;
  consecutiveHealthyDays: number;
  consecutiveFailures: number;
  suspicionScore: number;
  flagged: boolean;
}

interface Overview {
  routingPaused: boolean;
  lastSettledDate: string | null;
  todayPoolSpendUsd: number;
  todayHouseSpendUsd: number;
  statusCounts: Record<string, number>;
  providers: AdminProvider[];
}

interface PricingRow {
  model: string;
  inputUsdPerMTokens: number;
  outputUsdPerMTokens: number;
  active: boolean;
}

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pricing, setPricing] = useState<PricingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<PricingRow>({
    model: '',
    inputUsdPerMTokens: 0,
    outputUsdPerMTokens: 0,
    active: true,
  });

  const load = useCallback(async () => {
    setError(null);
    const headers = { 'x-admin-token': token };
    const [ovRes, prRes] = await Promise.all([
      fetch('/api/admin/overview', { headers }),
      fetch('/api/admin/pricing', { headers }),
    ]);
    if (!ovRes.ok) {
      setError(ovRes.status === 401 ? 'bad admin token' : `overview failed (${ovRes.status})`);
      setOverview(null);
      return;
    }
    setOverview(await ovRes.json());
    if (prRes.ok) setPricing((await prRes.json()).pricing);
  }, [token]);

  async function toggleKillSwitch() {
    if (!overview) return;
    await fetch('/api/admin/killswitch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ paused: !overview.routingPaused }),
    });
    await load();
  }

  async function savePricing(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/admin/pricing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify(edit),
    });
    await load();
  }

  return (
    <>
      <h1>Pool Admin</h1>
      <div className="panel">
        <label>
          Admin token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <button onClick={() => void load()}>Load</button>
        {error && <p className="error">{error}</p>}
      </div>

      {overview && (
        <>
          <div className="panel">
            <h2>
              Routing:{' '}
              {overview.routingPaused ? (
                <span className="error">PAUSED</span>
              ) : (
                <span className="ok">live</span>
              )}
            </h2>
            <div className="stat-grid">
              <div className="stat">
                <div className="num">${overview.todayPoolSpendUsd.toFixed(4)}</div>
                <div className="cap">pool spend today</div>
              </div>
              <div className="stat">
                <div className="num">${overview.todayHouseSpendUsd.toFixed(4)}</div>
                <div className="cap">house-key spend today</div>
              </div>
              <div className="stat">
                <div className="num">
                  {Object.entries(overview.statusCounts)
                    .map(([s, n]) => `${n} ${s}`)
                    .join(' · ') || '0 providers'}
                </div>
                <div className="cap">provider statuses</div>
              </div>
              <div className="stat">
                <div className="num">{overview.lastSettledDate?.slice(0, 10) ?? 'never'}</div>
                <div className="cap">last settled day</div>
              </div>
            </div>
            <p>
              <button className={overview.routingPaused ? '' : 'danger'} onClick={() => void toggleKillSwitch()}>
                {overview.routingPaused ? 'Resume routing' : 'KILL SWITCH — pause all routing'}
              </button>
            </p>
          </div>

          <div className="panel">
            <h2>Providers</h2>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Key</th>
                  <th>Today / Cap</th>
                  <th>Streak</th>
                  <th>Fails</th>
                  <th>Suspicion</th>
                </tr>
              </thead>
              <tbody>
                {overview.providers.map((p) => (
                  <tr key={p.id}>
                    <td title={p.wallet}>{p.displayName}</td>
                    <td className={`status-${p.status}`}>{p.status}</td>
                    <td>{p.keyLast4 ? `…${p.keyLast4}` : '—'}</td>
                    <td>
                      ${p.todayConsumedUsd.toFixed(3)} / ${p.dailyCapacityUsd.toFixed(0)}
                    </td>
                    <td>{p.consecutiveHealthyDays}d</td>
                    <td>{p.consecutiveFailures}</td>
                    <td className={p.flagged ? 'error' : ''}>
                      {p.suspicionScore.toFixed(2)}
                      {p.flagged ? ' ⚠' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h2>Model pricing (USD per 1M tokens)</h2>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {pricing.map((r) => (
                  <tr key={r.model}>
                    <td>{r.model}</td>
                    <td>${r.inputUsdPerMTokens}</td>
                    <td>${r.outputUsdPerMTokens}</td>
                    <td>{r.active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form onSubmit={(e) => void savePricing(e)}>
              <h2>Add / update model</h2>
              <label>
                Model id
                <input
                  value={edit.model}
                  onChange={(e) => setEdit({ ...edit, model: e.target.value })}
                  required
                />
              </label>
              <label>
                Input $/1M tokens
                <input
                  type="number"
                  step="0.000001"
                  min={0}
                  value={edit.inputUsdPerMTokens}
                  onChange={(e) => setEdit({ ...edit, inputUsdPerMTokens: Number(e.target.value) })}
                />
              </label>
              <label>
                Output $/1M tokens
                <input
                  type="number"
                  step="0.000001"
                  min={0}
                  value={edit.outputUsdPerMTokens}
                  onChange={(e) => setEdit({ ...edit, outputUsdPerMTokens: Number(e.target.value) })}
                />
              </label>
              <button type="submit">Save pricing</button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
