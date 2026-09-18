// The live ferry-note models consumed by the Hud.

import { describe, expect, it } from 'vitest';
import {
  buildFerryBellHomeNote,
  buildFerryBellReturnNote,
  buildFerryIslandArrivalNote,
  ferryBellHomeNoteFor,
} from '../src/ui/tutorial_greeting_view';

describe('tutorial greeting view', () => {
  it('builds the town-bell homecoming with the guidance choice and the return-bell note', () => {
    const note = buildFerryBellHomeNote();
    expect(note.speakerNpcId).toBe('wayfarer_bryn');
    expect(note.bodyKey).toBe('hudChrome.tutorialGreeting.eastbrookGuidanceNote');
    expect(note.extraBodyKeys).toEqual(['hudChrome.tutorialGreeting.bellHomeNote']);
    expect(note.guidanceChoice).toBe(true);
    expect(note.closeKey).toBe('hudChrome.tutorialGreeting.noteClose');
  });

  it('builds the plain return-bell note once the wolves are done', () => {
    const note = buildFerryBellReturnNote();
    expect(note.speakerNpcId).toBe('wayfarer_bryn');
    expect(note.bodyKey).toBe('hudChrome.tutorialGreeting.bellHomeNote');
    expect(note.extraBodyKeys).toBeUndefined();
    expect(note.guidanceChoice).toBeUndefined();
  });

  it.each(['unavailable', 'available', 'active', 'ready'] as const)(
    'offers the guidance choice while Wolves at the Door is %s',
    (state) => {
      const note = ferryBellHomeNoteFor({ questState: () => state });
      expect(note.guidanceChoice).toBe(true);
      expect(note.bodyKey).toBe('hudChrome.tutorialGreeting.eastbrookGuidanceNote');
    },
  );

  it('drops the choice for a character who has finished the wolves', () => {
    const asked: string[] = [];
    const note = ferryBellHomeNoteFor({
      questState: (id) => {
        asked.push(id);
        return 'done';
      },
    });
    expect(asked).toEqual(['q_wolves']);
    expect(note.guidanceChoice).toBeUndefined();
    expect(note.bodyKey).toBe('hudChrome.tutorialGreeting.bellHomeNote');
  });

  it('the island welcome speaks as Ferryman Odo (the arrival lands at his pier)', () => {
    const arrival = buildFerryIslandArrivalNote();
    expect(arrival.speakerNpcId).toBe('ferryman_odo');
    expect(arrival.bodyKey).toBe('hudChrome.tutorialGreeting.islandArrivalNote');
    expect(arrival.closeKey).toBe('hudChrome.tutorialGreeting.noteClose');
  });
});
