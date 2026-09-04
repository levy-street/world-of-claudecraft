// The live ferry-note models consumed by the Hud.

import { describe, expect, it } from 'vitest';
import {
  buildFerryBellHomeNote,
  buildFerryIslandArrivalNote,
} from '../src/ui/tutorial_greeting_view';

describe('tutorial greeting view', () => {
  it('builds the town-bell homecoming note for the harbor guide', () => {
    const note = buildFerryBellHomeNote();
    expect(note.speakerNpcId).toBe('wayfarer_bryn');
    expect(note.bodyKey).toBe('hudChrome.tutorialGreeting.bellHomeNote');
    expect(note.closeKey).toBe('hudChrome.tutorialGreeting.noteClose');
  });

  it('the island welcome speaks as Ferryman Odo (the arrival lands at his pier)', () => {
    const arrival = buildFerryIslandArrivalNote();
    expect(arrival.speakerNpcId).toBe('ferryman_odo');
    expect(arrival.bodyKey).toBe('hudChrome.tutorialGreeting.islandArrivalNote');
    expect(arrival.closeKey).toBe('hudChrome.tutorialGreeting.noteClose');
  });
});
