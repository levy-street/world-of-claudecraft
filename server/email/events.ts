// The transactional + marketing email event catalogue. Each event is a stable
// key (used as the email_log `event` and the template-catalog key) plus the
// shape of the data its template interpolates. Adding an event here forces a
// matching catalog entry (the email-i18n test guards completeness), so the type
// system and the test together keep templates and triggers in lockstep.

export type EmailCategory = 'transactional' | 'marketing';

// The seven product-level email reasons. `email_change` fans out into two
// rendered templates (a verify link to the new address and a security notice to
// the old one); every other reason maps to a single template of the same name.
export type EmailEvent =
  | 'account_created'
  | 'password_changed'
  | 'password_reset'
  | 'email_change_verify'
  | 'email_change_notice'
  | 'account_deleted'
  | 'data_export'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'security_incident'
  | 'generic';

// All template keys are the EmailEvent union. Kept as a separate alias so future
// non-event-driven templates can be added without widening EmailEvent.
export type EmailTemplateKey = EmailEvent;

// Per-event interpolation payloads. Values are plain strings so the catalog can
// stay host-agnostic (no Date/number formatting assumptions): callers format
// before handing data in.
export interface EmailData {
  account_created: { username: string };
  password_changed: { username: string };
  password_reset: { username: string; resetUrl: string };
  email_change_verify: { username: string; newEmail: string; verifyUrl: string };
  email_change_notice: { username: string; newEmail: string };
  account_deleted: { username: string };
  data_export: { username: string };
  two_factor_enabled: { username: string; recoveryCodeCount: string };
  two_factor_disabled: { username: string };
  security_incident: { username: string; action: string; reason: string; until: string };
  generic: { username: string; heading: string; body: string };
}

// The default language the server renders mail in when an account has no stored
// locale. English is always authored; other locales are filled by the
// maintainer at release time, mirroring the client i18n contributor rule.
export const DEFAULT_EMAIL_LOCALE = 'en';

// Default category per event. The six lifecycle events are strictly
// transactional and always delivered. `generic` defaults to 'marketing' so it is
// FAIL-CLOSED: a raw send with no explicit category is gated behind the opt-in
// rather than blasted to everyone. A transactional system notice via `generic`
// must opt in explicitly (the emailGeneric helper passes category:'transactional'
// when its marketing flag is false).
export const EVENT_CATEGORY: Record<EmailEvent, EmailCategory> = {
  account_created: 'transactional',
  password_changed: 'transactional',
  password_reset: 'transactional',
  email_change_verify: 'transactional',
  email_change_notice: 'transactional',
  account_deleted: 'transactional',
  data_export: 'transactional',
  two_factor_enabled: 'transactional',
  two_factor_disabled: 'transactional',
  security_incident: 'transactional',
  generic: 'marketing',
};
