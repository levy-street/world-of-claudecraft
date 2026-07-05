// Maps a duration token from the IP-block forms ('1d' | '7d' | '30d', or '' for
// forever) to an ISO expiry, or undefined for a permanent block. Shared by the Blocked
// IPs add form and the per-account ban-IP buttons in the moderation detail. Ported 1:1
// from the old main.ts blockExpiryIso.
export function blockExpiryIso(duration: string): string | undefined {
  const days: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };
  const n = days[duration];
  return n ? new Date(Date.now() + n * 86_400_000).toISOString() : undefined;
}
