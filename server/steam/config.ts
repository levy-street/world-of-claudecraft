// Env gate for the whole Steam surface. Everything under server/steam/ (and
// the /api/status capability advert) resolves enabled-ness through this one
// function, read LIVE per call (mirroring the ALLOW_DEV_COMMANDS live read in
// server/leaderboard.ts perfHandler) so tests and ops toggles never fight a
// boot-time snapshot. STEAM_APP_ID and STEAM_WEB_API_KEY are read only when
// the flag is on, and only inside server/steam/: the key must never appear in
// a log line, an error body, or client-reachable code.

/** True when the Steam surface is live (STEAM_ENABLED=1). Default off: the
 *  Steamworks app does not exist yet, so every route answers steam.disabled,
 *  the mirror is inert, and no client renders link UI. */
export function steamEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STEAM_ENABLED === '1';
}

/** The Steamworks app id, or null when unset/garbage. Read only when enabled. */
export function steamAppId(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = (env.STEAM_APP_ID ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** The publisher Web API key, or null when unset. Read only when enabled;
 *  never logged, never echoed into an error body. */
export function steamWebApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.STEAM_WEB_API_KEY ?? '').trim();
  return raw === '' ? null : raw;
}
