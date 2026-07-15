import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('docker-compose.yml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;

// The literal healthcheck line, exactly as it must appear on the game service. It is
// pinned whole (not by fragments) because every part of it is load-bearing: the exec
// form, the node interpreter, the /livez path, the status check, and the error arm.
const HEALTHCHECK_TEST_LINE =
  '      test: ["CMD", "node", "-e", "require(\'http\').get(\'http://127.0.0.1:8787/livez\',(r)=>process.exit(r.statusCode===200?0:1)).on(\'error\',()=>process.exit(1))"]';

// The healthcheck test line as it sits in the file, used only by the negative pins so
// they cannot be satisfied by an unrelated /livez mention elsewhere in the compose file.
const healthcheckTestLine =
  compose.split('\n').find((line) => line.trimStart().startsWith('test: ["CMD", "node"')) ?? '';

// The `game:` service block alone. discord-bot runs the SAME image, so a whole-file
// match would still pass if one of these knobs landed on the wrong service.
const gameService = compose.slice(
  compose.indexOf('\n  game:'),
  compose.indexOf('\n  discord-bot:'),
);

describe('Game container health and resource deploy contract', () => {
  // The whole point of gameService is to scope the knob assertions below to the game
  // block alone (discord-bot runs the SAME image). If either boundary marker is missing,
  // indexOf returns -1: `\n  game:` at -1 slices from the end, `\n  discord-bot:` at -1
  // slices to EOF, and the "scoped" slice silently degrades into a whole-file match that
  // would pass even with a knob on the wrong service. Assert both markers are present and
  // ordered so the scoping the rest of this suite relies on is real.
  it('finds both game-service slice boundaries, in order', () => {
    const gameStart = compose.indexOf('\n  game:');
    const discordStart = compose.indexOf('\n  discord-bot:');
    expect(gameStart).toBeGreaterThanOrEqual(0);
    expect(discordStart).toBeGreaterThanOrEqual(0);
    expect(discordStart).toBeGreaterThan(gameStart);
  });

  // `restart: unless-stopped` only acts on process EXIT, so a wedged-but-alive server
  // stays in the load balancer until a human notices. This probe is the only signal
  // docker has that the process is still doing its job. The runtime image is alpine with
  // no curl and no wget, so the probe has to be the node one-liner in exec form; if it
  // regresses to a CMD-SHELL curl the healthcheck fails permanently on a healthy server.
  it('probes /livez with an exec-form node one-liner (no curl exists in the image)', () => {
    expect(gameService).toContain(HEALTHCHECK_TEST_LINE);
  });

  // A bare http.get exits 0 on ANY response, so without the statusCode check a draining
  // or erroring server reads as healthy; and without the 'error' handler a refused
  // connection throws an unhandled event. Both arms must fail the probe, or a dead
  // server is reported healthy and never restarted.
  it('fails the probe on a non-200 status and on a refused connection', () => {
    expect(healthcheckTestLine).toContain('process.exit(r.statusCode===200?0:1)');
    expect(healthcheckTestLine).toContain(".on('error',()=>process.exit(1))");
  });

  // /livez reports a wedged game loop and deliberately STAYS 200 while the server
  // drains. /readyz flips to 503 during a graceful shutdown, so probing it would make
  // docker kill and restart a server that is shutting down cleanly. /metrics and
  // /api/status say nothing about the game loop at all.
  it('targets /livez only, never /readyz or another endpoint', () => {
    expect(healthcheckTestLine).toContain('/livez');
    expect(healthcheckTestLine).not.toContain('/readyz');
    expect(healthcheckTestLine).not.toContain('/metrics');
    expect(healthcheckTestLine).not.toContain('/api/status');
  });

  // Pinned as one contiguous block so the knobs cannot drift onto another service or
  // lose a line. Losing interval/timeout/retries reverts them to docker's 30s/30s/3
  // defaults; losing start_period is worse: a cold boot waits out the DB retry loop and
  // the schema sweep, so early probe failures would spend the retry budget and docker
  // would kill a server that was booting normally.
  it('pins the healthcheck cadence, including the cold-boot start_period', () => {
    expect(gameService).toContain(
      [
        '    healthcheck:',
        HEALTHCHECK_TEST_LINE,
        '      interval: 15s',
        '      timeout: 5s',
        '      retries: 4',
        '      start_period: 60s',
      ].join('\n'),
    );
  });

  // Docker's default is 10s between SIGTERM and SIGKILL, which is far too short for the
  // shutdown chain (character/market/mail saves, ending play sessions, the ledger and
  // deed drains, the Steam mirror, lease release, the pool close). At the default, a
  // deploy restart would SIGKILL the server mid-save and lose player progress.
  it('gives the server 75s between SIGTERM and SIGKILL to finish its saves', () => {
    expect(gameService).toContain('\n    stop_grace_period: 75s\n');
  });

  // Without a ceiling, a runaway game process (a leak, a snapshot storm) is free to eat
  // every last byte on the host and starve the database and the OS, so the whole host
  // wedges instead of just the one container. mem_limit is the direct runtime key,
  // honored unconditionally by `docker compose up`; 5g is what the 4096 MiB heap plus
  // native overhead is sized against, so this value and NODE_OPTIONS must move together.
  it('caps game container memory at 5 GiB with mem_limit', () => {
    expect(gameService).toContain('\n    mem_limit: 5g\n');
  });

  // Without memswap_limit, docker defaults total memory+swap to twice mem_limit, so on a
  // host with swap a leaking container thrashes up to 5g of swap before the OOM kill
  // instead of getting the clean in-container kill the memory limit exists to produce.
  it('pins swap to the memory limit so the container cannot lean on host swap', () => {
    expect(gameService).toContain('\n    memswap_limit: 5g\n');
  });

  // The game service passes an explicit environment allowlist (no env_file), so setting
  // NODE_OPTIONS in the host .env without this line would populate compose interpolation
  // and never reach the process. The heap would then keep node's default, which is sized
  // from TOTAL SYSTEM memory rather than the cgroup limit, and V8 could grow past
  // mem_limit and be OOM-killed mid-tick.
  it('passes NODE_OPTIONS through to the game server container', () => {
    expect(gameService).toContain(`NODE_OPTIONS: ${composeEnv('NODE_OPTIONS')}`);
  });

  // The recommended heap ceiling is documented, not baked in: compose and the image must
  // stay value-free so each deploy can size the heap for its own box. If this row is
  // lost, an operator has no way to know the heap must sit under the 5 GiB mem_limit.
  it('documents NODE_OPTIONS in .env.example with the recommended heap ceiling', () => {
    expect(envExample).toContain('#NODE_OPTIONS=--max-old-space-size=4096');
  });

  // stop_grace_period only works if node is PID 1 and receives SIGTERM. The runtime CMD
  // is `sh -c '... && node dist-server/server.cjs'`: sh implicitly execs the final
  // command, so node becomes PID 1 and the shutdown chain runs on SIGTERM. Appending any
  // command after node would leave sh as PID 1, node would never see SIGTERM, and every
  // deploy would SIGKILL the server mid-save at the 75s grace mark.
  it('keeps node as the final exec in the Dockerfile CMD so it receives SIGTERM', () => {
    expect(dockerfile).toContain('node dist-server/server.cjs"]');
  });
});

describe('healthcheck probe behavior (executed)', () => {
  // The exact-string pin above keeps the compose text; this executes the LOGIC of that
  // text. The probe source is EXTRACTED from the pinned line (never a copy that could
  // drift), with only the port substituted: binding 8787 here would collide with a dev
  // server, and the port is not what is under test. What is under test is the pair of
  // failure arms: a bare http.get exits 0 on ANY response (a 503 would read healthy
  // forever), and without the error handler a refused connection dies on an unhandled
  // 'error' event instead of a clean nonzero exit.
  const probeSource = HEALTHCHECK_TEST_LINE.match(/"-e", "(.+)"\]$/)?.[1] ?? '';

  function listen(statusCode: number): Promise<{ server: Server; port: number }> {
    return new Promise((resolve) => {
      const server = createServer((_req, res) => {
        res.statusCode = statusCode;
        res.end(statusCode === 200 ? 'ok' : 'game loop stalled');
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, port: (server.address() as { port: number }).port });
      });
    });
  }

  function runProbe(port: number): Promise<number | null> {
    const code = probeSource.replace(
      'http://127.0.0.1:8787/livez',
      `http://127.0.0.1:${port}/livez`,
    );
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore', timeout: 8_000 });
      child.on('close', (exitCode) => resolve(exitCode));
    });
  }

  it('extracts the probe source from the pinned healthcheck line', () => {
    expect(probeSource).toContain("require('http')");
    expect(probeSource).toContain('/livez');
  });

  it('exits 0 on a 200, and nonzero on a 503 and on a refused connection', async () => {
    const ok = await listen(200);
    expect(await runProbe(ok.port)).toBe(0);
    await new Promise((resolve) => ok.server.close(resolve));

    const stalled = await listen(503);
    expect(await runProbe(stalled.port)).toBe(1);
    await new Promise((resolve) => stalled.server.close(resolve));

    // Reuse the just-freed port for the refused arm: nothing listens there anymore.
    expect(await runProbe(stalled.port)).toBe(1);
  });
});
