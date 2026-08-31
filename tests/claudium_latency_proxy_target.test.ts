// The rig proxy's REQUEST-TARGET guard, driven as a real HTTP server rather than
// scraped as source.
//
// WHY IT HAS ITS OWN FILE AND ITS OWN SERVER. scripts/claudium_latency_proxy.mjs
// sits between the game server and the economy service during the go-live rig,
// and it forwards EVERY inbound header verbatim, the two economy secrets
// included. Its whole safety rests on one string check deciding that the target
// cannot re-point the forward at another host. A source pin cannot answer that:
// the question is what THIS Node's WHATWG URL resolves, and the third bypass
// shape below was found by probing exactly that and not by reading the code.
//
// The module runs its server at import, so it is spawned as a child process on a
// port of its own and torn down in the same test.
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// EPHEMERAL PORTS, not fixed ones. Two hardcoded numbers turn a developer's
// running rig, or a parallel worker, into a red gate whose stated cause is a
// bypass that never happened. Both servers bind port 0 and report what they got.
let PROXY_PORT = 0;
let UPSTREAM_PORT = 0;

let proxy: ChildProcess;
let proxyStderr = '';
let upstream: import('node:http').Server;
/** Every path the upstream was asked for, so a forward that lands is visible. */
const upstreamHits: string[] = [];

beforeAll(async () => {
  const http = await import('node:http');
  upstream = http.createServer((req, res) => {
    upstreamHits.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, saw: req.url }));
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  UPSTREAM_PORT = (upstream.address() as { port: number }).port;
  // The proxy binds its own ephemeral port and prints it in its ready line, but
  // parsing stdout is one more thing to get wrong; ask the OS for a free port and
  // hand it over instead. A race here reds the run with a clear cause, unlike a
  // collision on a fixed number.
  const scratch = await import('node:net');
  PROXY_PORT = await new Promise<number>((r) => {
    const probe = scratch.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => r(port));
    });
  });
  proxy = spawn(process.execPath, ['scripts/claudium_latency_proxy.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PROXY_PORT: String(PROXY_PORT),
      PROXY_UPSTREAM: `http://127.0.0.1:${UPSTREAM_PORT}`,
      // No delay: this file is about the target guard, never about the latency.
      PROXY_SPEND_DELAY_MS: '0',
    },
    // KEEP stderr. Discarding it meant a proxy that died on startup produced
    // "never came up" and nothing else, which points at the wrong file.
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proxy.stderr?.on('data', (c) => {
    proxyStderr += String(c);
  });
  let exited: string | null = null;
  proxy.on('exit', (code, signal) => {
    exited = `exit=${code} signal=${signal}`;
  });
  // Poll rather than sleep a guess: the control route answers as soon as it is up.
  for (let i = 0; i < 100; i++) {
    if (exited !== null) throw new Error(`latency proxy died (${exited}): ${proxyStderr}`);
    try {
      await fetch(`http://127.0.0.1:${PROXY_PORT}/rig/stats`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`latency proxy never came up. stderr: ${proxyStderr || '(empty)'}`);
}, 20_000);

afterAll(async () => {
  // AWAIT the child's exit rather than firing kill() and moving on: a surviving
  // node process holds its port and the next run of this file collides with it.
  if (proxy && proxy.exitCode === null && !proxy.killed) {
    const gone = new Promise<void>((r) => proxy.once('exit', () => r()));
    proxy.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5_000))]);
  }
  await new Promise<void>((r) => upstream.close(() => r()));
});

/** Send a RAW request target, which fetch() would normalize away. */
function rawRequest(target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    import('node:net').then(({ connect }) => {
      const sock = connect(PROXY_PORT, '127.0.0.1', () => {
        sock.write(
          `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${PROXY_PORT}\r\n` +
            'x-woc-economy-secret: rig-secret-must-not-leave\r\nConnection: close\r\n\r\n',
        );
      });
      let buf = '';
      sock.on('data', (c) => {
        buf += c.toString();
      });
      sock.on('end', () => {
        const status = Number(/^HTTP\/1\.1 (\d+)/.exec(buf)?.[1] ?? 0);
        resolve({ status, body: buf.slice(buf.indexOf('\r\n\r\n') + 4) });
      });
      sock.on('error', reject);
    });
  });
}

describe('the rig proxy refuses every request target that re-points the forward', () => {
  it('forwards an ordinary absolute path to the guarded upstream', async () => {
    upstreamHits.length = 0;
    const r = await rawRequest('/v1/claudium/spend');
    expect(r.status).toBe(200);
    // The POSITIVE arm, so the refusals below cannot pass because the proxy is
    // simply broken: a legitimate target really does reach the upstream.
    expect(upstreamHits).toEqual(['/v1/claudium/spend']);
  });

  it('and the guard is not over-broad: a PERCENT-ENCODED backslash still forwards', async () => {
    // The refusal below is on a RAW backslash, because that is the byte WHATWG
    // URL reads as an authority separator. A percent-encoded one is an ordinary
    // path character that resolves to the upstream host, so refusing it would
    // break a legitimate request for no safety. Pinned in both directions,
    // because a guard widened to `%5C` would pass every refusal arm below while
    // silently breaking this one.
    expect(new URL('/%5Cevil.example/spend', `http://127.0.0.1:${UPSTREAM_PORT}`).host).toBe(
      `127.0.0.1:${UPSTREAM_PORT}`,
    );
    upstreamHits.length = 0;
    const r = await rawRequest('/%5Cevil.example/spend');
    expect(r.status).toBe(200);
    expect(upstreamHits).toEqual(['/%5Cevil.example/spend']);
  });

  it('refuses every host-re-pointing shape the HANDLER sees, naming why', async () => {
    // Shape 3 is the one the phase's own comment claimed to have closed and had
    // not: WHATWG URL treats a backslash as a slash in the authority position,
    // so `/\\evil.example/spend` starts with a single slash, is not `//`, and
    // still resolves to the host evil.example. Verified against this Node.
    for (const target of [
      '//evil.example/spend', // protocol-relative
      'http://evil.example/spend', // absolute form, surfaced verbatim by Node
      '/\\evil.example/spend', // BACKSLASH authority, the shape that slipped
      '/\\\\evil.example/spend',
    ]) {
      upstreamHits.length = 0;
      const r = await rawRequest(target);
      expect(r.status, `${target} was not refused by the proxy`).toBe(400);
      expect(r.body, `${target} was refused without naming why`).toContain('bad_request_target');
      expect(upstreamHits, `${target} still reached an upstream`).toEqual([]);
    }
  });

  it('and a target Node itself will not parse never reaches a forward either', async () => {
    // A request line that does not start with a slash is malformed enough that
    // Node's own HTTP parser answers 400 before any handler runs. That is a
    // refusal too, but by a DIFFERENT layer, so it is asserted separately rather
    // than folded in above where an empty body would read as the app's answer.
    upstreamHits.length = 0;
    const r = await rawRequest('\\\\evil.example/spend');
    expect(r.status).not.toBe(200);
    expect(r.body, 'this one is the parser, so it carries no app payload').not.toContain(
      'bad_request_target',
    );
    expect(upstreamHits, 'a malformed target still reached an upstream').toEqual([]);
  });

  it('the backslash shape really does resolve to another host, so the guard is load-bearing', () => {
    // Pinned as a fact about the RUNTIME, not about the proxy: if a future Node
    // stopped resolving it this way the guard would look like dead code, and
    // this arm is what says it was not.
    const base = 'http://127.0.0.1:8792';
    expect(new URL('/\\evil.example/spend', base).host).toBe('evil.example');
    // And the two checks that were already there are pinned the same way.
    expect(new URL('//evil.example/spend', base).host).toBe('evil.example');
    expect(new URL('http://evil.example/spend', base).host).toBe('evil.example');
    // While an ordinary path stays home.
    expect(new URL('/v1/claudium/spend', base).host).toBe('127.0.0.1:8792');
  });
});
