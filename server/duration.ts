// Human-readable duration for player-facing server text ("5 minutes", "1 hour",
// "3 days"). The client re-localizes this exact output via localizeServerDuration
// (src/ui/server_i18n.ts), so the wording here and that matcher must stay in lockstep.
export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}
