// Shared loopback guards for scripts that mint accounts, grant roles, or
// drive /dev cheats: every target they touch must be local, and the DATABASE
// arm must validate the host node-postgres will ACTUALLY use (pg-connection-
// string honors a ?host= query override and surfaces hostaddr, so a
// WHATWG-hostname-only check is bypassable). Extracted on the rule of three
// (admin_professions_shot.mjs, mob_stall_repro.mjs, load_professions.mjs each
// hand-carried a copy; load_players.mjs adopted it in the phase 16 QA round)
// so the control is testable in one place: tests/loopback_guard.test.ts,
// which also scans every call site so a deleted import cannot silently
// disarm the guard.

import { parse as parsePgTarget } from 'pg-connection-string';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

/** Throws unless the URL's hostname is loopback. Never echoes credentials:
 *  only the hostname appears in the error. Returns the parsed URL. */
export function assertLoopbackUrl(urlStr, label) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error(`invalid ${label} (not a parseable URL)`);
  }
  const host = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new Error(
      `refusing non-loopback ${label} host "${u.hostname}"; this tool runs against a LOCAL ` +
        'dev target only. Allowed hosts: localhost, 127.0.0.1, ::1.',
    );
  }
  return u;
}

/** Throws unless the EFFECTIVE Postgres host (the one node-postgres resolves,
 *  ?host= override included) is loopback. Never echoes the raw value:
 *  DATABASE_URL carries credentials. Fails closed on an unparseable or
 *  hostless connection string. Returns the bare loopback host. */
export function assertLoopbackDatabaseUrl(raw, label = 'DATABASE_URL') {
  // Explicit missing arm: pg-connection-string resolves '' against an
  // internal sentinel base URL, which would otherwise surface as a
  // baffling `host "base"` refusal the operator never typed.
  if (!raw) throw new Error(`missing ${label}`);
  let target;
  try {
    target = parsePgTarget(raw);
  } catch {
    throw new Error(`invalid ${label} (not a parseable connection string)`);
  }
  // hostaddr outranks host under libpq semantics: the pure-JS driver ignores
  // it today, but a checkout that ever grows native bindings would dial it
  // and the host check below would be gating a value nobody connects to.
  // Refused outright rather than made to depend on which driver is installed.
  if (target.hostaddr) {
    throw new Error(
      `refusing ${label} carrying a hostaddr parameter; it can redirect the connection past the ` +
        'host check, and this tool must only ever run against a disposable local dev database.',
    );
  }
  const dbHost = String(target.host ?? '').toLowerCase();
  const bare = dbHost.replace(/^\[/, '').replace(/\]$/, '');
  if (!LOOPBACK_HOSTS.includes(bare)) {
    throw new Error(
      `refusing non-loopback ${label} host "${dbHost || '(none)'}"; this tool must only ever ` +
        'run against a disposable local dev database.',
    );
  }
  return bare;
}
