// Env gate for the whole Epic surface. Everything under server/epic/ (and
// the /api/status capability advert) resolves enabled-ness through this one
// function, read LIVE per call (mirroring server/steam/config.ts and the
// ALLOW_DEV_COMMANDS live read in server/leaderboard.ts) so tests and ops
// toggles never fight a boot-time snapshot. Product / deployment / client ids
// and the client secret are read only when the flag is on, and only inside
// server/epic/: the secret must never appear in a log line, an error body, or
// client-reachable code.

/** True when the Epic surface is live (EPIC_ENABLED=1). Default off: every
 *  route answers epic.disabled, the mirror is inert, and no client renders
 *  link UI. */
export function epicEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EPIC_ENABLED === '1';
}

/** Trimmed non-empty env string, or null when unset/whitespace. */
function nonEmpty(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = (env[key] ?? '').trim();
  return raw === '' ? null : raw;
}

/** EOS product id, or null when unset. Read only when enabled. */
export function epicProductId(env: NodeJS.ProcessEnv = process.env): string | null {
  return nonEmpty(env, 'EPIC_PRODUCT_ID');
}

/** EOS sandbox id when the chosen verify path needs one, or null when unset. */
export function epicSandboxId(env: NodeJS.ProcessEnv = process.env): string | null {
  return nonEmpty(env, 'EPIC_SANDBOX_ID');
}

/** EOS deployment id, or null when unset. Read only when enabled. */
export function epicDeploymentId(env: NodeJS.ProcessEnv = process.env): string | null {
  return nonEmpty(env, 'EPIC_DEPLOYMENT_ID');
}

/** EOS client id, or null when unset. Read only when enabled. */
export function epicClientId(env: NodeJS.ProcessEnv = process.env): string | null {
  return nonEmpty(env, 'EPIC_CLIENT_ID');
}

/** EOS client secret, or null when unset. Read only when enabled; never logged,
 *  never echoed into an error body. */
export function epicClientSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return nonEmpty(env, 'EPIC_CLIENT_SECRET');
}

/** True when the surface is provisioned enough to attempt upstream verification
 *  (product, deployment, client id, and client secret all set). Missing any of
 *  these reads as epic.upstream, never a 500. Sandbox is optional. */
export function epicProvisioned(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    epicProductId(env) !== null &&
    epicDeploymentId(env) !== null &&
    epicClientId(env) !== null &&
    epicClientSecret(env) !== null
  );
}
