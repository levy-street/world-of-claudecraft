# Epic Games Store integration

World of ClaudeCraft ships on the Epic Games Store as a third desktop
distribution channel (beside website downloads and Steam), with the same
merge-safe, env-gated shape as the Steam link and Book of Deeds achievement
mirror.

The implementation is **dark by default**: `EPIC_ENABLED` must be exactly `1`
to light server routes, status advert, mirror, and client link UI. Default CI
and `npm test` need no Epic secrets.

## Maintainer docs (keep these)

| Doc | Use |
|---|---|
| [state.md](state.md) | Locked product decisions (D1+), env keys, routes, code anchors |
| [portal-checklist.md](portal-checklist.md) | Epic Developer Portal sequence after org access |
| [bpt-upload.md](bpt-upload.md) | BuildPatchTool upload runbook + fail-closed helper |
| [docs/desktop-release.md](../desktop-release.md) | Epic packaging channel (build env, `release-epic/`) |
| [DEPLOY.md](../../DEPLOY.md) | Server `EPIC_*` runtime keys and dark default |

## Ops follow-up

Code can merge while the surface stays dark. Live portal setup, first BPT
upload, Dev sandbox smoke, store submission, and production lighting are tracked
in:

- **https://github.com/levy-street/world-of-claudecraft/issues/2708**

Open items called out there include EOS C SDK vendor path (O3), Mac artifact
naming (O4), and store support URL (O5).

## Non-goals (v1)

- Login with Epic (identity stays email + Discord)
- Linux EGS depot
- Epic friends / social overlay product surface
- In-app Epic checkout or Web Shop
- electron-updater on Epic builds (BPT owns patches)
- Requiring Epic secrets for website / steam / default CI paths
- Turning on `EPIC_ENABLED` in production as the default
