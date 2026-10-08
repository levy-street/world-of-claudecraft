// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { setAccountLoginChrome } from '../src/ui/account_login_chrome_controller';

describe('account login chrome', () => {
  beforeEach(() => {
    document.body.innerHTML = `<li class="nav-item"><button id="nav-btn-login"></button></li>
      <li id="nav-item-account" hidden></li><li id="nav-item-logout" hidden></li>
      <div id="discord-cta-banner"></div><div id="discord-window"></div>`;
  });
  it('shows account actions after login and restores login navigation on logout', () => {
    setAccountLoginChrome(true);
    expect(document.getElementById('nav-item-account')?.hidden).toBe(false);
    expect(document.getElementById('nav-item-logout')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.nav-item')?.hidden).toBe(true);
    setAccountLoginChrome(false);
    expect(document.getElementById('nav-item-account')?.hidden).toBe(true);
    expect(document.getElementById('nav-item-logout')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.nav-item')?.hidden).toBe(false);
    expect(document.getElementById('discord-cta-banner')?.hidden).toBe(true);
    expect(document.getElementById('discord-window')?.hidden).toBe(true);
  });
  it('allows the focused play entry without homepage navigation', () => {
    document.body.innerHTML = '';
    expect(() => setAccountLoginChrome(true)).not.toThrow();
    expect(() => setAccountLoginChrome(false)).not.toThrow();
  });
});
