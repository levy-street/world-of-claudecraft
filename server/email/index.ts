// Public surface of the email subsystem. main.ts / account.ts / admin.ts import
// ONLY from here. The singleton wires the env-selected transport to the shared
// audit log; the convenience helpers map each product event onto a fire-and-
// forget send so a mail hiccup never blocks the request that triggered it
// (matching the best-effort pattern register already uses for referral capture).
import { EmailService } from './service';
import { selectSender } from './sender';
import { recordEmailLog, type AccountMailTarget } from '../db';
import { makeEmailToken, hashEmailToken } from './tokens';

export { makeEmailToken, hashEmailToken } from './tokens';
export type { EmailEvent, EmailCategory } from './events';
export type { EmailSender, OutboundEmail } from './sender';
export { EmailService } from './service';

let singleton: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!singleton) {
    const sender = selectSender();
    singleton = new EmailService({
      sender,
      // Persist every attempt. The log write is itself best-effort: a logging
      // failure must not turn a delivered email into a thrown request error.
      log: (entry) => void recordEmailLog(entry).catch((err) => console.error('email_log write failed:', err)),
    });
    console.log(`[email] transport=${sender.name}`);
  }
  return singleton;
}

// Test seam: swap the singleton (e.g. for an in-memory sender) and restore.
export function __setEmailService(svc: EmailService | null): void {
  singleton = svc;
}

// Absolute base for links inside emails (verify, unsubscribe). Falls back to the
// public site so a missing env yields a real-looking link in dev rather than a
// relative one no mail client can open.
export function emailBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.EMAIL_BASE_URL || env.PUBLIC_BASE_URL || 'https://worldofclaudecraft.com').replace(/\/+$/, '');
}

export function emailChangeVerifyUrl(token: string, env?: NodeJS.ProcessEnv): string {
  return `${emailBaseUrl(env)}/api/account/email/verify?token=${encodeURIComponent(token)}`;
}

type Target = Pick<AccountMailTarget, 'id' | 'username' | 'email' | 'locale' | 'marketing_opt_in'>;

function fire(p: Promise<unknown>): void {
  void p.catch((err) => console.error('email send failed:', err));
}

export function emailAccountCreated(t: Target): void {
  fire(getEmailService().send({
    event: 'account_created', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username },
  }));
}

export function emailPasswordChanged(t: Target): void {
  fire(getEmailService().send({
    event: 'password_changed', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username },
  }));
}

// Double confirmation: a verify link to the NEW address AND a security notice to
// the OLD one, so an attacker who reaches an authenticated session still cannot
// silently swap the recovery email out from under the real owner.
export function emailEmailChangeRequested(t: Target, newEmail: string, verifyUrl: string): void {
  fire(getEmailService().send({
    event: 'email_change_verify', to: newEmail, locale: t.locale, accountId: t.id,
    data: { username: t.username, newEmail, verifyUrl },
  }));
  if (t.email) {
    fire(getEmailService().send({
      event: 'email_change_notice', to: t.email, locale: t.locale, accountId: t.id,
      data: { username: t.username, newEmail },
    }));
  }
}

export function emailAccountDeleted(t: Target): void {
  fire(getEmailService().send({
    event: 'account_deleted', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username },
  }));
}

export function emailDataExport(t: Target): void {
  fire(getEmailService().send({
    event: 'data_export', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username },
  }));
}

export function emailTwoFactorEnabled(t: Target, recoveryCodeCount: number): void {
  fire(getEmailService().send({
    event: 'two_factor_enabled', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username, recoveryCodeCount: String(recoveryCodeCount) },
  }));
}

export function emailTwoFactorDisabled(t: Target): void {
  fire(getEmailService().send({
    event: 'two_factor_disabled', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username },
  }));
}

export function emailSecurityIncident(
  t: Target,
  action: string,
  reason: string,
  until: string,
): void {
  fire(getEmailService().send({
    event: 'security_incident', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username, action, reason, until },
  }));
}

export function emailGeneric(t: Target, heading: string, body: string, marketing = false): void {
  fire(getEmailService().send({
    event: 'generic', to: t.email, locale: t.locale, accountId: t.id,
    data: { username: t.username, heading, body },
    category: marketing ? 'marketing' : 'transactional',
    marketingOptIn: t.marketing_opt_in,
  }));
}
