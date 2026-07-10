// Public surface of the email subsystem. main.ts / account.ts / admin.ts import
// ONLY from here. The singleton wires the env-selected transport to the shared
// audit log; the convenience helpers map each product event onto a fire-and-
// forget send so a mail hiccup never blocks the request that triggered it
// (matching the best-effort pattern register already uses for referral capture).

import { type AccountMailTarget, recordEmailLog } from '../db';
import { logger } from '../http/logger';
import { selectSender } from './sender';
import { EmailService } from './service';
import { hashEmailToken, makeEmailToken } from './tokens';

export type { EmailCategory, EmailEvent } from './events';
export type { EmailSender, OutboundEmail } from './sender';
export { EmailService } from './service';
export { hashEmailToken, makeEmailToken } from './tokens';

let singleton: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!singleton) {
    const sender = selectSender();
    singleton = new EmailService({
      sender,
      // Persist every attempt. The log write is itself best-effort: a logging
      // failure must not turn a delivered email into a thrown request error.
      log: (entry) =>
        void recordEmailLog(entry).catch((err) => logger.error({ err }, 'email_log write failed')),
    });
    // Lazily reached on the first send, which happens INSIDE a request, so the
    // one-time banner goes through the logger (reqId + one JSON line), not console.
    logger.info({ transport: sender.name }, 'email transport selected');
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
  return (env.EMAIL_BASE_URL || env.PUBLIC_BASE_URL || 'https://worldofclaudecraft.com').replace(
    /\/+$/,
    '',
  );
}

export function emailChangeVerifyUrl(token: string, env?: NodeJS.ProcessEnv): string {
  return `${emailBaseUrl(env)}/api/account/email/verify?token=${encodeURIComponent(token)}`;
}

// Unlike the email-verify link (which hits a JSON API route), the reset link
// lands on the client page so the logged-out user can type a new password; the
// client reads the ?reset= token at load.
export function passwordResetUrl(token: string, env?: NodeJS.ProcessEnv): string {
  return `${emailBaseUrl(env)}/?reset=${encodeURIComponent(token)}`;
}

type Target = Pick<AccountMailTarget, 'id' | 'username' | 'email' | 'locale' | 'marketing_opt_in'>;

// Provider errors can quote the recipient address (for example SES's
// "Email address is not verified: a@b.com"), so scrub anything address-shaped
// before the message reaches the ops log. The full address is still available
// in the email_log audit table, which is the intended PII home.
const ADDRESS_RE = /[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+\.[^\s@<>,;:"'()[\]]+/g;

function scrubAddresses(text: string): string {
  return text.replace(ADDRESS_RE, '[email redacted]');
}

function fire(p: Promise<unknown>): void {
  void p.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: scrubAddresses(msg) }, 'email send failed');
  });
}

export function emailAccountCreated(t: Target): void {
  fire(
    getEmailService().send({
      event: 'account_created',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username },
    }),
  );
}

export function emailPasswordChanged(t: Target): void {
  fire(
    getEmailService().send({
      event: 'password_changed',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username },
    }),
  );
}

export function emailPasswordReset(t: Target, resetUrl: string): void {
  fire(
    getEmailService().send({
      event: 'password_reset',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username, resetUrl },
    }),
  );
}

// Double confirmation: a verify link to the NEW address AND a security notice to
// the OLD one, so an attacker who reaches an authenticated session still cannot
// silently swap the recovery email out from under the real owner.
export function emailEmailChangeRequested(t: Target, newEmail: string, verifyUrl: string): void {
  fire(
    getEmailService().send({
      event: 'email_change_verify',
      to: newEmail,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username, newEmail, verifyUrl },
    }),
  );
  if (t.email) {
    fire(
      getEmailService().send({
        event: 'email_change_notice',
        to: t.email,
        locale: t.locale,
        accountId: t.id,
        data: { username: t.username, newEmail },
      }),
    );
  }
}

export function emailAccountDeleted(t: Target): void {
  fire(
    getEmailService().send({
      event: 'account_deleted',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username },
    }),
  );
}

export function emailDataExport(t: Target): void {
  fire(
    getEmailService().send({
      event: 'data_export',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username },
    }),
  );
}

export function emailTwoFactorEnabled(t: Target, recoveryCodeCount: number): void {
  fire(
    getEmailService().send({
      event: 'two_factor_enabled',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username, recoveryCodeCount: String(recoveryCodeCount) },
    }),
  );
}

export function emailTwoFactorDisabled(t: Target): void {
  fire(
    getEmailService().send({
      event: 'two_factor_disabled',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username },
    }),
  );
}

export function emailSecurityIncident(
  t: Target,
  action: string,
  reason: string,
  until: string,
): void {
  fire(
    getEmailService().send({
      event: 'security_incident',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username, action, reason, until },
    }),
  );
}

export function emailGeneric(t: Target, heading: string, body: string, marketing = false): void {
  fire(
    getEmailService().send({
      event: 'generic',
      to: t.email,
      locale: t.locale,
      accountId: t.id,
      data: { username: t.username, heading, body },
      category: marketing ? 'marketing' : 'transactional',
      marketingOptIn: t.marketing_opt_in,
    }),
  );
}
