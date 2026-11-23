// src/ui/log_event_route.ts: which chat pane a 'log' SimEvent belongs in. Genuine
// ambient mob/boss combat-flavor chatter (entityId-anchored, no pid, not a telegraph)
// goes to the Combat Log tab, not General/Chat; pid-scoped personal narrative and
// entityId-anchored actionable mechanic telegraphs stay in General/Chat.

import { describe, expect, it } from 'vitest';
import { DROWNED_TEMPLE_GATES } from '../src/sim/content/drowned_temple';
import { en } from '../src/ui/i18n.resolved.generated/en';
import { chatBubbleKind, isCombatFlavorLog, logEventCue } from '../src/ui/log_event_route';

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

describe('logEventCue: the sounds and banners a log line also fires', () => {
  it('keeps the Cheat Death and Sundering sounds it took over from hud.ts', () => {
    expect(logEventCue('Cheat Death saves you!')).toEqual({ sound: 'fiestaRevive', banner: null });
    expect(logEventCue('You receive loot: Linen Cloth.')).toEqual({ sound: null, banner: null });
  });

  it('shows the Moonbridge banner beside its chat line as the Colossus falls', () => {
    const gate = DROWNED_TEMPLE_GATES.find((g) => g.id === 'moonbridge');
    expect(gate?.openText).toBe('Moonlight gathers over the lagoon and hardens into a bridge.');
    const cue = logEventCue(gate?.openText ?? '');
    expect(cue).toEqual({ sound: null, banner: 'hud.system.moonbridgeBanner' });
    expect(en.hud.system.moonbridgeBanner).toBe('The Moonbridge Rises');
    // Only that gate's line: the other Temple gates keep their chat line alone.
    for (const g of DROWNED_TEMPLE_GATES)
      if (g.id !== 'moonbridge') expect(logEventCue(g.openText ?? '').banner).toBeNull();
  });
});
