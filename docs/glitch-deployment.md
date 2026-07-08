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
- Sends optional behavioral events for launch, auth, world loading, input, UI
  surfaces, chat intent, zone entry, level reach, quest lifecycles, quest
  dialogue choices, NPC talk options, merchant/store actions, combat friction,
  economy, social systems, delves, lockpicking, and disconnects.
- Exposes helper functions for progression run submission, leaderboard reads,
  achievements reads, and stats reads. Automatic leaderboard or achievement
  submission is not enabled until dashboard `api_key` values are chosen.

## Behavioral Events And Funnels

Behavioral tracking is enabled only inside a valid Glitch launch session. Regular
local, offline, or non-Glitch web sessions do not create a tracker and do not
call the behavioral event endpoint.

The browser sends one event at a time to:

```text
POST /titles/{configured title id}/events
```

with the documented title-token body fields:

- `game_install_id`: the validated Glitch `install_id`.
- `step_key`: a stable machine key for the stage, screen, location, or system.
- `action_key`: a stable machine key for what happened within that step.
- `metadata`: optional scalar context.
- `event_timestamp`: optional ISO timestamp.

The client does not call `/events/bulk` because the active bulk route is
admin-only, and it does not create behavioral funnel definitions because those
routes are dashboard or admin operations.

Event keys are normalized to stable machine keys. Metadata intentionally avoids
chat text, display names, title tokens, server tokens, database URLs, and other
PII or secrets. The common metadata is useful for debugging drop-off without
identifying a player directly: build, class key, level, zone id, biome,
position buckets, health percent, combat state, and dead or ghost state.

Useful dashboard funnels to create from emitted `step_key` values:

| Funnel | Ordered `step_key` values |
| --- | --- |
| Glitch launch to first intent | `glitch_launch`, `glitch_auth`, `world_load`, `world_session`, `input` |
| Early progression | `zone_eastbrook_vale`, `level_02`, `quest`, `level_06`, `zone_mirefen_marsh` |
| Generic quest lifecycle | `talk_open`, `talk_option`, `quest`, `quest` |
| Specific quest lifecycle | `talk_open`, `quest_<quest_id>_detail`, `quest_<quest_id>_accept`, `quest_<quest_id>_ready`, `quest_<quest_id>_complete` |
| NPC dialogue choice usage | `talk_open`, `talk_option` |
| Merchant purchase flow | `merchant_open`, `merchant_option`, `merchant_buy` |
| Merchant sell flow | `merchant_open`, `merchant_option`, `merchant_sell` |
| Delve friction | `delve`, `lockpick`, `delve` |
| Social engagement | `ui_social`, `social_party`, `social_trade`, `social_guild` |
| Disconnect diagnosis | `world_session`, `disconnect` |

Quest-specific funnel keys are generated from stable quest ids. For example,
`q_wolves` emits `quest_q_wolves_detail`, `quest_q_wolves_accept`,
`quest_q_wolves_ready`, and `quest_q_wolves_complete`. The generic `quest` key is
still emitted for aggregate quest reports. Dialogue option choices use
`step_key=talk_option` with action keys such as `select_quest_offer_detail`,
`select_quest_accept`, `select_vendor`, `select_world_market`, and
`select_close`. Merchant/store choices use `step_key=merchant_option` with
action keys such as `buy`, `buyback`, `sell_junk`, and `close`; successful sim
outcomes also emit `merchant_buy`, `merchant_buyback`, or `merchant_sell`.

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

export GLITCH_TITLE_ID=8254e0f9-6c3a-4c94-8a16-570157b9df3b
export GLITCH_TITLE_TOKEN="<deploy token>"
export GLITCH_DEPLOYMENT_TYPE=node
export GLITCH_ENTRY_POINT=index.html
export DATABASE_URL="<shared postgres url>"
export GLITCH_ENABLED=1
export GLITCH_SERVER_TITLE_TOKEN="<runtime title token>"
```

`VITE_GLITCH_TITLE_TOKEN` is the title token used by the shipped client for the
documented title-token APIs. `GLITCH_TITLE_TOKEN` is the deploy-scoped token used
by the Glitch CLI upload. Keep both out of git.

The normal Glitch deploy type for this repo is `node`. This game is an MMO with a
Node server, `/api`, `/ws`, and Postgres persistence, so the Glitch build must run
the server container for players to share the same live world. The Dockerfile
listens on port 3000 as required by Glitch's Node runtime.

The `node` entry point is `index.html`, not `package.json`. Glitch uses the
package start script to run the server, then loads the browser entry point from
inside the running app. The Glitch play page also performs a cross-site
`no-cors` public shell probe from `https://www.glitch.fun`; public document and
static responses from that origin use `Cross-Origin-Resource-Policy:
cross-origin` so Chrome does not block the probe. Sensitive `/api`,
`/admin/api`, `/oauth`, and `/internal` responses remain `same-origin`.

Glitch's Node runtime builds the client inside Docker. Because Vite inlines
`VITE_*` values at build time, the repo includes `glitch.public.env` as a blank
public Docker-build template. `npm run deploy:glitch` replaces only that file
inside the upload ZIP with public client values (`VITE_GLITCH_*`) before upload.
The generated file is not written to the working tree and does not contain the
deploy token, database URL, or server runtime token.

Use the other deployment types only for these cases:

| deployment_type | Use in this repo |
| --- | --- |
| `node` | Default and complete MMO deployment. Packages the source, Dockerfile, server, client, API, WebSocket world, and database-backed persistence. |
| `iframe` | Static client-only fallback. It cannot host `/api` or `/ws`; it needs an external authoritative WOC server with CORS enabled. |
| `wasm` | Static engine-style export only. This repo does not produce a required `.wasm` game runtime today, so do not use it for the MMO server. |
| `streamed_native` | Not used by the browser MMO. Reserved for a native streamed build with a web frontend. |
| `pixel_streaming` | Not used by the browser MMO. Reserved for Unreal or similar pixel-streaming packages. |

For a static `iframe` or `wasm` client-only deploy, opt in deliberately:

```bash
export GLITCH_ALLOW_STATIC_CLIENT_DEPLOY=1
export GLITCH_DEPLOYMENT_TYPE=iframe
export GLITCH_GAME_API_ORIGIN="https://worldofclaudecraft.com"
export VITE_API_ORIGIN="https://worldofclaudecraft.com"
```

The external server must include the Glitch iframe origins in `WEB_ORIGINS` if a
static client calls it cross-origin:

```bash
export WEB_ORIGINS="https://glitch-game-content.s3.amazonaws.com,https://www.glitch.fun,https://glitch.fun"
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
2. For `node`, refuses any `GLITCH_ENTRY_POINT` other than `index.html`.
3. Runs the mandatory local predeploy check before any upload:
   - `npm run build`
   - `npm run build:server`
   - starts `dist-server/server.cjs` locally with production env and a temporary
     `REALM_NAME`
   - verifies `GET /api/project-stats`
   - verifies `POST /api/site-presence` with the same JSON shape the live page sends
4. For `node`, prepares the Azure Container App unless
   `GLITCH_AZURE_POST_DEPLOY=0` is set:
   - sets revision mode to `multiple`
   - enforces `--min-replicas 1 --max-replicas 1`
5. Clones or updates the Glitch CLI deploy tool under the system temp directory.
6. For `node`, zips the source tree without `node_modules`, `dist`, `.env`, docs, tests, or local agent folders.
7. Uploads the archive with `entry=index.html`, `type=node`, `dockerfile=Dockerfile`, `build_context=.`, and `build_type=production`.
8. Waits for the Glitch deployment job to complete.
9. For `node`, runs an Azure Container App post-deploy check unless
   `GLITCH_AZURE_POST_DEPLOY=0` is set:
   - keeps revision mode at `multiple`
   - enforces `--min-replicas 1 --max-replicas 1`
   - reads all revisions, including inactive failed revisions
   - records the current known-good fallback from active traffic first, then
     falls back to Azure's last ready revision
   - waits for the latest revision to become healthy with one replica
   - pins traffic explicitly to the healthy latest revision
   - verifies that Azure reports 100 percent traffic on that revision
   - probes the public health route after routing traffic
   - detects the realm singleton rollout error in Azure logs
   - attempts a bounded singleton handoff only when a fallback revision is known
   - restores traffic to the current known-good revision and verifies public
     health if the latest revision never becomes healthy or fails public probing

If the local predeploy check fails, fix that failure locally first. Do not upload
another Glitch build until the check passes. When the check runs against Azure
Postgres from a developer machine, the machine's public IP must be allowed by
the Azure Flexible Server firewall for the duration of the check.

The live Glitch Container App for this single-realm MMO must run exactly one
replica. `REALM_SINGLETON_LOCK=1` intentionally prevents two server processes
from hosting `Claudemoon` at the same time. If Azure tries to roll or scale to a
second replica, the new process exits with `Realm "Claudemoon" is already hosted
by another game server process` and the revision fails activation. After a node
deploy, `npm run deploy:glitch` handles this post-deploy check automatically for
the default Glitch Container App.

The deploy script does not treat Azure's latest revision as live until three
checks agree: the revision is healthy, Azure traffic is pinned to it, and the
public health route responds. In the normal path, older revisions are not
deactivated until after those checks pass. If the new revision trips the realm
singleton lock, the script can briefly deactivate the known-good revision to
release the realm lock, but only when it already has a fallback revision to
restore and only for the bounded
`GLITCH_AZURE_SINGLETON_HANDOFF_TIMEOUT_MS` window. Failed fallback restoration
is reported as a deployment failure instead of being hidden.

The manual commands below are still useful for inspection or recovery:

```bash
az containerapp revision set-mode \
  --name world-of-claudecraft-node \
  --resource-group openai-resource-group \
  --mode multiple

az containerapp update \
  --name world-of-claudecraft-node \
  --resource-group openai-resource-group \
  --min-replicas 1 \
  --max-replicas 1

az containerapp revision list \
  --name world-of-claudecraft-node \
  --resource-group openai-resource-group \
  --all \
  --query "[].{name:name,healthState:properties.healthState,runningState:properties.runningState,replicas:properties.replicas}"

az containerapp show \
  --name world-of-claudecraft-node \
  --resource-group openai-resource-group \
  --query "properties.configuration.ingress.traffic"

az containerapp ingress traffic set \
  --name world-of-claudecraft-node \
  --resource-group openai-resource-group \
  --revision-weight "<known-good-revision>=100"
```

Useful overrides:

```bash
GLITCH_AZURE_CONTAINERAPP_NAME=world-of-claudecraft-node npm run deploy:glitch
GLITCH_AZURE_RESOURCE_GROUP=openai-resource-group npm run deploy:glitch
GLITCH_AZURE_PUBLIC_ORIGIN=https://worldofclaudecraft.com npm run deploy:glitch
GLITCH_AZURE_PUBLIC_HEALTH_PATH=/api/project-stats npm run deploy:glitch
GLITCH_AZURE_HEALTHCHECK_TIMEOUT_MS=15000 npm run deploy:glitch
GLITCH_AZURE_HEALTHCHECK_CONTAINS=Claudemoon npm run deploy:glitch
GLITCH_AZURE_SINGLETON_HANDOFF_TIMEOUT_MS=90000 npm run deploy:glitch
GLITCH_AZURE_RESTORE_TIMEOUT_MS=120000 npm run deploy:glitch
GLITCH_AZURE_POST_DEPLOY=0 npm run deploy:glitch  # skip Azure health handoff only for non-Azure experiments
GLITCH_DEPLOY_DRY_RUN=1 npm run deploy:glitch
GLITCH_DEPLOY_SKIP_BUILD=1 npm run deploy:glitch  # static iframe/wasm only; node preflight still builds
GLITCH_BUILD_TYPE=playtest npm run deploy:glitch
GLITCH_DEPLOY_VERSION=0.22.0 npm run deploy:glitch
GLITCH_ALLOW_STATIC_CLIENT_DEPLOY=1 GLITCH_DEPLOYMENT_TYPE=iframe npm run deploy:glitch
GLITCH_ALLOW_STATIC_CLIENT_DEPLOY=1 GLITCH_DEPLOYMENT_TYPE=wasm npm run deploy:glitch
GLITCH_ALLOW_STATIC_CLIENT_DEPLOY=1 GLITCH_GAME_API_ORIGIN=https://dev.worldofclaudecraft.com npm run deploy:glitch
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
