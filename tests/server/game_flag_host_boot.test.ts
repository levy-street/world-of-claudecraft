// The one line that decides where automated bot cases land: GameServer hands
// the detector its suspicion-flag host at construction (server/game.ts). Delete
// that line and every case silently goes back to the Reports inbox with no red
// test, so this pins the boot log line the wiring emits. The bundled detector
// here is whatever the #bot-detector alias resolves to (private clone or stub),
// so either of the two documented lines is acceptable; what must not happen is
// no line at all.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../../server/game';

describe('GameServer boot: the suspicion-flag host wiring', () => {
  it('attaches the host to the bundled detector (or says the build lacks the seam)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      new GameServer();
      const lines = log.mock.calls.map((call) => String(call[0]));
      const hostLines = lines.filter((line) =>
        line.startsWith('[bot-detector] suspicion-flag host: '),
      );
      expect(hostLines).toHaveLength(1);
      expect(hostLines[0]).toMatch(
        /^\[bot-detector\] suspicion-flag host: (attached|not accepted by this detector build)$/,
      );
    } finally {
      log.mockRestore();
    }
  });
});
