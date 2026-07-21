#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

: "${MEDIAWIKI_DB_HOST:=mediawiki-db}"
: "${MEDIAWIKI_DB_NAME:=mediawiki}"
: "${MEDIAWIKI_DB_USER:=mediawiki}"
: "${MEDIAWIKI_DB_PASSWORD:=mediawiki}"
: "${MEDIAWIKI_ADMIN_USER:=WikiAdmin}"
: "${MEDIAWIKI_ADMIN_PASS:=change-me-admin-password}"
: "${MEDIAWIKI_SERVER:=http://localhost:8080}"

echo "Waiting for MediaWiki database at ${MEDIAWIKI_DB_HOST}..."
until php -r '$m = @mysqli_connect(getenv("MEDIAWIKI_DB_HOST"), getenv("MEDIAWIKI_DB_USER"), getenv("MEDIAWIKI_DB_PASSWORD")); exit($m ? 0 : 1);'; do
  sleep 2
done

has_tables="$(php -r '$m = mysqli_connect(getenv("MEDIAWIKI_DB_HOST"), getenv("MEDIAWIKI_DB_USER"), getenv("MEDIAWIKI_DB_PASSWORD"), getenv("MEDIAWIKI_DB_NAME")); $r = $m ? mysqli_query($m, "SHOW TABLES LIKE '\''page'\''") : false; echo ($r && mysqli_num_rows($r) > 0) ? "yes" : "no";')"

if [ "${has_tables}" != "yes" ]; then
  echo "Installing MediaWiki schema..."
  rm -f LocalSettings.php
  php maintenance/install.php \
    --dbtype mysql \
    --dbserver "${MEDIAWIKI_DB_HOST}" \
    --dbname "${MEDIAWIKI_DB_NAME}" \
    --dbuser "${MEDIAWIKI_DB_USER}" \
    --dbpass "${MEDIAWIKI_DB_PASSWORD}" \
    --server "${MEDIAWIKI_SERVER}" \
    --scriptpath /wiki \
    --pass "${MEDIAWIKI_ADMIN_PASS}" \
    "World of Claudecraft Wiki" \
    "${MEDIAWIKI_ADMIN_USER}"
fi

cp /opt/woc/LocalSettings.php LocalSettings.php
php maintenance/update.php --quick

seed_hash="$(sha256sum /opt/woc/seed/pages.xml | awk '{print $1}')"
seed_marker=/var/www/html/images/.woc-seed-hash
current_hash=""
if [ -f "${seed_marker}" ]; then
  current_hash="$(cat "${seed_marker}")"
fi

if [ "${seed_hash}" != "${current_hash}" ]; then
  echo "Importing World of Claudecraft wiki seed pages..."
  printf '%s\n' 'Main Page' | php maintenance/deleteBatch.php --u "${MEDIAWIKI_ADMIN_USER}" --r 'Replace stock install page with World of Claudecraft seed' || true
  php maintenance/importDump.php --no-updates < /opt/woc/seed/pages.xml
  php maintenance/rebuildrecentchanges.php
  php maintenance/runJobs.php
  echo "${seed_hash}" > "${seed_marker}"
fi

exec docker-php-entrypoint "$@"
