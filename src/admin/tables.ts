import { escapeHtml, fmtCopper, fmtDate, fmtDuration, fmtRelative } from './format';
import type { AccountDetail, AccountRow, CharacterRow, LivePlayer, ModerationAccountDetail, ModerationQueueRow } from './types';

// Pure HTML-string renderers for the dashboard tables. All dynamic values go
// through escapeHtml — usernames and character names are player-controlled.

export function renderOnlineTable(players: LivePlayer[]): string {
  if (players.length === 0) return '<div class="empty">nobody online right now</div>';
  const rows = players.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.class)}</td>
      <td class="num">${p.level}</td>
      <td>${escapeHtml(p.zone)}</td>
      <td class="num">${Math.round(p.x)}, ${Math.round(p.z)}</td>
      <td class="num">${p.hp}/${p.maxHp}</td>
      <td class="num">${fmtDuration(p.sessionSeconds)}</td>
      <td class="num">${fmtDuration(p.lastSaveSecondsAgo)} ago</td>
      <td class="num">${p.accountId}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      <th>Character</th><th>Class</th><th class="num">Lvl</th><th>Zone</th>
      <th class="num">Pos</th><th class="num">HP</th><th class="num">Session</th>
      <th class="num">Last save</th><th class="num">Acct</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

export function renderAccountsTable(rows: AccountRow[]): string {
  if (rows.length === 0) return '<div class="empty">no accounts match</div>';
  const body = rows.map((a) => `
    <tr class="clickable" data-account-id="${a.id}">
      <td class="num">${a.id}</td>
      <td>${escapeHtml(a.username)}${a.isAdmin ? ' <span class="badge">admin</span>' : ''}</td>
      <td class="num">${a.characterCount}</td>
      <td class="num">${a.maxLevel}</td>
      <td class="num">${fmtDuration(a.playtimeSeconds)}</td>
      <td>${fmtDate(a.createdAt)}</td>
      <td>${fmtRelative(a.lastLogin)}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      <th class="num">ID</th><th>Username</th><th class="num">Chars</th><th class="num">Max lvl</th>
      <th class="num">Playtime</th><th>Registered</th><th>Last login</th>
    </tr></thead>
    <tbody>${body.join('')}</tbody>
  </table>`;
}

export function renderAccountDetail(d: AccountDetail): string {
  const chars = d.characters.length === 0
    ? '<div class="empty">no characters</div>'
    : `<table><thead><tr><th>Name</th><th>Class</th><th class="num">Lvl</th><th class="num">XP</th><th class="num">Money</th><th class="num">Pos</th><th>Last played</th></tr></thead><tbody>${
        d.characters.map((c) => `
          <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.class)}</td>
            <td class="num">${c.level}</td>
            <td class="num">${c.xp}</td>
            <td class="num">${fmtCopper(c.copper)}</td>
            <td class="num">${c.pos ? `${Math.round(c.pos.x)}, ${Math.round(c.pos.z)}` : '—'}</td>
            <td>${fmtRelative(c.updatedAt)}</td>
          </tr>`).join('')
      }</tbody></table>`;
  const sessions = d.recentSessions.length === 0
    ? '<div class="empty">no sessions recorded</div>'
    : `<table><thead><tr><th>Character</th><th>Started</th><th class="num">Length</th></tr></thead><tbody>${
        d.recentSessions.map((s) => `
          <tr>
            <td>${escapeHtml(s.characterName)}</td>
            <td>${fmtDate(s.startedAt)}</td>
            <td class="num">${s.endedAt ? fmtDuration(s.seconds) : 'online now'}</td>
          </tr>`).join('')
      }</tbody></table>`;
  return `<div class="detail-grid">
    <div><h4>Characters</h4>${chars}</div>
    <div><h4>Recent sessions — total playtime ${fmtDuration(d.playtimeSeconds)}</h4>${sessions}</div>
  </div>`;
}

export function renderCharactersTable(rows: CharacterRow[], sort: string, dir: string): string {
  if (rows.length === 0) return '<div class="empty">no characters yet</div>';
  const arrow = (col: string) => (sort === col ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sortableHeader = (col: string, label: string, numeric = false) =>
    `<th class="sortable${numeric ? ' num' : ''}" data-sort="${col}">${label}${arrow(col)}</th>`;
  const body = rows.map((c) => `
    <tr>
      <td class="num">${c.id}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.class)}</td>
      <td class="num">${c.level}</td>
      <td class="num">${c.xp}</td>
      <td class="num">${fmtCopper(c.copper)}</td>
      <td>${escapeHtml(c.username)}</td>
      <td>${fmtDate(c.createdAt)}</td>
      <td>${fmtRelative(c.updatedAt)}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      ${sortableHeader('id', 'ID', true)}
      ${sortableHeader('name', 'Name')}
      ${sortableHeader('class', 'Class')}
      ${sortableHeader('level', 'Lvl', true)}
      <th class="num">XP</th><th class="num">Money</th><th>Account</th>
      ${sortableHeader('created_at', 'Created')}
      ${sortableHeader('updated_at', 'Last played')}
    </tr></thead>
    <tbody>${body.join('')}</tbody>
  </table>`;
}

export function renderPager(total: number, page: number, limit: number): string {
  const pages = Math.max(1, Math.ceil(total / limit));
  return `
    <button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ prev</button>
    <span>page ${page} / ${pages} — ${total} total</span>
    <button data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>next ›</button>`;
}

export function renderModerationQueue(rows: ModerationQueueRow[]): string {
  if (rows.length === 0) return '<div class="empty">no open reports</div>';
  const body = rows.map((r) => `
    <tr class="clickable" data-moderation-account-id="${r.accountId}">
      <td>${escapeHtml(r.username)}${r.online ? ' <span class="badge">online</span>' : ''}</td>
      <td>${r.characterNames.map(escapeHtml).join(', ') || '—'}</td>
      <td class="num">${r.openReports}</td>
      <td>${reportKindBadge(r.latestSource, r.latestReportKind)} ${escapeHtml(reasonLabel(r.latestReason))}${r.maxAbuseScore > 0 ? ` <span class="badge warn">score ${r.maxAbuseScore}</span>` : ''}</td>
      <td>${fmtRelative(r.latestReportAt)}</td>
      <td>${statusBadge(r.status, r.suspendedUntil)}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      <th>Account</th><th>Characters</th><th class="num">Open Reports</th><th>Latest Reason</th><th>Latest</th><th>Status</th>
    </tr></thead>
    <tbody>${body.join('')}</tbody>
  </table>`;
}

export function renderModerationDetail(d: ModerationAccountDetail): string {
  const reports = d.reports.map((r) => {
    const evidence = renderEvidence(r.evidence);
    const events = r.relatedEvents.length === 0
      ? '<div class="empty">no related submission events</div>'
      : `<table><thead><tr><th>Time</th><th>Outcome</th><th>Reporter</th><th>Target</th><th class="num">Score</th><th>Signals</th></tr></thead><tbody>${
          r.relatedEvents.map((event) => `
            <tr>
              <td>${fmtDate(event.createdAt)}</td>
              <td>${escapeHtml(event.outcome)}</td>
              <td>${event.reporterAccountId ?? '—'} / ${escapeHtml(event.reporterCharacterName || 'unknown')}</td>
              <td>${event.targetAccountId ?? '—'} / ${escapeHtml(event.targetCharacterName || 'unknown')}</td>
              <td class="num">${event.abuseScore}</td>
              <td>${event.abuseReasons.map(escapeHtml).join(', ') || '—'}</td>
            </tr>`).join('')
        }</tbody></table>`;
    const chat = r.chatContext.length === 0
      ? '<div class="empty">no recent chat from this character before the report</div>'
      : `<table><thead><tr><th>Time</th><th>Channel</th><th>Message</th></tr></thead><tbody>${
          r.chatContext.map((c) => `
            <tr>
              <td>${fmtDate(c.createdAt)}</td>
              <td>${escapeHtml(c.channel)}</td>
              <td><b>${escapeHtml(c.characterName)}:</b> ${escapeHtml(c.message)}</td>
            </tr>`).join('')
        }</tbody></table>`;
    return `<div class="mod-report panel" data-report-id="${r.id}">
      <div class="panel-title">Report #${r.id} ${reportKindBadge(r.source, r.reportKind)} <span class="hint">${fmtDate(r.createdAt)}</span></div>
      <div class="mod-report-meta">
        <div><b>Reporter:</b> ${escapeHtml(r.reporterUsername ?? 'unknown')} / ${escapeHtml(r.reporterCharacterName || 'unknown')}</div>
        <div><b>Reported:</b> ${escapeHtml(r.reportedUsername)} / ${escapeHtml(r.reportedCharacterName || 'unknown')}</div>
        <div><b>Reason:</b> ${escapeHtml(reasonLabel(r.reason))}</div>
        <div><b>Abuse score:</b> ${r.abuseScore}${r.abuseReasons.length > 0 ? ` (${r.abuseReasons.map(escapeHtml).join(', ')})` : ''}</div>
      </div>
      <div class="mod-details">${escapeHtml(r.details || 'No extra details provided.')}</div>
      ${evidence}
      <div class="mod-actions">
        <button data-ignore-report="${r.id}">Ignore</button>
        ${r.reportedCharacterId ? `<button data-force-rename-character="${r.reportedCharacterId}" data-character-name="${escapeHtml(r.reportedCharacterName)}">Force Name Change</button>` : ''}
      </div>
      <h4>Related report submissions</h4>
      ${events}
      <h4>Recent chat before this report</h4>
      ${chat}
    </div>`;
  }).join('');
  return `<div class="mod-detail">
    <div class="panel-title">
      <span>${escapeHtml(d.account.username)}</span>
      <span class="hint">account #${d.account.id}</span>
    </div>
    ${renderAccountDetail(d.account)}
    <div class="mod-account-actions" data-action-account-id="${d.account.id}">
      <input id="mod-reason" placeholder="Moderator note / reason" maxlength="500" />
      <button data-suspend-hours="1">Suspend 1h</button>
      <button data-suspend-hours="24">Suspend 24h</button>
      <button data-suspend-hours="72">Suspend 3d</button>
      <button data-suspend-hours="168">Suspend 7d</button>
      <button data-suspend-hours="720">Suspend 30d</button>
      <input id="mod-custom-expiry" type="datetime-local" />
      <button data-suspend-custom="1">Suspend Custom</button>
      <button data-ban-account="1">Ban</button>
    </div>
    <div id="mod-confirm" class="mod-confirm"></div>
    <h4>Open reports</h4>
    ${reports || '<div class="empty">no open reports for this account</div>'}
  </div>`;
}

function reasonLabel(reason: string): string {
  return ({
    harassment: 'Harassment / abuse',
    spam: 'Spam',
    cheating: 'Cheating / exploit',
    botting: 'Botting / automation',
    offensive_name_or_chat: 'Offensive name or chat',
    report_abuse: 'Report abuse',
    other: 'Other',
  } as Record<string, string>)[reason] ?? reason;
}

function reportKindBadge(source: string, kind: string): string {
  if (source === 'system' || kind === 'report_abuse') {
    return '<span class="badge warn">System: report abuse</span>';
  }
  return '';
}

function renderEvidence(evidence: Record<string, unknown>): string {
  const entries = Object.entries(evidence).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '';
  return `<div class="mod-report-meta">${entries.slice(0, 12).map(([key, value]) => `
    <div><b>${escapeHtml(key)}:</b> ${escapeHtml(formatEvidenceValue(value))}</div>`).join('')}</div>`;
}

function formatEvidenceValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function statusBadge(status: string, suspendedUntil: string | null): string {
  if (status === 'banned') return '<span class="badge bad">banned</span>';
  if (status === 'suspended') return `<span class="badge warn">suspended until ${fmtDate(suspendedUntil)}</span>`;
  return '<span class="badge">active</span>';
}
