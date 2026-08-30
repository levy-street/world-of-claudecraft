// A rig-only HTTP passthrough that can DELAY /spend past the game server's
// SERVICE_TIMEOUT_MS (5000, server/claudium_proxy.ts), so a purchase whose money
// really does move comes back to the client as the AMBIGUOUS 'unavailable'.
//
// That is the state ruling 19 is about and the one no jsdom suite can produce:
// the debit lands, the reply is lost, and the client cannot tell that apart from
// never having been reached. The delay must EXCEED the timeout (a delay under it
// only shows the in-flight state), and the request is still forwarded, which is
// what makes the debit real.
//
// GET /rig/delay/<ms> sets the delay at runtime, so one browser session can be
// made ambiguous and then healthy without a restart.
import http from 'node:http';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';

const PORT = Number(process.env.PROXY_PORT ?? 8799);
// GUARD THE FORWARD, not just the listen. The game server points
// WOC_ECONOMY_SERVICE_URL at this proxy, so everything passing through carries
// x-woc-economy-secret and x-woc-economy-admin-secret, and every inbound header
// is forwarded verbatim. Without this one line a single environment variable
// ships those secrets to an arbitrary host.
const UPSTREAM = process.env.PROXY_UPSTREAM ?? 'http://127.0.0.1:8798';
assertLoopbackUrl(UPSTREAM, 'PROXY_UPSTREAM');
let delayMs = Number(process.env.PROXY_SPEND_DELAY_MS ?? 9000);
// RECEIVED, and it decides the delay. A refused target and a forward that dies on
// ECONNREFUSED both count here, which is right for "how busy is this rig" and
// WRONG for "did the spend traverse the service".
let spends = 0;
// ANSWERED BY THE UPSTREAM. Incremented only when the real service has replied,
// so a caller can tell a spend that reached the economy service from one that was
// refused at this proxy or never connected. The probe's arm-A/arm-C claim ("which
// layer held the line") and its arm-B control ("the second charge really did
// traverse the service") both read THIS, because reading `spends` let a 502 count
// as a traversal.
let forwards = 0;

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const control = /^\/rig\/delay\/(\d+)$/.exec(url);
  if (control) {
    delayMs = Number(control[1]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, delayMs, spends, forwards }));
    return;
  }
  if (url === '/rig/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ delayMs, spends, forwards }));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const isSpend = url.endsWith('/spend');
    if (isSpend) spends++;
    const wait = isSpend ? delayMs : 0;
    // The DELAY IS ON THE REPLY, not on the forward: the upstream sees the spend
    // immediately and debits, and only the answer is late. A delay before the
    // forward would make the request genuinely never-reached inside the client's
    // window, which is the case phase 14 settles as REFUSED rather than
    // ambiguous, and would test the opposite thing.
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    // Build from the guarded UPSTREAM's ORIGIN plus the raw path, never by
    // resolving req.url against it. Node surfaces absolute-form and
    // protocol-relative request targets verbatim, so `new URL(req.url, UPSTREAM)`
    // resolves `//evil.example/spend` and `http://evil.example/spend` to another
    // HOST, and the forward below copies every inbound header, the economy
    // secrets included. Guarding the configured upstream is only half the job.
    // A BACKSLASH IS THE THIRD FORM, and it slipped the first two checks: WHATWG
    // URL treats `\` as `/` in the authority position, so `/\evil.example/spend`
    // starts with a single `/`, is not `//`, and still resolves to the host
    // evil.example. Probed against this Node, not inferred. A legitimate request
    // target never carries a raw backslash (it would be percent-encoded), so
    // refusing every one of them is both safe and total.
    if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'bad_request_target' }));
      return;
    }
    // Belt and braces: the guard above decides, but the resolved host is what
    // actually matters, so refuse anything that did not land on the upstream.
    // This is the assertion a future edit to the string checks cannot weaken.
    if (new URL(url, new URL(UPSTREAM).origin).origin !== new URL(UPSTREAM).origin) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'bad_request_target' }));
      return;
    }
    const base = new URL(UPSTREAM);
    const upstream = new URL(url, base.origin);
    const proxied = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: upstream.pathname + upstream.search,
        method: req.method,
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      },
      (up) => {
        const out = [];
        up.on('data', (c) => out.push(c));
        up.on('end', () => {
          // The upstream ANSWERED. Only now has the request provably traversed
          // the service, which is the fact the probe's money arms assert on.
          if (isSpend) forwards++;
          const payload = Buffer.concat(out);
          const send = () => {
            res.writeHead(up.statusCode ?? 502, {
              'content-type': up.headers['content-type'] ?? 'application/json',
            });
            res.end(payload);
          };
          if (wait > 0) setTimeout(send, wait);
          else send();
        });
      },
    );
    proxied.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'proxy_upstream', detail: e.message }));
    });
    proxied.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`latency proxy on 127.0.0.1:${PORT} -> ${UPSTREAM}, /spend delayed ${delayMs}ms`);
});
