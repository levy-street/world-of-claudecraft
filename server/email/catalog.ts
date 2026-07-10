// Host-agnostic email string catalog. This is the one deliberate exception to
// the "server is language-agnostic" rule: emails have no client in the loop, so
// the server must render the final localized bytes itself. Strings live here as
// data (not `t()` calls) so the module pulls in no DOM and no client i18n stack.
//
// Contributors author ENGLISH only (the `en` block). The maintainer fills other
// locales at release; a missing locale transparently falls back to `en` (see
// renderEmail in templates.ts), so the product never ships an empty email.
import type { EmailTemplateKey } from './events';

export interface EmailTemplate {
  subject: string;
  // Plaintext body. The HTML body is derived from these blocks plus the
  // subject by the renderer, so each template only authors content once.
  text: string;
}

export type EmailCatalog = Record<string, Partial<Record<EmailTemplateKey, EmailTemplate>>>;

const BRAND = 'World of ClaudeCraft';

// English source of truth. {{placeholder}} tokens are filled from the event's
// EmailData payload. Keep copy plain: no em/en dashes or emoji (repo-wide ban).
const en: Record<EmailTemplateKey, EmailTemplate> = {
  account_created: {
    subject: `Welcome to ${BRAND}`,
    text:
      'Hi {{username}},\n\n' +
      `Your ${BRAND} account is ready. Log in any time to pick a class and start your adventure.\n\n` +
      'If you did not create this account, please reply to let us know.',
  },
  password_changed: {
    subject: `Your ${BRAND} password was changed`,
    text:
      'Hi {{username}},\n\n' +
      'Your account password was just changed and all other devices were signed out.\n\n' +
      'If this was not you, reset your password and contact support immediately.',
  },
  password_reset: {
    subject: `Reset your ${BRAND} password`,
    text:
      'Hi {{username}},\n\n' +
      'We received a request to reset your account password. Open this link to choose a new one:\n\n' +
      '{{resetUrl}}\n\n' +
      'The link expires soon and can be used once. If you did not request this, you can ignore this message; your password stays the same.',
  },
  email_change_verify: {
    subject: `Confirm your new ${BRAND} email`,
    text:
      'Hi {{username}},\n\n' +
      'Please confirm {{newEmail}} as the email for your account by opening this link:\n\n' +
      '{{verifyUrl}}\n\n' +
      'The link expires soon. If you did not request this, you can ignore this message.',
  },
  email_change_notice: {
    subject: `A change was requested for your ${BRAND} email`,
    text:
      'Hi {{username}},\n\n' +
      'Someone requested changing the email on your account to {{newEmail}}. The change only takes effect once that new address is confirmed.\n\n' +
      'If this was not you, change your password now: your account may be compromised.',
  },
  account_deleted: {
    subject: `Your ${BRAND} account was deactivated`,
    text:
      'Hi {{username}},\n\n' +
      'Your account has been deactivated and you have been signed out everywhere. You can ask an administrator to reactivate it later.\n\n' +
      'If you did not do this, contact support right away.',
  },
  data_export: {
    subject: `Your ${BRAND} data export`,
    text:
      'Hi {{username}},\n\n' +
      'You requested a copy of your account data. It was generated and returned to your browser as a JSON download.\n\n' +
      'If you did not request this, please contact support.',
  },
  two_factor_enabled: {
    subject: `Two-factor authentication is on for your ${BRAND} account`,
    text:
      'Hi {{username}},\n\n' +
      'Two-factor authentication was just turned on for your account. From now on, signing in needs a code from your authenticator app.\n\n' +
      'You also have {{recoveryCodeCount}} single-use recovery codes. Keep them somewhere safe: they are the only way back in if you lose your authenticator.\n\n' +
      'If you did not enable this, contact support immediately: your account may be compromised.',
  },
  two_factor_disabled: {
    subject: `Two-factor authentication is off for your ${BRAND} account`,
    text:
      'Hi {{username}},\n\n' +
      'Two-factor authentication was just turned off for your account, and any unused recovery codes were discarded.\n\n' +
      'If you did not do this, change your password now and turn two-factor authentication back on.',
  },
  security_incident: {
    subject: `Security notice for your ${BRAND} account`,
    text:
      'Hi {{username}},\n\n' +
      'A moderation action ({{action}}) was applied to your account.\n' +
      'Reason: {{reason}}\n' +
      'In effect until: {{until}}\n\n' +
      'Reply to this email if you believe this was a mistake.',
  },
  generic: {
    subject: '{{heading}}',
    text: 'Hi {{username}},\n\n{{body}}',
  },
};

export const CATALOG: EmailCatalog = {
  en,
  // Additional locales are filled by the maintainer at release time, e.g.:
  //   es: { ... }, fr: { ... }, de: { ... }
};

export { BRAND };
