'use strict';

// The desktop shell's ONLY Epic surface: producing a link proof for the
// account-link handshake (POST /api/epic/link verifies it server-side in
// Phase 5). Lives beside steam.cjs / desktop_config.cjs for the same reason:
// every decision worth pinning is made here, Node-testable with injected
// fakes, and electron/main.cjs stays a thin consumer.
//
// No native EOS binding ships in the default tree yet (D20 / D24): requireEos
// is injectable for tests and for a future thin adapter. Website and steam
// builds never load or initialize Epic native code. When the integration is
// enabled but the adapter is missing, getLinkProof falls back to the Epic
// Games Launcher exchange code on process argv (AUTH_TYPE=exchangecode +
// AUTH_PASSWORD), then answers null. Capability stays true on the epic
// channel so the renderer can still offer Link (proof may be null until the
// launcher or adapter is present).
//
// Proof shape (O1, provisional): a non-empty string. Preferred mint is the
// launcher exchange code (Epic Auth Web API exchange_code grant). An injected
// EOS adapter may return an id-token style string instead; Phase 5 verifies
// upstream and extracts the Epic account id. Client-supplied Epic account ids
// are never trusted here (D11 is server-side).

/**
 * Parse the Epic Games Launcher exchange code from process argv.
 * Official launcher args (Epic Auth Web APIs):
 *   -AUTH_LOGIN=unused -AUTH_PASSWORD=<exchange_code> -AUTH_TYPE=exchangecode
 * Returns the AUTH_PASSWORD value when AUTH_TYPE is exchangecode, else null.
 * Pure and Node-testable; never throws.
 */
function parseLauncherExchangeCode(argv) {
  try {
    if (!Array.isArray(argv)) return null;
    let authType = '';
    let authPassword = '';
    for (const raw of argv) {
      if (typeof raw !== 'string') continue;
      // Support both -KEY=value and --KEY=value forms.
      const m = raw.match(/^--?([A-Za-z_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const value = m[2];
      if (key === 'AUTH_TYPE') authType = value;
      else if (key === 'AUTH_PASSWORD') authPassword = value;
    }
    if (authType.toLowerCase() !== 'exchangecode') return null;
    if (typeof authPassword !== 'string' || authPassword.length === 0) return null;
    return authPassword;
  } catch {
    return null;
  }
}

// Whether this build may touch Epic at all. The env override applies ONLY to
// unpackaged checkouts (`electron .` / electron:dev with WOC_EPIC_DEV=1): a
// PACKAGED build's answer is its distribution stamp, period, mirroring the
// WOC_DISTRIBUTION hatch closure in desktop_config.cjs and steam.cjs (a local
// env var must not be able to make an installed website build load native
// Epic code).
function epicIntegrationEnabled({ distribution, env, isPackaged } = {}) {
  if (distribution === 'epic') return true;
  return isPackaged !== true && env?.WOC_EPIC_DEV === '1';
}

// Product / deployment / client ids for EOS init (and future stamp display).
// Prefer the wocDesktop stamp (written by electron-builder extraMetadata for
// a real epic channel build), else the WOC_EPIC_* env overrides on unpackaged
// checkouts only. Packaged stamp wins; env is ignored when packaged. Empty
// strings degrade rather than throwing: a half-stamped build must still launch
// (only its Epic features degrade). Server secret never lives here (D16).
function resolveEpicIds({ packagedMetadata, env, isPackaged } = {}) {
  const stamped = packagedMetadata?.wocDesktop ?? {};
  const pick = (stampKey, envKey) => {
    const stampedVal = stamped[stampKey];
    if (typeof stampedVal === 'string' && stampedVal.trim() !== '') {
      return stampedVal.trim();
    }
    if (isPackaged !== true) {
      const fromEnv = env?.[envKey];
      if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
        return fromEnv.trim();
      }
    }
    return '';
  };
  return {
    productId: pick('epicProductId', 'WOC_EPIC_PRODUCT_ID'),
    deploymentId: pick('epicDeploymentId', 'WOC_EPIC_DEPLOYMENT_ID'),
    clientId: pick('epicClientId', 'WOC_EPIC_CLIENT_ID'),
  };
}

/**
 * Build the shell's Epic facade. `requireEos` is injectable for tests;
 * production passes nothing and gets a throw-on-load default so missing
 * native degrades to the argv exchange-code path (or null). The returned
 * getLinkProof() NEVER throws (it answers null on every failure path), so
 * the IPC handler can hand its result straight across the bridge.
 *
 * Optional injectables:
 *   requireEos  - () => { init(ids) => client }; client.getLinkProof optional
 *   readArgv    - () => string[] (defaults to process.argv)
 */
function createEpicShell({
  distribution,
  packagedMetadata,
  env,
  isPackaged,
  log,
  requireEos,
  readArgv,
} = {}) {
  const enabled = epicIntegrationEnabled({ distribution, env, isPackaged });
  const ids = resolveEpicIds({ packagedMetadata, env, isPackaged });
  // No default npm EOS package (D24): omit requireEos and the shell never
  // attempts a native load. Tests inject fakes; a future epic-channel adapter
  // can pass requireEos from main. Until then getLinkProof uses the launcher
  // exchange-code argv fallback, then null.
  const loadEos = typeof requireEos === 'function' ? requireEos : null;
  const argv = typeof readArgv === 'function' ? readArgv : () => process.argv;

  // Steam twin: start null, assign only on successful init. Deliberately NOT
  // latched on failure so the next manual Link click retries (player may
  // relaunch from the Epic launcher with a fresh exchange code).
  let client = null;
  let lastProofHandle = null;

  function cancelQuietly(handle) {
    try {
      handle?.cancel?.();
    } catch {
      // Never let settle/cancel break the proof path.
    }
  }

  function clientOrNull() {
    if (!enabled || !loadEos) return null;
    if (client) return client;
    try {
      const mod = loadEos();
      if (!mod || typeof mod.init !== 'function') return null;
      const next = mod.init(ids);
      if (!next || typeof next !== 'object') return null;
      client = next;
    } catch (err) {
      log?.warn?.('[epic] init failed (adapter missing or launcher session?)', err?.message ?? err);
      return null;
    }
    return client;
  }

  // A non-empty proof string for POST /api/epic/link, or null (integration
  // off, no launcher exchange code, adapter missing, or mint failed). Handles
  // are kept to at most one live per session when the adapter returns a
  // cancelable handle; the renderer signals completion via cancelLinkProof.
  async function getLinkProof() {
    try {
      if (lastProofHandle) {
        cancelQuietly(lastProofHandle);
        lastProofHandle = null;
      }
      if (!enabled) return null;

      const c = clientOrNull();
      if (c && typeof c.getLinkProof === 'function') {
        const result = await c.getLinkProof();
        // Adapter may return a bare string or { proof, cancel }.
        if (typeof result === 'string' && result.length > 0) {
          return result;
        }
        if (result && typeof result === 'object') {
          const proof = result.proof;
          if (typeof proof === 'string' && proof.length > 0) {
            lastProofHandle = result;
            return proof;
          }
          cancelQuietly(result);
        }
      }

      // No adapter (or empty adapter proof): launcher exchange-code fallback.
      // One-time, short-lived; Phase 5 exchanges it server-side with the
      // server-held client secret (never stamped into this package).
      const code = parseLauncherExchangeCode(argv());
      if (typeof code === 'string' && code.length > 0) return code;
      return null;
    } catch (err) {
      // Never throw across IPC; a failed proof is just "no proof".
      log?.warn?.('[epic] link proof failed', err?.message ?? err);
      return null;
    }
  }

  // Release any live cancelable proof handle once the renderer reports the
  // attempt settled. Idempotent and never throws. Exchange-code proofs have
  // no handle; settle is still a no-op success for API parity with Steam.
  function cancelLinkProof() {
    cancelQuietly(lastProofHandle);
    lastProofHandle = null;
  }

  return {
    enabled,
    productId: ids.productId,
    deploymentId: ids.deploymentId,
    clientId: ids.clientId,
    getLinkProof,
    cancelLinkProof,
  };
}

module.exports = {
  parseLauncherExchangeCode,
  epicIntegrationEnabled,
  resolveEpicIds,
  createEpicShell,
};
