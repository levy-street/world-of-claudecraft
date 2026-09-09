// src/ui/log_event_route.ts: which chat pane a 'log' SimEvent belongs in. Genuine
// ambient mob/boss combat-flavor chatter (entityId-anchored, no pid, not a telegraph)
// goes to the Combat Log tab, not General/Chat; pid-scoped personal narrative and
// entityId-anchored actionable mechanic telegraphs stay in General/Chat.

import { describe, expect, it } from 'vitest';
import { chatBubbleKind, isCombatFlavorLog } from '../src/ui/log_event_route';

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

  it('keeps an entityId-anchored mechanic telegraph (e.g. Deacon Vandric begins Raise Dead) in General/Chat', () => {
    expect(isCombatFlavorLog(42, undefined, true)).toBe(false);
  });
});

describe('chatBubbleKind (the world-bubble half of the same dispatch)', () => {
  it('classifies a mob yell wrapper as a yell bubble', () => {
    expect(chatBubbleKind('Grubclaw yells, "Fresh meat!"')).toBe('yell');
  });

  it('classifies every Nythraxis vision beat as a speech bubble', () => {
    expect(chatBubbleKind('My king was a good man.')).toBe('speech');
    expect(chatBubbleKind('If you find the crypt... end this.')).toBe('speech');
  });

  it('gives an ordinary log line no bubble at all', () => {
    expect(chatBubbleKind('You receive loot: Linen Cloth.')).toBeNull();
    // A near miss of a vision beat is not a member; the set is exact.
    expect(chatBubbleKind('My king was a good man')).toBeNull();
  });
});
