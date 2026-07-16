import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const watchdog = readFileSync('deploy/game_watchdog.sh', 'utf8');
const userData = readFileSync('deploy/user-data.sh', 'utf8');
const deployDoc = readFileSync('DEPLOY.md', 'utf8');

describe('game watchdog deploy contract', () => {
  // Docker's `restart: unless-stopped` only fires when the container process EXITS,
  // so a wedged-but-alive game container is never restarted without this script.
  // An unset variable or a silently failing pipe in a watchdog is worse than no
  // watchdog: it would take a no-op path and report success.
  it('runs under strict shell settings', () => {
    expect(watchdog).toContain('set -euo pipefail');
  });

  // Detection reads docker's OWN health status (fed by the compose healthcheck
  // probing /livez). If this inspect is lost, the watchdog is blind.
  it('reads the container health status from docker inspect', () => {
    expect(watchdog).toContain('docker inspect');
    expect(watchdog).toContain('{{.State.Health.Status}}');
  });

  // It must act on `unhealthy` and on nothing else. Acting on `starting` would
  // restart every boot inside start_period; there is no other state to act on.
  it('restarts only on the unhealthy state', () => {
    expect(watchdog).toContain('unhealthy)');
    expect(watchdog).toContain('docker restart "$CONTAINER"');
  });

  // A drain deliberately keeps /livez at 200, so a draining container never reports
  // unhealthy and the watchdog never sees it. Losing this contract from the header
  // is how someone later "fixes" the detection into probing the port and starts
  // killing containers mid-shutdown, discarding the character saves the drain flushes.
  it('states the never-restart-a-draining-container contract', () => {
    expect(watchdog).toContain('IT MUST NEVER RESTART A DRAINING CONTAINER');
  });

  // Dry-run is how an operator confirms the watchdog sees the container without
  // touching production; it is also the only safe way to exercise it on a live box.
  it('has a dry-run arm that changes nothing', () => {
    expect(watchdog).toContain('--dry-run');
    expect(watchdog).toContain('WATCHDOG_DRY_RUN');
    expect(watchdog).toContain('DRY RUN: container ');
    expect(watchdog).toContain(' is unhealthy, would run: docker restart ');
  });

  // A restart outlasts the one-minute cron interval, so fires overlap by design.
  // Without the non-blocking lock, one wedge would be restarted twice.
  it('serializes overlapping cron fires with a non-blocking lock', () => {
    expect(watchdog).toContain('flock -n 9');
    expect(watchdog).toContain('WATCHDOG_LOCK_FILE');
  });

  // Backoff. The healthcheck cannot report unhealthy again for start_period plus
  // retries times interval after a restart, so without the cooldown state file the
  // watchdog would restart a genuinely crashing container blind, in a hot loop.
  it('refuses a fresh restart inside the cooldown window, stamped in a state file', () => {
    expect(watchdog).toContain('WATCHDOG_COOLDOWN');
    expect(watchdog).toContain('WATCHDOG_STATE_FILE');
    expect(watchdog).toContain('/var/lib/eastbrook/watchdog-last-restart');
    expect(watchdog).toContain('but the last watchdog restart was ');
    expect(watchdog).toContain('s), skipping');
  });

  // Cron runs with a minimal PATH (often /usr/bin:/bin). Without this append, docker
  // or flock installed under /usr/local/bin or /snap/bin are invisible and the
  // watchdog silently no-ops every minute forever: installed but permanently blind.
  // The harness cannot catch its loss (it prepends its own shim dir), so pin the line.
  it('appends the standard binary dirs to the cron PATH, never prepending', () => {
    expect(watchdog).toContain(
      'export PATH="${PATH:-}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"',
    );
  });

  // The exec harness feeds the shim's output directly, so the -f template itself is
  // invisible to it. The template is load-bearing end to end: Running feeds the
  // not-running guard, the {{if}} arm keeps an old image (no .State.Health at all)
  // from rendering "<no value>", and the field order feeds the "${state%% *}" parse.
  it('pins the full inspect format string: running, health, and the none fallback', () => {
    expect(watchdog).toContain(
      "'{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'",
    );
  });

  // The default bounds are load-bearing and invisible to the exec harness (its
  // hang tests override both knobs to 1s): the restart bound must EXCEED the 75s
  // compose stop_grace_period (a wedged process ignores SIGTERM and eats the full
  // grace, so a WORKING recovery routinely outlasts a minute, and a tighter bound
  // would misreport the exact restart this script exists to issue), and the
  // inspect bound must fit inside the one-minute cron interval.
  it('pins the default docker call bounds: inspect inside the cron minute, restart past the stop grace', () => {
    expect(watchdog).toContain('INSPECT_TIMEOUT="${WATCHDOG_INSPECT_TIMEOUT:-55}"');
    expect(watchdog).toContain('RESTART_TIMEOUT="${WATCHDOG_RESTART_TIMEOUT:-150}"');
    // GNU timeout reads 0 as unbounded, so an operator 0 must map to the default.
    expect(watchdog).toContain('if [ "$INSPECT_TIMEOUT" -eq 0 ]; then INSPECT_TIMEOUT=55; fi');
    expect(watchdog).toContain('if [ "$RESTART_TIMEOUT" -eq 0 ]; then RESTART_TIMEOUT=150; fi');
    // The KILL escalation is what bounds a TERM-immune docker CLI (uninterruptible
    // sleep); without it the wrapper waits forever and the bound is fiction.
    expect(watchdog).toContain('bounded() { timeout -k 5 "$@"; }');
  });
});

describe('game watchdog install', () => {
  // First boot must land the script AND the cron entry: an uninstalled watchdog is
  // an unmonitored realm, and a wedge then waits for a human to notice.
  it('installs the watchdog and its cron entry at first boot', () => {
    expect(userData).toContain(
      'install -m 755 "$APP_DIR/deploy/game_watchdog.sh" /usr/local/bin/eastbrook-watchdog',
    );
    expect(userData).toContain('/etc/cron.d/eastbrook-watchdog');
    expect(userData).toContain('* * * * * root /usr/local/bin/eastbrook-watchdog');
  });

  // user-data.sh runs at EC2 first boot only, so the already-provisioned production
  // box never gets the watchdog unless a human installs it. Without this documented
  // step the script ships and is never actually running anywhere.
  it('documents the by-hand install for an already-provisioned host', () => {
    expect(deployDoc).toContain(
      'sudo install -m 755 deploy/game_watchdog.sh /usr/local/bin/eastbrook-watchdog',
    );
    // 'first boot' alone appears in unrelated prose (secrets, chat-filter seeding), so
    // it pins nothing. This phrase is the by-hand-install instruction itself: drop the
    // documented manual step and an already-provisioned host ships with no watchdog.
    expect(deployDoc).toContain('has to be given it by hand');
  });

  // /livez can now answer 503, which makes it a public wedge oracle unless the edge
  // hides it; /metrics exposes operational internals. The 404 block must sit on BOTH
  // vhosts (site and admin domain), with the same path list, or one edge stays open.
  // split() counts occurrences, so a drift between the two heredocs fails here.
  it('hides the ops endpoints at the public edge, identically on both domains', () => {
    expect(userData.split('@ops path /livez /readyz /metrics')).toHaveLength(3);
    expect(userData.split('respond 404')).toHaveLength(3);
  });

  // user-data.sh writes that block at first boot only, so a host provisioned before
  // it existed keeps proxying /livez publicly, and /livez can now answer 503: a
  // public oracle for exactly when the world loop is down. The runbook must carry
  // the by-hand retrofit (matcher, validate, reload) or the fix never reaches a
  // host that is already running.
  it('documents the by-hand Caddy retrofit for an already-provisioned host', () => {
    expect(deployDoc).toContain('@ops path /livez /readyz /metrics');
    expect(deployDoc).toContain('respond @ops 404');
    expect(deployDoc).toContain('sudo caddy validate --config /etc/caddy/Caddyfile');
    expect(deployDoc).toContain('sudo systemctl reload caddy');
  });

  // Cron appends to an open fd, so plain rotation would keep writing to the renamed
  // file; copytruncate is what keeps the live log bounded. An unbounded root-owned
  // log on a small host is a slow disk-full outage.
  it('rotates the watchdog log with copytruncate', () => {
    expect(userData).toContain('/etc/logrotate.d/eastbrook-watchdog');
    expect(userData).toContain('copytruncate');
  });
});

describe('update runbook guards', () => {
  // The private bot detector lives in a second checkout the image bundles at build
  // time. A missing clone silently falls back to the no-op stub and a drifted clone
  // compiles anyway, so the build reports nothing either way: the runbook IS the
  // guard, and only these two steps catch a detector out of step with the game tree.
  it('pulls the private bot-detector clone before the build', () => {
    expect(deployDoc).toContain('sudo git -C private/bot_detector pull');
  });

  // npx tsc needs devDependencies, which a production checkout does not have. A
  // documented gate that cannot run on a fresh host is not a gate.
  it('runs the type-check drift gate, with devDependencies actually installed', () => {
    expect(deployDoc).toContain('npx tsc --noEmit');
    expect(deployDoc).toContain('npm ci');
    // The two substrings above are satisfiable by two unrelated lines. The gate only
    // works if `npm ci` (to get devDependencies) and `npx tsc --noEmit` run TOGETHER
    // inside node:22-alpine, because a deploy host has neither Node nor devDependencies.
    // Pin the whole invocation as one contiguous block so a split can never pass. It
    // must sweep every .env and .git out of the copy (the host .env holds every
    // production secret, and a nested clone's .env or .git config can carry tokens),
    // and pass --ignore-scripts so dependency install hooks cannot run as root with
    // network access: losing either turns the type-check into a secret-exfiltration
    // surface on every deploy. The --memory/--memory-swap bound keeps the gate,
    // which runs on the live box before the game stops, from creating the host
    // memory pressure the game service's mem_limit exists to prevent.
    expect(deployDoc).toContain(
      [
        'sudo docker run --rm --memory 2g --memory-swap 2g -v /opt/eastbrook:/src:ro -w /app node:22-alpine \\',
        "  sh -c 'cp -a /src/. /app && find /app \\( -name .git -o -name .env \\) -prune -exec rm -rf {} + && npm ci --ignore-scripts --no-audit --no-fund && npx tsc --noEmit'",
      ].join('\n'),
    );
  });

  // The stop step must let the shutdown chain drain; the explicit fallback window is
  // for an older checkout whose compose file carries no stop_grace_period.
  it('stops the game before rebuilding, with an explicit drain fallback', () => {
    expect(deployDoc).toContain('sudo docker compose stop game');
    expect(deployDoc).toContain('sudo docker compose stop -t 60 game');
  });

  // Post-deploy verification: an unverified deploy is one that gets rolled back later
  // by whoever is on call. The health status catches a container whose world loop is
  // not completing passes; the log read catches a server erroring on startup.
  it('verifies container health and clean startup logs after the deploy', () => {
    expect(deployDoc).toContain("sudo docker inspect -f '{{.State.Health.Status}}' eastbrook-game");
    expect(deployDoc).toContain('sudo docker compose logs game --since 10m');
  });
});

// -----------------------------------------------------------------------------
// EXECUTION HARNESS: run deploy/game_watchdog.sh for real against a fake `docker`
// (and a fake `flock`) on PATH, and assert whether it ACTUALLY issued a restart.
// The string-grep tests above pin the literals; these pin the behavior, so a
// mutation that keeps every literal intact but changes what the script does (a
// `starting) ;;` restart arm, a deleted not-running guard, an inverted cooldown
// comparison, a disabled dry-run arm) is caught here instead of shipping green.
// -----------------------------------------------------------------------------

const WATCHDOG_SCRIPT = 'deploy/game_watchdog.sh';
const CONTAINER = 'eastbrook-game';
const harnessDirs: string[] = [];

interface Harness {
  dir: string;
  stateFile: string;
  lockFile: string;
  restartLog: string;
}

// A temp PATH dir holding two shims. `docker` prints a scripted `<running> <health>`
// pair for `inspect` and records every `restart` invocation to a file; `flock` (which
// may be entirely ABSENT on macOS) is overridden so the lock decision is deterministic
// and cross-platform, controllable via SHIM_FLOCK_EXIT. Prepending this dir to PATH
// makes both shims win over any real binary, and keeps the script off real docker.
function makeHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'woc-watchdog-'));
  harnessDirs.push(dir);
  const dockerShim = `#!/usr/bin/env bash
if [ "$1" = "inspect" ]; then
  if [ "\${SHIM_INSPECT_HANG:-0}" = "1" ]; then exec sleep 5; fi
  if [ "\${SHIM_INSPECT_EXIT:-0}" != "0" ]; then exit "\${SHIM_INSPECT_EXIT}"; fi
  printf '%s\\n' "$SHIM_INSPECT"
  exit 0
fi
if [ "$1" = "restart" ]; then
  if [ "\${SHIM_RESTART_HANG:-0}" = "1" ]; then exec sleep 5; fi
  # Record the cooldown stamp AS SEEN AT RESTART TIME next to the container name: the
  # script must write the stamp BEFORE restarting (a hanging restart still holds the
  # cooldown), and this is the only observable that pins that ordering.
  printf '%s stamp=%s\\n' "$2" "$(cat "$WATCHDOG_STATE_FILE" 2>/dev/null || echo missing)" >> "$SHIM_RESTART_LOG"
  exit "\${SHIM_RESTART_EXIT:-0}"
fi
exit 0
`;
  writeFileSync(join(dir, 'docker'), dockerShim);
  chmodSync(join(dir, 'docker'), 0o755);
  const flockShim = `#!/usr/bin/env bash
exit "\${SHIM_FLOCK_EXIT:-0}"
`;
  writeFileSync(join(dir, 'flock'), flockShim);
  chmodSync(join(dir, 'flock'), 0o755);
  return {
    dir,
    stateFile: join(dir, 'state'),
    lockFile: join(dir, 'lock'),
    restartLog: join(dir, 'restart.log'),
  };
}

interface RunResult {
  status: number | null;
  output: string;
  restarted: boolean;
}

function runWatchdog(
  h: Harness,
  opts: { inspect: string; args?: string[]; env?: Record<string, string> },
): RunResult {
  const res = spawnSync('bash', [WATCHDOG_SCRIPT, ...(opts.args ?? [])], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${h.dir}:${process.env.PATH ?? ''}`,
      WATCHDOG_CONTAINER: CONTAINER,
      WATCHDOG_STATE_FILE: h.stateFile,
      WATCHDOG_LOCK_FILE: h.lockFile,
      SHIM_INSPECT: opts.inspect,
      SHIM_RESTART_LOG: h.restartLog,
      ...opts.env,
    },
  });
  const restarted =
    existsSync(h.restartLog) && readFileSync(h.restartLog, 'utf8').includes(CONTAINER);
  return { status: res.status, output: `${res.stdout}${res.stderr}`, restarted };
}

/** Epoch seconds, to stamp the cooldown state file relative to the script's `date -u +%s`. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

afterAll(() => {
  for (const dir of harnessDirs) rmSync(dir, { recursive: true, force: true });
});

describe('game watchdog behavior (executed against a fake docker)', () => {
  // The harness must be able to observe a REAL restart, or every negative case below
  // passes vacuously. An unhealthy, running container is the one case the watchdog
  // exists for: if this stops restarting, a wedged world never recovers on its own.
  it('restarts an unhealthy, running container', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true unhealthy' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(true);
  });

  // Restarting a healthy container would bounce a working server once a minute.
  it('does NOT restart a healthy container', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true healthy' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
  });

  // `starting` is the start_period window. Acting on it turns every cold boot into a
  // restart loop that never lets the server finish coming up (mutation: a starting arm).
  it('does NOT restart a container that is still starting (inside start_period)', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true starting' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
  });

  // running=false is the real state after `docker compose stop`, and health can still
  // read `unhealthy`. Restarting it fights the operator/deploy that stopped it and can
  // kill a container mid-drain, discarding the saves the drain exists to flush.
  it('does NOT restart a container that is not running, even while health is unhealthy', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'false unhealthy' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
  });

  // An image predating the healthcheck reports no health (`none`). Treating that as a
  // reason to restart bounces a container the watchdog has no basis to assess.
  it('does NOT restart a container reporting no health status (none)', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true none' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
  });

  // --dry-run is the only safe way to exercise the watchdog on a live box. If it ever
  // performs a real restart, an operator merely checking the watchdog reboots production.
  it('logs the intended restart but does NOT restart under --dry-run', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true unhealthy', args: ['--dry-run'] });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
    expect(res.output).toContain('DRY RUN: container eastbrook-game is unhealthy');
    expect(res.output).toContain('would run: docker restart eastbrook-game');
  });

  // A restart stamp newer than the cooldown must suppress a fresh restart: after a
  // restart the healthcheck cannot report unhealthy again for start_period + retries,
  // so acting inside the window is a blind hot restart loop (mutation: inverted -lt).
  it('does NOT restart while a cooldown stamp is inside the window', () => {
    const h = makeHarness();
    writeFileSync(h.stateFile, `${nowSeconds()}\n`);
    const res = runWatchdog(h, { inspect: 'true unhealthy' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
    expect(res.output).toContain('cooldown');
  });

  // A stamp older than the cooldown must allow the next restart, or a container that
  // failed to recover on its first restart is never retried (mutation: inverted -lt).
  it('DOES restart once the cooldown stamp is older than the window', () => {
    const h = makeHarness();
    writeFileSync(h.stateFile, `${nowSeconds() - 700}\n`);
    const res = runWatchdog(h, { inspect: 'true unhealthy' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(true);
  });

  // A non-numeric WATCHDOG_COOLDOWN override must fall back to the default, not
  // disable the cooldown: unsanitized, the numeric comparison errors, the condition
  // evaluates false, and the script falls through to a restart with NO cooldown
  // protection, the exact hot loop the knob exists to prevent (mutation: drop the
  // COOLDOWN sanitization case).
  it('does NOT restart inside the window when WATCHDOG_COOLDOWN is non-numeric', () => {
    const h = makeHarness();
    writeFileSync(h.stateFile, `${nowSeconds()}\n`);
    const res = runWatchdog(h, {
      inspect: 'true unhealthy',
      env: { WATCHDOG_COOLDOWN: 'five-minutes' },
    });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
    expect(res.output).toContain('cooldown');
  });

  // Overlapping cron fires must serialize: a restart outlasts the one-minute interval,
  // so a second fire that ignored the lock would restart the same wedge twice. The
  // flock shim reports the lock already held (exit 1), the signal a real flock gives a
  // second concurrent run.
  it('does NOT restart when the serialization lock is already held', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true unhealthy', env: { SHIM_FLOCK_EXIT: '1' } });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
    expect(res.output).toContain('skipping');
  });

  // The WRITE side of the cooldown: the first real restart must stamp the state file,
  // and that stamp must suppress the immediately following run. Without this pair, a
  // mutation that never writes the stamp passes every other case (they pre-seed the
  // file or run once), and in production a genuinely crashing container would be
  // restart-looped every minute: the exact hot loop the cooldown exists to prevent.
  it('stamps the cooldown on a real restart, and the very next run is suppressed by it', () => {
    const h = makeHarness();
    const first = runWatchdog(h, { inspect: 'true unhealthy' });
    expect(first.status).toBe(0);
    expect(first.restarted).toBe(true);
    // The shim records the stamp as seen AT RESTART TIME: a numeric value proves the
    // stamp was written BEFORE docker restart ran (a hanging restart still holds the
    // cooldown); 'missing' here means the ordering regressed to stamp-after-restart.
    expect(readFileSync(h.restartLog, 'utf8')).toMatch(
      new RegExp(`^${CONTAINER} stamp=\\d+$`, 'm'),
    );
    expect(readFileSync(h.stateFile, 'utf8').trim()).toMatch(/^\d+$/);
    rmSync(h.restartLog, { force: true });
    const second = runWatchdog(h, { inspect: 'true unhealthy' });
    expect(second.status).toBe(0);
    expect(second.restarted).toBe(false);
    expect(second.output).toContain('cooldown');
  });

  // A failed restart must be LOUD (exit 1, FAILED in the log) and must still hold the
  // cooldown stamp: retrying a restart that just failed, once a minute, helps nobody.
  it('exits 1 and logs FAILED when docker restart itself fails, keeping the stamp', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true unhealthy', env: { SHIM_RESTART_EXIT: '1' } });
    expect(res.status).toBe(1);
    expect(res.output).toContain('FAILED');
    expect(readFileSync(h.stateFile, 'utf8').trim()).toMatch(/^\d+$/);
  });

  // A corrupted stamp (partial write, manual edit) must read as ABSENT, not as a
  // far-future epoch that latches the cooldown shut and blocks wedge recovery forever.
  it('treats a corrupted cooldown stamp as absent and still restarts', () => {
    const h = makeHarness();
    writeFileSync(h.stateFile, 'not-a-number\n');
    const res = runWatchdog(h, { inspect: 'true unhealthy' });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(true);
  });

  // A hung docker daemon must not park a run on the flock forever (every later cron
  // fire would exit with the skip line and the wedge would never recover). The
  // inspect is abandoned on its bound and logged LOUDLY: that line is the only
  // breadcrumb distinguishing a hung daemon from a plainly absent container.
  it('abandons a hung docker inspect on the bound and exits cleanly', () => {
    const h = makeHarness();
    const res = runWatchdog(h, {
      inspect: 'true unhealthy',
      env: { SHIM_INSPECT_HANG: '1', WATCHDOG_INSPECT_TIMEOUT: '1' },
    });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(false);
    expect(res.output).toContain('docker inspect eastbrook-game timed out after 1s');
  });

  // Same bound on the restart arm: abandon a hung restart loudly (exit 1), and the
  // cooldown stamp written BEFORE the restart must survive, so the next fire does
  // not immediately pile a second restart onto a struggling daemon.
  it('abandons a hung docker restart on the bound, keeping the cooldown stamp', () => {
    const h = makeHarness();
    const res = runWatchdog(h, {
      inspect: 'true unhealthy',
      env: { SHIM_RESTART_HANG: '1', WATCHDOG_RESTART_TIMEOUT: '1' },
    });
    expect(res.status).toBe(1);
    expect(res.output).toContain('docker restart eastbrook-game timed out after 1s');
    expect(readFileSync(h.stateFile, 'utf8').trim()).toMatch(/^\d+$/);
  });

  // A non-numeric timeout override must sanitize to the default, not reach `timeout`
  // as a bogus duration: unsanitized, `timeout fast docker inspect` exits 125, the
  // error branch reads that as container-absent, and the watchdog goes permanently
  // blind while reporting nothing (mutation: drop the timeout sanitization cases).
  it('still restarts when the timeout knobs are non-numeric (sanitized to defaults)', () => {
    const h = makeHarness();
    const res = runWatchdog(h, {
      inspect: 'true unhealthy',
      env: { WATCHDOG_INSPECT_TIMEOUT: 'fast', WATCHDOG_RESTART_TIMEOUT: 'soon' },
    });
    expect(res.status).toBe(0);
    expect(res.restarted).toBe(true);
  });

  // An operator typo must fail loudly with usage, never fall through to a live run
  // where the misspelled flag (say --dry-rum) silently performs a REAL restart.
  it('rejects an unknown flag with usage and exit 2, restarting nothing', () => {
    const h = makeHarness();
    const res = runWatchdog(h, { inspect: 'true unhealthy', args: ['--bogus'] });
    expect(res.status).toBe(2);
    expect(res.output).toContain('usage:');
    expect(res.restarted).toBe(false);
  });

  // A syntax error anywhere in the script would ship green through every string-grep
  // pin above; parsing it (and the executed cases) is what actually catches one.
  it('parses without a syntax error', () => {
    const res = spawnSync('bash', ['-n', WATCHDOG_SCRIPT], { encoding: 'utf8' });
    expect(res.status).toBe(0);
  });
});
