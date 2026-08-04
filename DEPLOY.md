# Deploying World of ClaudeCraft on AWS

> **Levy Street production** is deployed via Ansible, not this document:
> the `eastbrook_game` role in the internal `ansible-scripts` repo runs
> the stack on `idyllic-games-prod` behind nginx + certbot at
> https://worldofclaudecraft.com. Re-running
> `ansible-playbook playbooks/setup_server.yml -e target_host=idyllic-games-prod`
> pulls and redeploys. The guide below is the generic, standalone path.

One EC2 instance runs everything: the game server, Postgres, MediaWiki, and Caddy
(TLS reverse proxy). Sized for a small population, a `t4g.small`
(~$14/month all-in) is comfortable for a handful of concurrent players.

## 1. Confirm the repo is public

The standalone first-boot script clones
`https://github.com/levy-street/world-of-claudecraft.git` anonymously. If you
are deploying a private fork instead, use a deploy key or another secret
manager-specific flow; do not paste long-lived personal access tokens into EC2
user data.

## 2. Launch the instance

In the EC2 console:

| Setting | Value |
|---|---|
| AMI | Ubuntu Server 24.04 LTS (**arm64**) |
| Instance type | `t4g.small` (2 vCPU Graviton, 2 GB) |
| Storage | 20 GB gp3 |
| Security group | Inbound: **22** (your IP only), **80**, **443**, nothing else |
| User data | Paste `deploy/user-data.sh` with `DOMAIN` filled in |

Leave `DOMAIN=""` if you want to test by IP first over plain HTTP,
you can set the domain later (step 4).

Allocate an **Elastic IP** and associate it with the instance so the
address survives restarts.

The game server and Postgres bind to loopback only (`127.0.0.1:8787` /
`127.0.0.1:5433`); Caddy is the sole public entrance, so the security
group above is the whole exposure story.

First boot takes a few minutes (Docker image build). Watch it with:

```bash
ssh ubuntu@<elastic-ip> sudo tail -f /var/log/eastbrook-setup.log
```

## 3. Point DNS at it

Create an **A record** for your domain (e.g. `play.example.com`) pointing
at the Elastic IP. In Route 53: Hosted zone, Create record, type A,
the Elastic IP.

## 4. Turn on TLS (if you started without a domain)

```bash
ssh ubuntu@<elastic-ip>
echo 'play.example.com {
	@ops path /livez /readyz /metrics /internal/*
	respond @ops 404
	route /wiki* {
		reverse_proxy localhost:8080
	}
	reverse_proxy localhost:8787
	encode gzip
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy fetches and renews the Let's Encrypt certificate automatically;
WebSockets are proxied with no extra config, and the client auto-selects
`wss://` on https pages. Open `https://play.example.com` and you're live.

## Updating the game

Run these in order. If you bundle the private bot detector, its pull and the
type-check gate are not optional. The detector is an optional component in a second
checkout (`private/bot_detector`), and the build never complains about it: a missing
clone silently falls back to the no-op stub, and a clone that has drifted out of step
with the game tree compiles into the image and only fails when the server calls it.
The type check is what catches that mismatch, and it has to run before the image is
built, not after it ships.

```bash
ssh ubuntu@<elastic-ip>
cd /opt/eastbrook

# 1. The game code.
sudo git pull

# 2. The private bot detector, if you bundle it. The image bundles whatever sits in
#    private/bot_detector at build time (see the bot detector note below), so this
#    clone has to move with the game tree. Pull it in the same breath as the game
#    repo, every time. Skip this step entirely if you run the open-source stub.
sudo git -C private/bot_detector pull
#    First time on this host, clone it instead: it is not part of the public checkout.
#    sudo git clone <private-bot-detector-repo> private/bot_detector

# 3. The type-check drift gate: this is what catches a detector that no longer
#    matches the interface the server calls. A deploy host runs Docker but often no
#    Node, and a production checkout has no devDependencies, so run it in the same
#    Node the image builds with. The checkout goes in read-only and is copied inside
#    the container, so no root-owned node_modules is left behind on the host. Two
#    hardenings: the find sweep drops every .env and every .git from the copy (the
#    host .env holds every production secret, and a nested clone's .env or .git
#    config can carry tokens; the type check needs none of them), and
#    --ignore-scripts stops dependency install hooks from running as root with
#    network access. The memory bound matters because this runs on the live box
#    BEFORE the game stops: an unbounded pnpm install plus tsc can spike past what
#    the host has spare and create the exact memory pressure the game service's
#    mem_limit exists to prevent. 2g is ample for this tree's install and tsc; the
#    swap bound matches so the gate cannot push the host into swap either.
sudo docker run --rm --memory 2g --memory-swap 2g -v /opt/eastbrook:/src:ro -w /app node:26-slim \
  sh -c 'cp -a /src/. /app && find /app \( -name .git -o -name .env \) -prune -exec rm -rf {} + && npm install -g pnpm@10.34.5 && pnpm install --frozen-lockfile --ignore-scripts && npx tsc --noEmit'
#    Red means STOP, do not deploy: the image would build fine and fail at runtime.
#    One exception: exit code 137 means the container hit the 2g memory bound (a
#    gate-environment failure, not a type error); raise the bound or run the gate
#    off-box, do not skip it.
#    (On a host that does have Node 26 on PATH with pnpm available,
#    `pnpm install --frozen-lockfile --ignore-scripts && npx tsc --noEmit` in the
#    checkout runs the same type check, but WITHOUT the container's memory bound;
#    on the live box prefer the containerized form above.)

# 4. Optional: warn the players. POST /internal/restart-countdown broadcasts an
#    in-game countdown. The secret header is the gate: nothing restricts the
#    endpoint to loopback. The public edge now answers 404 for /internal/* as well
#    as for /livez, /readyz, and /metrics, but that is defense in depth and not the
#    gate, so treat RESTART_COUNTDOWN_SECRET as a real production secret. The curl
#    below targets 127.0.0.1:8787 on the host and never traverses Caddy, so the
#    edge 404 does not affect it.
#    With the secret unset the endpoint answers 404 and there is nothing to warn
#    with. The countdown runs 10 minutes; wait for it to elapse before step 5.
curl -fsS -X POST -H "x-woc-deploy-secret: <RESTART_COUNTDOWN_SECRET>" \
  http://127.0.0.1:8787/internal/restart-countdown

# 5. Stop the game and let it drain. The container's stop grace period covers the
#    whole shutdown chain (character saves included), and /livez deliberately stays
#    200 while draining, so neither Docker's healthcheck nor the watchdog can read a
#    graceful drain as a wedge.
sudo docker compose stop game
#    On an older checkout whose compose file has no stop_grace_period, pass the
#    window explicitly: sudo docker compose stop -t 60 game
#    This normal stop followed by up -d --build replaces the process. It also
#    terminates authenticated and linkdead sessions held in process memory, so an
#    auth rollout needs no separate session cleanup. Do not leave an old game
#    process serving alongside the rebuilt one.

# 6. Rebuild and start. (`sudo docker compose build game` before step 4 shortens the
#    outage: the image is then ready the moment the countdown ends.)
sudo docker compose up -d --build
```

Then verify, before you walk away:

```bash
# the realm answers
curl -fsS http://127.0.0.1:8787/api/status

# Docker calls the game container healthy, not `starting` and not `unhealthy`
sudo docker compose ps
sudo docker inspect -f '{{.State.Health.Status}}' eastbrook-game

# the startup logs are free of errors, and the bot detector line names the
# implementation you actually expect (`stub (no-op)` or `private`); repeated
# TypeErrors that mention the detector mean the bundled clone is out of step
# with the game tree: stop, pull it (step 2), and rebuild
sudo docker compose logs game --since 10m
```

A container that never leaves `starting`, or that flips to `unhealthy`, is telling
you the world loop is not completing passes: roll back rather than leaving it up.

Players online during the restart are disconnected for a few seconds and
can log straight back in; the server saves all characters on shutdown.

## Outbound email (AWS SES)

The server sends account-lifecycle mail (signup, password reset, email change,
security notices; see `server/email/`). Without configuration it uses the
console transport: emails are logged, never sent. To deliver for real via SES:

1. In SES (same region as the instance is simplest), create a **domain
   identity** for the sending domain and publish the DKIM CNAMEs, MAIL FROM,
   and DMARC records it gives you.
2. Request **production access** for the SES account (until granted, the
   sandbox only delivers to individually verified addresses).
3. Attach an IAM role to the instance allowing `ses:SendEmail` on that
   identity (preferred over access keys; the SDK default chain picks it up
   through the instance metadata service).
4. In `/opt/eastbrook/.env` set:

```bash
EMAIL_PROVIDER=ses
EMAIL_SES_REGION=us-east-1
EMAIL_FROM="World of ClaudeCraft <noreply@worldofclaudecraft.com>"
EMAIL_BASE_URL=https://worldofclaudecraft.com
```

Then `docker compose up -d game`. The startup log line
`email transport selected` confirms which transport is live; every send
attempt is audited in the `email_log` table. A provider with a plain HTTP
API works too: set `EMAIL_API_URL`, `EMAIL_API_KEY`, and `EMAIL_FROM`
instead (see `.env.example`).

## Backups

A nightly `pg_dump` runs at 03:15 UTC via `/etc/cron.d/eastbrook-backup`,
writing gzipped dumps to `/var/backups/eastbrook/` and keeping 14 days.

Restore (stack must be up):

```bash
gunzip -c /var/backups/eastbrook/eastbrook-2026-06-10.sql.gz \
  | sudo docker exec -i eastbrook-db psql -U eastbrook eastbrook
```

For off-box safety, sync the directory to S3 occasionally:
`aws s3 sync /var/backups/eastbrook s3://your-bucket/eastbrook/`.

## Operational notes

- **Secrets**: the Postgres password is generated at first boot into
  `/opt/eastbrook/.env` (mode 600, gitignored). Nothing else to manage.
- **Timed Daily Rewards ban rollback**: releases with timed bans retain expired rows in
  `daily_reward_bans` and exclude them with an `expires_at` predicate. Before rolling
  back to a release that predates timed bans, stop every game process and remove expired
  rows with `DELETE FROM daily_reward_bans WHERE expires_at <= now();`. The older release
  cannot honor future expiry times. Operators must either remove still-active timed bans
  before rollback or explicitly accept that they will become permanent until manually
  unbanned. Do not alter the nullable `expires_at` column during rollback.
- **Professions rollback caveats**: `characters.state` is written whole, so rolling
  back to a binary that predates a professions field erases that field on the first
  autosave. Across the professions persistence release specifically: node respawn
  timers (`nodeHarvestCooldowns`) are erased, which reopens the node relog exploit
  for the rollback window (accepted trade, no player value lost); slotted tool
  effects (`toolEffectSlots`) are erased the same way, and since the
  acquisition craft shipped that is REAL PLAYER-VALUE LOSS (a slot costs a
  crafted charm of arcane reagents plus its recharges, and the erased
  `craftedBy` discount provenance cannot be re-minted), so a rollback across
  the acquisition-craft boundary needs a restore-from-backup plan and the
  release notes must carry the caveat; the tier-mail acknowledgement
  prune is a one-way heal that fires on the first UPGRADE load, so a rollback
  cannot undo it and the only recovery is a database backup; and any FUTURE
  proficiency or craft cap raise is rollback-destructive
  (the old binary clamps raised values on load and persists the loss), so a
  rollback across a cap change needs a restore-from-backup plan for professions
  counters. Details: "Rollback erases newer fields" in
  `docs/design/professions-tuning-packet.md`.
- **Client/server deploy order for content releases**: deploy the SERVER first, then
  let clients update. Web and desktop bundles refresh on their next load. The iOS
  binary rides App Store review and cannot pick up a same-day bundle (LiveUpdates
  is off), so submit it early, hold its release until it is approved, release the
  binary, and deploy the server right behind it: the binary must be out before the
  server moves, and the gap between the two must stay short. The two mid-window
  mixes degrade differently, and the order above keeps both windows short:
  - OLD client on NEW server (the guarded direction): item ids the bundle predates
    render with the fallback icon and their raw id in the trade window, bags, and
    bank; profession grant lines name the raw id; vendor rows show the old
    bundle's stock and prices while the purchase path charges the server's own
    truth (a mismatch is display-only); denial toasts fall back to their generic
    wording. Gather-node skew depends on the node family, because each side
    collides against its own bundle's positions: moved or added ORE and WOOD
    collide invisibly at their server spots and stand as solid stale props at
    their old client spots (both read as rubber-band corrections), while HERB
    skew is walk-through phantom props only (herb clusters carry no collider).
    All of THAT is cosmetic and self-heals when the client updates. Two
    v0.32.0 surfaces on this leg are NOT cosmetic: the world grew far past
    the old bundle's terrain rectangle, so a stale tab can walk east,
    west, or north into ground its renderer has no mesh for (a void with the wrong
    zone name and music, walkable because the server's rim moved outward);
    and the instance plane REBASED (INSTANCE_X_BASE), so a stale tab that
    enters any dungeon, delve, or arena after the deploy is teleported to
    coordinates its renderer draws as a black, collider-less void, with the
    exit object invisible, until relog (login is protected: a saved
    inside-instance position ejects to the door). The release left the
    fail-closed layout gate at ONLINE_WORLD_LAYOUT_VERSION 3 through both
    changes, so stale bundles are still admitted at reconnect; bumping it
    is the one-line mechanical answer if the maintainer resolves the
    surfaced forced-refresh question toward refusing stale sessions.
  - NEW client on OLD server (the bounded direction): every gather node the
    release relocated is unusable, because the client shows it where the old
    server does not have it. Among the zones the deployed server HAS, the
    worst cases are Eastbrook tier-1 herbalism and Mirefen's tier-2 band,
    each a fully moved-or-new group; the eleven expansion zones are a
    different class entirely (their ground does not exist on the old server,
    so everything there is dead until the server deploys), and new client
    surfaces advertise nodes, items, and minimap markers the old server
    denies.
    This window exists only between a client release and the server deploy, so
    close it by deploying the server as soon as the clients are staged. (An
    old server answers a command it does not know by logging a protocol
    anomaly to the bot detector and spending a rate-limit token. The
    professions tuning packet itself adds TWO commands, slot_tool_effect and
    recharge_tool_effect, neither dev-gated, both wired to shipped
    professions-window buttons; on the FORWARD leg those buttons stay
    unreachable for an ordinary player because an old server never mints a
    charm and never sends the tslot rows the buttons render from, so only a
    hand-built frame spends tokens through them. On a ROLLBACK leg the
    premise flips: charms already crafted survive in bags (the pre-packet
    loader keeps unknown-id slots as dormant data), so the slot buttons
    render from real inventory and an ordinary click spends rate-limit
    tokens and logs anomalies against the rolled-back server until the
    packet server returns. The v0.32.0 expansion the branch
    merged with adds eleven more commands, none dev-gated, of which FOUR are
    reachable from the shipped client's own surfaces: the mount key, the two
    race controls, and the Settings unstuck action. On this leg an ordinary
    player pressing the mount key or using unstuck spends rate-limit tokens
    and logs anomalies until the server deploys, one more reason to keep the
    binary-to-server gap short. One more version-skewed CONSUMER rides this
    deploy: the discord-bot container's activity feed predates the packet's
    masterwork and deed card kinds (and the expansion's vale_cup kind), so
    restart the bot with the server or those cards post as empty embeds
    Discord rejects until it picks up the new build.)
  Release-specific caveat for the professions tuning deploy: the guards above
  describe bundles built from this release onward. The bundle DEPLOYED TODAY
  predates them, and its trade window throws while rendering an offer that
  stages ANY item id the bundle predates (the packet's fine-grade materials
  and rods, and equally the expansion's whole tradeable catalog: rift
  essence and gems, the new-zone gear, none of it soulbound), freezing that
  trade panel for the stale session until the page reloads. The sibling
  loot-window throw is unreachable through the PACKET's ids as long as
  they remain gathering, recipe, vendor, and delve-shop
  content only, out of every mob and chest loot table, so keep them out
  until clients have rolled; it is NOT unreachable for the merged release as
  a whole, because the v0.32.0 expansion put four mount reins into the
  heroic loot of five encounters the deployed bundle already knows (the
  Morthen, Vael, Ysolei, and Korzul heroic finales plus the Nythraxis raid),
  so a solo or free-for-all heroic clear that drops one freezes a stale
  session's corpse loot window the same way, and the v0.34.0 sync widened
  the same arm: the release's Heroic Wildheart Basin loot pass (Zulgar) put
  six more epic ids into heroic boss loot that a stale bundle
  does not know. The reins odds are the mount drop rates (0.5 and 0.1
  percent) while the Wildheart ids drop at ordinary heroic rates, the party
  need/greed path is already guarded at the base, and the frozen id set
  (reins exceptions plus the Wildheart additions) is pinned by the
  deploy-window test's snapshot. Rift-run loot is a second release-content arm on
  the same window (the run builders push the rift catalog onto boss corpse
  lists at runtime, outside every content-table sweep); it requires the
  stale tab to get inside a rift at all, and whether the old bundle's
  generic object interaction reaches a rift portal has not been verified
  either way. Both arms are inputs to the surfaced
  forced-refresh-at-deploy question. Two more
  deployed-bundle arms need no loot table at all, because the
  fine grades are minted by HARVESTING with an outclassing tool: a stale tab
  that gathers one sees it land in an INVISIBLE bag cell (and bank cell after
  a deposit) that still consumes capacity, and the profession chat line names
  the raw id. Cosmetic and self-healing on reload, but they will read as
  "my ore vanished" in reports, so expect them for as long as stale tabs
  live. Stale sessions are ended by the pre-deploy restart countdown, but a
  reconnect rides the same stale page: only a page reload picks up the new
  bundle.
  The caveats above were measured against 9d7a1a021, the commit deployed
  today; the branch has since merged the true v0.32.0 tip (0b427afca, 685
  commits past the measured base), re-synced repeatedly through
  release/v0.33.0 (last at 2ae71a7fbf), and then merged release/v0.34.0
  (94f5ac63d8, at merge 706bec2d21), which together are what the
  merged-branch numbers above describe. If the live server moves before
  this branch deploys, re-run the compatibility diff against the commit
  actually deployed before trusting any "N new X" claim.
  The loot-table exclusion is enforced by
  `tests/stale_client_rollout.test.ts` for the deploy window (delete that
  pin once clients have rolled). Per-surface analysis for the professions
  tuning release: the stale-client compatibility phase of
  `docs/design/professions-tuning-packet-review.md`.
- **Bank ledger audit**: `node scripts/bank_audit.mjs` (reads `DATABASE_URL` from the
  environment) replays the append-only `bank_ledger` against live character bank state
  and exits non-zero on any discrepancy. Run it after an economy incident or a restore.
- **Username bans**: set `USERNAME_BANLIST_FILE=/opt/eastbrook/username-banlist.txt`
  to load blocked username terms from a private newline- or comma-separated
  file. `USERNAME_BANLIST` can also provide a comma-separated inline list.
- **Chat filter**: the word lists are now **managed live from the admin
  dashboard** (Chat Filter tab), stored in the database and seeded with sensible
  defaults on first boot. Two tiers: *soft* words are masked client-side with
  `****` (players can toggle the filter off in Options), and *hard* words (slurs)
  are blocked server-side and escalate from a warning to account-wide timed mutes
  (durations editable in the same tab). `CHAT_CENSOR_LIST` / `CHAT_CENSOR_FILE`
  are still read **once**, on the first boot of a fresh database, to seed the soft
  list; after that they are ignored and the dashboard is authoritative.
- **Realms (horizontal scaling)**: each server process serves one realm,
  set by `REALM_NAME` (default `Claudemoon`). To add a realm, run another
  process against the **same** `DATABASE_URL` with a different `REALM_NAME`
  and `PORT` (e.g. behind its own vhost or compose service). Characters,
  friends, guilds, presence, and the World Market are realm-scoped, so the
  worlds are fully isolated: players on different realms can't see, whisper,
  friend, guild, or share an auction house with each other. Concurrent boots
  serialize their schema setup behind a
  Postgres advisory lock, so starting several at once is safe. Character and
  guild names remain globally unique across realms.
- **Raid reset time zone**: raid lockouts end at the next 3 AM (03:00, the classic daily
  reset) in the realm's civil time zone. Set `REALM_RESET_TZ` to an IANA zone per
  realm process (e.g. `America/New_York`, `Europe/Paris`); it defaults to
  `America/New_York`. The process must run on a full-ICU Node (the default for
  modern Node); an unresolvable zone falls back to the default, and if even the
  default cannot be resolved the process fails fast at boot.
- **Bot gate (Cloudflare Turnstile)**: login and registration can be gated by
  Turnstile so headless clients (the aiohttp/websockets bot wave) can't create or
  sign into accounts. It is **off until configured**: both halves must be set or
  the gate silently does nothing:
  - `TURNSTILE_SECRET` (server runtime, secret): enables server-side verification.
  - `VITE_TURNSTILE_SITEKEY` (public): renders the widget. This is read by the
    **client and inlined at `npm run build` time**, so it must be present when the
    image/bundle is built, not just at runtime. Use a separate Turnstile widget per
    environment (dev vs prod). If the origin's nginx (in the `ansible-scripts` repo)
    sets a Content-Security-Policy, it must allow `script-src`/`frame-src
    https://challenges.cloudflare.com` or the widget won't load.
- **Wallet connection and linking**: injected Wallet Standard extensions and the
  direct Phantom/Solflare iOS and Android web handoffs work without configuration.
  To offer desktop website QR codes and handoff to Backpack, Jupiter, and other
  external apps, create a Reown project at
  `https://cloud.reown.com`, allow the production/staging/local website origins,
  and set the public `VITE_REOWN_PROJECT_ID` while building the client. Connecting
  authorizes the current browser session to ask the wallet app for signatures;
  linking is the separate one-time signature that saves the public address to a
  WoC account. The website Electron distribution instead opens the same deployed
  origin in the normal browser, where an installed wallet extension authorizes a
  short-lived link or purchase operation before returning through the app's custom
  URL. This browser handoff needs no additional environment variable. The app never
  receives a recovery phrase or private key. Wallet UI is enabled on website
  desktop/mobile and the website Electron distribution,
  and disabled on Capacitor iOS/Android and Steam. Reown AppKit 1.8 uses a
  community license with commercial-use thresholds, so confirm the current terms
  before production deployment. $WOC balance reads remain server-side only: set
  `SOLANA_RPC_URL` to a production Solana RPC endpoint and leave it unprefixed so
  API keys are not bundled into the client. `WOC_MINT` defaults to the canonical
  token mint and should only be overridden if that mint changes. Set
  `PUBLIC_ORIGIN` in single-realm production so shared player-card pages emit
  stable absolute Open Graph URLs.
- **Steam link + achievement mirror**: players can link a Steam account so
  their Book of Deeds achievements mirror to Steam (`server/steam/`). It is
  **off until configured**: with `STEAM_ENABLED` unset, every `/api/steam`
  route answers `steam.disabled`, the mirror is inert, and no client renders
  link UI. To enable, set `STEAM_ENABLED=1` plus the Steamworks `STEAM_APP_ID`
  and a publisher Web API key in `STEAM_WEB_API_KEY` (partner.steam-api.com)
  in the server runtime env. Docker Compose passes these three variables from
  the host `.env` into the game container. The key is a secret: it must never
  appear in logs or client code. Linking is a cosmetic mirror for deed
  achievements only; login with Steam does not exist.
- **Epic link + achievement mirror**: players can link an Epic account so
  their Book of Deeds achievements mirror to Epic Online Services
  (`server/epic/`). It is **off until configured** (merge-safe dark default):
  with `EPIC_ENABLED` unset or not exactly `1`, every `/api/epic/*` route
  answers `epic.disabled`, the mirror is inert, `/api/status` advertises
  `epic: { enabled: false }`, and no client renders Epic link UI. Default CI
  and `npm test` need no Epic secrets. To enable, set the following in the
  server runtime env (Docker Compose passes them from the host `.env` into the
  game container):

  | Key | Required when lit | Notes |
  |---|---|---|
  | `EPIC_ENABLED` | yes (exactly `1`) | Any other value keeps the surface dark |
  | `EPIC_PRODUCT_ID` | yes | EOS product id |
  | `EPIC_DEPLOYMENT_ID` | yes | EOS deployment id |
  | `EPIC_CLIENT_ID` | yes | EOS client id used by the server |
  | `EPIC_CLIENT_SECRET` | yes | Server only; never logged; never stamped into desktop builds |
  | `EPIC_SANDBOX_ID` | optional | Only if the chosen verify path needs it |

  Linking is a **cosmetic** mirror for deed achievements (and optional future
  ownership checks) only. **Login with Epic does not exist**; identity stays
  email + Discord. Client-supplied Epic account ids are never trusted. Do not
  confuse these server keys with BuildPatchTool upload credentials
  (`EPIC_BPT_*` in `docs/epic-games-integration/bpt-upload.md`), which never
  belong on the game server.
- **Claudium economy service**: `WOC_ECONOMY_SERVICE_URL` is resolved by the
  game server. Use `http://127.0.0.1:8798/v1/claudium/` only when both services
  run directly on the host. For the Compose game container with a host-run
  economy service, use `http://host.docker.internal:8798/v1/claudium/`.
  A separately deployed economy service should use its internal or remote DNS
  URL instead.
- **Never** set `ALLOW_DEV_COMMANDS=1` in production: it enables the full
  `/dev` cheat set (the level/teleport cheats the test bots use, plus item
  grants, mob spawns, instance teleports, and the dev command GUI).
- **Community test profile**: on a disposable public test realm, set
  `PROVISION_TEST_ACCOUNTS=1` in the host `.env`, then restart the game
  container. The flag gives newly created accounts nine level-20 characters,
  one per class, with complete Warfare gear and four maximum-size bags. It does
  not backfill existing accounts. (Rift portal density no longer needs a flag:
  every realm keeps one portal per eligible zone on an hourly rotation, so the
  former `COMMUNITY_TEST_RIFTS` toggle is gone.) The flag is off by default and
  does not enable dev
  commands, so keep `ALLOW_DEV_COMMANDS=0` on a public realm.

  For the initial community test, leave `RIFT_UPGRADER_URL` and
  `RIFT_UPGRADER_MODEL` unset and keep `RIFT_RUNTIME_ASSETS=0` unless remote AI
  and asset-job costs are explicitly part of the test. Monitor tick performance
  before opening the realm. To roll back, set both community flags to `0` and
  restart the game container. Disabling stops future roster seeding and dense
  Rift refill; characters already created remain, and persisted portals close
  through their normal clear or expiry lifecycle.
- **Bot detector (implementation)**: the open-source tree ships with a no-op stub
  (`server/bot_detector/stub.ts`). Detection hooks are wired in, but they observe
  nothing and never act. To bundle the real behavioral detector, clone the private
  `bot_detector` repo into `private/bot_detector` **before** `npm run build` (or
  `npm run build:server`). The Docker build copies `private/` into the build stage,
  so the same rule applies to deploys that run `docker compose build`: the private
  checkout must exist before the image is built. That directory is not part of the
  public checkout. At build time, confirm which implementation was picked:
  `[build:server] bot detector: stub (no-op)` vs `... bot detector: private`.
- **Anti-bot runtime knobs**: `MAX_WS_PER_IP_HARD` (default `20`) caps simultaneous
  WebSocket connections per source IP; extra connections are refused at the
  handshake. `ANTIBOT_ENFORCE=1` lets the detector act on its findings (e.g. kick);
  when unset, detection is observe-only. With the no-op stub, enforcement has no
  effect regardless of this flag.
- **Metrics endpoint**: `GET /metrics` (Prometheus exposition) is **off until
  configured**: it answers 404 unless `METRICS_TOKEN` is set in the server
  runtime env. When set, the scraper must send `Authorization: Bearer <token>`
  (anything else gets an opaque 401). Configure the token on **both** the server
  and the Prometheus scrape job in the same change or scraping goes dark, and point
  the scrape job at `127.0.0.1:8787/metrics` on the host: the public edge answers
  404 for the ops paths (`/livez`, `/readyz`, `/metrics`) and for the whole
  internal API (`/internal/*`) once the Caddy block below is in place. `/livez`
  and `/readyz` need no token, but they are for the container healthcheck and the
  host watchdog, which read them locally and never through Caddy; nothing on the
  public internet needs them.
  Series-cardinality note for the v0.32.0 deploy: the zone label vocabulary
  behind the harvest and fishing counter families grew from 3 zones to 14,
  so every zone-labeled counter now pre-registers 42 series (zone x tier or
  zone x band) instead of 9, about 4.7x per family, and dashboards or alerts
  that enumerate zone label values need re-pointing at the new ids. The
  full cross product is still pre-registered at boot by design (a Prometheus
  counter cannot backfill a scrape), and no per-request cardinality bound
  changed: the vocabularies stay content-derived and bounded.
- **Multi-realm scraping**: one server process hosts exactly one realm, and no
  exported series carries a `realm` label (pinned by the exporter tests; the
  DB-backed business family filters on the realm in its queries instead). Give
  each realm process its own scrape target and attach realm identity as a
  target label in the scrape config, e.g.
  `static_configs: [{ targets: ['127.0.0.1:8787'], labels: { realm: 'emberfall' } }]`
  per realm port. Counters then sum cleanly across realms
  (`sum(woc_fishing_catches_total)` is world-wide). The one exception:
  `woc_rod_fee_copper` is a static content gauge published IDENTICALLY by
  every realm process, so aggregate it with `max()` (or `avg()`), never
  `sum()`. Both series carry a `recipe` label and the two rod fees DIFFER,
  so the aggregation must keep that label or the product multiplies every
  training by the single highest fee: the copper the rod fees took across
  realms is
  `sum(sum by (recipe) (woc_rod_fee_payments_total) * max by (recipe) (woc_rod_fee_copper))`.
- **Discord bot series (Grafana)**: the bot reports its rate-limit governor
  counters on the presence push it already sends, so `/metrics` carries them with
  no extra scrape target and no bot-side endpoint. Cumulative counters
  (`rate()` and `increase()` apply; the server accumulates across bot restarts, so
  rendered totals never go backwards): `woc_discord_bot_requests_total`,
  `woc_discord_bot_rate_limited_total` (labeled `scope` over `user`, `global`,
  `shared`, `unknown`), `woc_discord_bot_global_pauses_total`,
  `woc_discord_bot_ban_pauses_total`, `woc_discord_bot_breaker_opens_total`,
  `woc_discord_bot_forbidden_blocks_total`, `woc_discord_bot_breaker_blocks_total`,
  `woc_discord_bot_queue_full_blocks_total` (requests refused because a bucket
  queue was at its cap: a saturated backlog shedding load during an incident).
  Live gauges: `woc_discord_bot_queue_depth`, `woc_discord_bot_tracked_buckets`,
  `woc_discord_bot_tracked_routes`, `woc_discord_bot_active_queues`,
  `woc_discord_bot_forbidden_entries`, and `woc_discord_bot_breaker_state`
  (labeled `state` over `closed`, `open`, `half-open`; 1 on the active state,
  all three 0 when nothing is reporting a state: never pushed, stale, or the
  last push carried an unrecognized state value). The two
  signals worth alerting on at 2am: **breaker opens** (any increase of
  `woc_discord_bot_breaker_opens_total` means the bot tripped its own circuit
  breaker; any open at all is worth an alert) and the **429 rate**
  (`sum(rate(woc_discord_bot_rate_limited_total[5m]))`; after the stability
  packet, normal is near zero, so a sustained climb is the next storm forming).
  The five live gauges and the breaker state read zero five minutes after the
  bot stops pushing (the same staleness rule the presence snapshot uses) while
  the cumulative counters hold their totals. `woc_discord_bot_push_age_seconds`
  (time since the last bot push) is neither: it keeps GROWING through
  staleness, with two caveats to read it by. It renders 0 in a server process
  that has never received a push, so a game-server restart while the bot is
  down reads momentarily fresh (the all-zero counters beside it are the tell),
  and the presence push is event-driven (a debounce over presence and voice
  events), so a growing age can be a genuinely quiet guild as well as a dead
  bot. Liveness belongs to the bot container's own healthcheck; the push age
  says how old the numbers are, not whether the bot is alive.
- **Game watchdog (wedge recovery)**: `deploy/game_watchdog.sh`, installed as
  `/usr/local/bin/eastbrook-watchdog` and fired every minute from
  `/etc/cron.d/eastbrook-watchdog`. Docker's `restart: unless-stopped` only acts when
  the container process EXITS, so a wedged-but-alive container (world loop stalled,
  port still held) sits there until a human ssh-es in. The compose healthcheck probes
  `GET /livez`, which answers **503 once the world loop has not completed a pass in
  over 30 seconds** (unauthenticated on the server port, and hidden at the public
  edge: see the Caddy note below); Docker turns that
  into a container health status; the watchdog reads that status and restarts the
  container **only** on `unhealthy`. Never on `starting`, never on `healthy`, and
  never when the container is stopped or its image predates the healthcheck. It never
  touches a **draining** container, and cannot: a drain deliberately holds `/livez` at
  200 so a graceful shutdown is never misread as a wedge, so a draining container
  never reports unhealthy. A five-minute cooldown (stamped in
  `/var/lib/eastbrook/watchdog-last-restart`) sits above the roughly two-minute floor
  before the healthcheck can re-evaluate a restart, so the watchdog never fires blind; a
  container that keeps re-wedging is restarted about once every five minutes (Docker's
  own `restart: unless-stopped` cannot help, since a wedge never exits the process), and
  an `flock` serializes overlapping cron fires. End to end, a wedge takes roughly 90
  seconds to flip `unhealthy`, up to a minute more before the next once-a-minute cron
  fire reads it, then up to the stop grace period to shut down, then a boot: budget
  about four minutes from stall to recovered when planning on-call. Dry-run
  it any time, it changes nothing:
  `sudo /usr/local/bin/eastbrook-watchdog --dry-run --verbose`. Actions land in
  `/var/log/eastbrook-watchdog.log`; it is silent when there is nothing to do.
  **Installing it on a host that is already running**: `deploy/user-data.sh` runs at
  EC2 **first boot only** and never runs again, so any host provisioned before the
  watchdog existed (or provisioned some other way) has to be given it by hand:

  ```bash
  cd /opt/eastbrook && sudo git pull
  sudo install -m 755 deploy/game_watchdog.sh /usr/local/bin/eastbrook-watchdog
  sudo install -d -m 755 /var/lib/eastbrook
  echo '* * * * * root /usr/local/bin/eastbrook-watchdog >> /var/log/eastbrook-watchdog.log 2>&1' \
    | sudo tee /etc/cron.d/eastbrook-watchdog
  sudo /usr/local/bin/eastbrook-watchdog --dry-run --verbose  # confirm it sees the container
  ```

  The watchdog only has something to read once the game container runs an image
  whose compose file carries the healthcheck, so install it alongside that deploy,
  not before it.
  **The Caddy ops block needs the same by-hand treatment**: `deploy/user-data.sh`
  writes the 404 block at first boot only, so a host provisioned before it existed
  still proxies `/livez`, `/readyz`, and `/metrics` to the public internet, and
  `/livez` can now answer 503, which tells anyone polling it exactly when the world
  loop is down. A host provisioned before THIS revision also still proxies the entire
  `/internal/*` surface (the restart countdown and the whole Discord bot API) to the
  public internet: an operator who copies the older three-path snippet leaves
  `/internal/*` public, which is exactly what the matcher below fixes. Look at each
  public site block of `/etc/caddy/Caddyfile` and pick the case that matches:

  If the block ALREADY has an `@ops path ...` matcher (any host provisioned by
  `deploy/user-data.sh` since the watchdog era), add ` /internal/*` to the end of that
  existing line and leave its `handle @ops { respond 404 }` block alone.

  If the block has no `@ops` matcher yet, add the pair below. The bare form works when
  the block proxies with a bare `reverse_proxy` (the shape in section 4 above), because
  `respond` runs before a bare `reverse_proxy` and nothing else needs to move:

  ```
  @ops path /livez /readyz /metrics /internal/*
  respond @ops 404
  ```

  But if the block proxies through a `handle { reverse_proxy ... }` wrapper (the shape
  `deploy/user-data.sh` writes), a bare `respond` never runs: `handle` precedes
  `respond` in Caddy's directive order and the catch-all handle terminates the request
  first. There, wrap it, `handle @ops { respond 404 }` with the same matcher line, and
  place it ABOVE the catch-all handle (the first matching handle wins).

  Then validate and reload, and confirm from outside (both an ops path and an
  internal one; a 200 here means the matcher was added in a form the block ignores,
  see above):

  ```bash
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/livez  # expect 404
  curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/internal/discord/outbox  # expect 404
  ```

  The healthcheck and the watchdog are unaffected: both read the container's own
  port and never traverse Caddy.
- **API dispatch (rollback)**: every REST surface (`/api`, `/admin/api`, `/oauth`,
  `/internal`) runs through the in-house request pipeline by default. To roll back to
  the old handler ladder, set `API_DISPATCH=legacy` in the server runtime env and
  restart the process: it is one flag, no code redeploy. Leaving it unset (or `new`)
  keeps the new pipeline. The boot log warns with an `ALERT` line only when the legacy
  ladder is serving in production, which after this default flip means the warn fires
  exactly when someone has rolled back (`API_DISPATCH=legacy`), a deliberate choice
  worth noticing rather than a routine boot.
- **Env hygiene: no empty numeric placeholders.** A SET-BUT-EMPTY numeric env
  line (`CHAT_LOG_RETENTION_DAYS=`, `PORT=`, `MAX_WS_PER_IP_HARD=`,
  `PERF_REPORT_RETENTION_DAYS=`, `DAILY_REWARD_EVENTS_RETENTION_DAYS=`,
  `ONLINE_SAMPLES_RETENTION_DAYS=`, `SITE_PRESENCE_RETENTION_DAYS=`,
  `PLAY_SESSION_RETENTION_DAYS=`, `ACCOUNT_IP_ASSOCIATION_RETENTION_DAYS=`) now means
  the DEFAULT, not `0`. Before the
  validated config loader, `CHAT_LOG_RETENTION_DAYS=` resolved to `0` (keep chat
  logs forever); the same line now resolves to the 90-day default and pruning
  turns ON. Audit deployed env files for empty placeholder lines: delete the
  line to take the default, or set an explicit value (`CHAT_LOG_RETENTION_DAYS=0`
  is still keep-forever). Two more rows follow the same "empty means the DEFAULT"
  contract:
  - `NODE_OPTIONS=` (empty) means node's own defaults, which node sizes from TOTAL
    system memory rather than the container's `mem_limit`, so on a host larger than the
    limit node can grow past it and be OOM-killed mid-tick. Set a heap cap under the
    limit on any host with the memory to back it, for example
    `--max-old-space-size=4096` under the 5g `mem_limit` in `docker-compose.yml`: size
    the two together and a runaway heap kills node inside the container, which Docker
    restarts, rather than sending the kernel OOM-killer hunting for a victim on the
    host. Raising the heap cap above the container limit trades one failure for a worse
    one. Set this explicitly in the production `.env` (it is empty by default so a small
    dev host is not handed a heap cap it cannot back).
  - `MAX_PLAYERS_PER_REALM=` (empty) means the built-in default of 5000. A positive
    value is the number of sessions a realm admits before it refuses fresh WebSocket
    joins (`/api/status` advertises the value, so the realm list can show Full
    honestly); an explicit `0` disables the cap entirely. The default is a guard rail,
    not a capacity estimate: what a realm can actually carry depends on the host, so
    measure yours and set the number you measured.
  - `DAILY_REWARD_EVENTS_RETENTION_DAYS=`, `ONLINE_SAMPLES_RETENTION_DAYS=`,
    `SITE_PRESENCE_RETENTION_DAYS=`, `PLAY_SESSION_RETENTION_DAYS=`,
    `ACCOUNT_IP_ASSOCIATION_RETENTION_DAYS=`, and
    `UNSTUCK_REPORT_RETENTION_DAYS=` (empty) follow the
    `CHAT_LOG_RETENTION_DAYS` contract exactly: an empty line means the default,
    and an explicit `0` is keep-forever. The unstuck table carries account and
    character ids plus positions, so audit its window with the same care as
    the IP tables.
  - `RETENTION_SWEEP_UTC_HOUR=` and `RETENTION_SWEEP_MAX_ROWS_PER_RUN=` are NOT
    keep-forever-shaped: their raw value is trimmed, so an empty or whitespace line
    also reads as the DEFAULT, but an explicit `0` is a live value: a 00:00 UTC
    sweep hour, or a zero-row budget that disables the nightly sweep.
- **`DB_POOL_MAX_CLIENTS`: production deliberately stays at the default of 10.**
  The load rig measured the wall this buys: on the 10-client default a login ramp
  pins the pool from roughly 487 concurrent players, `woc_db_pool_clients{state="waiting"}`
  oscillates with the 30-second autosave waves, and joins slow to a crawl, while the
  players already in stay playable. The SYMPTOM an operator sees is players reporting
  "Authentication timed out" while `woc_db_pool_clients{state="waiting"}` holds above
  zero between autosave waves; that pair means pool saturation, not an auth outage.
  The response: raise `DB_POOL_MAX_CLIENTS` a few clients at a time (it accepts 1 to 97
  and rejects loudly outside that), never straight to the ceiling, and keep the budget
  arithmetic in view: realms sharing one `DATABASE_URL` multiply, and each realm also
  takes one boot client, so realms x pool + realms must stay at or under the 97 usable
  connections on stock `postgres:16` (`max_connections` 100, 3 superuser-reserved).
  The boot log warns when the configured multiplication breaks that budget.
- **Nightly retention sweep.** The batched retention prunes run once per UTC day
  at `RETENTION_SWEEP_UTC_HOUR` (default 05:00 UTC) behind a database advisory
  lock, so with several processes on one database exactly one of them sweeps.
  Deletes run as small back-to-back batches under a per-table row budget
  (`RETENTION_SWEEP_MAX_ROWS_PER_RUN`), so raising the budget for a catch-up
  should be done deliberately, in a quiet window. The last-swept day is recorded
  in the database, so a restart or deploy later the same day does not re-run the
  sweep at peak. One timing caveat: the sweep fires on the first poll (about a
  minute after listen) whenever the process boots past the sweep hour on a day
  whose sweep has not yet recorded itself, so the first deploy of this feature,
  or any deploy landing before that day's sweep has run, performs the catch-up
  at deploy time rather than at the off-peak hour. Deploy off-peak, or set
  `RETENTION_SWEEP_MAX_ROWS_PER_RUN=0` for the deploy and restore it afterward.
  After a rollback to an older binary, the admin overview's
  all-time online peak can read lower until you roll forward again: the folded
  value is preserved, the older reader just does not consult it. Rollback
  caveat: binaries older than the sweep run one unbatched chat-log prune at
  boot, before listen and with no error containment, so a large chat-log
  backlog (budget-capped nights, or a stretch with the row budget set to 0)
  can make that boot delete time out and the old binary fail to start. Before
  rolling back to a pre-sweep binary, let the sweep catch up (or drain the
  backlog manually in bounded batches) so the old boot prune has little to do.
  Play-session rollback caveats, same shape: once play sessions have folded,
  a binary older than the fold reads lifetime playtime lower by the folded
  amount (character select and the admin views; the rollup rows are preserved,
  the older readers just do not consult them), and its boot recreates the
  daily-rewards exclusion view without the association arm, so accounts whose
  banned-IP sessions already folded regain daily-reward eligibility until you
  roll forward again. Folded raw session rows themselves are recoverable only
  from the nightly database dump. The first sweep after this feature deploys
  also performs the largest fold it will ever do (the whole backlog, budget-
  capped per night), so the deploy-time catch-up guidance above applies with
  extra weight.
- **`/api/discord` status cache** (game service). The account-scoped part of the
  `GET /api/discord` payload is served from a per-account in-memory cache; every
  in-process write (link, unlink, grants, swag claims, password set, guild-member
  and pushed-meta updates) evicts the affected account immediately, so the TTL only
  bounds staleness for writes a PEER realm process made. Honest cost accounting: a
  cache hit removes the four PAYLOAD queries; the request still pays its auth reads
  (bearer-token resolve plus moderation status) like every authenticated endpoint,
  so the incident's per-request database cost drops by the payload share, not to
  zero. Brownout behavior changed with the cache: a warm account now answers 200
  with the last good payload while the PAYLOAD queries are failing but the auth
  reads still resolve (each such read still attempts a refresh first, and
  cached_read warns once per failure streak in the game log); a cold account
  still errors, and a total database outage still fails every request at auth,
  before the cache is ever consulted. Two keys, both following the "empty,
  non-numeric, or non-positive means the DEFAULT" contract:
  - `DISCORD_STATUS_CACHE_TTL_MS=` (empty) means the default 15000 (15 seconds).
    Raising it saves little (a cache hit is already free of payload queries) and
    widens the cross-process staleness window; lowering it toward 0 is not possible
    (a non-positive value reads as the default, never as caching off).
  - `DISCORD_STATUS_CACHE_MAX_ENTRIES=` (empty) means the default 2000 accounts
    (double the 1,000-concurrent-player design envelope; a few hundred bytes per
    entry, unserved columns are kept out of the cached shape). Past the cap the
    least-recently-read account is evicted and its next status read costs one
    extra set of payload queries, never an error.
- Logs: `sudo docker compose -f /opt/eastbrook/docker-compose.yml logs -f game`.
- If the instance ever feels tight, stop, change instance type,
  start. Everything lives in Docker plus one EBS volume, so nothing
  else changes.

## Discord bot

The Discord bot (`bot/`) is a standalone Node process that bridges the official
Discord server and the game: status-tier roles plus a level-on-name nickname synced
from in-game data, presence (the online count and the featured voice room) pushed
into the HUD widget, in-game "!" community posts relayed as embeds, a
significant-activity feed (max level, rare drops, duels, arena), daily-rewards
winner posts, and the consumer for the game's Discord outbox. It is a pure consumer
of the game server: it reads and writes through the secret-gated
`/internal/discord/*` API and holds nothing durable of its own, so stopping it never
affects the realm.

**Enabling it.** The bot is the `discord-bot` compose service (container
`eastbrook-discord-bot`), behind the `discord` profile and sharing the game image, so
it needs no separate build:

```bash
sudo docker compose --profile discord up -d
```

Without `--profile discord` the service simply never starts, which is the supported
way to run a realm with no Discord integration. Set the required keys in the host
`.env` beside `docker-compose.yml` before the first start.

### Environment keys

Compose passes every key below from the host `.env` into the container (the one
exception is `GAME_SERVER_URL`, which compose pins to the in-network address, so
repointing it is a `docker-compose.yml` edit), so changing a tunable is an edit plus
`sudo docker compose --profile discord up -d discord-bot`, never an image rebuild. Every numeric key falls back to its built-in default on an
empty or non-positive value, so an unset key is always safe and a blank line in
`.env` never means zero.

**Required** (the bot throws at boot without them):

| Key | Default | What it does / incident guidance |
|---|---|---|
| `DISCORD_BOT_TOKEN` | none, required | Bot token from the Discord developer portal. A wrong or revoked token is a fatal gateway close: see the crash-loop note below. |
| `DISCORD_CLIENT_ID` | none, required | Application (client) id, used to register the `/whoami` and `/link` slash commands. |
| `DISCORD_GUILD_ID` | none, required | The one guild the bot operates in. |
| `DISCORD_BOT_SECRET` | none, required | Shared secret for the game's `/internal/discord/*` API. It must match the server's `DISCORD_BOT_SECRET` exactly, or every call the bot makes is rejected and nothing syncs. |

**Connection:**

| Key | Default | What it does / incident guidance |
|---|---|---|
| `GAME_SERVER_URL` | `http://game:8787` from compose (`http://127.0.0.1:8787` in code) | Base URL for the internal API. Compose pins this one (no host `.env` interpolation), so changing it means editing `docker-compose.yml`. Leave the compose value alone unless the game runs outside this compose network, and in that case point it at a private or loopback address of the game host, never the public domain: the edge answers 404 for all of `/internal/*`, so a bot aimed through Caddy syncs nothing, and every internal call carries `DISCORD_BOT_SECRET` over plain `http`, so any hop that leaves the host or the private network exposes the shared secret in transit regardless of what the edge answers. |
| `PUBLIC_GAME_URL` | `http://localhost:8787` from compose (`https://worldofclaudecraft.com` in code) | The public URL shown in bot replies and deep-link buttons. Set it to your real domain, or players get links they cannot use. |

**Channel ids** (each feature is off when its channel is unset):

| Key | Default | What it does / incident guidance |
|---|---|---|
| `DISCORD_VOICE_CHANNEL_ID` | unset | The featured voice room surfaced in the in-game Discord widget. |
| `DISCORD_WELCOME_CHANNEL_ID` | unset | Read at boot but currently unwired: no welcome message is posted, deliberately. |
| `DISCORD_TEST_CHANNEL_ID` | unset | One-time "bot online" startup announcement, and the last-resort fallback channel for relay and activity posts. |
| `DISCORD_RELAY_CHANNEL_ID` | falls back to the test channel | Where in-game "!" community posts land. With neither this nor the test channel set, drained relay items are DROPPED after a once-per-channel notice, so set one before opening the feature to players. |
| `DISCORD_ACTIVITY_CHANNEL_ID` | falls back to relay, then test | Where the significant-activity feed lands. Same drop rule as relay. |
| `DISCORD_DAILY_REWARDS_CHANNEL_ID` | unset | Daily-rewards top-10 winner posts. Unlike relay and activity, an unset channel drops nothing: a winner day is marked on the server only after its post lands, so it is re-served until it can be announced. |

**Behavior:**

| Key | Default | What it does / incident guidance |
|---|---|---|
| `DISCORD_SYNC_NICKNAMES` | `1` from compose (on unless the value is exactly `0`) | Sync each linked member's Discord nickname to carry their in-game level. Set it to `0` to stop every nickname PATCH at once, which is the fastest way to shed Discord write volume without stopping the bot. |

**Governor** (the rate-limit levers, and the first place to reach during a Discord
incident):

| Key | Default | What it does / incident guidance |
|---|---|---|
| `DISCORD_MAX_RPS` | `8` | Ceiling on requests per second to Discord (their own limit is 50). Lower it (2 to 4) during a 429 storm or while a Cloudflare ban keeps recurring; the sweeps just take longer. Raising it above the default is how the 2026-07-29 incident is reproduced, not how it is fixed. |
| `DISCORD_BAN_PAUSE_MS` | `600000` (10 minutes) | Process-wide pause after a 429 whose body is not JSON, which is how Cloudflare answers once it has started banning. Raise it if bans keep recurring; lowering it retries into a live ban and extends it. |
| `DISCORD_BREAKER_LIMIT` | `300` | Invalid responses inside one rolling 10 minute window that open the request breaker (Discord's own ban threshold is 10000). Lower it to make background traffic stop sooner during an incident: an open breaker refuses sweeps and outbox drains while essential traffic such as a slash-command reply keeps flowing. |
| `DISCORD_FORBIDDEN_TTL_MS` | `86400000` (24 hours) | How long a member's 400, 401 or 403 is remembered before that member is retried (a 400 is a payload Discord permanently rejects, such as a nickname it will never accept). Raise it when a permissions problem is flooding the log with repeats. Lower it right after FIXING a permission (for example granting Manage Nicknames) so the affected members re-sync instead of waiting out the day. |

**Cadences** (how often each loop runs; raising them all is the blunt way to cut the
bot's share of game-server request volume):

| Key | Default | What it does / incident guidance |
|---|---|---|
| `DISCORD_ROLE_SYNC_INTERVAL_MS` | `300000` (5 minutes) | The floor between role-sync passes, and the cadence of the special-roles refresh, the members-meta push, and the tier-role refresh. Raise it to cut Discord write volume and internal reads together. |
| `DISCORD_PRESENCE_DEBOUNCE_MS` | `4000` | The window over which a burst of voice and presence events folds into one push. Raise it during a busy voice event to collapse more of the burst; the widget just updates a little later. |
| `DISCORD_SWEEP_SLICE_MS` | `3000` | How long the linked-member sweep waits between slices while a pass is live. Raise it to spread the same pass over more wall-clock time. |
| `DISCORD_SWEEP_SLICE_SIZE` | `100` | How many linked members one slice asks about, and may write to. Lower it together with the slice interval to cut the peak Discord write rate a single tick can queue. |
| `DISCORD_OUTBOX_POLL_MS` | `3000` | The active poll cadence while the outbox keeps returning work. Raise it to cut the bot's share of game-server requests, at the cost of relay and activity latency. |
| `DISCORD_OUTBOX_IDLE_MS` | `15000` | Where that cadence decays to once the drains come back empty. The first queued item snaps the loop straight back to the active cadence, so raising this costs no latency on a quiet realm. |
| `DISCORD_OUTBOX_TIMEOUT_MS` | `70000` | The abort deadline for ONE outbox poll. It must stay ABOVE the game server's 65 second read deadline on the outbox long poll: set lower, every poll aborts client-side before the server can answer, and items the server already drained are lost. 70000 is an ENFORCED floor: the bot logs a warning and uses 70000 for any lower value, so the knob can only raise the deadline. |

**Heartbeat** (liveness, read by the container healthcheck):

| Key | Default | What it does / incident guidance |
|---|---|---|
| `DISCORD_HEARTBEAT_FILE` | `/tmp/discord-bot-heartbeat` | The file the bot's scheduler stamps. Both the bot and the healthcheck read this key, so change it in the host `.env` only, where both see the same value. |
| `DISCORD_HEARTBEAT_INTERVAL_MS` | `30000` | How often the scheduler loop rewrites the stamp. Time-to-red is set by the staleness window below, not by this, so lowering this alone buys nothing: to detect a wedge sooner, lower `DISCORD_HEARTBEAT_STALE_MS` and keep it a comfortable multiple of this interval. |
| `DISCORD_HEARTBEAT_STALE_MS` | `90000` | Healthcheck side ONLY (the bot itself never reads it): how old the stamp may be before Docker calls the container unhealthy. Keep it a comfortable multiple of the interval, so one slow write is not read as a stall. Empty, non-numeric and non-positive values all fall back to the default, same as the bot's own numeric knobs. |

Not every deadline is an env key. Three request bounds are code constants in `bot/`,
where the suite can pin them against literals: `SERVER_CALL_TIMEOUT_MS` and
`DEFAULT_OUTBOX_TIMEOUT_MS` in `bot/server_client.ts` (an ordinary internal-API call,
and the outbox long poll's much longer deadline) and `DISCORD_CALL_TIMEOUT_MS`
(15000) for one call out to Discord. Changing one of those is a code change and a
rebuild, not an `.env` edit.

### Verifying health

The container healthcheck probes the FRESHNESS of the heartbeat file, not the
presence of a process, because the failure that actually happens is a live process
whose loops have stopped turning:

```bash
# health status, and the last few probe results with their output
sudo docker inspect --format '{{json .State.Health}}' eastbrook-discord-bot

# the same thing by hand: how old the heartbeat stamp is, in milliseconds
# (resolves DISCORD_HEARTBEAT_FILE the same way the probe does, so it follows an override)
sudo docker exec eastbrook-discord-bot node -e "const p=(process.env.DISCORD_HEARTBEAT_FILE||'').trim()||'/tmp/discord-bot-heartbeat';const s=require('fs').statSync(p);console.log(p, Date.now()-s.mtimeMs)"
```

Healthy is an age under 90000 (`DISCORD_HEARTBEAT_STALE_MS`). A red healthcheck
means the scheduler loop stopped turning even though the process is alive, and
nothing restarts it for you: `restart: unless-stopped` acts on process exit only, so
a red probe is an operator signal, not a self-healing one. Act on it with:

```bash
sudo docker compose --profile discord restart discord-bot
```

The container also runs under `mem_limit: 512m` with `memswap_limit: 512m`, so a leak
kills the bot rather than the game or the database sharing the host, and
`stop_grace_period: 15s`, which is ample because the bot has nothing to save: the
outbox lives on the server and redelivers anything unacknowledged on the next poll.

### Fatal gateway close: the crash loop is by design

A close the bot cannot recover from (an invalid token, or the privileged
`GUILD_MEMBERS` and `GUILD_PRESENCES` intents not enabled for the application in the
developer portal) EXITS the process with code 1, so the restart policy acts on it.
With the cause still unfixed the container restarts, fails the same way, and Docker's
backoff spaces the attempts further apart: `sudo docker ps` shows it flipping between
`Restarting` and a few seconds of uptime, and the logs repeat the same close code.
That visible crash loop is deliberate (there is no retry limiter and no supervisor by
design). The alternative, and what the 2026-07-29 incident actually produced, is a
silent zombie: a process that stays up forever having quietly stopped doing anything.
The fix is to correct the token or enable the intents and restart, never to disable
the restart policy.

### Incident runbook

The four commands below are the ones used to diagnose the 2026-07-29 traffic spike
(`docs/discord-bot-stability/incident-2026-07-29.md`), each with what a healthy
reading looks like now.

```bash
# request rate + breakdown from game access logs
sudo docker logs --since 60m eastbrook-game 2>&1 | grep '"msg":"access"' \
  | grep -o '"route":"[^"]*"' | sort | uniq -c | sort -rn | head -15
```

Healthy: normal player and site routes dominate the top of the list, and the
`/internal/discord/*` routes are a trickle near the bottom. During the incident the
internal routes were most of the list.

```bash
# who is generating it (internal 172.18.0.x vs external)
sudo docker logs --since 60m eastbrook-game 2>&1 | grep '"msg":"access"' \
  | grep -o '"ip":"[^"]*"' | sort | uniq -c | sort -rn | head -10
```

Healthy: the internal docker-network addresses (`172.18.0.x`, the bot) are a small
share of the total. During the incident they were about 45 percent of every request
the game served.

```bash
# bot 429 timeline
sudo docker logs -t eastbrook-discord-bot 2>&1 | grep 429 | cut -c1-13 | sort | uniq -c
```

Healthy: zero or near-zero lines per hour. Any sustained hourly count is the retry
storm restarting; the incident peaked at 35000 to 38000 per hour.

```bash
# connections to the game's internal API
sudo ss -tn state established '( dport = :8787 )' | wc -l
```

Healthy: low tens, against roughly 110 held continuously during the incident.

**Escalation levers**, in order. Each is an `.env` edit plus
`sudo docker compose --profile discord up -d discord-bot`:

1. **Lower `DISCORD_MAX_RPS`** (8 down to 2 to 4). This is the direct brake on
   Discord-side volume and the one that stops a ban from recurring.
2. **Raise the sweep and outbox cadences** (`DISCORD_SWEEP_SLICE_MS`,
   `DISCORD_ROLE_SYNC_INTERVAL_MS`, `DISCORD_OUTBOX_POLL_MS`,
   `DISCORD_OUTBOX_IDLE_MS`) and lower `DISCORD_SWEEP_SLICE_SIZE`. This is the brake
   on the bot's share of the GAME server's request volume. Do not lower
   `DISCORD_OUTBOX_TIMEOUT_MS` while doing this.
3. **Stop the bot** as the definitive lever:

   ```bash
   sudo docker compose --profile discord stop discord-bot
   ```

   The game is unaffected. The bot is a pure consumer, so stopping it costs role,
   nickname, presence, relay, and activity sync until it is started again, and
   nothing else. Queued outbox items stay on the server and are delivered when it
   comes back.

## Deploying an SFX Studio export

Follow the full local authoring and pre-export checklist in the
[SFX Studio tutorial](docs/sfx-studio-tutorial.md).

Deploy the game code containing the runtime SFX pack loader once, including a
store or OTA rollout for native clients. After that, audio-only Studio exports
for the same compiled catalog do not require another web or native client build.
Native clients fetch compatible packs from their configured production origin;
if that request fails, they keep using the SFX bundled with the app.

1. In SFX Studio, publish each finished audio master and apply the playback mix.
2. Click Export All and extract the downloaded ZIP on the production host.
3. Ensure the persistent overlay belongs to the deploy user, then run the
   installer from the extracted artifact:

   ```bash
   sudo mkdir -p /opt/eastbrook/sfx-runtime
   sudo chown "$USER":"$(id -gn)" /opt/eastbrook/sfx-runtime
   sh install.sh /opt/eastbrook/sfx-runtime
   ```

4. Keep the overlay persistent and set `SFX_PACK_DIR` to its `audio/sfx`
   directory. Docker Compose does this with `EASTBROOK_SFX_DIR`, which defaults
   to `./sfx-runtime` beside the compose file.

The POSIX installer needs only `/bin/sh` and either `sha256sum` or `shasum`; the
bootstrap installs `unzip` for extracting the artifact. A Node-based
`install.mjs` alternative is included too. The installer verifies every
content-addressed MP3, installs immutable blobs first, and atomically replaces
`runtime-pack.json` last. It does not delete old
blobs, because already-open clients and rollback may still reference them. An
artifact with a different compiled catalog hash, a missing fixed key, or an
unsupported extra key is rejected by the client and needs a normal game
deployment instead. Compatible constrained mob-subfamily keys may be added by
an artifact.

## Automatic production CPU incident capture

`npm run ops:cpu-monitor` watches Docker CPU and attaches to the game only after a
confirmed trigger. By default it polls every 30 seconds, confirms that two of three
samples exceed 90%, and then records a 20-second V8 CPU profile at a 4 ms sampling
interval. The profile is temporary and event-triggered, so the profiler has no
steady-state game-loop cost.

Run the monitor as a supervised service on an always-on private operations host,
not in the game container. The Levy Street deployment should manage that service
in the private Ansible repo, where SSH aliases and credentials already live. A
representative direct invocation from that host is:

```bash
npm run ops:cpu-monitor -- \
  --direct \
  --host world-of-claudecraft-prod \
  --container eastbrook-game \
  --out-dir /var/lib/woc-prod-cpu-monitor
```

The service unit should use `Restart=always`, `RestartSec=10`, `UMask=0077`, an
unprivileged local user, and the repository checkout as its working directory. With
systemd, use `StateDirectory=woc-prod-cpu-monitor` and
`StateDirectoryMode=0700`; the monitor safely initializes an empty, private,
service-owned directory on first use. The remote SSH principal needs narrowly
controlled access to the Docker operations used by the script and to `flock` for
capture serialization. General `sudo docker` access is effectively root access.
Use a dedicated principal plus a root-owned forced-command or validation wrapper
that admits only the exact expected commands for the named container; do not grant
a wildcard Docker sudo rule to an ordinary account. The PID and profiler clients
are immutable, root-owned helpers copied into `/app/ops` by the production image,
and their `docker exec` calls do not consume client-supplied stdin. The wrapper must
validate the complete `SSH_ORIGINAL_COMMAND`, reject unexpected stdin, and allow
only those fixed helper paths. Checking only a `docker exec` command prefix still
permits arbitrary code execution in the production container and is not sufficient.

The monitor verifies private file ownership and permissions, uses local and remote
exclusive locks, and retains at most 24 validated captures or 30 days of captures.
Captures and process logs can contain sensitive operational data, so the artifact
directory must stay private and must not be served over HTTP.

Each incident directory includes `cpu.cpuprofile`, game and perf logs,
container/process snapshots, Docker stats before/during/after, metadata, and SHA-256
checksums. Open `cpu.cpuprofile` with the Load profile action in the Chrome DevTools
Performance panel. Review `metadata.json` first: `complete` should be true and
`profileStartDelayMs` records the delay until the profiler acknowledged it had
started. A fully complete directory also contains a `COMPLETE` marker written after
the metadata and checksum manifest. A valid CPU profile is retained even if
supporting context is degraded. The `errors` array explains any missing auxiliary
artifact without triggering a second profile every two minutes.

Detailed tick-profiler JSON is optional. It requires an existing staff bearer that
can access the `ops.perf` admin routes, supplied through a service-owned mode-0600
file with `--ops-token-file`. The current role model does not provide a dedicated
machine-only bearer, so do not copy a broad personal admin session into the service.
Provision a narrowly scoped service credential in the server before enabling this
option. When enabled, `tickCapture` in `metadata.json` must be `complete`.
The tick result also records loop callback count, sim tick count, catch-up callback
count, and maximum ticks per callback so callback aggregation is visible during a
saturation event.

Before enabling the service, verify its SSH user has only the required passwordless
Docker commands and run one controlled check:

```bash
npm run ops:cpu-monitor -- --once --dry-run --direct \
  --host world-of-claudecraft-prod \
  --container eastbrook-game \
  --out-dir /var/lib/woc-prod-cpu-monitor
```

Once automatic tick capture is working, remove `PERF_TICK_LOG=1` from production.
The admin-triggered profiler enables detailed sim sub-phase timing only during its
wall-clock capture window; leaving the environment flag enabled would keep that
extra instrumentation active on every tick.

## Admin dashboard

The admin dashboard (account/character/session metrics, live players,
server health) is served by the same game server process:

- **Production**: point `admin.worldofclaudecraft.com` at the instance
  (A record) and add a server block for it in the nginx config in the
  internal `ansible-scripts` repo, proxying to the same game port as the
  main site. The Node server serves the dashboard for any hostname
  starting with `admin.`.
- **Standalone/Caddy**: set `ADMIN_DOMAIN` in `deploy/user-data.sh`
  (or add the extra site block to `/etc/caddy/Caddyfile` by hand).
- **Local dev**: open `http://localhost:8787/admin` (or `/admin` under
  `npm run dev`).

Access requires signing in with a game account that has the `is_admin`
flag. The hostname only selects which HTML shell is served; every
`/admin/api/*` call is checked against the account flag.

Grant the first admin:

```bash
# locally
npm run admin:grant -- <username>

# on the box (the runtime image only ships bundled code, so use psql)
sudo docker exec eastbrook-db psql -U eastbrook eastbrook \
  -c "UPDATE accounts SET is_admin = TRUE WHERE username = '<username>';"
```

Revoke with `npm run admin:grant -- <username> --revoke` (or set the
flag to `FALSE` in SQL).
