import type { SuspiciousPlayersData } from './types';

export interface SuspiciousSessionsExportFile {
  filename: string;
  contents: string;
}

export function buildSuspiciousSessionsExport(
  data: SuspiciousPlayersData,
  capturedAt: Date = new Date(),
): SuspiciousSessionsExportFile {
  const capturedAtIso = capturedAt.toISOString();
  const payload = {
    schemaVersion: 1,
    capturedAt: capturedAtIso,
    sessionCount: data.players.length,
    sessions: data.players.map((player) => ({
      accountId: player.ref.accountId,
      characterId: player.ref.characterId,
      observedAt: player.snapshot?.capturedAt ?? null,
      score: player.score,
      evidence: player.evidence.map((evidence) => ({
        kind: evidence.kind,
        weight: evidence.weight,
        expiresAt: Number.isFinite(evidence.expiresAt) ? evidence.expiresAt : null,
      })),
    })),
  };
  return {
    filename: `bot-detector-suspicious-sessions-${capturedAtIso.replace(/[:.]/g, '-')}.json`,
    contents: `${JSON.stringify(payload, null, 2)}\n`,
  };
}
