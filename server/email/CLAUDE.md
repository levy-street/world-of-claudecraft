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
- `events.ts` - the 7 email events, their interpolation payloads, default
  categories. Adding an event forces a matching `en` catalog entry (guarded by
  `tests/email_templates.test.ts`).
- `catalog.ts` - host-agnostic string catalog. **Contributors author `en` only.**
  The maintainer fills other locales at release; a missing locale falls back to
  `en` so mail is never blank.
- `templates.ts` - pure `renderEmail(event, locale, data) -> {subject, html, text}`.
  No I/O, no DOM, no Date.
- `tokens.ts` - pure random-token + SHA-256 helpers (change-email, unsubscribe).
- `sender.ts` - the delivery seam. `ConsoleSender` (dev default, no env) and
  `HttpSender` (provider-agnostic `fetch` POST). `selectSender(env)` picks one.
- `service.ts` - `EmailService`: render + marketing-gate + deliver + audit-log,
  **never throws**. Unit-tested against a fake sender.
- `index.ts` - singleton wiring + fire-and-forget convenience helpers the routes
  call.

## Rules
- Every send is fire-and-forget; a mail outage must never break the HTTP request
  that triggered it (mirrors register's best-effort referral capture).
- Transactional events always send; only `generic` may be `marketing`, and
  marketing is dropped unless the account's `marketing_opt_in` is true.
- Store only token *hashes* in the DB (`email_change_requests.token_hash`,
  `accounts.unsubscribe_token` is a capability token); the raw token only ever
  travels in the email link.

## Config (env, all optional; absent = ConsoleSender, nothing leaves the box)
`EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM` (all three required for real
delivery), `EMAIL_BASE_URL` / `PUBLIC_BASE_URL` (absolute base for links).
