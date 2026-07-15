// Regression pin for the DEFERRED world construction in server/main.ts
// (liveGame()). The v0.20.0 housekeeping merge moved `new GameServer()` off
// module load; the branch kept the memoized liveGame() accessor after the
// feature's revert because the parity/characterization harnesses import main.ts
// without running startServer() and need lazy first-touch construction (and
// every module-scope configure*Runtime closure defers its liveGame() read to
// request time). This pin is the loud guard: a bare import of server/main must
// construct NO GameServer.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Replace the real GameServer with a constructor spy. main.ts is the only module
// that imports it as a value (everything else is `import type`), so this observes
// exactly the construction liveGame() would perform.
vi.mock('../../server/game', () => ({ GameServer: vi.fn() }));

describe('deferred GameServer construction (liveGame)', () => {
  it('a bare import of server/main constructs no GameServer', async () => {
    // db.ts evaluates a module-scope DATABASE_URL (throws if unset); dummy URL as
    // in importable_spine.test.ts, no connection is made on Pool construction.
    process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase1_test';
    const { GameServer } = await import('../../server/game');
    await import('../../server/main');
    expect(GameServer).not.toHaveBeenCalled();
  });
});

// startServer() binds a port, opens a WS server, and needs Postgres, so it cannot run
// in this unit test (GameServer is mocked to a bare spy with no start()/lastTickAt()).
// The wiring it performs is still load-bearing and can regress silently, so it is pinned
// at the closest honest seam: the source of startServer() itself. Read the file text and
// assert the liveness registration is present AND ACTIVE. The complementary runtime
// contract, that such a registered source makes isLive() track the real loop, is proven
// in tests/game_state_metrics.test.ts against a live GameServer.
describe('startServer wires the game loop into /livez liveness (source pin)', () => {
  const mainSrc = readFileSync('server/main.ts', 'utf8');

  it('registers the live game source with the liveness slot, as an ACTIVE call', () => {
    // The `^\s*` anchor requires the statement at a line start after only whitespace, so a
    // `// registerLivenessSource(gameStateSource);` (or a block-commented line) does NOT
    // match. Commenting the wiring out is exactly the regression this catches: without it,
    // no liveness source is ever registered, /livez answers 200 unconditionally in
    // production, and a wedged loop is never restarted by the watchdog.
    expect(mainSrc).toMatch(/^\s*registerLivenessSource\(gameStateSource\);/m);
  });

  it('feeds the live game loop clock into that registered source', () => {
    // The registered source must expose the game's completed-pass clock, or /livez reads
    // an absent signal and can never detect a wedge even with the call above present.
    expect(mainSrc).toContain('lastTickAt: () => game.lastTickAt(),');
  });
});
