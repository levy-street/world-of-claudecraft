/** Account login chrome shared by fresh logins, restores and session expiry. */
export function setAccountLoginChrome(loggedIn: boolean): void {
  for (const id of ['nav-item-account', 'nav-item-logout']) {
    const item = document.getElementById(id);
    if (item) item.hidden = !loggedIn;
  }
  const login = document.getElementById('nav-btn-login')?.closest<HTMLElement>('.nav-item');
  if (login) login.hidden = loggedIn;
  if (!loggedIn) {
    document.getElementById('discord-cta-banner')?.setAttribute('hidden', '');
    const discord = document.getElementById('discord-window');
    if (discord) discord.hidden = true;
  }
}
