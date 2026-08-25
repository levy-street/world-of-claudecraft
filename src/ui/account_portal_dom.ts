// Thin DOM rendering for the home-page account portal (a static marketing-shell
// form, not part of the in-game Hud/PainterHost per-frame family: named without
// a *_painter/*_window/*_controller suffix on purpose so it is not swept into
// that gate). Pairs with the pure account_portal.ts model: every function here
// only paints/toggles nodes from a model or a plain boolean, and owns no state
// of its own. main.ts still wires the form submit handlers (those need the net
// Api this module deliberately never imports) and calls these instead of
// touching the account-portal DOM directly.

import type { AccountPortalModel } from './account_portal';
import { formatDateTime, formatNumber, type TranslationKey, t } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

export function setAccountFieldMsg(sel: string, text: string, ok: boolean): void {
  const el = $(sel);
  el.textContent = text;
  el.classList.toggle('is-error', !ok && text !== '');
  el.classList.toggle('is-ok', ok && text !== '');
}

// Reflect the account's 2FA state: when enabled, only the password-gated disable
// form shows; when disabled, only the "Set Up" entry point. The transient setup
// and recovery panes always reset to hidden so re-opening the portal is clean.
export function paintTwoFactorStatus(enabled: boolean): void {
  const setText = (sel: string, key: TranslationKey) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key);
  };
  setText(
    '#account-2fa-status',
    enabled ? 'hudChrome.account.twoFactorStatusOn' : 'hudChrome.account.twoFactorStatusOff',
  );
  const show = (sel: string, visible: boolean) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.hidden = !visible;
  };
  show('#account-2fa-setup-btn', !enabled);
  show('#account-2fa-begin-form', false);
  show('#account-2fa-setup', false);
  show('#account-2fa-recovery', false);
  show('#account-2fa-disable-form', enabled);
  const msg = document.getElementById('account-2fa-msg');
  if (msg) {
    msg.textContent = '';
    msg.className = 'auth-field-msg';
  }
}

// Reflect whether the account has a real, owner-chosen password: an Apple- or
// Discord-provisioned account (passwordSet:false) sees "Set a Password" instead
// of "Change Password" (there is no current password to re-verify), until it
// sets one and the portal reloads into the ordinary state.
export function paintPasswordSetStatus(passwordSet: boolean): void {
  const show = (sel: string, visible: boolean) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.hidden = !visible;
  };
  show('#account-password-form', passwordSet);
  show('#account-set-password-form', !passwordSet);
}

export function paintAccountPortal(
  model: AccountPortalModel,
  // When the account fetch failed transiently we re-render the shell but must
  // NOT clobber an already-populated email field: a blank value would otherwise
  // be submitted as a null email update on the next save.
  preserveEmailInput = false,
  twoFactorEnabled = false,
  // Fail-safe default: on a transient error (see the caller) assume a real
  // password already exists, so a network blip never paints the "no password"
  // Set-a-Password state over an ordinary account.
  passwordSet = true,
): void {
  // The account portal lives only in index.html; focused entries such as
  // play.html omit it, so there is nothing to paint (token revalidation and the
  // nav chrome in loadAccountPortal still run).
  const loggedOut = document.getElementById('account-logged-out') as HTMLElement | null;
  if (!loggedOut) return;
  loggedOut.hidden = model.loggedIn;
  $('#account-sections').hidden = !model.loggedIn;
  if (model.loggedIn) {
    paintTwoFactorStatus(twoFactorEnabled);
    paintPasswordSetStatus(passwordSet);
  }
  $('#account-username').textContent = model.header.username;
  const since = $('#account-member-since');
  since.textContent = model.header.memberSinceIso
    ? t('hudChrome.account.memberSince', {
        date: formatDateTime(new Date(model.header.memberSinceIso), {
          dateStyle: 'medium',
        }),
      })
    : '';
  $('#account-char-count').textContent = t('hudChrome.account.charactersCount', {
    count: formatNumber(model.header.characterCount),
  });
  if (!preserveEmailInput) ($('#account-email') as HTMLInputElement).value = model.email;
}
