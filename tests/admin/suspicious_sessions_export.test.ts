import { describe, expect, it } from 'vitest';
import { buildSuspiciousSessionsExport } from '../../src/admin/suspicious_sessions_export';
import type { SuspiciousPlayersData } from '../../src/admin/types';

describe('buildSuspiciousSessionsExport', () => {
  it('exports analysis fields without names, IPs, or free-text evidence details', () => {
    const data: SuspiciousPlayersData = {
      players: [
        {
          ref: {
            accountId: 7,
            characterId: 42,
            name: 'SecretCharacterName',
            ip: '203.0.113.7',
          },
          snapshot: { capturedAt: 1_750_000_000_000 },
          score: 0.9,
          evidence: [
            {
              kind: 'shared_client',
              weight: 0.9,
              detail: 'SecretAltName (account 8) shared this browser.',
              expiresAt: Number.POSITIVE_INFINITY,
            },
          ],
        },
      ],
    };

    const file = buildSuspiciousSessionsExport(data, new Date('2026-07-03T10:15:30.123Z'));
    const payload = JSON.parse(file.contents);

    expect(file.filename).toBe('bot-detector-suspicious-sessions-2026-07-03T10-15-30-123Z.json');
    expect(payload).toEqual({
      schemaVersion: 1,
      capturedAt: '2026-07-03T10:15:30.123Z',
      sessionCount: 1,
      sessions: [
        {
          accountId: 7,
          characterId: 42,
          observedAt: 1_750_000_000_000,
          score: 0.9,
          evidence: [
            {
              kind: 'shared_client',
              weight: 0.9,
              expiresAt: null,
            },
          ],
        },
      ],
    });
    expect(file.contents).not.toContain('SecretCharacterName');
    expect(file.contents).not.toContain('SecretAltName');
    expect(file.contents).not.toContain('203.0.113.7');
    expect(file.contents.endsWith('\n')).toBe(true);
  });
});
