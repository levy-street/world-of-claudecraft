// User dashboard SPA — /me/. Anyone who can log in to the game can sign in
// here and see their character list, realm, role flags, and any active
// chat-mute / suspension status.

import {
  userLogin, getMe, getToken, getUserName, clearSession,
  ApiError, type MeData,
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
        <h1>World of ClaudeCraft — My Account</h1>
        <p class="woc-dim">Sign in with your game username and password.</p>
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
      await userLogin(
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

function renderDashboard(me: MeData): void {
  const roleChips: string[] = [];
  if (me.roles.isAdmin) roleChips.push('<span class="woc-chip woc-admin">Admin</span>');
  if (me.roles.isModerator && !me.roles.isAdmin) roleChips.push('<span class="woc-chip woc-mod">Moderator</span>');
  if (roleChips.length === 0) roleChips.push('<span class="woc-chip">Player</span>');

  const charsHtml = me.characters.length === 0
    ? '<p class="woc-dim">No characters on this realm yet.</p>'
    : `<table class="woc-table"><thead><tr><th>Name</th><th>Class</th><th>Level</th><th>Lifetime XP</th></tr></thead><tbody>
        ${me.characters.map((c) => `<tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.class)}</td>
          <td>${c.level}</td>
          <td>${c.lifetimeXp.toLocaleString()}</td>
        </tr>`).join('')}
       </tbody></table>`;

  const moderationHtml = me.moderation.locked
    ? `<div class="woc-error">Account locked: ${escapeHtml(me.moderation.message)}</div>`
    : me.moderation.chatMutedUntil
    ? `<div class="woc-error">Chat muted until ${escapeHtml(me.moderation.chatMutedUntil)}.</div>`
    : '<div class="woc-ok">Account in good standing.</div>';

  document.body.innerHTML = `
    <div class="woc-dash">
      <header class="woc-header">
        <h1>My Account — ${escapeHtml(getUserName())}</h1>
        <div class="woc-meta">
          ${roleChips.join(' ')}
          <span class="woc-dim">Realm: <strong>${escapeHtml(me.realm)}</strong></span>
          ${me.roles.isModerator ? '<a class="woc-link" href="/mod/">Moderator Tools</a>' : ''}
          ${me.roles.isAdmin ? '<a class="woc-link" href="/admin/">Admin</a>' : ''}
          <button id="signout" class="woc-link" type="button">Sign out</button>
        </div>
      </header>
      <section class="woc-card">
        <h2>Standing</h2>
        ${moderationHtml}
      </section>
      <section class="woc-card">
        <h2>Characters on ${escapeHtml(me.realm)}</h2>
        ${charsHtml}
      </section>
    </div>
  `;
  $('#signout').addEventListener('click', () => {
    clearSession();
    renderLoginShell();
  });
}

async function boot(): Promise<void> {
  if (!getToken()) { renderLoginShell(); return; }
  try {
    const me = await getMe();
    renderDashboard(me);
  } catch (err) {
    clearSession();
    renderLoginShell();
    if (err instanceof ApiError && err.status !== 401) {
      const e = document.getElementById('login-error');
      if (e) { e.hidden = false; e.textContent = err.message; }
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
  } else {
    void boot();
  }
}
