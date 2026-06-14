# Deploying World of Claudecraft on AWS

> **Levy Street production** is deployed via Ansible, not this document:
> the `eastbrook_game` role in the internal `ansible-scripts` repo runs
> the stack on `idyllic-games-prod` behind nginx + certbot at
> https://worldofclaudecraft.com. Re-running
> `ansible-playbook playbooks/setup_server.yml -e target_host=idyllic-games-prod`
> pulls and redeploys. The guide below is the generic, standalone path.

One EC2 instance runs everything: the game server, Postgres, and Caddy
(TLS reverse proxy). Sized for a small population — a `t4g.small`
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
| Security group | Inbound: **22** (your IP only), **80**, **443** — nothing else |
| User data | Paste `deploy/user-data.sh` with `DOMAIN` filled in |

Leave `DOMAIN=""` if you want to test by IP first over plain HTTP —
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
at the Elastic IP. In Route 53: Hosted zone → Create record → A →
the Elastic IP.

## 4. Turn on TLS (if you started without a domain)

```bash
ssh ubuntu@<elastic-ip>
echo 'play.example.com {
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

## Experimental SpacetimeDB Path

The production/default backend is still Node + Postgres. The SpacetimeDB path is
gated behind `WORLD_BACKEND=spacetimedb` / `VITE_WORLD_BACKEND=spacetimedb`.
SpacetimeDB owns account, character, session, input, command, snapshot, event,
social, report, and stats tables/reducers. A local bridge process preserves
v0.5 gameplay parity by joining SpacetimeDB sessions into the existing
authoritative Node simulation and publishing the same world wire frames back to
SpacetimeDB subscribers.

For local experiments, run the opt-in compose profile:

```bash
docker compose --profile stdb up -d spacetimedb
npm run stdb:publish
npm run stdb:bridge
VITE_WORLD_BACKEND=spacetimedb VITE_STDB_URI=http://127.0.0.1:3000 npm run dev
```

The official standalone container listens on port 3000; the compose service
binds it to loopback only so it is not exposed publicly by default.

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
- **Username bans**: set `USERNAME_BANLIST_FILE=/opt/eastbrook/username-banlist.txt`
  to load blocked username terms from a private newline- or comma-separated
  file. `USERNAME_BANLIST` can also provide a comma-separated inline list.
- **Chat censorship**: set `CHAT_CENSOR_FILE=/opt/eastbrook/chat-censor.txt`
  to mask configured terms from a private newline- or comma-separated file.
  `CHAT_CENSOR_LIST` can also provide a comma-separated inline list.
- **Realms (horizontal scaling)**: each server process serves one realm,
  set by `REALM_NAME` (default `Claudemoon`). To add a realm, run another
  process against the **same** `DATABASE_URL` with a different `REALM_NAME`
  and `PORT` (e.g. behind its own vhost or compose service). Characters,
  friends, guilds, and presence are realm-scoped, so the worlds are fully
  isolated — players on different realms can't see, whisper, friend, or
  guild each other. Concurrent boots serialize their schema setup behind a
  Postgres advisory lock, so starting several at once is safe. Character and
  guild names remain globally unique across realms.
- **Never** set `ALLOW_DEV_COMMANDS=1` in production — it enables the
  level/teleport cheats used by the test bots.
- Health check: `curl -s localhost:8787/api/status` on the box returns
  `{"ok":true,"players_online":N,...}`.
- Logs: `sudo docker compose -f /opt/eastbrook/docker-compose.yml logs -f game`.
- If the instance ever feels tight, stop → change instance type →
  start. Everything lives in Docker plus one EBS volume, so nothing
  else changes.

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
flag. The hostname only selects which HTML shell is served — every
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
