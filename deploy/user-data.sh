#!/bin/bash
# World of Claudecraft — EC2 first-boot setup (cloud-init user data).
#
# Target: Ubuntu 24.04 LTS arm64 (t4g.small or similar).
# Fill in the two variables below, then paste this whole file into the
# EC2 launch wizard's "User data" field. Full walkthrough: DEPLOY.md.
#
# What it does: installs Docker + Caddy, clones the repo, generates a
# strong Postgres password, starts the game stack, fronts it with Caddy
# (auto-TLS when DOMAIN is set), adds 2G swap and a nightly DB backup.

# ---------------------------------------------------------------------------
# REQUIRED CONFIG
# ---------------------------------------------------------------------------
# Your game domain with an A record pointing at this instance's Elastic IP,
# e.g. "play.example.com". Leave empty to serve plain HTTP on port 80 (test
# by IP first, set the domain later — see DEPLOY.md).
DOMAIN=""

# Admin dashboard domain (e.g. "admin.worldofclaudecraft.com"), also with an
# A record at this instance. Leave empty to skip; the dashboard then stays
# reachable only at /admin on the game site. Access still requires an
# is_admin account regardless of hostname (see DEPLOY.md).
ADMIN_DOMAIN=""

# ---------------------------------------------------------------------------
REPO="https://github.com/levy-street/world-of-claudecraft.git"
APP_DIR="/opt/eastbrook"
BACKUP_DIR="/var/backups/eastbrook"

set -euo pipefail
exec > >(tee -a /var/log/eastbrook-setup.log) 2>&1
echo "=== World of Claudecraft setup started: $(date -u) ==="

# --- swap: builds on a 2 GB instance want the headroom --------------------
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- packages: docker, compose v2, git, caddy ------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 git curl gnupg apt-transport-https unzip

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

systemctl enable --now docker

# --- clone + secrets --------------------------------------------------------
if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

# compose reads .env automatically; never commit this file
if [ ! -f .env ]; then
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
  chmod 600 .env
fi

# Persistent host overlay for SFX Studio production bundles. Create it before
# Compose so Docker does not create a root-owned bind-mount directory.
install -d -o ubuntu -g ubuntu "$APP_DIR/sfx-runtime"

# --- build + run the stack --------------------------------------------------
docker compose up -d --build

# --- caddy: TLS reverse proxy ------------------------------------------------
if [ -n "$DOMAIN" ]; then
  SITE="$DOMAIN"
else
  SITE=":80"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
	reverse_proxy localhost:8787
	encode gzip
}
CADDY
if [ -n "$ADMIN_DOMAIN" ]; then
  cat >> /etc/caddy/Caddyfile <<CADDY

$ADMIN_DOMAIN {
	reverse_proxy localhost:8787
	encode gzip
}
CADDY
fi
systemctl enable caddy
systemctl restart caddy

# --- nightly DB backup (03:15 UTC, keeps 14 days) ---------------------------
cat > /usr/local/bin/eastbrook-backup <<'BACKUP'
#!/bin/bash
set -euo pipefail
BACKUP_DIR="/var/backups/eastbrook"
mkdir -p "$BACKUP_DIR"
docker exec eastbrook-db pg_dump -U eastbrook eastbrook \
  | gzip > "$BACKUP_DIR/eastbrook-$(date +%F).sql.gz"
find "$BACKUP_DIR" -name '*.sql.gz' -mtime +14 -delete
BACKUP
chmod +x /usr/local/bin/eastbrook-backup
echo "15 3 * * * root /usr/local/bin/eastbrook-backup" > /etc/cron.d/eastbrook-backup

echo "=== World of Claudecraft setup finished: $(date -u) ==="
echo "Game:   http://localhost:8787 (behind Caddy on ${SITE})"
echo "Status: $(curl -s --max-time 5 http://localhost:8787/api/status || echo 'not up yet — check: docker compose logs game')"
