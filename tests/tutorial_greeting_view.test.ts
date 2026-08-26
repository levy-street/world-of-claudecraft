// The spawn greeting dialog's pure core: the one decision it owns is which
// body copy the greeter speaks (first-character welcome vs refresher), keyed
// off the event's server-recomputed account fact.

import { describe, expect, it } from 'vitest';
import {
  buildFerryBellHomeNote,
  buildFerryIslandArrivalNote,
  buildTutorialDeclineNote,
  buildTutorialGreetingModel,
  TUTORIAL_GREETER_NPC_ID,
} from '../src/ui/tutorial_greeting_view';

describe('tutorial greeting view', () => {
  it('picks the first-character welcome for a first character', () => {
    const model = buildTutorialGreetingModel(true);
    expect(model.bodyKey).toBe('hudChrome.tutorialGreeting.bodyFirst');
    expect(model.speakerNpcId).toBe(TUTORIAL_GREETER_NPC_ID);
  });

  it('picks the refresher for a later character, buttons unchanged', () => {
    const first = buildTutorialGreetingModel(true);
    const later = buildTutorialGreetingModel(false);
    expect(later.bodyKey).toBe('hudChrome.tutorialGreeting.bodyRefresher');
    expect(later.bodyKey).not.toBe(first.bodyKey);
    expect(later.playKey).toBe(first.playKey);
    expect(later.skipKey).toBe(first.skipKey);
  });

  it('the two notes share the greeter and the close key, with distinct bodies', () => {
    const decline = buildTutorialDeclineNote();
    const bellHome = buildFerryBellHomeNote();
    expect(decline.speakerNpcId).toBe(TUTORIAL_GREETER_NPC_ID);
    expect(bellHome.speakerNpcId).toBe(TUTORIAL_GREETER_NPC_ID);
    expect(decline.bodyKey).toBe('hudChrome.tutorialGreeting.declineNote');
    expect(bellHome.bodyKey).toBe('hudChrome.tutorialGreeting.bellHomeNote');
    expect(decline.closeKey).toBe(bellHome.closeKey);
  });

  it('the island welcome speaks as Ferryman Odo (the arrival lands at his pier)', () => {
    const arrival = buildFerryIslandArrivalNote();
    expect(arrival.speakerNpcId).toBe('ferryman_odo');
    expect(arrival.bodyKey).toBe('hudChrome.tutorialGreeting.islandArrivalNote');
    expect(arrival.closeKey).toBe(buildTutorialDeclineNote().closeKey);
  });
});
