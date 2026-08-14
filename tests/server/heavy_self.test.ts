// Membership pins for the extracted heavy-self policy (server/heavy_self.ts,
// moved whole from server/game.ts at the v0.38.0 fourteenth absorb). The
// farming members' BEHAVIORAL coverage lives in
// tests/farming_command_chain_online.test.ts; these literal pins guard the
// extraction itself: a member dropped in a merge resolution reds here by name
// instead of surfacing as a stale self mirror in a live session.
import { describe, expect, it } from 'vitest';
import { HEAVY_SELF_CMDS, HEAVY_SELF_EVENTS } from '../../server/heavy_self';

describe('heavy-self policy sets', () => {
  it('carries the farming command members', () => {
    for (const cmd of ['plant_crop', 'harvest_crop', 'convert_husks']) {
      expect(HEAVY_SELF_CMDS.has(cmd), cmd).toBe(true);
    }
  });

  it('carries the farming event member', () => {
    expect(HEAVY_SELF_EVENTS.has('farmPlanted')).toBe(true);
    // farmDenied is deliberately NOT a member (refusals ride their own event
    // and must not buy a heavy re-serialize); pin the negative arm too.
    expect(HEAVY_SELF_EVENTS.has('farmDenied')).toBe(false);
  });

  it('carries two long-standing core members, so a wholesale set swap cannot pass', () => {
    expect(HEAVY_SELF_CMDS.has('equip')).toBe(true);
    expect(HEAVY_SELF_EVENTS.has('loot')).toBe(true);
  });
});
