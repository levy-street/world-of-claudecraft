# Epic Developer Portal checklist (maintainer)

Maintainer-facing sequence after Epic **organization access** lands. No secrets
belong in this file or in git. Product submission may still be in flight when
this checklist is read; it is the order of operations once the org exists, not
a claim that every step is already finished.

Server and client code stays **merge-safe and dark** without portal credentials
(`EPIC_ENABLED` off; routes answer `epic.disabled`). Store submission and live
BPT upload are **ops** (issue #2708), not a dark-code merge requirement.

Stable concepts only (product, sandbox, client, artifact, offer, IARC). Prefer
current Epic Developer Portal docs when UI labels move:

- [Epic Games Store publishing tools](https://dev.epicgames.com/docs/epic-games-store)
- [Manage Artifacts](https://dev.epicgames.com/docs/epic-games-store/store-presence/manage-artifacts)
- [BuildPatch Tool (latest)](https://dev.epicgames.com/docs/epic-games-store/publishing-tools/uploading-binaries/buildpatch-tool-latest)
- [Release Management](https://dev.epicgames.com/docs/epic-games-store/publishing-tools/publishing-process/release-management)
- Portal home: [dev.epicgames.com/portal](https://dev.epicgames.com/portal)

## 1. Organization and product

- [ ] Organization approved / accessible under the correct legal entity
- [ ] Product created for World of ClaudeCraft
- [ ] Note stable ids for later env wiring (placeholders only in docs):
  - Product id -> server `EPIC_PRODUCT_ID` and build `WOC_EPIC_PRODUCT_ID`
  - Deployment id(s) -> `EPIC_DEPLOYMENT_ID` / `WOC_EPIC_DEPLOYMENT_ID`
  - Sandbox id(s) if required by the verify path -> optional `EPIC_SANDBOX_ID`
- [ ] Confirm v1 store platforms: **Windows + macOS only** (no Linux EGS listing)

## 2. Clients and credentials

Keep three credential families separate. Never commit any of them.

| Family | Used by | Typical keys (names locked for game path) |
|---|---|---|
| EOS game client (server) | Link verify + achievement mirror (`server/epic/`) | `EPIC_CLIENT_ID`, `EPIC_CLIENT_SECRET` (secret server-only, never logged) |
| Desktop stamp (build) | Packaged epic shell (`wocDesktop.epic*`) | `WOC_EPIC_PRODUCT_ID`, `WOC_EPIC_DEPLOYMENT_ID`, `WOC_EPIC_CLIENT_ID` (no secret) |
| BPT upload client | BuildPatchTool only | `EPIC_BPT_CLIENT_ID`, `EPIC_BPT_CLIENT_SECRET`, org/product/artifact ids (see `bpt-upload.md`) |

- [ ] Create / record the EOS client used by the **game server** (not the BPT client)
- [ ] Create / record BPT credentials under Product Settings (Owner/Admin/Store)
- [ ] Create Windows and Mac **artifacts** (or confirm Epic-provisioned ones); record each **Artifact ID**
- [ ] Create offer(s) and note Offer IDs if the portal requires them for store attach
- [ ] Store secrets only in the production secret store / host `.env` (never the client stamp, never git)

## 3. Sandboxes and Dev smoke path

- [ ] Dev sandbox ready for internal builds
- [ ] Live sandbox / public path understood via Epic Release Management (do not treat Live as "upload with a different flag")
- [ ] Entitlements for internal testers documented for the team

## 4. IARC and store presence

- [ ] Complete IARC (or Epic's current age-rating flow) for the product
- [ ] Store page assets: key art, screenshots, trailers, descriptions per Epic asset specs
- [ ] Privacy policy / support / EULA URLs as required by Epic store listing rules
- [ ] Decide whether a public status page or support URL must appear on the listing (open item O5; ops, not code)
- [ ] Confirm Mac artifact naming (universal vs per-arch) once the product exists (open item O4)

## 5. Achievements (permanent ids)

Mirror is observer-only: sim deeds unlock on the game server; Epic receives a
copy when link + `EPIC_ENABLED=1` + map entry exist. Achievement API ids are
**permanent** once shipped (D14): add, never rename or reuse.

Source of truth for portal achievement **names / API ids**:

- `server/epic/achievement_map.ts` (`ACH_*` values; same vocabulary as Steam)

Checklist:

- [ ] Register each mapped `ACH_*` id in the Epic portal achievement set for this product
- [ ] Hidden deeds in the map (`hid_*` -> `ACH_*`) registered as hidden achievements
- [ ] Do not invent alternate spellings; portal id must match the map string exactly
- [ ] Art icons and XP values are maintainer portal work (ops; tracked in #2708)
- [ ] After portal registration, smoke: link a Dev account, unlock a mapped deed, confirm Epic shows the achievement

Full launch set is the map export (on the order of 75 entries; hard cap 100).
Do not maintain a second hand-copied id list in this doc (it will rot). When
authoring, open `achievement_map.ts` or run the existing achievement map test
for the authoritative inventory.

## 6. Build and upload (Dev)

- [ ] Package with `npm run electron:build:epic` on Win + Mac runners using
  `WOC_EPIC_*` build ids (see `docs/desktop-release.md`)
- [ ] Confirm `release-epic/` contains **loose dir** layouts only (no store installers)
- [ ] Upload with BPT (`docs/epic-games-integration/bpt-upload.md`); label platform binaries
- [ ] Attach binaries to the correct artifacts / offers
- [ ] Internal install + launch smoke on Windows and macOS from the Dev sandbox

## 7. Server lighting (separate from store binary)

Server surface defaults **dark**. Lighting is an ops decision after secrets exist.

- [ ] Host `.env` (or secret store) has:
  - `EPIC_ENABLED=1` (exactly `1`)
  - `EPIC_PRODUCT_ID`, `EPIC_DEPLOYMENT_ID`, `EPIC_CLIENT_ID`, `EPIC_CLIENT_SECRET`
  - optional `EPIC_SANDBOX_ID` if the verify path needs it
- [ ] Docker Compose passes those keys into the game container (same pattern as Steam)
- [ ] Confirm `/api/status` advertises `epic: { enabled: true }` only when intended
- [ ] Confirm link + mirror are **cosmetic** (email + Discord remain the only login methods; no session mint from Epic)
- [ ] Rate limits and logs: secret never appears in log lines or error bodies

With `EPIC_ENABLED` unset or not exactly `1`: every `/api/epic/*` answers
`epic.disabled`, status advert is false, mirror is inert, client shows no Epic UI.

## 8. Client UI smoke (Dev)

- [ ] Packaged epic build: distribution banner `epic`, updater disabled, wallet closed
- [ ] Logged-in player sees Epic link group only when advert + capability allow
- [ ] Link / unlink / already-linked / reclaim-by-proof paths exercised against Dev
- [ ] Website and Steam builds still hide Epic UI when server dark or channel not epic

## 9. Store review and Live

Submit for store review **only after** Dev sandbox smoke of packaging + (if
lit) link/mirror and client UI looks good.

- [ ] Store page complete, IARC complete, Dev binary attached
- [ ] Submit for Epic store review per current Self-Publishing / SPT process
- [ ] After approval, promote through Release Management to Live
- [ ] Post-live: monitor support, achievement unlocks, and crash logs; keep
  `EPIC_ENABLED` dark on production until mirror credentials and policy are ready

## 10. Explicit non-goals (do not do these)

- Login with Epic / session mint from Epic proof (D2)
- Wallet commerce on the epic channel (D5)
- Linux EGS depot or store claim (D6)
- Uploading website installers or Steam depots as the EGS binary (D7)
- Committing `.env`, real client secrets, or pasting secrets into issues/PRs
- Turning on `EPIC_ENABLED` in production docs as the default (D3)

## Related code anchors

- Server gate: `server/epic/config.ts` (`epicEnabled`, provisioned ids)
- Achievement map: `server/epic/achievement_map.ts`
- Routes: `POST/DELETE /api/epic/link`, `GET /api/epic/status`
- Desktop packaging: `scripts/electron-build.mjs`, `scripts/electron-builder-config.mjs`
- Desktop shell: `electron/epic.cjs`
- BPT helper: `scripts/epic-bpt-upload.mjs`
