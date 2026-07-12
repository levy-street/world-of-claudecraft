# server/email

Transactional + marketing email subsystem. Entry point is `index.ts`; nothing
outside imports the other files directly.

## Why this exists where it does
Emails are the one place `server/` renders final localized player-facing text
itself. Everywhere else `server/` emits English literals and the *client*
re-localizes (`src/ui/server_i18n.ts`); an email has no client in the loop, so it
must be rendered server-side. That is why `catalog.ts` holds strings as data (not
`t()`), and why the account row carries a `locale` column to pick the language.

## Layout
- `catalog.ts` - host-agnostic string catalog. **Contributors author `en` only**;
  the maintainer fills other locales at release, and a missing locale falls back to
  `en` so mail is never blank.
- `templates.ts` - pure `renderEmail(event, locale, data)`: no I/O, no DOM, no Date.
- `sender.ts` - delivery seam: `ConsoleSender` (dev default, no env), `HttpSender`
  (`fetch` POST), `SesSender`. `selectSender(env)` picks one: `EMAIL_PROVIDER=ses`
  wins (needs `EMAIL_SES_REGION` or `AWS_REGION` plus `EMAIL_FROM`); else
  `EMAIL_API_URL` + `EMAIL_API_KEY` + `EMAIL_FROM` picks `HttpSender`; anything
  missing falls back to `ConsoleSender`.
- `ses_sender.ts` - `SesSender`: AWS SES v2, lazily imports `@aws-sdk/client-sesv2`
  so the dependency loads only when SES is selected.
- `service.ts` - `EmailService` (render + marketing-gate + deliver + audit-log),
  **never throws**. Unit-tested against a fake sender.
- `events.ts` - the email events; adding one forces a matching `en` catalog entry
  (guarded by `tests/email_templates.test.ts`).
- `tokens.ts` - pure random-token + SHA-256 helpers (change-email, unsubscribe,
  password reset).

## Rules
- Every send is fire-and-forget; a mail outage must never break the HTTP request
  that triggered it (mirrors register's best-effort referral capture).
- Transactional events always send; only `generic` may be `marketing`, and
  marketing is dropped unless the account's `marketing_opt_in` is true.
- Store only token *hashes* in the DB (`email_change_requests.token_hash`,
  `password_reset_requests.token_hash`; `accounts.unsubscribe_token` is a
  capability token); the raw token only ever travels in the email link.

## Config
The email env vars are all optional; absent = `ConsoleSender`, nothing leaves the
box (see `selectSender`).
