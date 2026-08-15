import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HEARTBEAT_INTERVAL_MS } from '../bot/cadence';
import { DEFAULT_HEARTBEAT_FILE, isHeartbeatFresh } from '../bot/liveness';

// Resolved from THIS file, not process.cwd(): a vitest invocation from another
// directory would otherwise fail at module scope with ENOENT.
const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const compose = read('docker-compose.yml');
const userData = read('deploy/user-data.sh');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const buildBot = read('scripts/build_bot.mjs');
// tsconfig.json is JSONC by spec, so strip comments before parsing: a perfectly
// legal `// note` added to it would otherwise crash this file at module scope
// and take every test in it down with an error that names none of them.
const readJsonc = (name: string) =>
  JSON.parse(
    read(name)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1'),
  );
const tsconfig = readJsonc('tsconfig.json') as { include: string[] };

// Every assertion about the bot service reads THIS slice, never the whole compose
// file. Proximity is not containment: `restart: unless-stopped`, `healthcheck:`,
// `mem_limit` and `stop_grace_period` all appear in the GAME service too, so a
// whole-file toContain would stay green with the bot service left entirely
// unhardened. Service keys sit at four spaces, so the next two-space line starts
// the next top-level service (or its leading comment) and ends this block; a
// service that happens to be last in the file runs to the end of the text.
const discordBotService = (() => {
  const start = compose.indexOf('\n  discord-bot:\n');
  if (start < 0) throw new Error('docker-compose.yml has no discord-bot service');
  const body = compose.slice(start + 1);
  const end = body.slice(1).search(/\n {2}\S/);
  return end < 0 ? body : body.slice(0, end + 1);
})();

// The exec-form node one-liner the healthcheck runs, unwrapped from its YAML
// sequence. It holds no double quotes of its own (only single ones), which is what
// makes this extraction unambiguous.
const healthcheckProbe = /test: \["CMD", "node", "-e", "([^"]*)"\]/.exec(discordBotService)?.[1];

// Every tunable the bot process (or its probe) reads and that compose must forward.
// Listed literally so a key dropped from compose fails by name; the length is pinned
// below so a key quietly dropped from THIS list cannot pass either.
const FORWARDED_KNOBS = [
  'DISCORD_MAX_RPS',
  'DISCORD_BAN_PAUSE_MS',
  'DISCORD_BREAKER_LIMIT',
  'DISCORD_FORBIDDEN_TTL_MS',
  'DISCORD_ROLE_SYNC_INTERVAL_MS',
  'DISCORD_PRESENCE_DEBOUNCE_MS',
  'DISCORD_SWEEP_SLICE_MS',
  'DISCORD_SWEEP_SLICE_SIZE',
  'DISCORD_OUTBOX_POLL_MS',
  'DISCORD_OUTBOX_IDLE_MS',
  'DISCORD_OUTBOX_TIMEOUT_MS',
  'DISCORD_HEARTBEAT_FILE',
  'DISCORD_HEARTBEAT_INTERVAL_MS',
  'DISCORD_HEARTBEAT_STALE_MS',
];

describe('Discord bot deploy container contract', () => {
  it('builds and ships the bundled Discord bot artifact', () => {
    expect(dockerfile).toContain('COPY bot ./bot');
    expect(dockerfile).toContain('npm run build:bot');
    expect(dockerfile).toContain('COPY --from=build /app/dist-bot ./dist-bot');
  });

  it('keeps the Discord bot build script in the Docker build context', () => {
    expect(dockerignore).toContain('!scripts/build_bot.mjs');
  });

  it('runs the Discord bot as a separate compose service', () => {
    expect(compose).toContain('discord-bot:');
    expect(compose).toContain('container_name: eastbrook-discord-bot');
    expect(compose).toContain('command: ["node", "dist-bot/bot.cjs"]');
    expect(compose).toContain('GAME_SERVER_URL: http://game:8787');
    expect(compose).toContain(`DISCORD_BOT_TOKEN: ${composeEnv('DISCORD_BOT_TOKEN')}`);
  });

  it('passes the shared Discord bot secret to the game server', () => {
    expect(compose).toContain(`DISCORD_BOT_SECRET: ${composeEnv('DISCORD_BOT_SECRET')}`);
  });
});

describe('Discord bot build and typecheck surface', () => {
  it('bundles bot/main.ts to the exact artifact the compose command runs', () => {
    // The deploy contract has three legs and only two were pinned: the
    // Dockerfile runs build:bot and copies dist-bot, and compose runs
    // `node dist-bot/bot.cjs`. Nothing said what build:bot actually produces,
    // so repointing the entry or the outfile (or neutering the script) left the
    // image assembling cleanly and the container failing to start on the host.
    expect(packageJson.scripts['build:bot']).toBe('node scripts/build_bot.mjs');
    expect(buildBot).toContain("entryPoints: ['bot/main.ts']");
    expect(buildBot).toContain("outfile: 'dist-bot/bot.cjs'");
  });

  it('keeps bot/ inside the typecheck surface', () => {
    // This is the headline deliverable of the stability packet's first phase,
    // and it is one word in one array. Removing it is completely silent:
    // build:bot is esbuild, which does not typecheck, and `npm run check:types`
    // would simply check a smaller file set and stay green. The bot test suites
    // drag most of bot/ in through their own imports, but bot/main.ts (the
    // wiring) is imported by nothing and would drop out.
    expect(tsconfig.include).toContain('bot');
    // ...and that the gate's typecheck actually reads THAT tsconfig. A project-
    // less `tsc --noEmit` defaults to the root tsconfig.json (the release-side
    // incremental/buildinfo flags change caching, never the project read), but a
    // `-p`/`--project` redirect would leave the include above pinning a config
    // nothing runs, so that is the one shape this rejects.
    expect(packageJson.scripts['check:ts']).toMatch(/^tsc --noEmit(\s|$)/);
    expect(packageJson.scripts['check:ts']).not.toMatch(/(^|\s)(-p|--project)(\s|$)/);
    expect(packageJson.scripts['check:types']).toContain('check:ts');
  });

  it('typechecks bot/ a second time against a node-only, DOM-free lib set', () => {
    // The repo-wide tsc checks bot/ with the browser lib set, so bot code calling
    // `setTimeout(...)` and getting the DOM overload, or reaching for `document`,
    // compiles clean here and explodes under node at runtime. This second project
    // is the only thing that catches it, and it is worth nothing unless its lib is
    // actually node-shaped, hence the exact deep-equals plus the explicit no-DOM
    // assertion (a lib list that GREW a 'DOM' entry is precisely the regression).
    const tsconfigBot = readJsonc('tsconfig.bot.json') as {
      extends: string;
      compilerOptions: { lib: string[]; types: string[] };
      include: string[];
    };
    expect(tsconfigBot.extends).toBe('./tsconfig.json');
    expect(tsconfigBot.compilerOptions.lib).toEqual(['ES2022']);
    expect(tsconfigBot.compilerOptions.lib).not.toContain('DOM');
    expect(tsconfigBot.compilerOptions.types).toEqual(['node']);
    expect(tsconfigBot.include).toEqual(['bot']);
    expect(packageJson.scripts['check:ts:bot']).toBe('tsc -p tsconfig.bot.json');
    expect(packageJson.scripts['check:types']).toContain('check:ts:bot');
    // The bot project is ADDED to the gate, never substituted for the root include.
    // Dropping 'bot' from tsconfig.json in exchange would look like a tidy-up and
    // would silently take bot/ out of the repo-wide typecheck, leaving only this
    // narrower project (and, for anyone running a bare `tsc --noEmit`, nothing).
    expect(tsconfig.include).toContain('bot');
  });
});

describe('Discord bot container supervision', () => {
  // A slice that accidentally swallowed the game service would make every assertion
  // below meaningless, and would do so silently. This is the vacuity floor for the
  // whole describe: the slice holds the bot and stops before the game.
  it('slices the compose text to the discord-bot service alone', () => {
    expect(discordBotService).toContain('container_name: eastbrook-discord-bot');
    expect(discordBotService).not.toContain('container_name: eastbrook-game');
  });

  it('supervises the bot container: restart policy, profile, and resource ceilings', () => {
    expect(discordBotService).toContain('restart: unless-stopped');
    // The bot only comes up under `--profile discord`; losing the profile would start
    // it for every operator running a bare `docker compose up`, including anyone whose
    // .env has no bot token, and it would then crash-loop against the restart policy.
    expect(discordBotService).toContain('profiles:\n      - discord');
    // Shorter than the game's 75s on purpose: no save or drain obligations, just an
    // in-flight Discord call and the outbox ack. Raising it would only delay deploys.
    expect(discordBotService).toContain('stop_grace_period: 15s');
    // The ceiling protects the NEIGHBOURS (game and database on the same host) from a
    // leak in the bot, and memswap pinned equal is what turns an overrun into a clean
    // in-container OOM kill instead of the host thrashing swap first.
    expect(discordBotService).toContain('mem_limit: 512m');
    expect(discordBotService).toContain('memswap_limit: 512m');
  });

  it('probes bot liveness with an exec-form node one-liner, not a shell or an HTTP get', () => {
    expect(discordBotService).toContain('healthcheck:');
    expect(healthcheckProbe).toBeTruthy();
    // The runtime image (node:26-slim) has neither curl nor wget, so a CMD-SHELL probe
    // borrowed from the postgres service would fail on every host, always. Compose also
    // interpolates a `$` inside the test string, so a probe carrying one would reach the
    // container mangled or empty: this asserts the landed one-liner has none.
    expect(healthcheckProbe).not.toContain('$');
    // Freshness, not existence. `statSync(p)` alone would pass forever on the stamp a
    // long-dead scheduler wrote once at boot, which is the exact failure being probed.
    // The pin runs THROUGH the comparison and both exit arms: a scan that stops at the
    // operand would stay green with the verdict inverted (`>stale?0:1` ships a
    // healthcheck that is red exactly while the bot is healthy).
    expect(healthcheckProbe).toContain('Date.now()-fs.statSync(p).mtimeMs<stale?0:1');
    // Missing and unreadable must exit nonzero too, hence the catch arm.
    expect(healthcheckProbe).toContain('catch{process.exit(1)}');
    // The probe trims the path because bot/config.ts trims it; without the matching
    // trim a padded override sends the write and the stat to two different names and
    // the container is permanently unhealthy.
    expect(healthcheckProbe).toContain(".trim()||'");
    expect(discordBotService).toContain('start_period: 60s');
  });

  it('gives the probe cycle real margins, pinned relationally and by value', () => {
    // start_period gets the same relational treatment as the stale window: the
    // first jittered write can land about 1.1x the interval after boot, so the
    // boot margin must scale with the cadence. The literal above pins today's
    // value; this pins the RELATION, so raising HEARTBEAT_INTERVAL_MS in
    // bot/cadence.ts without widening start_period fails here instead of
    // silently eroding the margin (a declared Phase 7 residual, now closed).
    const startPeriod = /start_period: (\d+)s/.exec(discordBotService);
    expect(startPeriod).not.toBeNull();
    expect(Number(startPeriod?.[1]) * 1000).toBeGreaterThanOrEqual(2 * HEARTBEAT_INTERVAL_MS);
    // The remaining probe knobs fall back to docker defaults when deleted, which
    // is silent: losing `retries: 4` falls back to 3 and shortens the unhealthy
    // verdict by one probe cycle.
    expect(discordBotService).toContain('interval: 15s');
    expect(discordBotService).toContain('timeout: 5s');
    expect(discordBotService).toContain('retries: 4');
  });

  // Silent drift here is the whole hazard of a file-based heartbeat: the writer and the
  // prober agree on nothing at compile time, so a path changed on one side leaves a
  // healthcheck that is permanently red (prober watching a file nobody writes) or
  // permanently green in the wrong way. Nothing else in the tree connects the two.
  it('probes the same heartbeat path the bot writes, and tolerates more than one interval', () => {
    expect(healthcheckProbe).toContain(`'${DEFAULT_HEARTBEAT_FILE}'`);
    const fallbackPath = /\.trim\(\)\|\|'([^']*)'/.exec(healthcheckProbe ?? '');
    expect(fallbackPath?.[1]).toBe(DEFAULT_HEARTBEAT_FILE);
    // The staleness window must clear at least two writes, or ordinary scheduling jitter
    // (or one skipped write) flaps the container unhealthy. Read the fallback by anchoring
    // to the guard's own shape: a bare digit scan would happily match the interval, the
    // port, or any other number in the probe. The trailing guard keeps 9000 from matching
    // 90000. The s>0 arm is what rejects '', garbage, zero and negatives alike, matching
    // the bot side's positiveNumberFromEnv.
    const fallbackStale = /DISCORD_HEARTBEAT_STALE_MS\);const stale=s>0\?s:(\d+)(?!\d)/.exec(
      healthcheckProbe ?? '',
    );
    expect(fallbackStale).not.toBeNull();
    expect(Number(fallbackStale?.[1])).toBeGreaterThanOrEqual(2 * HEARTBEAT_INTERVAL_MS);
  });
});

// The probe's production logic lives in a YAML string, where every structural pin above
// is a substring scan: a one-liner that satisfies all of them but is unparsable to node
// (or parses with the verdict inverted) would ship, and the symptom is a container
// permanently unhealthy (or worse, healthy over a wedge). So EXECUTE the extracted
// string the way docker will, with the real node binary, against real files in the
// three states the acceptance list names, and hold its verdict to the same pure rule
// (`isHeartbeatFresh`) the module documents. The far fixtures use minute margins, so
// wall-clock slop between utimes and the probe run cannot flip them; the boundary
// fixtures deliberately sit 5s either side of the probe's own window, sized against a
// sub-second spawn (the one case slop could flip is near-fresh, and only under
// pathological contention).
describe('Discord bot healthcheck probe, executed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wocc-heartbeat-probe-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Runs the probe exactly as the container healthcheck does and reports its exit
  // code. Both heartbeat keys are always set explicitly (to '' when the case means
  // "unset") so an ambient value in the test environment cannot leak in.
  const probeExit = (heartbeatFile: string, staleMs: string) => {
    // Loud, not vacuous: `node -e ''` exits 0, so a failed extraction would turn
    // every all-zeros case below (the padded path, the non-positive knobs) into a
    // pass that executed nothing. The structural suite reds too, but each executed
    // case should fail by NAME when the extraction breaks.
    if (!healthcheckProbe)
      throw new Error('healthcheck probe not extracted from docker-compose.yml');
    try {
      execFileSync(process.execPath, ['-e', healthcheckProbe], {
        env: {
          ...process.env,
          DISCORD_HEARTBEAT_FILE: heartbeatFile,
          DISCORD_HEARTBEAT_STALE_MS: staleMs,
        },
        stdio: 'ignore',
      });
      return 0;
    } catch (err) {
      const status = (err as { status?: number | null }).status;
      expect(status).not.toBeNull();
      return status ?? -1;
    }
  };

  const stampFile = (name: string, ageMs: number) => {
    const p = join(dir, name);
    writeFileSync(p, 'probe fixture');
    const when = new Date(Date.now() - ageMs);
    utimesSync(p, when, when);
    return p;
  };

  it('answers healthy for a fresh stamp and unhealthy for a stale one, agreeing with isHeartbeatFresh', () => {
    const fresh = stampFile('fresh', 1000);
    const stale = stampFile('stale', 10 * 60 * 1000);
    expect(probeExit(fresh, '')).toBe(0);
    expect(probeExit(stale, '')).toBe(1);
    // The pure rule is the documented decision; the probe is its YAML twin. The
    // agreement is driven with the window READ FROM THE PROBE, at fixtures a few
    // seconds either side of it, so the executed verdict and isHeartbeatFresh are
    // held to the SAME boundary: hand-restating 90000 here proved nothing, since
    // far-away fixtures agree under any window. (5s margins are safe: the probe
    // run lands well within them, and the value drift itself is what the
    // relational >= 2x interval pin above guards.)
    const winMatch = /const stale=s>0\?s:(\d+)(?!\d)/.exec(healthcheckProbe ?? '');
    expect(winMatch).not.toBeNull();
    const win = Number(winMatch?.[1]);
    const nearFresh = stampFile('near-fresh', win - 5000);
    const nearStale = stampFile('near-stale', win + 5000);
    expect(probeExit(nearFresh, '')).toBe(0);
    expect(probeExit(nearStale, '')).toBe(1);
    expect(isHeartbeatFresh(Date.now() - (win - 5000), Date.now(), win)).toBe(true);
    expect(isHeartbeatFresh(Date.now() - (win + 5000), Date.now(), win)).toBe(false);
  });

  it('answers unhealthy when the heartbeat path cannot be statted (a denied parent directory)', () => {
    // "Unreadable" needs precision: stat needs no read permission on the FILE, so
    // a chmod-000 stamp still reads healthy while fresh, and correctly so (mtime
    // is the only evidence the probe needs, and a stamp the bot cannot WRITE goes
    // stale within one window anyway). The arm the catch actually guards beyond
    // ENOENT is stat DENIAL, which takes a denied parent directory. Root stats
    // through anything, so the fixture is skipped there rather than left vacuous.
    if (process.getuid?.() === 0) return;
    const deniedDir = join(dir, 'denied');
    mkdirSync(deniedDir);
    const target = join(deniedDir, 'hb');
    writeFileSync(target, 'probe fixture');
    chmodSync(deniedDir, 0o000);
    try {
      expect(probeExit(target, '')).toBe(1);
    } finally {
      chmodSync(deniedDir, 0o755);
    }
  });

  it('answers unhealthy for a missing file', () => {
    expect(probeExit(join(dir, 'never-written'), '')).toBe(1);
  });

  it('trims a padded path override the same way bot/config.ts does', () => {
    const fresh = stampFile('padded-target', 1000);
    expect(probeExit(`  ${fresh}  `, '')).toBe(0);
  });

  it('falls back to the default window for a non-positive staleness override', () => {
    const fresh = stampFile('fresh-negative-knob', 1000);
    // A negative bound would make age<stale unsatisfiable and pin the container
    // permanently unhealthy; the s>0 guard must reject it like '' and garbage.
    expect(probeExit(fresh, '-5')).toBe(0);
    expect(probeExit(fresh, '0')).toBe(0);
    expect(probeExit(fresh, 'not-a-number')).toBe(0);
  });
});

describe('Discord bot runtime configuration passthrough', () => {
  // The bot reads all of these; compose forwarded none of them. That is not a cosmetic
  // gap: it makes every incident lever DEPLOY.md tells an operator to reach for inert on
  // the real host, where the only remaining way to change one is to edit and rebuild the
  // image mid-incident. Empty-when-unset is safe by construction (positiveNumberFromEnv
  // rejects '' and falls back to the code default), so forwarding costs nothing.
  it('forwards every bot tunable into the container', () => {
    // Pin the list length as well as its contents: without this, deleting a key from
    // FORWARDED_KNOBS deletes its assertion and the suite stays green over less.
    expect(FORWARDED_KNOBS).toHaveLength(14);
    for (const key of FORWARDED_KNOBS) {
      expect(discordBotService).toContain(`${key}: ${composeEnv(key)}`);
    }
  });
});

describe('Discord bot DEPLOY.md contract', () => {
  const deployDoc = read('DEPLOY.md');

  it('documents every env key the bot reads, plus the probe-only staleness knob', () => {
    // D13 says every bot env key is documented in DEPLOY.md, and until now the
    // rule was enforced nowhere: the compose passthrough got a by-name pin this
    // phase for exactly this failure shape (11 knobs the bot read and compose
    // forwarded to nobody), so the doc table gets the same treatment. The key
    // set is scraped from bot/config.ts the way the config suite does it, so a
    // key added there without a doc row fails here by name.
    const stripped = read('bot/config.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const keys = new Set<string>();
    for (const m of stripped.matchAll(/process\.env\.([A-Z_0-9]+)/g)) keys.add(m[1]);
    for (const m of stripped.matchAll(/required\('([A-Z_0-9]+)'\)/g)) keys.add(m[1]);
    // Vacuity floor at the real count: a scrape that quietly stopped matching
    // would otherwise assert nothing.
    expect(keys.size).toBeGreaterThanOrEqual(26);
    // The TABLE ROW form, not a bare backticked mention: several keys also
    // appear in prose (incident guidance, the runbook), so a deleted row would
    // otherwise stay green on its prose echo (proved by mutation: dropping the
    // DISCORD_MAX_RPS row passed the bare-backtick form).
    for (const key of keys) expect(deployDoc).toContain(`| \`${key}\` |`);
    // Probe-side only, deliberately absent from BOT_ENV_KEYS and from config.ts,
    // still an operator lever that needs its row.
    expect(deployDoc).toContain('| `DISCORD_HEARTBEAT_STALE_MS` |');
  });

  it('carries the health-verification commands the runbook names, override-safe', () => {
    expect(deployDoc).toContain(
      "sudo docker inspect --format '{{json .State.Health}}' eastbrook-discord-bot",
    );
    // The by-hand freshness check must resolve DISCORD_HEARTBEAT_FILE exactly
    // like the probe (trimmed, with the same fallback), or on a host that set
    // the override it throws ENOENT mid-incident and reads as a dead bot.
    expect(deployDoc).toContain(
      "const p=(process.env.DISCORD_HEARTBEAT_FILE||'').trim()||'/tmp/discord-bot-heartbeat'",
    );
  });
});

describe('Discord bot internal API at the public edge', () => {
  // The bot talks to the game over /internal/*, whose only gate is a shared secret
  // header. First-boot Caddy must 404 that prefix from outside as defense in depth over
  // that secret: it keeps a leaked header from being usable from the internet, and keeps
  // the internal surface's own 404-vs-401 differences from answering probes. The full
  // both-vhosts, byte-identical pin lives in tests/deploy_watchdog.test.ts; this is the
  // bot-side half, here so the Discord contract fails on its own if the prefix is lost.
  it('hides /internal/* behind the same ops matcher at first boot', () => {
    expect(userData).toContain('@ops path /livez /readyz /metrics /internal/*');
  });
});
