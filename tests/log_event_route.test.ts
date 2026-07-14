// src/ui/log_event_route.ts: which chat pane a 'log' SimEvent belongs in. Genuine
// ambient mob/boss combat-flavor chatter (entityId-anchored, no pid, not a telegraph)
// goes to the Combat Log tab, not General/Chat; pid-scoped personal narrative and
// entityId-anchored actionable mechanic telegraphs stay in General/Chat.

import { describe, expect, it } from 'vitest';
import { isCombatFlavorLog } from '../src/ui/log_event_route';

describe('isCombatFlavorLog', () => {
  it('routes a genuine ambient bark (entityId-anchored, no pid, not a telegraph) to Combat Log', () => {
    expect(isCombatFlavorLog(42)).toBe(true);
    expect(isCombatFlavorLog(42, undefined, false)).toBe(true);
  });

  it('keeps an anchorless line (e.g. a world boss spawn broadcast) in General/Chat', () => {
    expect(isCombatFlavorLog(undefined)).toBe(false);
  });

  it('keeps a pid-scoped personal narrative line (e.g. a Nythraxis vision line) in General/Chat even with an entityId', () => {
    expect(isCombatFlavorLog(42, 7)).toBe(false);
  });

  it('keeps an entityId-anchored mechanic telegraph (e.g. Deacon Varric begins Raise Dead) in General/Chat', () => {
    expect(isCombatFlavorLog(42, undefined, true)).toBe(false);
  });
});
