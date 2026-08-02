# Epic BuildPatchTool (BPT) upload runbook

How the maintainer packages World of ClaudeCraft for the Epic Games Store and
uploads loose binaries with Epic's BuildPatchTool. Companion to
`docs/desktop-release.md` (Epic section) and
`docs/epic-games-integration/portal-checklist.md`.

**Status:** product submission may still be in flight. You **cannot** complete a
real BPT upload until the Epic organization, product, artifacts, and BPT
credentials exist (tracked in #2708). Docs and the optional script make the
steps mechanical when access arrives. No secrets belong in the repo.

Official source of truth for BPT flags and portal UI:

- [BuildPatch Tool Instructions (latest)](https://dev.epicgames.com/docs/epic-games-store/publishing-tools/uploading-binaries/buildpatch-tool-latest)
  (Epic currently recommends the newest tool; older pages such as 1.7.0 / 1.8.x
  may still be linked from the portal)
- [Manage Artifacts](https://dev.epicgames.com/docs/epic-games-store/store-presence/manage-artifacts)
- [Release Management](https://dev.epicgames.com/docs/epic-games-store/publishing-tools/publishing-process/release-management)
- Portal: [dev.epicgames.com/portal](https://dev.epicgames.com/portal)

Do not invent click paths beyond the stable concepts below (product, sandbox,
artifact, binary, label, Dev vs Live). Prefer the official docs when the portal
UI moves.

## Concepts (stable)

| Concept | Role |
|---|---|
| Organization | Epic org that owns the product |
| Product | The game product in the Developer Portal |
| Sandbox | Dev (upload + internal test) vs Live (players after release process) |
| Artifact | Store binary slot for an offer (one per platform layout you ship) |
| Binary | A versioned upload produced by BPT `UploadBinary` |
| Label | Associates a binary version with a platform so the launcher can find it |
| BPT client | Portal **BPT credentials** (Client ID + Client Secret) used only for upload; distinct from the EOS game client used by the game server |

BPT uploads land in the **Dev** sandbox. Promotion to Live uses Epic Release
Management (portal), not a second game client.

## What we ship to BPT

Build first (per OS runner):

```bash
export WOC_EPIC_PRODUCT_ID='<EPIC_PRODUCT_ID>'
export WOC_EPIC_DEPLOYMENT_ID='<EPIC_DEPLOYMENT_ID>'
export WOC_EPIC_CLIENT_ID='<EPIC_CLIENT_ID>'
# Never stamp EPIC_CLIENT_SECRET or BPT secrets into the client.

# Windows runner:
npm run electron:build:epic
# -> release-epic/win-unpacked/

# macOS runner (Developer ID + notarization env present):
npm run electron:build:epic
# -> release-epic/mac-universal/World of ClaudeCraft.app
```

Channel rules (locked):

- Output directory: `release-epic/` only
- Targets: electron-builder `dir` layouts (loose trees), not NSIS / DMG / AppImage
- Platforms: **Windows + macOS only** (no Linux EGS claim)
- Updates: BPT + Epic labels / release management; electron-updater is OFF

Suggested BuildRoot / AppLaunch:

| Platform | BuildRoot | AppLaunch (relative to BuildRoot) |
|---|---|---|
| Windows | `release-epic/win-unpacked` | `World of ClaudeCraft.exe` |
| macOS | `release-epic/mac-universal` | nested MacOS executable under `World of ClaudeCraft.app/Contents/MacOS/` (confirm the exact filename on the first pack) |

`BuildVersion` should be a unique, human-readable string per upload (for example
`0.33.0-windows` / `0.33.0-mac`). Epic rejects reusing a version that already
exists for that artifact unless you delete it first (ops decision).

## Obtain and install BuildPatchTool

1. Sign in to the [Developer Portal](https://dev.epicgames.com/portal).
2. Select the correct **Organization**, then the **product**.
3. Open **Epic Games Store** -> **Artifacts and Binaries** (some orgs label this
   **Builds**).
4. Use the portal control to **download the BuildPatch Tool** (ZIP). Prefer the
   latest version Epic documents.
5. Unzip on the upload host. On Windows the CLI is typically under something
   like `Engine/Binaries/Win64/BuildPatchTool.exe` (exact layout follows Epic's
   ZIP). macOS/Linux hosts can run their platform binary the same way; examples
   in Epic docs are Windows-first.

BPT is an **operator** tool. It is not a gameplay dependency, not vendored into
the game client, and not required for `npm test` / `npm run gate`.

## Credentials and IDs (placeholders only)

Retrieve from the portal (roles: Owner, Admin, or Store, per Epic docs). Put
values in the **local shell** or a secret store, never in git.

| Placeholder / env | Meaning | Notes |
|---|---|---|
| `$EPIC_BPT_ORGANIZATION_ID` | Organization id | From BPT credentials / org |
| `$EPIC_BPT_PRODUCT_ID` | Product id for BPT | Portal product id; may match runtime `EPIC_PRODUCT_ID` once assigned |
| `$EPIC_BPT_ARTIFACT_ID` | Artifact id for **this** platform upload | From artifact details (Windows vs Mac artifacts differ) |
| `$EPIC_BPT_CLIENT_ID` | BPT Client ID | Product Settings -> BPT credentials |
| `$EPIC_BPT_CLIENT_SECRET` | BPT Client Secret | Product Settings; pass via env, not argv history |
| `$EPIC_BPT_CLOUD_DIR` | Local cache dir for BPT | Empty/dedicated dir, **not** BuildRoot |
| `$EPIC_BPT_BIN` | Path to `BuildPatchTool` binary | Absolute path preferred |

Prefer Epic's `ClientSecretEnvVar` form so the secret does not appear in process
lists or shell history:

```bash
export EPIC_BPT_CLIENT_SECRET='<BPT_CLIENT_SECRET>'
# BPT then reads -ClientSecretEnvVar=EPIC_BPT_CLIENT_SECRET
```

**Do not confuse** BPT credentials with the **server EOS** keys used for link
verification and the achievement mirror (`EPIC_CLIENT_ID` /
`EPIC_CLIENT_SECRET` in `DEPLOY.md`). Different clients, different secrets,
different machines.

## UploadBinary (conceptual command)

After packaging, on a host that has BPT and the loose tree:

```bash
# Example shape from Epic's UploadBinary docs. Replace every placeholder.
# Paths: no trailing slash issues per Epic path rules; prefer forward slashes.
"$EPIC_BPT_BIN" \
  -OrganizationId="$EPIC_BPT_ORGANIZATION_ID" \
  -ProductId="$EPIC_BPT_PRODUCT_ID" \
  -ArtifactId="$EPIC_BPT_ARTIFACT_ID" \
  -ClientId="$EPIC_BPT_CLIENT_ID" \
  -ClientSecretEnvVar=EPIC_BPT_CLIENT_SECRET \
  -mode=UploadBinary \
  -BuildRoot="<absolute-or-relative-path-to-loose-tree>" \
  -CloudDir="$EPIC_BPT_CLOUD_DIR" \
  -BuildVersion="<unique-version-string>" \
  -AppLaunch="<relative-executable-path>" \
  -AppArgs=""
```

Then label the binary for the platform (Epic `LabelBinary` mode) so the launcher
can resolve it. Platform strings and label names follow Epic's current docs
(Windows / Mac labels; do not invent Win32-only labels for a 64-bit Electron
build). Attach the binary to the correct artifact / offer in **Artifacts and
Binaries**, test in the **Dev** sandbox, and only then promote via **Release
Management** toward Live.

Optional modes Epic documents (use when needed; see official pages for flags):
`ListBinaries`, `GetBinaryMetadata`, `DeleteBinary`, `CopyBinary`,
`DiffBinaries`, `BinaryDeltaOptimise`, `LabelBinary`.

Repo helper (fail-closed, no upload without creds):

```bash
node scripts/epic-bpt-upload.mjs --help
node scripts/epic-bpt-upload.mjs --dry-run --os win --build-version 0.33.0-windows
# Real upload only when you intentionally omit --dry-run AND all required
# env vars are set AND EPIC_BPT_BIN points at a real BPT binary.
```

## Sandbox / Dev vs Live

1. Upload with BPT into the **Dev** sandbox (default BPT path).
2. Smoke in Dev: install via Epic tooling / sandbox entitlement, launch, login
   with **email or Discord** (never "login with Epic"), link Epic account for
   achievements when `EPIC_ENABLED=1` on the test server, exercise a deed
   unlock if the mirror is lit.
3. Promote through Epic **Release Management** only after Dev smoke and store
   review readiness (see portal checklist). Live is not "re-run UploadBinary
   with a different flag"; it is a portal release process.

## What NOT to upload

- Website channel installers or update feeds from `release/` (NSIS, DMG, ZIP
  for electron-updater, AppImage, deb, `latest*.yml`)
- Steam layouts from `release-steam/`
- Git working trees, `node_modules`, source maps you do not want public
- `.env`, client secrets, BPT secrets, publisher API keys
- Linux epic trees (we do not produce any)
- Any path that embeds credentials

## Default CI and gates

- Default `npm test` / `npm run gate` / website and steam packaging need **no**
  Epic or BPT secrets.
- `scripts/epic-bpt-upload.mjs` is optional ops; it is not wired into pretest,
  gate, or desktop-publish CI.
- `EPIC_ENABLED` stays off in production until the maintainer deliberately
  lights the server surface after portal + server secrets are ready.

## Related

- Packaging channel: `docs/desktop-release.md` (Epic section)
- Server env: `DEPLOY.md` (`EPIC_*` keys)
- Portal sequence: `docs/epic-games-integration/portal-checklist.md`
- Achievement id vocabulary: `server/epic/achievement_map.ts` (`ACH_*` permanent)
- Packet decisions: `docs/epic-games-integration/state.md` (D3, D4, D6, D7, D15, D16, D25, D26)
