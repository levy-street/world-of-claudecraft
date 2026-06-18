import { useCallback, useEffect, useState } from 'react';
import './styles.css';
import {
  getProfile,
  getLeaderboard,
  startGithubLink,
  verifyGithubLink,
  unlinkGithub,
  linkWallet,
  claimRewards,
  isContribution,
  isWocBalance,
  type DevsApiConfig,
  type DevsProfile,
  type LeaderboardRow,
} from './api';

export interface DevsPortalProps {
  config: DevsApiConfig;
}

function Header() {
  return (
    <header className="devs-head">
      <div className="devs-eyebrow">World of ClaudeCraft</div>
      <h1>Devs Portal</h1>
      <p className="devs-sub">
        Your GitHub contributions to World of ClaudeCraft forge your hero — merged PRs, reviews, and
        commits become contribution XP and <strong>$WOC</strong>. Link your GitHub and wallet to track it.
      </p>
    </header>
  );
}

function GithubLinkForm({ config, onLinked, initialUsername = '' }: { config: DevsApiConfig; onLinked: () => void; initialUsername?: string }) {
  const [value, setValue] = useState(initialUsername);
  const [code, setCode] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await startGithubLink(config, value.trim());
      setCode(r.code);
      setUsername(r.githubUsername);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      await verifyGithubLink(config);
      onLinked();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (code) {
    return (
      <div>
        <h3>Verify GitHub ownership</h3>
        <p className="devs-note">
          Add this one-time code to your <a className="devs-linked" style={{ display: 'inline' }} href={`https://github.com/${username}`} target="_blank" rel="noopener noreferrer">@{username}</a> GitHub bio
          (Settings → Profile → Bio), then verify. You can remove it afterward.
        </p>
        <div className="devs-field">
          <input className="devs-input" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
          <button className="devs-btn ghost" onClick={() => void navigator.clipboard?.writeText(code)}>Copy</button>
          <button className="devs-btn" onClick={() => void verify()} disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        </div>
        <button className="devs-btn ghost" style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }} onClick={() => { setCode(null); setErr(null); }}>Use a different username</button>
        {err && <div className="devs-error">{err}</div>}
      </div>
    );
  }

  return (
    <div>
      <h3>Link your GitHub</h3>
      <p className="devs-note">Connect your GitHub account to count your contributions to the repo. We’ll verify you own it.</p>
      <div className="devs-field">
        <input
          className="devs-input"
          placeholder="github-username"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void start()}
          disabled={busy}
        />
        <button className="devs-btn" onClick={() => void start()} disabled={busy || !value.trim()}>
          {busy ? 'Starting…' : 'Get code'}
        </button>
      </div>
      {err && <div className="devs-error">{err}</div>}
    </div>
  );
}

function ContributionBlock({ profile }: { profile: DevsProfile }) {
  const c = profile.contribution;
  if (c && 'error' in c) {
    return <div className="devs-error">Couldn’t load contributions right now — try again shortly.</div>;
  }
  if (!isContribution(c)) return null;
  const pct = Math.round(c.progressToNext * 100);
  return (
    <div>
      <h3>Contributions to {profile.repo}</h3>
      <div className="devs-statrow">
        <div className="devs-stat"><span className="v">{c.prsMerged}</span><span className="k">PRs merged</span></div>
        <div className="devs-stat"><span className="v">{c.prReviews}</span><span className="k">Reviews</span></div>
        <div className="devs-stat"><span className="v">{c.commits}</span><span className="k">Commits</span></div>
        <div className="devs-stat"><span className="v">{c.issuesOpened}</span><span className="k">Issues</span></div>
        <div className="devs-stat"><span className="v">{c.points.toLocaleString()}</span><span className="k">Contribution pts</span></div>
      </div>
      <div className="devs-levelbar">
        <div className="meta">
          <span>Contributor Level {c.level}</span>
          <span>{c.points.toLocaleString()} / {c.nextLevelPoints.toLocaleString()} pts</span>
        </div>
        <div className="devs-track"><div className="devs-fill" style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}

function ProfileCard({ profile, config, onReload }: { profile: DevsProfile; config: DevsApiConfig; onReload: () => void }) {
  return (
    <section className="devs-card">
      <h2>Your Hero</h2>
      {profile.character ? (
        <div className="devs-charline">
          <span className="devs-charname">{profile.character.name}</span>
          <span className="devs-chartag">
            Level {profile.character.level} {cap(profile.character.class)} · {profile.character.lifetimeXp.toLocaleString()} lifetime XP
          </span>
        </div>
      ) : (
        <p className="devs-note">No character yet — create one in-game on the Play tab, and your contributions will power it up.</p>
      )}

      <div style={{ marginTop: 16 }}>
        {profile.githubUsername && profile.githubVerified ? (
          <>
            <div className="devs-linked">
              <span>Linked ✓</span>
              <a href={`https://github.com/${profile.githubUsername}`} target="_blank" rel="noopener noreferrer">@{profile.githubUsername}</a>
              <button className="devs-btn ghost" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }} onClick={() => void unlinkGithub(config).then(onReload)}>Unlink</button>
            </div>
            <div style={{ marginTop: 12 }}><ContributionBlock profile={profile} /></div>
          </>
        ) : (
          <GithubLinkForm config={config} onLinked={onReload} initialUsername={profile.githubUsername ?? ''} />
        )}
      </div>
    </section>
  );
}

function WalletCard({ profile, config, onReload }: { profile: DevsProfile; config: DevsApiConfig; onReload: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const claim = async () => {
    setClaimBusy(true);
    setClaimMsg(null);
    try {
      const r = await claimRewards(config);
      setClaimMsg(r.ok ? `Claimed ${r.amountUi.toLocaleString()} $WOC` : 'Nothing to claim yet');
      onReload();
    } catch (e) {
      setClaimMsg((e as Error).message);
    } finally {
      setClaimBusy(false);
    }
  };
  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await linkWallet(config, value.trim());
      onReload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="devs-card">
      <h2>$WOC Wallet</h2>
      {profile.solanaAddress ? (
        <>
          {isWocBalance(profile.woc) ? (
            <div className="devs-woc"><span className="amt">{profile.woc.uiAmount.toLocaleString()}</span><span className="sym">$WOC</span></div>
          ) : (
            <div className="devs-note">Balance unavailable right now.</div>
          )}
          <div className="devs-linked" style={{ marginTop: 8 }}>
            <a href={`https://solscan.io/account/${profile.solanaAddress}`} target="_blank" rel="noopener noreferrer">{short(profile.solanaAddress)}</a>
            <button className="devs-btn ghost" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }} onClick={() => void linkWallet(config, '').then(onReload)}>Unlink</button>
          </div>
          {profile.rewards.enabled ? (
            <div style={{ marginTop: 16, borderTop: '1px solid rgba(245,197,66,0.18)', paddingTop: 14 }}>
              <h3>Claimable rewards</h3>
              <div className="devs-woc"><span className="amt">{profile.rewards.claimableUi.toLocaleString()}</span><span className="sym">$WOC</span></div>
              <div className="devs-field" style={{ marginTop: 10 }}>
                <button className="devs-btn" onClick={() => void claim()} disabled={claimBusy || profile.rewards.claimableUi <= 0}>
                  {claimBusy ? 'Claiming…' : 'Claim $WOC'}
                </button>
              </div>
              {claimMsg && <div className="devs-note" style={{ marginTop: 6 }}>{claimMsg}</div>}
            </div>
          ) : (
            <p className="devs-note" style={{ marginTop: 12 }}>You’ve earned {profile.rewards.claimableUi.toLocaleString()} $WOC in contribution rewards — claims open once the treasury is live.</p>
          )}
        </>
      ) : (
        <>
          <h3>Link your Solana wallet</h3>
          <p className="devs-note">Add your Solana address to see your $WOC balance.</p>
          <div className="devs-field">
            <input className="devs-input" placeholder="Solana address" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} disabled={busy} />
            <button className="devs-btn" onClick={() => void submit()} disabled={busy || !value.trim()}>{busy ? 'Linking…' : 'Link Wallet'}</button>
          </div>
          {err && <div className="devs-error">{err}</div>}
        </>
      )}
    </section>
  );
}

function LeaderboardCard({ rows, you }: { rows: LeaderboardRow[]; you: string | null }) {
  return (
    <section className="devs-card">
      <h2>Top Contributors</h2>
      {rows.length === 0 ? (
        <p className="devs-note">No ranked contributors yet — link your GitHub to claim the first spot.</p>
      ) : (
        <table className="devs-lb">
          <thead><tr><th className="rank">#</th><th>Contributor</th><th>Lv</th><th className="pts">Points</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.githubUsername} className={you && r.githubUsername.toLowerCase() === you.toLowerCase() ? 'you' : ''}>
                <td className="rank">{i + 1}</td>
                <td><a className="devs-linked" style={{ display: 'inline' }} href={`https://github.com/${r.githubUsername}`} target="_blank" rel="noopener noreferrer">@{r.githubUsername}</a></td>
                <td>{r.level}</td>
                <td className="pts">{r.points.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function short(a: string) { return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a; }

export function DevsPortal({ config }: DevsPortalProps) {
  const [profile, setProfile] = useState<DevsProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loggedIn = !!config.getToken();

  const load = useCallback(async () => {
    if (!config.getToken()) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [p, lb] = await Promise.all([getProfile(config), getLeaderboard(config).catch(() => [] as LeaderboardRow[])]);
      setProfile(p);
      setLeaderboard(lb);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => { void load(); }, [load]);

  if (!loggedIn) {
    return (
      <div className="devs">
        <Header />
        <div className="devs-center"><p className="devs-note">Log in to the realm (Login / Register) to view your Devs portal.</p></div>
      </div>
    );
  }
  if (loading || !profile) {
    return (
      <div className="devs">
        <Header />
        <div className="devs-center"><div className="devs-spinner" /><p className="devs-note">Summoning your contributions…</p></div>
      </div>
    );
  }
  return (
    <div className="devs">
      <Header />
      {error && <div className="devs-error">{error}</div>}
      <div className="devs-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ProfileCard profile={profile} config={config} onReload={() => void load()} />
          <WalletCard profile={profile} config={config} onReload={() => void load()} />
        </div>
        <LeaderboardCard rows={leaderboard} you={profile.githubUsername} />
      </div>
    </div>
  );
}
