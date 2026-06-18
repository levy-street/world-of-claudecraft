// Moderator dashboard SPA — /mod/. Requires is_moderator or is_admin.
// Shows the moderation queue and the current mod's own info.

import {
  modLogin, getModMe, getModQueue, getToken, getModName, clearSession,
  ApiError, type ModMeData, type ModQueueRow,
} from './api';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function renderLoginShell(): void {
  document.body.innerHTML = `
    <div class="woc-dash">
      <div class="woc-card">
        <h1>World of ClaudeCraft — Moderator</h1>
        <p class="woc-dim">Sign in. Moderator or admin access required.</p>
        <form id="login-form">
          <div class="woc-stack">
            <input id="login-username" type="text" placeholder="Username" autocomplete="username" required />
            <input id="login-password" type="password" placeholder="Password" autocomplete="current-password" required />
            <div id="login-error" class="woc-error" hidden></div>
            <button type="submit">Sign in</button>
          </div>
        </form>
      </div>
    </div>
  `;
  ($('#login-form') as HTMLFormElement).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    try {
      await modLogin(
        ($('#login-username') as HTMLInputElement).value.trim(),
        ($('#login-password') as HTMLInputElement).value,
      );
      void boot();
    } catch (e) {
      err.hidden = false;
      err.textContent = e instanceof ApiError ? e.message : 'sign-in failed';
    }
  });
}

function renderQueueTable(rows: ModQueueRow[]): string {
  if (rows.length === 0) {
    return '<p class="woc-ok">No open reports. Queue is clear.</p>';
  }
  return `<table class="woc-table">
    <thead><tr>
      <th>Account</th><th>Character</th><th>Reports</th><th>Status</th><th>Last report</th>
    </tr></thead>
    <tbody>
      ${rows.map((r) => {
        const status: string[] = [];
        if (r.banned) status.push('<span class="woc-chip woc-banned">Banned</span>');
        if (r.suspendedUntil) status.push(`<span class="woc-chip woc-suspended">Suspended → ${escapeHtml(r.suspendedUntil)}</span>`);
        if (r.chatMutedUntil) status.push(`<span class="woc-chip woc-muted">Chat muted → ${escapeHtml(r.chatMutedUntil)}</span>`);
        if (r.online) status.push('<span class="woc-chip woc-online">Online</span>');
        if (status.length === 0) status.push('<span class="woc-dim">—</span>');
        return `<tr>
          <td>${escapeHtml(r.username ?? '(deleted)')}</td>
          <td>${escapeHtml(r.characterName ?? '(none)')} ${r.characterClass ? `<span class="woc-dim">${escapeHtml(r.characterClass)} ${r.characterLevel ?? ''}</span>` : ''}</td>
          <td>${r.openReports}</td>
          <td>${status.join(' ')}</td>
          <td>${escapeHtml(r.lastReportAt ?? '—')}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function renderDashboard(): Promise<void> {
  let me: ModMeData;
  try { me = await getModMe(); }
  catch (e) {
    clearSession();
    renderLoginShell();
    if (e instanceof ApiError && e.status !== 401) {
      const el = document.getElementById('login-error');
      if (el) { el.hidden = false; el.textContent = e.message; }
    }
    return;
  }

  const roleChips: string[] = [];
  if (me.roles.isAdmin) roleChips.push('<span class="woc-chip woc-admin">Admin</span>');
  if (me.roles.isModerator) roleChips.push('<span class="woc-chip woc-mod">Moderator</span>');

  document.body.innerHTML = `
    <div class="woc-dash">
      <header class="woc-header">
        <h1>World of ClaudeCraft — Moderator Tools</h1>
        <div class="woc-meta">
          <span>${escapeHtml(getModName())}</span>
          ${roleChips.join(' ')}
          <span class="woc-dim">Realm: <strong>${escapeHtml(me.realm)}</strong></span>
          <a class="woc-link" href="/me/">My Account</a>
          ${me.roles.isAdmin ? '<a class="woc-link" href="/admin/">Admin</a>' : ''}
          <button id="signout" class="woc-link" type="button">Sign out</button>
        </div>
      </header>
      <section class="woc-card">
        <h2>Moderation queue</h2>
        <div id="queue">Loading…</div>
      </section>
    </div>
  `;
  $('#signout').addEventListener('click', () => { clearSession(); renderLoginShell(); });

  try {
    const queue = await getModQueue();
    $('#queue').innerHTML = renderQueueTable(queue);
  } catch (e) {
    $('#queue').innerHTML = `<div class="woc-error">Queue load failed: ${escapeHtml(e instanceof Error ? e.message : 'unknown')}</div>`;
  }
}

async function boot(): Promise<void> {
  if (!getToken()) { renderLoginShell(); return; }
  await renderDashboard();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
  } else {
    void boot();
  }
}
