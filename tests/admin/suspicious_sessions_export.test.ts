import { describe, expect, it } from 'vitest';
import { buildSuspiciousSessionsExport } from '../../src/admin/suspicious_sessions_export';
import type { SuspiciousPlayersData } from '../../src/admin/types';

describe('buildSuspiciousSessionsExport', () => {
  // The export is the RAW suspicious-players payload: triage keys on the fields a
  // redacted export would drop (evidence detail, state, name, IP). Schema 2,
  // aligned 2026-07-06 after the 2026-07-05 triage found schema 1 unusable.
  it('exports the raw payload verbatim under data.players, with capture metadata', () => {
    const data: SuspiciousPlayersData = {
      players: [
        {
          ref: {
            accountId: 7,
            characterId: 42,
            name: 'ReviewCharacterName',
            ip: '203.0.113.7',
          },
          state: 'CONFIRMED',
          snapshot: { capturedAt: 1_750_000_000_000 },
          score: 1.3,
          evidence: [
            {
              kind: 'review_signal_a',
              weight: 0.9,
              detail: 'Public-safe synthetic evidence A.',
              expiresAt: Number.POSITIVE_INFINITY,
            },
            {
              kind: 'review_signal_b',
              weight: 0.4,
              detail: 'Public-safe synthetic evidence B.',
              expiresAt: 1_750_000_100_000,
              occurrences: 3,
              firstAt: 1_749_999_000_000,
              lastAt: 1_750_000_050_000,
              episodesAt: [1_749_999_000_000, 1_749_999_500_000, 1_750_000_050_000],
            },
          ],
        },
      ],
    };

    const file = buildSuspiciousSessionsExport(data, new Date('2026-07-03T10:15:30.123Z'));
    const payload = JSON.parse(file.contents);

    expect(file.filename).toBe('bot-detector-suspicious-sessions-2026-07-03T10-15-30-123Z.json');
    expect(payload).toEqual({
      schemaVersion: 2,
      capturedAt: '2026-07-03T10:15:30.123Z',
      sessionCount: 1,
      data: {
        players: [
          {
            ref: {
              accountId: 7,
              characterId: 42,
              name: 'ReviewCharacterName',
              ip: '203.0.113.7',
            },
            state: 'CONFIRMED',
            snapshot: { capturedAt: 1_750_000_000_000 },
            score: 1.3,
            evidence: [
              {
                kind: 'review_signal_a',
                weight: 0.9,
                detail: 'Public-safe synthetic evidence A.',
                // Infinity (session-scoped evidence) serializes to null.
                expiresAt: null,
              },
              {
                kind: 'review_signal_b',
                weight: 0.4,
                detail: 'Public-safe synthetic evidence B.',
                expiresAt: 1_750_000_100_000,
                occurrences: 3,
                firstAt: 1_749_999_000_000,
                lastAt: 1_750_000_050_000,
                episodesAt: [1_749_999_000_000, 1_749_999_500_000, 1_750_000_050_000],
              },
            ],
          },
        ],
      },
    });
    expect(file.contents.endsWith('\n')).toBe(true);
  });
});
