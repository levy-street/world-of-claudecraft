const CAPABILITY_FIELD = 'profiler_invulnerability';

/**
 * Fail closed before an online profile can create or enter a character. A
 * missing field distinguishes an older server from a supporting server whose
 * dev-command gate is deliberately off.
 */
export async function requireOnlineProfilerCapability(server, fetchImpl = fetch) {
  const url = `${server.replace(/\/$/, '')}/api/status`;
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
  } catch (cause) {
    throw new Error(`online profiler could not verify ${CAPABILITY_FIELD} at /api/status`, {
      cause,
    });
  }
  if (!response.ok) {
    throw new Error(`online profiler /api/status returned HTTP ${response.status}`);
  }

  let status;
  try {
    status = await response.json();
  } catch (cause) {
    throw new Error('online profiler /api/status returned invalid JSON', { cause });
  }
  if (!Object.hasOwn(status ?? {}, CAPABILITY_FIELD)) {
    throw new Error('online profiler server does not support profiler invulnerability');
  }
  if (status[CAPABILITY_FIELD] !== true) {
    throw new Error(
      'online profiler server supports invulnerability; start it with ALLOW_DEV_COMMANDS=1',
    );
  }
}
