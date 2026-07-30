#!/usr/bin/env node
// Layout-epoch preflight for an OTA publish (docs/ota-updates.md).
//
// An OTA bundle replaces the web layer on a phone while the authoritative
// server keeps running untouched, so the ONE thing that must agree between the
// two is the world-layout epoch: src/world_api.ts encodes it in the first
// WebSocket frame's discriminator (`auth-world-<ONLINE_WORLD_LAYOUT_VERSION>`)
// and the server refuses any other discriminator outright. Publishing a bundle
// from a different epoch than the running server would leave every updated
// device unable to connect until it picked up a corrected bundle.
//
// The probe is deliberately credential-free. It opens one socket, sends this
// checkout's discriminator with an EMPTY token, and reads the single rejection
// frame the server answers with:
//
//   'not authenticated'          -> the discriminator was accepted, epochs match
//   the incompatible-world text  -> the discriminator was refused, epochs differ
//   anything else                -> inconclusive (rate limited, timed out); the
//                                   caller must treat this as a failure, never
//                                   as permission to publish
//
// Usage: node scripts/ota/check_server_layout.mjs [wss://host/ws]
//
// The parsing and classification are pure and unit-tested
// (tests/ota_server_layout.test.ts); only the socket at the bottom runs when
// invoked as a CLI.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How long to wait for the server's single rejection frame. */
const PROBE_TIMEOUT_MS = 15_000;

/** The verdicts the classifier can return. Only `compatible` may publish. */
export const LAYOUT_VERDICT = {
  compatible: 'compatible',
  incompatible: 'incompatible',
  inconclusive: 'inconclusive',
};

/**
 * The server's rejection literal for a token it cannot resolve
 * (`WS_AUTH_ERROR.notAuthenticated` in server/ws_auth.ts). Reaching it proves
 * the handshake got PAST the discriminator check, which is the whole signal.
 * Pinned against the server source by tests/ota_server_layout.test.ts.
 */
export const NOT_AUTHENTICATED_ERROR = 'not authenticated';

/**
 * Read the wire contract out of src/world_api.ts rather than importing it: this
 * is a .mjs script and world_api.ts is TypeScript, and reading the file is also
 * exactly right semantically, since we want the epoch of the CHECKOUT being
 * published, not of anything already installed.
 */
export function parseWorldApiContract(source) {
  const layout = source.match(/ONLINE_WORLD_LAYOUT_VERSION\s*=\s*(\d+)\s*as const/);
  const timer = source.match(/STABLE_TIMER_WIRE_VERSION\s*=\s*(\d+)\s*as const/);
  const incompatible = source.match(/ONLINE_WORLD_INCOMPATIBLE_MESSAGE\s*=\s*'([^']+)'\s*as const/);
  if (!layout) throw new Error('ota layout check: ONLINE_WORLD_LAYOUT_VERSION not found');
  if (!timer) throw new Error('ota layout check: STABLE_TIMER_WIRE_VERSION not found');
  if (!incompatible)
    throw new Error('ota layout check: ONLINE_WORLD_INCOMPATIBLE_MESSAGE not found');
  const layoutVersion = Number(layout[1]);
  return {
    layoutVersion,
    authType: `auth-world-${layoutVersion}`,
    timerWire: Number(timer[1]),
    incompatibleMessage: incompatible[1],
  };
}

/** The unauthenticated handshake frame the probe sends. */
export function buildProbeFrame(contract) {
  return {
    t: contract.authType,
    token: '',
    character: 0,
    clientSeed: '',
    timerWire: contract.timerWire,
  };
}

/**
 * Classify the server's first frame. Anything other than the two known
 * rejections is `inconclusive` on purpose: a rate limit or an auth timeout says
 * nothing about the epoch, and guessing "compatible" there would defeat the
 * point of the check.
 */
export function classifyHandshakeReply(raw, contract) {
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch {
    return { verdict: LAYOUT_VERDICT.inconclusive, detail: `unparseable frame: ${raw}` };
  }
  if (frame?.t !== 'error' || typeof frame.error !== 'string') {
    return { verdict: LAYOUT_VERDICT.inconclusive, detail: `unexpected frame: ${raw}` };
  }
  if (frame.error === contract.incompatibleMessage) {
    return { verdict: LAYOUT_VERDICT.incompatible, detail: frame.error };
  }
  if (frame.error === NOT_AUTHENTICATED_ERROR) {
    return { verdict: LAYOUT_VERDICT.compatible, detail: frame.error };
  }
  return { verdict: LAYOUT_VERDICT.inconclusive, detail: frame.error };
}

// ---------------------------------------------------------------------------
// CLI below: one socket, no logic worth testing.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function probe(url, contract) {
  const { WebSocket } = await import('ws');
  return new Promise((resolvePromise) => {
    const ws = new WebSocket(url);
    const done = (result) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // closing a socket that never opened is not an error worth surfacing
      }
      resolvePromise(result);
    };
    const timer = setTimeout(
      () => done({ verdict: LAYOUT_VERDICT.inconclusive, detail: 'probe timed out' }),
      PROBE_TIMEOUT_MS,
    );
    ws.on('open', () => ws.send(JSON.stringify(buildProbeFrame(contract))));
    ws.on('message', (data) => done(classifyHandshakeReply(String(data), contract)));
    ws.on('error', (err) =>
      done({ verdict: LAYOUT_VERDICT.inconclusive, detail: `socket error: ${err.message}` }),
    );
    ws.on('close', () =>
      done({ verdict: LAYOUT_VERDICT.inconclusive, detail: 'closed before answering' }),
    );
  });
}

async function main() {
  const url = process.argv[2] ?? 'wss://worldofclaudecraft.com/ws';
  const contract = parseWorldApiContract(
    readFileSync(resolve(root, 'src', 'world_api.ts'), 'utf8'),
  );
  console.log(`ota layout check: this checkout speaks ${contract.authType}`);
  console.log(`ota layout check: probing ${url}`);
  const { verdict, detail } = await probe(url, contract);
  if (verdict === LAYOUT_VERDICT.compatible) {
    console.log(`ota layout check: OK, the server accepts ${contract.authType}`);
    return;
  }
  if (verdict === LAYOUT_VERDICT.incompatible) {
    throw new Error(
      `ota layout check: the server REFUSED ${contract.authType} ("${detail}"). ` +
        'Publishing this bundle would leave updated devices unable to connect. ' +
        'Deploy the server from this release first, then publish.',
    );
  }
  throw new Error(
    `ota layout check: inconclusive (${detail}). Not publishing on an unverified epoch; ` +
      're-run, or dispatch with skip_server_check if you have confirmed the epoch by hand.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
