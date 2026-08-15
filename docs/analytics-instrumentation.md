# UA analytics instrumentation

The user-acquisition measurement surface added for the August 2026 UA program:
what is captured, where it lands, and the operational knobs. The motivating
findings live in the maintainer's UA deep-dive report (13 Aug 2026): paid and
organic cohorts could not be separated, churn inside the first ten minutes was
invisible, and no spend data existed server-side.

## What is captured, where

| Signal | Storage | Written by |
|---|---|---|
| First-touch attribution (fbclid, utm tags, landing URL, referrer, visitor id, fbp/fbc cookies) | `account_attribution` (one row per account, first write wins) | `server/signup_attribution.ts` via both register arms; client capture in `src/attribution.ts` (write-once localStorage) |
| Signup locale | `accounts.locale` | client-selected language, else Accept-Language |
| Signup country | `accounts.created_country` | trusted edge geo header (`GEOIP_COUNTRY_HEADER`, default `cf-ipcountry`) |
| Marketing email opt-in | `accounts.marketing_opt_in` | the explicit register-form checkbox (never pre-ticked) |
| Every level-up | `level_up_events` | `server/progress_events.ts` observer at the game event drain |
| New-player quest accepts/turn-ins and deaths (level, zone, killer), levels 1-10 | `ftue_events` | same observer |
| Ad spend (hand-entered per day and campaign, integer cents) | `ad_spend` | `POST /admin/api/ad-spend` (see below) |
| D7-retained once-guard | `accounts.d7_capi_sent_at` | `server/ua_capi_db.ts` atomic claim |

## Meta Conversions API events

`server/meta_capi.ts` sends, all fire-and-forget and disabled without
`META_CAPI_ACCESS_TOKEN`:

- `AccountCreated` (both register arms; event id `acct_<accountId>`, deduped
  against the browser pixel's matching eventID)
- `ReachedLevel2` (event id `lvl2_<characterId>`): fires inside the first
  session for most players, roughly 3.4x the volume of level 5; intended as
  the campaign optimization event at current budgets
- `ReachedLevel5` (event id `lvl5_<characterId>`): the quality backstop
- `D7Retained` (event id `d7_<accountId>`): once per account, first session
  opened during day seven after signup; for per-campaign quality reporting in
  Ads Manager, not optimization

Every event carries the signup email as a SHA-256 hash (`server/ua_capi.ts`
enrichment) for event match quality. The browser pixel snippet exists only in
`index.html`; signups completed on `/play` fire CAPI only (a known gap, noted
here so nobody chases a pixel/CAPI mismatch).

## The ad-spend ledger

`GET /admin/api/ad-spend?days=N` lists the trailing window (permission
`analytics.read`); `POST /admin/api/ad-spend` upserts one
`{ day, campaign, spendCents, impressions?, clicks?, currency? }` row and
`POST /admin/api/ad-spend/delete` removes one (both `analytics.manage`).
Re-entering a row replaces it, so corrections are just re-entry. A Meta
Marketing API import job can later write through the same upsert without a
schema change.

## Retention and ops knobs

- `LEVEL_UP_EVENTS_RETENTION_DAYS` / `FTUE_EVENTS_RETENTION_DAYS` (default
  365; 0 keeps forever) ride the nightly retention sweep.
- `PERF_REPORT_RETENTION_DAYS`: production should run at least 90 (the
  device/FPS versus early-retention correlation needs a month or more of
  history; the old 14-day suggestion silently discarded it).
- `GEOIP_COUNTRY_HEADER`: only point at a header a trusted edge injects and
  strips from client requests; empty disables the read.
- `ad_spend` and `account_attribution` are deliberately keep-forever: both are
  small and are the longitudinal record the cohort reports join against.
- Off-host dump archiving (operational, not in this repo): the pre-deploy and
  nightly `pg_dump` files in `/var/backups/eastbrook` rotate away within
  weeks; July 2026 history is already unrecoverable. Archive one dump per week
  to durable storage (S3 or R2) from the host cron so longitudinal cohort
  analysis stays possible. Tracked in the deploy repo.

## Reading it back (the next UA report)

Paid versus organic: join cohorts to `account_attribution` on `account_id`
(`utm_campaign` / `fbclid` presence separates paid). CAC math: join weekly
signup or milestone counts against `ad_spend`. Per-level friction:
`level_up_events` timestamps per account. First-session autopsy:
`ftue_events` kinds `quest_accepted` / `quest_done` / `death` for the level
1-10 window, joined against `play_sessions`.
