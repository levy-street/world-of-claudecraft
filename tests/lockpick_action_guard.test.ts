import { describe, expect, it } from 'vitest';
import { isPickAction } from '../server/lockpick_action';

// The server's lockpick command guard (moved out of server/game.ts): only the
// six actions the Sim understands pass; anything else is rejected before it
// reaches the Sim.
describe('isPickAction', () => {
  it('accepts every lockpick action the Sim understands', () => {
    for (const action of ['hardSet', 'set', 'steady', 'ease', 'drop', 'abort']) {
      expect(isPickAction(action), action).toBe(true);
    }
  });

  it('rejects unknown strings and non-string values', () => {
    for (const value of ['', 'Set', 'pick', 'toString', '__proto__', 1, null, undefined, {}]) {
      expect(isPickAction(value), String(value)).toBe(false);
    }
  });
});
