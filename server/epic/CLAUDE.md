# server/epic

Env-gated Epic Games Store integration: link-not-login account association plus
the deed-to-Epic achievement mirror. This is the Epic arm of the shared
storefront-mirror pattern, and `server/steam/CLAUDE.md` is the canonical
description of that pattern (mirror-never-authority, `index.ts` exports `routes`
ONLY, feature gate FIRST before auth, fire-and-forget push worker with capped
retries then DROP, server-verified id, secrets never logged, config read LIVE
per call, registry-only routes with no legacy-ladder twin). The layout mirrors
steam's file for file (`routes.ts` / `ticket.ts` / `web_api.ts` / `mirror.ts` /
`achievement_map.ts` / `epic_db.ts` / `config.ts`); this file covers only what
Epic does differently.

## Epic deltas

- **Routes**: `POST /api/epic/link` (verify + insert/displace + reconcile),
  `DELETE /api/epic/link` (idempotent), `GET /api/epic/status`; link attempts
  take `EPIC_LINK_POLICY` (`ip+account`, 5 per minute).
- **Proof chain, not a hex ticket.** The desktop shell mints a non-empty
  STRING proof (preferred: the Epic Games Launcher exchange code from argv;
  an EOS adapter may mint an id-token style string later). The server
  shape-clamps it (charset + length), verifies it upstream via the Auth Web
  API `exchange_code` grant with the confidential client secret (`ticket.ts`
  builds the requests pure and IO-free; `web_api.ts` is the ONE fetch shell
  for Epic Auth / Connect / Stats, official host, 5 s timeout), and takes the
  Epic account id from the VERIFIED token response, never from the client.
- **Reclaim by proof.** If the verified Epic id is already linked to another
  WoCC account, `displaceEpicLink` (`epic_db.ts`) displaces the old row in ONE
  transaction: fresh verified control wins over a stale (possibly stolen)
  link. Otherwise steam's plain-INSERT semantics hold (replacing a link is an
  explicit unlink-then-link, never an upsert; `account_id` PK,
  `epic_account_id` UNIQUE, DDL in `db.ts` SCHEMA).
- **Unlock push (O2) negative rules.** Unlocks travel the server-trusted
  Connect + Stats Achievements Web API path (request shapes are in
  `ticket.ts`/`web_api.ts`): NEVER client-reported unlocks, and NEVER a native
  EOS SDK process in Node. Reconcile-on-login runs beside reconcile-on-link,
  so a dropped push heals at the next join.
- **`achievement_map.ts`**: deed id to permanent Epic achievement id
  (`ACH_*`), hard cap 100 (D14). The launch set matches the Steam map's deed
  set (same ACH vocabulary for portal authoring); a shipped id may be added,
  never renamed or reused.
- **Login with Epic DOES NOT EXIST.** Nothing here calls `newToken` or touches
  `auth_tokens`; an `epic_links` row is a cosmetic-mirror pointer, never a
  credential source. `tests/server/epic_routes.test.ts` source-scans the
  directory for this, and its scan INCLUDES `achievement_map.ts`.

## Observer wiring (D21, direct imports, not the barrel)

- `server/deeds_records.ts` calls epic `onDeedRecorded` beside steam after
  each `character_deeds` upsert (the dual fan-out).
- `server/game.ts` calls epic `reconcileOnLogin` beside steam after
  `deedRecordsIdle` on join.
- `server/main.ts` awaits `stopEpicMirror` beside `stopSteamMirror` on
  shutdown.
- Steam and Epic are independent: an Epic outage must never fault or slow the
  deeds recorder, the game loop, or the Steam mirror.

## Config

`EPIC_ENABLED=1` turns the surface on; default off, every route answers
`epic.disabled` and the mirror is inert. `EPIC_PRODUCT_ID`,
`EPIC_DEPLOYMENT_ID`, `EPIC_CLIENT_ID`, and `EPIC_CLIENT_SECRET` are required
when enabled for link verification and unlock push; `EPIC_SANDBOX_ID` is
optional. Enabled without client/deployment credentials, the link route
answers `epic.upstream` and the mirror drops with one warn line.
