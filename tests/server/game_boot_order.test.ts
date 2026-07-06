// Regression pin for the DEFERRED world construction in server/main.ts
// (liveGame()). The v0.20.0 housekeeping merge moved `new GameServer()` off
// module load; the branch kept the memoized liveGame() accessor after the
// feature's revert because the parity/characterization harnesses import main.ts
// without running startServer() and need lazy first-touch construction (and
// every module-scope configure*Runtime closure defers its liveGame() read to
// request time). This pin is the loud guard: a bare import of server/main must
// construct NO GameServer.

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
