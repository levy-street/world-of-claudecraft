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

```bash
ssh ubuntu@<elastic-ip>
cd /opt/eastbrook
sudo git pull
sudo docker compose up -d --build
```

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
- **Wallet linking**: the wallet UI uses injected Solana browser wallets and no
  third-party wallet-connect project id. $WOC balance reads are server-side
  only: set `SOLANA_RPC_URL` to a production Solana RPC endpoint and leave it
  unprefixed so API keys are not bundled into the client. `WOC_MINT` defaults to
  the canonical token mint and should only be overridden if that mint changes.
  Set `PUBLIC_ORIGIN` in single-realm production so shared player-card pages
  emit stable absolute Open Graph URLs.
- **Steam link + achievement mirror**: players can link a Steam account so
  their Book of Deeds achievements mirror to Steam (`server/steam/`). It is
  **off until configured**: with `STEAM_ENABLED` unset, every `/api/steam`
  route answers `steam.disabled`, the mirror is inert, and no client renders
  link UI. To enable, set `STEAM_ENABLED=1` plus the Steamworks `STEAM_APP_ID`
  and a publisher Web API key in `STEAM_WEB_API_KEY` (partner.steam-api.com)
  in the server runtime env. The key is a secret: it must never appear in
  logs or client code. Linking is a cosmetic mirror for deed achievements
  only; login with Steam does not exist.
- **Never** set `ALLOW_DEV_COMMANDS=1` in production: it enables the
  level/teleport cheats used by the test bots.
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
  and the Prometheus scrape job in the same change or scraping goes dark.
  `/livez` and `/readyz` stay open for load-balancer checks.
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
  `PERF_REPORT_RETENTION_DAYS=`) now means the DEFAULT, not `0`. Before the
  validated config loader, `CHAT_LOG_RETENTION_DAYS=` resolved to `0` (keep chat
  logs forever); the same line now resolves to the 90-day default and pruning
  turns ON. Audit deployed env files for empty placeholder lines: delete the
  line to take the default, or set an explicit value (`CHAT_LOG_RETENTION_DAYS=0`
  is still keep-forever).
- Logs: `sudo docker compose -f /opt/eastbrook/docker-compose.yml logs -f game`.
- If the instance ever feels tight, stop, change instance type,
  start. Everything lives in Docker plus one EBS volume, so nothing
  else changes.

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
