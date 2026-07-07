import type { SuspiciousPlayersData } from './types';

export interface SuspiciousSessionsExportFile {
  filename: string;
  contents: string;
}

// The raw /admin/api/suspicious-players payload, verbatim, plus capture metadata.
// Schema 1 redacted names, IPs, and evidence details; the 2026-07-05 triage
// concluded that shape could not support false-positive analysis (several
// strategies share one evidence kind, so triage keys on `detail`; `state`
// separates reported sessions). Operator-only artifact behind admin auth: treat
// downloads as sensitive and keep them out of public trackers.
export function buildSuspiciousSessionsExport(
  data: SuspiciousPlayersData,
  capturedAt: Date = new Date(),
): SuspiciousSessionsExportFile {
  const capturedAtIso = capturedAt.toISOString();
  const payload = {
    schemaVersion: 2,
    capturedAt: capturedAtIso,
    sessionCount: data.players.length,
    // Nested under `data` so analysis scripts written against a saved raw
    // response (`.data.players`) read a downloaded file unchanged. An Infinity
    // expiresAt (session-scoped evidence) serializes to null via JSON.
    data: { players: data.players },
  };
  return {
    filename: `bot-detector-suspicious-sessions-${capturedAtIso.replace(/[:.]/g, '-')}.json`,
    contents: `${JSON.stringify(payload, null, 2)}\n`,
  };
}
