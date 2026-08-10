const LOOPBACK_REMOTE_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLoopbackRemoteAddress(remoteAddress) {
  return LOOPBACK_REMOTE_ADDRESSES.has(
    String(remoteAddress ?? '')
      .trim()
      .toLowerCase(),
  );
}

export function isLoopbackHost(host) {
  if (!host) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function sameOrigin(origin, host) {
  if (!origin || !host || !isLoopbackHost(host)) return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLoopbackHost(parsed.host) &&
      parsed.host.toLowerCase() === host.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}

export function diagnosticsReadAllowed(remoteAddress, host) {
  return isLoopbackRemoteAddress(remoteAddress) && isLoopbackHost(host);
}

export function diagnosticsCaptureAllowed(remoteAddress, origin, host) {
  return isLoopbackRemoteAddress(remoteAddress) && sameOrigin(origin, host);
}
