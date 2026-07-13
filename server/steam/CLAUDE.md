# server/steam

Env-gated Steam integration: link-not-login account association plus the
deed-to-Steam achievement mirror. The registry entry point is `index.ts`, and it
exports `routes` ONLY; everything else imports the concrete module (`./config`
for the flag, `./mirror` for the observer), because the barrel drags `routes.ts`
into the importer's graph and breaks tests that partial-mock the db module.

## Why this exists where it does
Steam is a MIRROR, never an authority. The sim decides deed unlocks,
`server/deeds_records.ts` records them into `character_deeds`, and this
subsystem copies a linked account's unlocks outward through the publisher Web
API. Nothing here can grant, deny, or reorder a deed, and the 50 ms world loop
never awaits any of it.

## Layout
- `routes.ts` - three registry-only `RouteDef`s (no legacy-ladder twin, by
  design): `POST /api/steam/link` (verify + insert + reconcile), `DELETE
  /api/steam/link` (idempotent), `GET /api/steam/status`. The feature gate runs
  FIRST on every route (before auth); link attempts take `STEAM_LINK_POLICY`
  (`ip+account`, 5 per minute) since every allowed attempt is an upstream call.
- `ticket.ts` - pure (IO-free) helpers: the hex ticket shape clamp, the
  `AuthenticateUserTicket` / `SetUserStatsForGame` request builders, the
  verdict parse (the same pure-versus-fetch split
  `wallet_link.ts` keeps against `wallet.ts`).
- `web_api.ts` - the fetch shell: the ONE place server code talks to the Steam
  Web API (partner host, 5 s timeout, 'upstream' on any fault).
- `mirror.ts` - the push worker: per-process FIFO with in-flight dedupe,
  at-least-once delivery with capped retries, then DROP (reconcile-on-link
  heals any gap); a short-TTL link cache the routes overwrite synchronously.
- `achievement_map.ts` - deed id to `ACH_*` name, hard cap 100. A shipped ACH
  name is PERMANENT: entries may be added, never renamed or reused.
- `steam_db.ts` - the `steam_links` SQL boundary (DDL in `db.ts` SCHEMA):
  `account_id` PK, `steam_id` UNIQUE, plain INSERT (replacing a link is an
  explicit unlink-then-link, never an upsert).
- `config.ts` - the env gate, read LIVE per call (never a boot-time snapshot).

## Rules
- **Linking is allowed; LOGIN WITH STEAM DOES NOT EXIST.** Nothing here calls
  `newToken` or touches `auth_tokens`; a `steam_links` row is a cosmetic-mirror
  pointer, never an identity or credential source.
  `tests/server/steam_routes.test.ts` source-scans the directory for this.
- The client is never trusted to name its own Steam id: the server verifies
  the posted ticket upstream with the publisher key and takes the id from the
  verified response. VAC- and publisher-banned accounts are refused.
- Secrets: the publisher key rides only inside the request URL/body built by
  `ticket.ts`; never log a URL, a request body, or an upstream response body.
- Every push is fire-and-forget: a Steam outage must never fault or slow the
  deeds recorder or the game loop.

## Config
`STEAM_ENABLED=1` turns the surface on; default off, every route answers
`steam.disabled` and the mirror is inert. `STEAM_APP_ID` and
`STEAM_WEB_API_KEY` are read only when enabled and only inside this directory;
enabled without them, the link route answers `steam.upstream` and the mirror
drops with one warn line.
