# server/epic

Env-gated Epic Games Store integration: link-not-login account association plus
the deed-to-Epic achievement mirror. The registry entry point is `index.ts`, and
it exports `routes` ONLY; everything else imports the concrete module
(`./config` for the flag, `./mirror` for the observer), because the barrel drags
`routes.ts` into the importer's graph and breaks tests that partial-mock the db
module.

## Why this exists where it does
Epic is a MIRROR, never an authority. The sim decides deed unlocks,
`server/deeds_records.ts` records them into `character_deeds`, and this
subsystem copies a linked account's unlocks outward through the server-trusted
Connect + Stats Achievements Web API path (O2). Nothing here can grant, deny,
or reorder a deed, and the 50 ms world loop never awaits any of it.

## Layout
- `routes.ts` - three registry-only `RouteDef`s (no legacy-ladder twin, by
  design): `POST /api/epic/link` (verify + insert/displace + reconcile),
  `DELETE /api/epic/link` (idempotent), `GET /api/epic/status`. The feature
  gate runs FIRST on every route (before auth); link attempts take
  `EPIC_LINK_POLICY` (`ip+account`, 5 per minute).
- `ticket.ts` - pure (IO-free) helpers: the proof shape clamp, the Auth Web API
  `exchange_code` token request builder, the success/error verdict parse, and
  the O2 unlock builders (client_credentials token, external-account mapping,
  Stats Achievements unlock request). Same pure-versus-fetch split as
  `server/steam/ticket.ts`.
- `web_api.ts` - the fetch shell: the ONE place server code talks to Epic Auth /
  Connect / Stats Web APIs (official host, 5 s timeout, 'upstream' or false on
  any network or server fault). Never logs URL/body/Authorization (client secret
  rides in form body or Basic header; client access token rides in Bearer).
- `mirror.ts` - the push worker: per-process FIFO with in-flight dedupe,
  at-least-once delivery with capped retries, then DROP (reconcile-on-link and
  reconcile-on-login heal any gap); a short-TTL link cache the routes overwrite
  synchronously. Injectable deps for tests.
- `achievement_map.ts` - deed id to permanent Epic achievement id (`ACH_*`),
  hard cap 100 (D14). Launch set matches the Steam map's deed set (same ACH
  vocabulary for portal authoring). A shipped id may be added, never renamed
  or reused.
- `epic_db.ts` - the `epic_links` SQL boundary (DDL in `db.ts` SCHEMA):
  `account_id` PK, `epic_account_id` UNIQUE, plain INSERT (replacing a link is
  an explicit unlink-then-link, never an upsert). Reclaim-by-proof uses
  `displaceEpicLink` in one transaction.
- `config.ts` - the env gate, read LIVE per call (never a boot-time snapshot).

## Trust chain (link proof)
1. Desktop shell mints a non-empty **string** proof for `POST /api/epic/link
   { proof }` (preferred: Epic Games Launcher exchange code from argv
   `AUTH_TYPE=exchangecode` + `AUTH_PASSWORD`; optional EOS adapter may mint
   an id-token style string later).
2. Server shape-clamps the proof (charset + length), never trusts a
   client-supplied Epic account id.
3. Server POSTs `grant_type=exchange_code` to
   `https://api.epicgames.dev/epic/oauth/v2/token` with `exchange_code`,
   `deployment_id`, `client_id`, and `client_secret` (confidential client).
4. Epic responds with `account_id`; that becomes `epic_links.epic_account_id`.
5. If that Epic id is already linked to another WoCC account, **reclaim by
   proof**: displace the old row (`displaceEpicLink`). Fresh verified control
   wins over a stale (possibly stolen) link.
6. An `epic_links` row is a cosmetic-mirror pointer only. It is never used to
   mint `auth_tokens` or any session.

## Achievement unlock path (O2, server-trusted)
1. Client access token: `POST https://api.epicgames.dev/auth/v1/oauth/token`
   with `grant_type=client_credentials` (Basic `clientId:clientSecret`).
2. Map linked Epic account id to product user id:
   `GET https://api.epicgames.dev/user/v1/accounts?accountId=...&identityProviderId=epicgames`
   (response field: `ids` map).
3. Batch unlock:
   `POST https://api.epicgames.dev/stats/v1/{deploymentId}/players/{productUserId}/achievements/unlock`
   body `{ achievementIds: string[] }` (portal achievement ids from
   `achievement_map.ts`).
4. Never client-reported unlocks. Never a native EOS SDK process in Node.

## Observer wiring (direct imports, not the barrel)
- `server/deeds_records.ts` calls epic `onDeedRecorded` beside steam after each
  character_deeds upsert (D21 dual fan-out).
- `server/game.ts` calls epic `reconcileOnLogin` beside steam after
  `deedRecordsIdle` on join.
- `server/main.ts` awaits `stopEpicMirror` beside `stopSteamMirror` on
  shutdown.

## Rules
- **Linking is allowed; LOGIN WITH EPIC DOES NOT EXIST.** Nothing here calls
  `newToken` or touches `auth_tokens`; an `epic_links` row is a cosmetic-mirror
  pointer, never an identity or credential source.
  `tests/server/epic_routes.test.ts` source-scans the directory for this
  (includes `achievement_map.ts`).
- The client is never trusted to name its own Epic id: the server verifies
  the posted proof upstream with the client secret and takes the id from the
  verified token response (`account_id`).
- Secrets: the client secret rides only inside request builders; never log a
  URL, a request body, an Authorization header, or an upstream response body.
- Every push is fire-and-forget: an Epic outage must never fault or slow the
  deeds recorder or the game loop. Steam and Epic are independent (D21).

## Config
`EPIC_ENABLED=1` turns the surface on; default off, every route answers
`epic.disabled` and the mirror is inert. `EPIC_PRODUCT_ID`,
`EPIC_DEPLOYMENT_ID`, `EPIC_CLIENT_ID`, and `EPIC_CLIENT_SECRET` are required
when enabled for link verification and unlock push; `EPIC_SANDBOX_ID` is
optional. Enabled without client/deployment credentials, the link route
answers `epic.upstream` and the mirror drops with one warn line.
