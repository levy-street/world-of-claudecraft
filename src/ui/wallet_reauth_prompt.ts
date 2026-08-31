// The wallet-change re-authorization prompt (the client arm of the R11 relink
// gate, server/wallet_reauth.ts): once an account has a linked wallet,
// marketplace sale proceeds pay to it, so CHANGING or REMOVING the link asks
// the player to prove the account with their password (plus the second factor
// when one is enrolled) before the request is sent. The server is the
// authority; this prompt only collects the proof up front, because a refused
// attempt has already consumed the single-use link challenge and would force a
// second wallet signature.
//
// Pure decision cores up top (a Vitest drives them directly); the DOM modal is
// a thin painter over the shared confirm-modal family (index.html exemplars:
// the recovery-email and delete-character modals).

import type { WalletReauthProof } from '../net/online';
import { userFacingApiError } from './api_error_i18n';
import type { FocusManager } from './focus_manager';
import { t } from './i18n';
import { classifyAuthCode } from './two_factor_setup';

/** Re-exported so consumers and tests share the net-layer type (a UI_DOM_MODULES
 *  entry may import net types; keeping one source of truth kills mirror drift). */
export type { WalletReauthProof } from '../net/online';

export interface WalletReauthAccountShape {
  twoFactorEnabled: boolean;
  passwordSet: boolean;
}

export type WalletReauthMode = 'relink' | 'unlink';

export type WalletReauthPlan =
  | { kind: 'password'; showTwoFactor: boolean }
  | { kind: 'no_password' };

/** Decide what the prompt asks for. A null account (the info read failed) still
 *  shows the full form: the server re-checks everything and its coded refusal
 *  localizes precisely, so the read is a UX hint, never a gate. */
export function walletReauthPlan(account: WalletReauthAccountShape | null): WalletReauthPlan {
  if (!account) return { kind: 'password', showTwoFactor: true };
  if (!account.passwordSet) return { kind: 'no_password' };
  return { kind: 'password', showTwoFactor: account.twoFactorEnabled };
}

/** True when the flow is CHANGING an existing link (re-auth applies): a wallet
 *  is linked and the incoming address differs. First links stay prompt-free. */
export function needsWalletReauth(currentPubkey: string | null, nextAddress: string): boolean {
  return Boolean(currentPubkey) && currentPubkey !== nextAddress;
}

/** Assemble the request proof from the form fields. The one second-factor
 *  field serves both shapes exactly like the login form: classifyAuthCode
 *  splits a 6-digit TOTP entry from a recovery code. */
export function buildWalletReauthProof(password: string, secondFactor: string): WalletReauthProof {
  const factor = secondFactor.trim()
    ? classifyAuthCode(secondFactor)
    : { code: '', recoveryCode: '' };
  return {
    password,
    ...(factor.code ? { totp: factor.code } : {}),
    ...(factor.recoveryCode ? { recoveryCode: factor.recoveryCode } : {}),
  };
}

/** Player text for a failed wallet change: a reauth-coded refusal (or the
 *  shared lockout identity the throttled arm answers with) renders its own
 *  precise message; anything else keeps the flow's generic fallback. */
export function walletChangeErrorText(err: unknown, fallback: string): string {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  if (
    typeof code === 'string' &&
    (code.startsWith('wallet.reauth_') || code === 'auth.too_many_failed_attempts')
  ) {
    return userFacingApiError(err);
  }
  return fallback;
}

/** Read the account shape, then prompt. The read rides a caller-supplied
 *  thunk (structurally api.getAccount) so this module stays net-free; the
 *  prompt is injectable so a Vitest can drive the failed-read branch DOM-free. */
export async function acquireWalletReauth(
  readAccount: () => Promise<WalletReauthAccountShape>,
  mode: WalletReauthMode,
  focusManager: FocusManager,
  prompt: typeof promptWalletReauth = promptWalletReauth,
): Promise<WalletReauthProof | null> {
  const account = await readAccount().catch(() => null);
  return prompt(walletReauthPlan(account), mode, focusManager);
}

/** Show the modal; resolves the collected proof, or null on cancel (and always
 *  null on the no-password plan, whose only action is acknowledging it). */
export function promptWalletReauth(
  plan: WalletReauthPlan,
  mode: WalletReauthMode,
  focusManager: FocusManager,
): Promise<WalletReauthProof | null> {
  return new Promise((resolve) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.id = 'wallet-reauth-modal';

    const panel = document.createElement('div');
    panel.className = 'confirm-modal panel auth-panel-premium';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'wallet-reauth-title');

    const title = document.createElement('h2');
    title.id = 'wallet-reauth-title';
    title.textContent = mode === 'unlink' ? t('wallet.reauthUnlinkTitle') : t('wallet.reauthTitle');

    const help = document.createElement('p');
    help.textContent =
      plan.kind === 'no_password' ? t('wallet.reauthNoPassword') : t('wallet.reauthHelp');

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    let settled = false;
    const finish = (proof: WalletReauthProof | null): void => {
      if (settled) return;
      settled = true;
      back.remove();
      focusHandle.release(true);
      resolve(proof);
    };

    panel.append(title, help);

    if (plan.kind === 'no_password') {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn btn-primary';
      close.textContent = t('wallet.reauthClose');
      close.addEventListener('click', () => finish(null));
      actions.appendChild(close);
      panel.appendChild(actions);
      // Move focus INTO the dialog: without it the trap never engages and
      // Escape never reaches the backdrop listener.
      queueMicrotask(() => close.focus());
    } else {
      const passwordField = document.createElement('div');
      passwordField.className = 'auth-field';
      const passwordLabel = document.createElement('label');
      passwordLabel.className = 'auth-label';
      passwordLabel.htmlFor = 'wallet-reauth-password';
      passwordLabel.textContent = t('auth.password');
      const password = document.createElement('input');
      password.id = 'wallet-reauth-password';
      password.type = 'password';
      password.autocomplete = 'current-password';
      passwordField.append(passwordLabel, password);
      panel.appendChild(passwordField);

      let factor: HTMLInputElement | null = null;
      if (plan.showTwoFactor) {
        const factorField = document.createElement('div');
        factorField.className = 'auth-field';
        const factorLabel = document.createElement('label');
        factorLabel.className = 'auth-label';
        factorLabel.htmlFor = 'wallet-reauth-factor';
        factorLabel.textContent = t('auth.twoFactorLabel');
        factor = document.createElement('input');
        factor.id = 'wallet-reauth-factor';
        factor.type = 'text';
        factor.autocomplete = 'one-time-code';
        factor.placeholder = t('auth.twoFactorPlaceholder');
        factorField.append(factorLabel, factor);
        panel.appendChild(factorField);
      }

      const error = document.createElement('div');
      error.className = 'auth-error';
      error.setAttribute('aria-live', 'polite');
      panel.appendChild(error);

      const submit = (): void => {
        if (!password.value) {
          error.textContent = t('auth.passwordError');
          password.focus();
          return;
        }
        finish(buildWalletReauthProof(password.value, factor?.value ?? ''));
      };
      const onEnter = (e: KeyboardEvent): void => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      };
      password.addEventListener('keydown', onEnter);
      factor?.addEventListener('keydown', onEnter);

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-secondary';
      cancel.textContent = t('wallet.reauthCancel');
      cancel.addEventListener('click', () => finish(null));
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'btn btn-primary';
      confirm.textContent = t('wallet.reauthConfirm');
      confirm.addEventListener('click', submit);
      actions.append(cancel, confirm);
      panel.appendChild(actions);
      queueMicrotask(() => password.focus());
    }

    back.addEventListener('click', (e) => {
      if (e.target === back) finish(null);
    });
    back.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    });
    back.appendChild(panel);
    document.body.appendChild(back);
    // The shared trap: Tab cycles inside the panel, and close returns focus to
    // the control that opened the flow (the mobile_wallet_launcher exemplar).
    const focusHandle = focusManager.open({ root: () => panel, returnFocusTo: opener });
  });
}
