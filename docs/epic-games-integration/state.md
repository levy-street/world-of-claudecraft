# State: Epic Games Store integration

Status: **code complete, dark by default.** Packet implementation and close QA
are done; the dark surface ships via PR 2709. Live portal, BPT, Dev smoke,
and production lighting are ops:

- https://github.com/levy-street/world-of-claudecraft/issues/2708

Locked decisions below override ad-hoc invention. Companion runbooks:
`portal-checklist.md`, `bpt-upload.md`, `docs/desktop-release.md`, `DEPLOY.md`.

## Locked decisions

- **D1 Steam-shaped channel.** Epic is a third `wocDesktop.distribution` value
  (`website` | `steam` | `epic`). Same Electron codebase. No second game client.
- **D2 No login with Epic.** Identity stays email + Discord only. An `epic_links`
  row is a cosmetic mirror pointer for achievements (and optional future ownership
  checks), never an identity or session source. Source-scan tests pin this the way
  Steam does.
- **D3 Merge-safe dark default.** `EPIC_ENABLED` is off unless exactly `1`. With
  the flag off: every `/api/epic/*` route answers `epic.disabled`, the mirror is
  inert, `/api/status` advertises `epic: { enabled: false }`, and no client
  renders Epic link UI. Missing product id, deployment id, or client credentials
  never break server boot, website builds, steam builds, or the default test/CI
  gate.
- **D4 Updater off on epic.** `updaterAllowed` is true only for packaged
  `website`. Epic builds force publish null and never self-update (Epic BPT owns
  patches), same hard rule as Steam.
- **D5 Wallet closed on epic.** `walletConnectionSupported` stays website-only
  until a later product decision. Epic follows Steam here.
- **D6 Platforms for EGS v1.** Windows + macOS only. Linux stays website + Steam.
  Do not add a Linux epic depot, target, or store claim.
- **D7 Packaging shape.** Epic channel builds use electron-builder `dir` targets
  into `release-epic/` (mac universal `.app`, win x64 unpacked). Never upload
  NSIS/DMG/AppImage as the Epic store binary. Website installers stay website-only.
- **D8 Native EOS isolation.** EOS C SDK (or its thin adapter) ships only on the
  epic channel package (`files` + `asarUnpack`), never on website or steam
  artifacts. Unpackaged dev uses `WOC_EPIC_DEV=1` (and optional id env overrides)
  the way `WOC_STEAM_DEV=1` works. Packaged builds ignore runtime env for channel.
- **D9 Thin shell surface.** `electron/epic.cjs` is the ONLY desktop Epic surface:
  capability probe + mint link proof + settle/cancel cleanup. Injectable loader
  for tests. Never throws across IPC (null on every failure path).
- **D10 Server module layout.** `server/epic/` mirrors `server/steam/`:
  `config.ts`, `ticket.ts` (pure), `web_api.ts` (fetch shell), `epic_db.ts`,
  `routes.ts`, `mirror.ts`, `achievement_map.ts`, `index.ts` (routes only for
  registry). Everything else imports concrete modules, not the barrel.
- **D11 Token trust chain.** Server verifies the posted proof upstream and
  extracts the Epic account id. Client-supplied Epic ids are never trusted.
- **D12 Reclaim by proof.** If a fresh verified proof shows an Epic account
  currently linked to another WoCC account, displace the old row (Steam
  `displaceSteamLink` pattern).
- **D13 Achievement mirror is observer-only.** Sim decides deed unlocks. Server
  records them. Epic mirror copies outward fire-and-forget. Never grant, deny, or
  reorder a deed. World loop never awaits mirror IO.
- **D14 Achievement IDs permanent.** Mapped EOS/EGS achievement names may be
  added, never renamed or reused once shipped (Steam ACH rule).
- **D15 Env keys (server runtime).**
  - `EPIC_ENABLED` (exactly `1` to light the surface)
  - `EPIC_PRODUCT_ID`
  - `EPIC_SANDBOX_ID` (if required by the chosen verify path)
  - `EPIC_DEPLOYMENT_ID`
  - `EPIC_CLIENT_ID`
  - `EPIC_CLIENT_SECRET` (server only, never logged)
  Finals in `DEPLOY.md`. BPT uses a separate `EPIC_BPT_*` family
  (`bpt-upload.md`); never put BPT secrets on the game server or desktop stamp.
- **D16 Env keys (desktop build / dev).**
  - Build stamp (required non-empty on epic channel):
    - `WOC_EPIC_PRODUCT_ID` -> `wocDesktop.epicProductId`
    - `WOC_EPIC_DEPLOYMENT_ID` -> `wocDesktop.epicDeploymentId`
    - `WOC_EPIC_CLIENT_ID` -> `wocDesktop.epicClientId`
  - Unpackaged only: `WOC_DISTRIBUTION=epic`, `WOC_EPIC_DEV=1`, optional id overrides
  Website and steam builds never require any Epic env. Server secrets never stamp.
- **D17 Routes (registry-only).**
  - `POST /api/epic/link` (body proof)
  - `DELETE /api/epic/link`
  - `GET /api/epic/status`
  Feature gate first (before auth). Link mutations use `EPIC_LINK_POLICY`
  (ip+account, twin of Steam).
- **D18 Status advert.** `/api/status` includes `epic: { enabled: boolean }`
  beside `steam`. RouteDef path reads live `epicEnabled()`. Legacy arm hardcodes
  `enabled: false` when that is still the Steam pattern.
- **D19 DDL.** Additive `epic_links` in `server/db.ts` SCHEMA
  (`account_id` PK, `epic_account_id` TEXT UNIQUE, timestamps as Steam).
- **D20 EOS adapter strategy.** Thin main-process adapter with injectable
  `requireEos`. Missing native degrades to null (merge-safe). Shell lands with
  fakes until O3 vendors the SDK.
- **D21 Dual mirror fan-out.** Deed recording and login reconcile call Steam and
  Epic observers independently. Either may be dark.
- **D22 i18n.** Every new player-visible string is a catalog `t()` key. S3 guard
  (`tests/localization_fixes.test.ts`) must stay green.
- **D23 Copy rules.** No em dashes, en dashes, or emojis in code, comments, docs,
  commits, or player-facing copy.
- **D24 Zero new runtime deps on website/steam paths.** Epic-only optional
  packaging deps only.
- **D25 BPT is ops, not gameplay.** Upload scripts and portal checklists are not
  required for server merge safety; not in pretest or gate.
- **D26 Portal work is parallel.** Org, product, IARC, store page, and credentials
  are tracked in #2708; not code-phase work.

## Non-negotiable constraints

- `src/sim/` stays free of Epic, Steam, Electron, DOM, and network SDK imports.
- Server authority: client never decides link validity or achievement unlocks.
- Secrets never committed; never logged.
- Module-first: no growing `electron/main.cjs` or `src/main.ts` with Epic logic banks.
- New REST endpoints are RouteDefs in the registry.
- Parameterized SQL only.

## Validation (when touching this surface)

| When the diff touches | Run |
|---|---|
| `electron/desktop_config.cjs` or builder scripts | `npx vitest run tests/electron_desktop_config.test.ts tests/electron_builder_config.test.ts` |
| `electron/epic.cjs` / preload / main IPC | `npx vitest run tests/electron_epic.test.ts tests/electron_ipc_channels.test.ts` |
| `server/epic/**` | `npx vitest run tests/server/epic_*.test.ts` |
| DDL / `epic_links` | migration-safety review + `tests/server/epic_db.test.ts` |
| UI / i18n | `npx vitest run tests/epic_link.test.ts tests/epic_link_markup.test.ts tests/localization_fixes.test.ts` |
| Near done | `npx tsc --noEmit`, `npm run ci:changed`, `npm run gate` for large changes |

## Code anchors

Desktop:

- `electron/desktop_config.cjs`, `electron/epic.cjs`, `electron/main.cjs`, `electron/preload.cjs`
- `scripts/electron-build.mjs`, `scripts/electron-builder-config.mjs`
- `scripts/epic-bpt-upload.mjs` (ops only)

Server:

- `server/epic/` (`config`, `ticket`, `web_api`, `epic_db`, `routes`, `mirror`,
  `achievement_map`, `index`)
- `server/deeds_records.ts`, `server/game.ts` (dual fan-out)
- `server/db.ts` (`epic_links` DDL)
- `server/http/registry.ts`

Client:

- `src/ui/epic_link.ts`, `src/runtime.ts` (`DesktopBridge`), markup in
  `index.html` / `play.html`

Tests:

- `tests/server/epic_*.test.ts`, `tests/electron_epic.test.ts`,
  `tests/electron_desktop_config.test.ts`, `tests/electron_builder_config.test.ts`,
  `tests/epic_link.test.ts`, `tests/epic_link_markup.test.ts`,
  `tests/epic_achievement_map.test.ts`, `tests/epic_bpt_upload.test.ts`,
  dual fan-out pins in `tests/deed_records_table.test.ts` and `tests/deeds_reconcile.test.ts`

## Closed design choices (reference)

- **Link proof (O1 closed):** `POST /api/epic/link { proof }`; desktop mints launcher
  exchange code; server exchanges via Epic OAuth v2 and stores `account_id`.
  Literals in `server/epic/ticket.ts` / `web_api.ts` and matching tests.
- **Achievement unlock (O2 closed):** server-trusted Web API only
  (client_credentials + product user map + Stats unlock batch). Map in
  `server/epic/achievement_map.ts`.

## Open ops (tracked in #2708)

- **O3** Vendor vs download path for EOS C SDK binaries on the epic package.
- **O4** Final portal artifact naming for Mac once the product exists.
- **O5** Public status or support URL on the EGS store listing if required.
- Portal product, sandboxes, clients, first BPT upload, Dev smoke, store submit,
  deliberate production `EPIC_ENABLED` lighting.
