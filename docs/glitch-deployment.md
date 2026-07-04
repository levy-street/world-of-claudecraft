# Glitch Deployment

This repo has an optional Glitch launch integration for the browser build.
It is off by default. A Glitch-enabled build activates only when
`VITE_GLITCH_ENABLED=1` and `VITE_GLITCH_TITLE_TOKEN` are present at build time.

## What The Integration Does

- Reads Glitch's `install_id` query parameter on launch.
- Validates that install before entering the game.
- Uses the username returned by Glitch validation. Numbers and punctuation are
  preserved, with only control characters and excessive length stripped.
- Bypasses the normal World of ClaudeCraft login, realm, character, and offline
  selection screens when a valid Glitch launch install is present.
- Exchanges the Glitch install for a normal World of ClaudeCraft online session
  through `/api/auth/glitch`.
- Enters the authoritative MMO server over the normal WebSocket world path, so
  Glitch players share the same live realm as regular web players.
- Starts an Aegis install heartbeat every 60 seconds.
- Exposes helper functions for progression run submission, leaderboard reads,
  achievements reads, and stats reads. Automatic leaderboard or achievement
  submission is not enabled until dashboard `api_key` values are chosen.

## Database

The Glitch MMO launch path uses the authoritative World of ClaudeCraft server,
so production needs the normal World of ClaudeCraft Postgres database. For
single-host dev, Docker Compose can run Postgres locally. For production or
multi-host operation, use a managed Postgres database such as Azure Flexible
Server and set the server's `DATABASE_URL` to that shared database.

Do not run multiple game server processes with the same `REALM_NAME` and assume
the database will merge them into one live world. One process owns one live
realm. The server takes a Postgres advisory lock for its realm at boot so a
duplicate same-realm process fails fast instead of splitting players into two
worlds. Multiple realms may share the same database by using different
`REALM_NAME` values.

See [DEPLOY.md](../DEPLOY.md) for the Azure Flexible Server CLI setup and the
required `DATABASE_URL` format.

## Required Environment

Set these in your shell or CI secret store. Do not commit token values.

```bash
export VITE_GLITCH_ENABLED=1
export VITE_GLITCH_TITLE_ID=8254e0f9-6c3a-4c94-8a16-570157b9df3b
export VITE_GLITCH_TITLE_TOKEN="<client title token>"
export VITE_GLITCH_DEFAULT_CLASS=warrior
export VITE_API_ORIGIN="https://worldofclaudecraft.com"

export GLITCH_TITLE_ID=8254e0f9-6c3a-4c94-8a16-570157b9df3b
export GLITCH_TITLE_TOKEN="<deploy token>"
export GLITCH_GAME_API_ORIGIN="https://worldofclaudecraft.com"
export GLITCH_DEPLOYMENT_TYPE=iframe
```

`VITE_GLITCH_TITLE_TOKEN` is the title token used by the shipped client for the
documented title-token APIs. `GLITCH_TITLE_TOKEN` is the deploy-scoped token used
by the Glitch CLI upload. Keep both out of git.

Set these on the authoritative World of ClaudeCraft server too, so the Glitch
iframe can exchange a validated install for a normal WOC online session:

```bash
export GLITCH_ENABLED=1
export GLITCH_SERVER_TITLE_TOKEN="<runtime title token>"
export WEB_ORIGINS="https://glitch-game-content.s3.amazonaws.com,https://www.glitch.fun"
```

The server uses `GLITCH_SERVER_TITLE_TOKEN` only to validate
`/installs/{install_id}/validate`; it must be a runtime title token, not the deploy token.
The browser never receives `GLITCH_SERVER_TITLE_TOKEN`.

## Deploy

Run:

```bash
npm run deploy:glitch
```

The script:

1. Loads `.env` and `.env.local` if present.
2. Clones or updates the Glitch CLI deploy tool under the system temp directory.
3. Runs `npm run build` with Glitch integration enabled, relative static asset URLs, and a
   server API origin baked into `VITE_API_ORIGIN`.
4. Uploads `dist/` with `entry=index.html`, `type=iframe`, and `build_type=production`.
5. Waits for the Glitch deployment job to complete.

Useful overrides:

```bash
GLITCH_DEPLOY_DRY_RUN=1 npm run deploy:glitch
GLITCH_DEPLOY_SKIP_BUILD=1 npm run deploy:glitch
GLITCH_BUILD_TYPE=playtest npm run deploy:glitch
GLITCH_DEPLOYMENT_TYPE=wasm npm run deploy:glitch
GLITCH_DEPLOY_VERSION=0.20.0 npm run deploy:glitch
GLITCH_GAME_API_ORIGIN=https://dev.worldofclaudecraft.com npm run deploy:glitch
```

## Local Verification

Build a Glitch-enabled client without deploying:

```bash
VITE_GLITCH_ENABLED=1 \
VITE_GLITCH_TITLE_ID=8254e0f9-6c3a-4c94-8a16-570157b9df3b \
VITE_GLITCH_TITLE_TOKEN="<client title token>" \
VITE_API_ORIGIN=http://127.0.0.1:8787 \
npm run build
```

Then serve the built output and launch with a Glitch install id:

```text
http://localhost:4173/?install_id=<install uuid>
```

When validation succeeds, the game skips the normal menus and enters the world as
the Glitch username.

## Security Notes

- Never commit `.env`, `.env.local`, title tokens, deploy tokens, server tokens,
  admin JWTs, or Azure credentials.
- The deploy script does not print tokens and does not write them to the repo.
- `glitch.deploy.json` is intentionally not used because the Glitch CLI manifest
  must not contain a token.
- Glitch cloud-save helpers remain available, but the MMO launch path does not
  use cloud saves for character state. Characters persist through the
  authoritative WOC server database.
