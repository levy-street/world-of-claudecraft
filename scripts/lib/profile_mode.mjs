export function resolveProfileMode(requestedMode, forceOnline = false) {
  if (forceOnline) return 'online';
  return requestedMode === 'online' ? 'online' : 'offline';
}
