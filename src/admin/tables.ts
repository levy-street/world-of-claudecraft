import { escapeHtml, fmtCopper, fmtDate, fmtDuration, fmtNumber, fmtPercent, fmtRelative } from './format';
import { classLabel, zoneLabel, t } from './i18n';
import type {
  AccountDetail, AccountRow, BlockedIpsData, BlockedIpRow, BugReportRow, CharacterRow, ChatFilterData, ChatModeratedAccount,
  ChatModerationDetail, FilterWord, LivePlayer, ModerationAccountDetail, ModerationQueueRow,
  ProviderUsageCache, ProviderUsageSnapshot,
} from './types';

// Pure HTML-string renderers for the dashboard tables. All dynamic values go
// through escapeHtml — usernames and character names are player-controlled.

export function renderOnlineTable(players: LivePlayer[]): string {
  if (players.length === 0) return `<div class="empty">${t('online.empty')}</div>`;
  const rows = players.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(classLabel(p.class))}</td>
      <td class="num">${p.level}</td>
      <td>${escapeHtml(zoneLabel(p.zone))}</td>
      <td class="num">${Math.round(p.x)}, ${Math.round(p.z)}</td>
      <td class="num">${p.hp}/${p.maxHp}</td>
      <td class="num">${fmtDuration(p.sessionSeconds)}</td>
      <td class="num">${fmtDuration(p.lastSaveSecondsAgo)} ${t('common.ago')}</td>
      <td class="num">${p.accountId}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      <th>${t('online.colCharacter')}</th><th>${t('online.colClass')}</th><th class="num">${t('online.colLevel')}</th><th>${t('online.colZone')}</th>
      <th class="num">${t('online.colPos')}</th><th class="num">${t('online.colHp')}</th><th class="num">${t('online.colSession')}</th>
      <th class="num">${t('online.colLastSave')}</th><th class="num">${t('online.colAcct')}</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function renderMetricCount(value: number): string {
  return escapeHtml(fmtNumber(value));
}

function renderCacheEntries(cache: ProviderUsageCache): string {
  if (cache.maxEntries === null) return escapeHtml(fmtNumber(cache.entries));
  return escapeHtml(t('usage.cacheEntriesOfMax', {
    entries: fmtNumber(cache.entries),
    max: fmtNumber(cache.maxEntries),
  }));
}

function renderCacheHitRate(cache: ProviderUsageCache): string {
  const totalReads = cache.hits + cache.misses;
  if (totalReads <= 0) return escapeHtml(t('usage.notAvailable'));
  return escapeHtml(fmtPercent(cache.hits / totalReads));
}

export function renderProviderUsage(usage: ProviderUsageSnapshot): string {
  const metricRows = usage.metrics.map((metric) => `
    <tr>
      <td>${escapeHtml(t(metric.labelKey))}</td>
      ${usage.windows.map((window) => `<td class="num">${renderMetricCount(metric.counts[window.key] ?? 0)}</td>`).join('')}
    </tr>`).join('');
  const cacheRows = usage.caches.map((cache) => `
    <tr>
      <td>${escapeHtml(t(cache.labelKey))}</td>
      <td class="num">${renderCacheEntries(cache)}</td>
      <td class="num">${renderCacheHitRate(cache)}</td>
      <td class="num">${renderMetricCount(cache.hits)}</td>
      <td class="num">${renderMetricCount(cache.misses)}</td>
      <td class="num">${renderMetricCount(cache.staleRefreshes)}</td>
      <td class="num">${renderMetricCount(cache.stores)}</td>
      <td class="num">${renderMetricCount(cache.failures)}</td>
      <td class="num">${renderMetricCount(cache.evictions)}</td>
    </tr>`).join('');

  return `
    <div class="usage-section">
      <h4>${t('usage.requestsTitle')}</h4>
      <div class="table-scroll">
        <table class="usage-table">
          <thead><tr>
            <th>${t('usage.colMetric')}</th>
            ${usage.windows.map((window) => `<th class="num">${escapeHtml(t(window.labelKey))}</th>`).join('')}
          </tr></thead>
          <tbody>${metricRows}</tbody>
        </table>
      </div>
    </div>
    <div class="usage-section">
      <h4>${t('usage.cacheTitle')}</h4>
      <div class="table-scroll">
        <table class="usage-table">
          <thead><tr>
            <th>${t('usage.cacheColCache')}</th>
            <th class="num">${t('usage.cacheColEntries')}</th>
            <th class="num">${t('usage.cacheColHitRate')}</th>
            <th class="num">${t('usage.cacheColHits')}</th>
            <th class="num">${t('usage.cacheColMisses')}</th>
            <th class="num">${t('usage.cacheColStale')}</th>
            <th class="num">${t('usage.cacheColStores')}</th>
            <th class="num">${t('usage.cacheColFailures')}</th>
            <th class="num">${t('usage.cacheColEvictions')}</th>
          </tr></thead>
          <tbody>${cacheRows}</tbody>
        </table>
      </div>
    </div>`;
}

export function renderAccountsTable(rows: AccountRow[]): string {
  if (rows.length === 0) return `<div class="empty">${t('accounts.empty')}</div>`;
  const body = rows.map((a) => `
    <tr class="clickable" data-account-id="${a.id}">
      <td class="num">${a.id}</td>
      <td>${escapeHtml(a.username)}${a.isAdmin ? ` <span class="badge">${t('accounts.badgeAdmin')}</span>` : ''} ${accountStatusBadge(a)}</td>
      <td class="num">${a.characterCount}</td>
      <td class="num">${a.maxLevel}</td>
      <td class="num">${fmtDuration(a.playtimeSeconds)}</td>
      <td>${fmtDate(a.createdAt)}</td>
      <td>${fmtRelative(a.lastLogin)}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      <th class="num">${t('accounts.colId')}</th><th>${t('accounts.colUsername')}</th><th class="num">${t('accounts.colChars')}</th><th class="num">${t('accounts.colMaxLvl')}</th>
      <th class="num">${t('accounts.colPlaytime')}</th><th>${t('accounts.colRegistered')}</th><th>${t('accounts.colLastLogin')}</th>
    </tr></thead>
    <tbody>${body.join('')}</tbody>
  </table>`;
}

function accountStatusBadge(a: { bannedAt: string | null; suspendedUntil: string | null }): string {
  if (a.bannedAt) return `<span class="badge bad">${t('accounts.badgeBanned')}</span>`;
  const suspendedUntil = a.suspendedUntil ? new Date(a.suspendedUntil) : null;
  if (suspendedUntil && suspendedUntil.getTime() > Date.now()) return `<span class="badge warn">${t('accounts.badgeSuspended')}</span>`;
  return '';
}

function accountStatusDetail(d: AccountDetail): string {
  const activeSuspension = d.suspendedUntil !== null && new Date(d.suspendedUntil).getTime() > Date.now();
  const activeChatMute = d.chatMutedUntil !== null && new Date(d.chatMutedUntil).getTime() > Date.now();
  if (d.bannedAt) return `<span class="badge bad">${t('accounts.badgeBanned')}</span> <span class="hint">${t('detail.since', { value: fmtDate(d.bannedAt) })}</span>`;
  if (activeSuspension) return `<span class="badge warn">${t('detail.suspendedUntil', { value: fmtDate(d.suspendedUntil) })}</span>`;
  return `<span class="badge">${t('detail.statusActive')}</span>${activeChatMute ? ` <span class="badge warn">${t('detail.chatMutedUntil', { value: fmtDate(d.chatMutedUntil) })}</span>` : ''}`;
}

export function renderAccountDetail(d: AccountDetail, includeAdminControls = false): string {
  const canModerateAccount = includeAdminControls && !d.isAdmin;
  const chars = d.characters.length === 0
    ? `<div class="empty">${t('detail.noCharacters')}</div>`
    : `<table><thead><tr><th>${t('detail.colName')}</th><th>${t('characters.colClass')}</th><th class="num">${t('characters.colLevel')}</th><th class="num">${t('detail.colXp')}</th><th class="num">${t('detail.colMoney')}</th><th class="num">${t('online.colPos')}</th><th>${t('characters.colLastPlayed')}</th>${canModerateAccount ? `<th>${t('detail.colActions')}</th>` : ''}</tr></thead><tbody>${
        d.characters.map((c) => `
          <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(classLabel(c.class))}</td>
            <td class="num">${c.level}</td>
            <td class="num">${c.xp}</td>
            <td class="num">${fmtCopper(c.copper)}</td>
            <td class="num">${c.pos ? `${Math.round(c.pos.x)}, ${Math.round(c.pos.z)}` : '—'}</td>
            <td>${fmtRelative(c.updatedAt)}</td>
            ${canModerateAccount ? `<td><button data-force-rename-character="${c.id}" data-character-name="${escapeHtml(c.name)}">${t('detail.forceNameChange')}</button></td>` : ''}
          </tr>`).join('')
      }</tbody></table>`;
  const sessions = d.recentSessions.length === 0
    ? `<div class="empty">${t('detail.noSessions')}</div>`
    : `<table><thead><tr><th>${t('online.colCharacter')}</th><th>${t('detail.started')}</th><th class="num">${t('dialog.length')}</th></tr></thead><tbody>${
        d.recentSessions.map((s) => `
          <tr>
            <td>${escapeHtml(s.characterName)}</td>
            <td>${fmtDate(s.startedAt)}</td>
            <td class="num">${s.endedAt ? fmtDuration(s.seconds) : t('detail.onlineNow')}</td>
          </tr>`).join('')
      }</tbody></table>`;
  const accountStatus = accountStatusDetail(d);
  const accountActionButtons = d.bannedAt ? `
      <button data-unban-account="1">${t('detail.unban')}</button>` : `
      <button data-suspend-hours="1">${t('detail.suspend1h')}</button>
      <button data-suspend-hours="24">${t('detail.suspend24h')}</button>
      <button data-suspend-hours="72">${t('detail.suspend3d')}</button>
      <button data-suspend-hours="168">${t('detail.suspend7d')}</button>
      <button data-suspend-hours="720">${t('detail.suspend30d')}</button>
      <input class="account-custom-expiry" type="datetime-local" />
      <button data-suspend-custom="1">${t('detail.suspendCustom')}</button>
      <button data-chat-mute-hours="1">${t('detail.chatMute1h')}</button>
      <button data-chat-mute-custom="1">${t('detail.chatMuteCustom')}</button>
      <button data-ban-account="1" class="danger">${t('detail.ban')}</button>`;
  const adminControls = canModerateAccount ? `
    <div class="account-admin-controls mod-account-actions" data-action-account-id="${d.id}">
      <div class="account-status"><b>${t('detail.status')}</b> ${accountStatus}${d.moderationReason ? ` <span class="hint">${t('detail.reason', { value: escapeHtml(d.moderationReason) })}</span>` : ''}</div>
      ${d.chatMutedUntil && new Date(d.chatMutedUntil).getTime() > Date.now() && d.chatMuteReason ? `<div class="account-status"><b>${t('detail.chatMuteLabel')}</b> <span class="hint">${t('detail.reason', { value: escapeHtml(d.chatMuteReason) })}</span></div>` : ''}
      <input class="account-mod-reason" placeholder="${t('detail.notePlaceholder')}" maxlength="500" />
      ${accountActionButtons}
    </div>
    <div class="mod-confirm account-mod-confirm"></div>` : includeAdminControls ? `
    <div class="account-admin-controls">
      <div class="account-status"><b>${t('detail.status')}</b> <span class="badge">${t('accounts.badgeAdmin')}</span> ${accountStatus}</div>
    </div>` : '';
  // Chat-mute controls are shown for EVERY account (admins included): the chat
  // filter auto-mutes admins too, and ban/suspend gating must not strand them.
  const activeChatMute = d.chatMutedUntil !== null && new Date(d.chatMutedUntil).getTime() > Date.now();
  const chatModControls = includeAdminControls ? `
    <div class="account-admin-controls chat-mod-controls" data-action-account-id="${d.id}">
      <div class="account-status"><b>${t('chatMod.chatLabel')}</b> ${activeChatMute ? `<span class="badge warn">${t('chatMod.mutedUntil', { value: fmtDate(d.chatMutedUntil) })}</span>` : `<span class="badge">${t('chatMod.notMuted')}</span>`} &middot; ${t('chatMod.strikesInline')} <b>${d.chatStrikes}</b></div>
      ${activeChatMute ? `<button data-lift-mute="1">${t('chatMod.liftChatMute')}</button>` : ''}
      ${d.chatStrikes > 0 ? `<button data-reset-strikes="1">${t('chatMod.resetChatStrikes')}</button>` : ''}
    </div>` : '';
  return `<div class="account-detail" data-action-account-id="${d.id}">${adminControls}${chatModControls}<div class="detail-grid">
    <div><h4>${t('detail.charactersHeader')}</h4>${chars}</div>
    <div><h4>${t('detail.sessionsHeader', { value: fmtDuration(d.playtimeSeconds) })}</h4>${sessions}</div>
  </div></div>`;
}

export function renderCharactersTable(rows: CharacterRow[], sort: string, dir: string): string {
  if (rows.length === 0) return `<div class="empty">${t('characters.empty')}</div>`;
  const arrow = (col: string) => (sort === col ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sortableHeader = (col: string, label: string, numeric = false) =>
    `<th class="sortable${numeric ? ' num' : ''}" data-sort="${col}">${label}${arrow(col)}</th>`;
  const body = rows.map((c) => `
    <tr>
      <td class="num">${c.id}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(classLabel(c.class))}</td>
      <td class="num">${c.level}</td>
      <td class="num">${c.xp}</td>
      <td class="num">${fmtCopper(c.copper)}</td>
      <td>${escapeHtml(c.username)}</td>
      <td>${fmtDate(c.createdAt)}</td>
      <td>${fmtRelative(c.updatedAt)}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      ${sortableHeader('id', t('characters.colId'), true)}
      ${sortableHeader('name', t('characters.colName'))}
      ${sortableHeader('class', t('characters.colClass'))}
      ${sortableHeader('level', t('characters.colLevel'), true)}
      <th class="num">${t('characters.colXp')}</th><th class="num">${t('characters.colMoney')}</th><th>${t('characters.colAccount')}</th>
      ${sortableHeader('created_at', t('characters.colCreated'))}
      ${sortableHeader('updated_at', t('characters.colLastPlayed'))}
    </tr></thead>
    <tbody>${body.join('')}</tbody>
  </table>`;
}

export function renderPager(total: number, page: number, limit: number): string {
  const pages = Math.max(1, Math.ceil(total / limit));
  return `
    <button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${t('accounts.prev')}</button>
    <span>${t('accounts.pager', { page, pages, total })}</span>
    <button data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>${t('accounts.next')}</button>`;
}

export function renderModerationQueue(rows: ModerationQueueRow[]): string {
  if (rows.length === 0) return `<div class="empty">${t('moderation.empty')}</div>`;
  const body = rows.map((r) => `
    <tr class="clickable" data-moderation-account-id="${r.accountId}">
      <td>${escapeHtml(r.username)}${r.online ? ` <span class="badge">${t('moderation.badgeOnline')}</span>` : ''}</td>
      <td>${r.characterNames.map(escapeHtml).join(', ') || '—'}</td>
      <td class="num">${r.openReports}</td>
      <td>${escapeHtml(reasonLabel(r.latestReason))}</td>
      <td>${fmtRelative(r.latestReportAt)}</td>
      <td>${statusBadge(r.status, r.suspendedUntil)}</td>
    </tr>`);
  return `<table>
    <thead><tr>
      <th>${t('moderation.colAccount')}</th><th>${t('moderation.colCharacters')}</th><th class="num">${t('moderation.colOpenReports')}</th><th>${t('moderation.colLatestReason')}</th><th>${t('moderation.colLatest')}</th><th>${t('moderation.colStatus')}</th>
    </tr></thead>
    <tbody>${body.join('')}</tbody>
  </table>`;
}

export function renderModerationDetail(d: ModerationAccountDetail): string {
  const reports = d.reports.map((r) => {
    const chat = r.chatContext.length === 0
      ? `<div class="empty">${t('report.noChat')}</div>`
      : `<table><thead><tr><th>${t('report.colTime')}</th><th>${t('report.colChannel')}</th><th>${t('report.colMessage')}</th></tr></thead><tbody>${
          r.chatContext.map((c) => `
            <tr>
              <td>${fmtDate(c.createdAt)}</td>
              <td>${escapeHtml(c.channel)}</td>
              <td><b>${escapeHtml(c.characterName)}:</b> ${escapeHtml(c.message)}</td>
            </tr>`).join('')
        }</tbody></table>`;
    return `<div class="mod-report panel" data-report-id="${r.id}">
      <div class="panel-title">${t('report.title', { id: r.id })} <span class="hint">${fmtDate(r.createdAt)}</span></div>
      <div class="mod-report-meta">
        <div><b>${t('report.reporter')}</b> ${escapeHtml(r.reporterUsername ?? t('common.unknown'))} / ${escapeHtml(r.reporterCharacterName || t('common.unknown'))}</div>
        <div><b>${t('report.reported')}</b> ${escapeHtml(r.reportedUsername)} / ${escapeHtml(r.reportedCharacterName || t('common.unknown'))}</div>
        <div><b>${t('report.reason')}</b> ${escapeHtml(reasonLabel(r.reason))}</div>
      </div>
      <div class="mod-details">${escapeHtml(r.details || t('report.noDetails'))}</div>
      <div class="mod-actions">
        <button data-ignore-report="${r.id}">${t('report.ignore')}</button>
        ${r.reportedCharacterId ? `<button data-force-rename-character="${r.reportedCharacterId}" data-character-name="${escapeHtml(r.reportedCharacterName)}">${t('report.forceNameChange')}</button>` : ''}
      </div>
      <h4>${t('report.recentChat')}</h4>
      ${chat}
    </div>`;
  }).join('');
  const moderationAccountButtons = d.account.bannedAt ? `
      <button data-unban-account="1">${t('detail.unban')}</button>` : `
      <button data-suspend-hours="1">${t('detail.suspend1h')}</button>
      <button data-suspend-hours="24">${t('detail.suspend24h')}</button>
      <button data-suspend-hours="72">${t('detail.suspend3d')}</button>
      <button data-suspend-hours="168">${t('detail.suspend7d')}</button>
      <button data-suspend-hours="720">${t('detail.suspend30d')}</button>
      <input id="mod-custom-expiry" type="datetime-local" />
      <button data-suspend-custom="1">${t('detail.suspendCustom')}</button>
      <button data-chat-mute-hours="1">${t('detail.chatMute1h')}</button>
      <button data-chat-mute-custom="1">${t('detail.chatMuteCustom')}</button>
      <button data-ban-account="1">${t('detail.ban')}</button>`;
  return `<div class="mod-detail">
    <div class="panel-title">
      <span>${escapeHtml(d.account.username)}</span>
      <span class="hint">${t('detail.accountNum', { id: d.account.id })}</span>
    </div>
    ${renderAccountDetail(d.account)}
    ${renderChatModeration(d.chat)}
    <div class="mod-account-actions" data-action-account-id="${d.account.id}">
      <input id="mod-reason" placeholder="${t('detail.notePlaceholder')}" maxlength="500" />
      ${moderationAccountButtons}
    </div>
    <div id="mod-confirm" class="mod-confirm"></div>
    ${renderIpBlockSection(d)}
    <h4>${t('report.openReports')}</h4>
    ${reports || `<div class="empty">${t('report.noOpenReports')}</div>`}
  </div>`;
}

// Surfaces an account's recent IPs and their block status so a moderator can see
// at a glance why a player can't connect.
const MAX_KNOWN_IPS = 5;

function renderIpBlockSection(d: ModerationAccountDetail): string {
  const blocked = new Set(d.blockedIps);
  const ips: string[] = [];
  const seen = new Set<string>();
  // Newest-first (last login, then recent sessions DESC), capped.
  const add = (ip: string | null) => {
    if (ip && !seen.has(ip) && ips.length < MAX_KNOWN_IPS) { seen.add(ip); ips.push(ip); }
  };
  add(d.account.lastLoginIp);
  for (const s of d.account.recentSessions) add(s.ip);
  // Surface this account's blocked IPs even past the cap, so Unblock stays reachable.
  for (const ip of d.blockedIps) {
    if (!seen.has(ip)) { seen.add(ip); ips.push(ip); }
  }
  const rows = ips.length === 0
    ? `<div class="empty">${t('blockedIps.noKnownIps')}</div>`
    : ips.map((ip, i) => {
        const isBlocked = blocked.has(ip);
        const label = i === 0 ? ` <span class="hint">${t('blockedIps.lastIp')}</span>` : '';
        const badge = isBlocked ? ` <span class="badge bad">${t('blockedIps.blockedBadge')}</span>` : '';
        // Admins can't be locked out, so don't offer to ban their IP; Unblock
        // stays in case it was blocked from elsewhere.
        const banButtons = [
          { duration: '1d', label: t('blockedIps.ban24h') },
          { duration: '30d', label: t('blockedIps.ban30d') },
          { duration: '', label: t('blockedIps.banForever') },
        ].map((b) => `<button data-ban-ip="${escapeHtml(ip)}" data-ban-duration="${b.duration}" class="danger">${b.label}</button>`).join('');
        const action = isBlocked
          ? `<button data-unblock-ip="${escapeHtml(ip)}">${t('blockedIps.unblock')}</button>`
          : d.account.isAdmin
            ? `<span class="hint">${t('blockedIps.adminProtected')}</span>`
            : banButtons;
        return `<div class="ip-row"><code>${escapeHtml(ip)}</code>${label}${badge} ${action}</div>`;
      }).join('');
  return `<div class="panel ip-block">
    <div class="panel-title">${t('blockedIps.accountSectionTitle')}</div>
    ${rows}
  </div>`;
}

// Chat-filter state for an account: live mute status, strike count, the
// warn/mute incident log, and manual lift/reset actions (slurs the player typed).
function renderChatModeration(chat: ChatModerationDetail): string {
  const muteStatus = chat.chatMutedUntil
    ? `<span class="badge bad">${t('chatMod.mutedUntil', { value: fmtDate(chat.chatMutedUntil) })}</span>`
    : `<span class="badge">${t('chatMod.notMuted')}</span>`;
  const incidents = chat.violations.length === 0
    ? `<div class="empty">${t('chatMod.noIncidents')}</div>`
    : `<table><thead><tr><th>${t('report.colTime')}</th><th>${t('report.colChannel')}</th><th>${t('chatMod.colWord')}</th><th>${t('dialog.action')}</th><th>${t('report.colMessage')}</th></tr></thead><tbody>${
        chat.violations.map((v) => `
          <tr>
            <td>${fmtDate(v.createdAt)}</td>
            <td>${escapeHtml(v.channel)}</td>
            <td>${escapeHtml(v.term)}</td>
            <td>${escapeHtml(v.action)}${v.muteSeconds > 0 ? ` (${escapeHtml(fmtDuration(v.muteSeconds))})` : ''}</td>
            <td>${escapeHtml(v.message)}</td>
          </tr>`).join('')
      }</tbody></table>`;
  return `<div class="panel chat-mod">
    <div class="panel-title">${t('chatMod.title')}</div>
    <div class="chat-mod-status">${t('chatMod.status')} ${muteStatus} &middot; ${t('chatMod.strikes')} <b>${chat.chatStrikes}</b></div>
    <div class="mod-actions">
      ${chat.chatMutedUntil ? `<button data-lift-mute="1">${t('chatMod.liftMute')}</button>` : ''}
      ${chat.chatStrikes > 0 ? `<button data-reset-strikes="1">${t('chatMod.resetStrikes')}</button>` : ''}
    </div>
    <h4>${t('chatMod.recentIncidents')}</h4>
    ${incidents}
  </div>`;
}

function renderWordChips(words: FilterWord[]): string {
  if (words.length === 0) return `<div class="empty">${t('chatFilter.noWords')}</div>`;
  return `<div class="word-chips">${
    words.map((w) => `<span class="word-chip">${escapeHtml(w.word)}<button class="word-del" data-del-word="${w.id}" title="${t('chatFilter.removeWord')}">&times;</button></span>`).join('')
  }</div>`;
}

export function renderChatFilter(data: ChatFilterData): string {
  const ladderHuman = data.config.muteLadderSeconds.map((s) => fmtDuration(s)).join(' → ');
  return `
    <div class="panel">
      <div class="panel-title">${t('chatFilter.escalationTitle')}</div>
      <p class="hint">${t('chatFilter.escalationHint')}</p>
      <div class="cf-config">
        <label>${t('chatFilter.warningsLabel')}
          <input id="cf-warnings" type="number" min="0" max="50" value="${data.config.warningsBeforeMute}" />
        </label>
        <label>${t('chatFilter.ladderLabel')}
          <input id="cf-ladder" type="text" value="${escapeHtml(data.config.muteLadderSeconds.join(', '))}" />
        </label>
        <div class="hint">${t('chatFilter.currentLadder')} ${escapeHtml(ladderHuman || '—')}</div>
        <button data-save-config="1">${t('chatFilter.saveConfig')}</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">${t('chatFilter.softTitle')} <span class="hint">${t('chatFilter.softHint')}</span></div>
      <form class="word-add" data-add-tier="soft"><input placeholder="${t('chatFilter.softPlaceholder')}" maxlength="64" /><button>${t('chatFilter.add')}</button></form>
      ${renderWordChips(data.soft)}
    </div>
    <div class="panel">
      <div class="panel-title">${t('chatFilter.hardTitle')} <span class="hint">${t('chatFilter.hardHint')}</span></div>
      <form class="word-add" data-add-tier="hard"><input placeholder="${t('chatFilter.hardPlaceholder')}" maxlength="64" /><button>${t('chatFilter.add')}</button></form>
      ${renderWordChips(data.hard)}
    </div>
    <div class="panel">
      <div class="panel-title">${t('chatFilter.accountsTitle')} <span class="hint">${t('chatFilter.accountsHint')}</span></div>
      ${renderChatModeratedAccounts(data.accounts)}
    </div>`;
}

export function renderBlockedIps(data: BlockedIpsData): string {
  const addForm = `<div class="panel">
    <div class="panel-title">${t('blockedIps.addTitle')}</div>
    <form class="ip-add">
      <input class="ip-add-ip" placeholder="${t('blockedIps.ipPlaceholder')}" maxlength="128" />
      <input class="ip-add-reason" placeholder="${t('blockedIps.reasonPlaceholder')}" maxlength="500" />
      <label class="ip-add-expiry">${t('blockedIps.expiresLabel')}
        <select class="ip-add-expiry-select">
          <option value="">${t('blockedIps.expiresForever')}</option>
          <option value="1d">${t('blockedIps.expires1d')}</option>
          <option value="7d">${t('blockedIps.expires1w')}</option>
          <option value="30d">${t('blockedIps.expires1m')}</option>
        </select>
      </label>
      <button>${t('blockedIps.add')}</button>
    </form>
  </div>`;
  return `${addForm}<div class="panel">
    <div class="panel-title">${t('blockedIps.listTitle')}</div>
    ${renderBlockedIpsTable(data.rows)}
  </div>`;
}

function renderBlockedIpsTable(rows: BlockedIpRow[]): string {
  if (rows.length === 0) return `<div class="empty">${t('blockedIps.empty')}</div>`;
  const now = Date.now();
  const body = rows.map((r) => {
    const expired = r.expiresAt !== null && new Date(r.expiresAt).getTime() <= now;
    const expiry = r.expiresAt === null
      ? `<span class="badge">${t('blockedIps.permanent')}</span>`
      : `<span class="badge ${expired ? 'bad' : 'warn'}">${fmtDate(r.expiresAt)}</span>`;
    return `<tr>
      <td><code>${escapeHtml(r.ip)}</code></td>
      <td>${escapeHtml(r.reason || '—')}</td>
      <td>${expiry}</td>
      <td>${escapeHtml(r.createdByUsername ?? t('common.unknown'))}</td>
      <td>${fmtDate(r.createdAt)}</td>
      <td><button data-unblock-ip="${escapeHtml(r.ip)}">${t('blockedIps.remove')}</button></td>
    </tr>`;
  }).join('');
  return `<table><thead><tr>
    <th>${t('blockedIps.colIp')}</th>
    <th>${t('blockedIps.colReason')}</th>
    <th>${t('blockedIps.colExpires')}</th>
    <th>${t('blockedIps.colCreatedBy')}</th>
    <th>${t('blockedIps.colCreatedAt')}</th>
    <th>${t('detail.colActions')}</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

function renderChatModeratedAccounts(accounts: ChatModeratedAccount[]): string {
  if (accounts.length === 0) return `<div class="empty">${t('chatFilter.noModeratedAccounts')}</div>`;
  const rows = accounts.map((a) => {
    const muted = a.chatMutedUntil !== null && new Date(a.chatMutedUntil).getTime() > Date.now();
    const muteCell = muted
      ? `<span class="badge warn">${t('chatMod.mutedUntil', { value: fmtDate(a.chatMutedUntil) })}</span>`
      : `<span class="badge">${t('chatMod.notMuted')}</span>`;
    const actions = `${muted ? `<button data-lift-mute="1">${t('chatMod.liftMute')}</button>` : ''}${a.chatStrikes > 0 ? ` <button data-reset-strikes="1">${t('chatMod.resetStrikes')}</button>` : ''}`;
    return `<tr data-action-account-id="${a.id}">
      <td>${escapeHtml(a.username)}${a.isAdmin ? ` <span class="badge">${t('accounts.badgeAdmin')}</span>` : ''}</td>
      <td class="num">${a.chatStrikes}</td>
      <td>${muteCell}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>${t('moderation.colAccount')}</th><th class="num">${t('chatMod.colStrikes')}</th><th>${t('chatMod.colMute')}</th><th>${t('detail.colActions')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function reasonLabel(reason: string): string {
  return ({
    harassment: t('reason.harassment'),
    spam: t('reason.spam'),
    cheating: t('reason.cheating'),
    offensive_name_or_chat: t('reason.offensiveName'),
    other: t('reason.other'),
  } as Record<string, string>)[reason] ?? reason;
}

function statusBadge(status: string, suspendedUntil: string | null): string {
  if (status === 'banned') return `<span class="badge bad">${t('accounts.badgeBanned')}</span>`;
  if (status === 'suspended') return `<span class="badge warn">${t('detail.suspendedUntil', { value: fmtDate(suspendedUntil) })}</span>`;
  return `<span class="badge">${t('detail.statusActive')}</span>`;
}

export function renderBugReportsTable(rows: BugReportRow[]): string {
  if (rows.length === 0) return `<div class="empty">${t('bugReports.empty')}</div>`;
  const body = rows.map((r) => {
    const coords = `${fmtNumber(r.pos_x)}, ${fmtNumber(r.pos_y)}, ${fmtNumber(r.pos_z)}`;
    // The list omits the screenshot bytes; offer a button that fetches the one
    // report's screenshot on demand (see showBugScreenshot in main.ts).
    const shot = r.has_screenshot
      ? `<button class="btn-link" data-bug-shot="${r.id}">${t('bugReports.viewScreenshot')}</button>`
      : `<span class="text-dim">${t('bugReports.noScreenshot')}</span>`;
    const meta = `<details><summary>${t('bugReports.colMeta')}</summary><pre class="bug-meta">${escapeHtml(JSON.stringify(r.meta ?? {}, null, 2))}</pre></details>`;
    return `<tr>
      <td>${fmtRelative(r.created_at)}</td>
      <td>${escapeHtml(r.realm) || '-'}</td>
      <td>${escapeHtml(r.character_name) || '-'}</td>
      <td>${escapeHtml(coords)}</td>
      <td class="bug-desc-cell">${escapeHtml(r.description)}</td>
      <td><span class="badge">${escapeHtml(r.status)}</span></td>
      <td>${meta}</td>
      <td>${shot}</td>
    </tr>`;
  });
  return `<div class="table-scroll"><table>
    <thead><tr>
      <th>${t('bugReports.colWhen')}</th><th>${t('bugReports.colRealm')}</th><th>${t('bugReports.colCharacter')}</th><th>${t('bugReports.colPosition')}</th><th>${t('bugReports.colDescription')}</th><th>${t('bugReports.colStatus')}</th><th>${t('bugReports.colMeta')}</th><th>${t('bugReports.colScreenshot')}</th>
    </tr></thead>
    <tbody>${body.join('')}</tbody>
  </table></div>`;
}
