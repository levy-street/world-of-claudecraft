#!/bin/bash
# World of Claudecraft PTR realm -- first-boot setup (cloud-init user data).
#
# Same standalone stack as deploy/user-data.sh, pinned to the canonical PTR
# release branch. Fill DOMAIN (or leave empty to test by IP), paste into the
# host's user-data / run as root on any Ubuntu 24.04 arm64 box with Docker.
# Full walkthrough: DEPLOY.md.
#
# PTR realm note: this is a throwaway test realm on a dedicated disposable
# host and database. It ships with
# ALLOW_DEV_COMMANDS=1 so testers can /dev level and jump characters to the
# row unlocks. NEVER run it on a production host or attach production data.

# ---------------------------------------------------------------------------
# REQUIRED CONFIG
# ---------------------------------------------------------------------------
# The PTR game domain with an A record at this box's static IP, e.g.
# "ptr.example.com". Empty = plain HTTP on port 80 (test by IP first).
DOMAIN=""
ADMIN_DOMAIN=""

# ---------------------------------------------------------------------------
REPO="https://github.com/levy-street/world-of-claudecraft.git"
BRANCH="release/v0.24.0-ptr"
APP_DIR="/opt/eastbrook-ptr"
BACKUP_DIR="/var/backups/eastbrook-ptr"

set -euo pipefail
exec > >(tee -a /var/log/eastbrook-setup.log) 2>&1

# --- packages: docker, compose v2, git, caddy ------------------------------
apt-get update
apt-get install -y docker.io docker-compose-v2 git curl gnupg apt-transport-https openssl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

systemctl enable --now docker

# --- clone the PTR branch + secrets ----------------------------------------
if [ ! -d "$APP_DIR" ]; then
  git clone --branch "$BRANCH" --single-branch "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
if [ "$(git remote get-url origin)" != "$REPO" ]; then
  echo "Refusing PTR update: origin is not the canonical repository." >&2
  exit 1
fi
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
  echo "Refusing PTR update: local branch is not the exact fetched remote commit." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "Refusing PTR update: source worktree has nonignored changes." >&2
  exit 1
fi

# compose reads .env automatically; never commit this file
if [ ! -f .env ]; then
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    # PTR realm: dev commands ON so testers can jump levels to the row unlocks.
    echo "ALLOW_DEV_COMMANDS=1"
  } > .env
  chmod 600 .env
fi

# --- build + run the stack --------------------------------------------------
docker compose up -d --build

# --- Caddy: TLS when DOMAIN set, else plain HTTP by IP ----------------------
if [ -n "$DOMAIN" ]; then
  SITE="$DOMAIN"
else
  SITE=":80"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
  reverse_proxy 127.0.0.1:8787
}
CADDY
if [ -n "$ADMIN_DOMAIN" ]; then
  cat >> /etc/caddy/Caddyfile <<CADDY
$ADMIN_DOMAIN {
  reverse_proxy 127.0.0.1:8787
}
CADDY
fi
systemctl reload caddy

echo "PTR realm boot complete."
echo "Branch: $BRANCH @ $(git -C "$APP_DIR" rev-parse --short HEAD)"
echo "Status: $(curl -s --max-time 5 http://localhost:8787/api/status || echo 'not up yet -- docker compose logs game')"
