// The touch menu control's decision core: the roster, the release rules, the
// early reveal, and where the live caption parks. Pure, so every branch is driven
// directly without a browser (the pointer half lives in
// menu_strip_gesture_controller.test.ts).

import { describe, expect, it } from 'vitest';
import { CONSUMABLE_STRIP_PITCH_PX } from '../src/ui/hud/action_bar/consumable_strip_core';
import {
  STRIP_PITCH_PX,
  shouldRevealStrip,
  stripCancelIsLive,
} from '../src/ui/hud/action_bar/radial_action_core';
import {
  MENU_CAPTION_HALF_PX,
  MENU_STRIP_COUNT,
  MENU_STRIP_DIRECTION,
  MENU_STRIP_ITEMS,
  MENU_STRIP_PITCH_PX,
  menuCaptionCenterX,
  menuStripCancelIsLive,
  resolveMenuStripDirection,
  resolveMenuStripRelease,
  shouldRevealMenuStrip,
} from '../src/ui/hud/menu/menu_strip_core';

// The two strip menus walk at the SAME finger distance, and they must: a player
// who learns the swipe on the consumables row uses it on the menu strip. The two
// used to be separate 34px literals with a comment claiming they matched and
// nothing checking it, so an edit to one silently taught two different gestures.
describe('the strip menus share one pitch and one set of rules', () => {
  it('takes its pitch from the shared constant, not a second literal', () => {
    expect(MENU_STRIP_PITCH_PX).toBe(STRIP_PITCH_PX);
    expect(CONSUMABLE_STRIP_PITCH_PX).toBe(STRIP_PITCH_PX);
    // The alias assertions above are identity by construction (both re-export
    // the SAME binding), so re-introducing a second `= 34` literal on either
    // side would still pass them. Pin the shared constant itself.
    expect(STRIP_PITCH_PX).toBe(34);
  });

  it('takes the cancel-is-live and reveal-early rules from the shared core', () => {
    expect(menuStripCancelIsLive).toBe(stripCancelIsLive);
    expect(shouldRevealMenuStrip).toBe(shouldRevealStrip);
  });
});

describe('the menu strip roster', () => {
  it('leads with Mount, the answer to issue #2739', () => {
    expect(MENU_STRIP_ITEMS[0].id).toBe('mount');
    expect(MENU_STRIP_ITEMS[0].elementId).toBe('mobile-menu-mount');
  });

  it('keeps the frequency order the swipe distance is priced against', () => {
    expect(MENU_STRIP_ITEMS.map((item) => item.id)).toEqual([
      'mount',
      'chat',
      'map',
      'bags',
      'social',
      'quest',
      'char',
      'spellbook',
      'settings',
      'more',
    ]);
    expect(MENU_STRIP_COUNT).toBe(10);
  });

  it('seats Chat SECOND, on its own strip button rather than the tray one', () => {
    // The control's bare tap used to open chat; it opens the row now, so chat
    // needs a seat of its own and it is the shortest gesture after Mount.
    expect(MENU_STRIP_ITEMS[1].id).toBe('chat');
    // NOT the tray's #mobile-chat: that button carries the press-and-hold log
    // peek on its own pointer handlers, which the strip's synthesized click on
    // the picked item would never reach.
    expect(MENU_STRIP_ITEMS[1].elementId).toBe('mobile-menu-chat');
    expect(MENU_STRIP_ITEMS.some((item) => item.elementId === 'mobile-chat')).toBe(false);
  });

  it('names a REAL button per item, so no action is implemented twice', () => {
    // The three that moved out of the old row keep the ids their handlers are
    // bound to; the ones promoted out of the More tray get their own.
    const byId = new Map(MENU_STRIP_ITEMS.map((item) => [item.id, item.elementId]));
    expect(byId.get('social')).toBe('mobile-social');
    expect(byId.get('quest')).toBe('mobile-quest');
    expect(byId.get('settings')).toBe('mobile-menu');
    expect(byId.get('more')).toBe('mobile-more');
    // Every element id is distinct, or two roster positions would fire one button.
    expect(new Set(byId.values()).size).toBe(MENU_STRIP_COUNT);
  });

  it('pins each item to its localized caption key, at its runtime home', () => {
    // MENU_STRIP_ITEMS.captionKey is where the old static-markup mobileSocial /
    // mobileSettings / questUi.tracker.title strings moved (see
    // tests/localization_coverage.test.ts, the negative "no longer in the
    // markup" pins). Nothing else pins these keys, so a deletion or a swap to
    // another valid-but-wrong TranslationKey would fail nowhere else.
    expect(MENU_STRIP_ITEMS.map((item) => item.captionKey)).toEqual([
      'hudChrome.mounts.mount',
      'hud.core.mobileChat',
      'hud.core.mobileMap',
      'hud.keybinds.actions.bags',
      'hud.core.mobileSocial',
      'questUi.tracker.title',
      'hud.keybinds.actions.char',
      'abilityUi.spellbook.title',
      'hud.core.mobileSettings',
      'hud.core.mobileMore',
    ]);
  });

  it('grows rightward from a control seated at the left of the bottom band', () => {
    expect(MENU_STRIP_DIRECTION).toBe('right');
    expect(resolveMenuStripDirection({ leftHanded: false })).toBe(MENU_STRIP_DIRECTION);
  });

  // The left-handed mirror reseats the whole control against the opposite edge
  // (hud.mobile.css body.mobile-left-handed #mobile-combat-controls), where a
  // rightward row is clamped back over its own anchor while the travel, the dim
  // and the caption still count rightward.
  it('flips leftward under the left-handed mirror', () => {
    expect(resolveMenuStripDirection({ leftHanded: true })).toBe('left');
  });

  it('walks the whole row inside a thumb arc at the gesture pitch', () => {
    // What the gesture actually costs is the travel to the LAST item, far less
    // than the drawn spacing (which would need over 500px to reach it). The
    // budget is half the narrowest shipped landscape viewport, so the thumb never
    // has to cross the screen centre to finish the swipe; adding Chat spent one
    // more pitch of it.
    const NARROWEST_LANDSCAPE_PX = 844;
    expect(MENU_STRIP_PITCH_PX * (MENU_STRIP_COUNT - 1)).toBeLessThan(NARROWEST_LANDSCAPE_PX / 2);
  });
});

describe('resolveMenuStripRelease', () => {
  it('OPENS the row on a bare tap: the control runs no action of its own', () => {
    // It used to answer 'default' here, which opened chat. Chat is a strip item
    // now, so the tap has nothing to run and reveals the row instead.
    expect(
      resolveMenuStripRelease({ index: -1, revealed: false, count: MENU_STRIP_COUNT }),
    ).toEqual({ kind: 'open' });
  });

  it('cancels a release back at the anchor once the row is open', () => {
    expect(resolveMenuStripRelease({ index: -1, revealed: true, count: MENU_STRIP_COUNT })).toEqual(
      {
        kind: 'cancel',
      },
    );
  });

  it('picks the item the finger is over', () => {
    expect(resolveMenuStripRelease({ index: 0, revealed: true, count: MENU_STRIP_COUNT })).toEqual({
      kind: 'pick',
      index: 0,
    });
    expect(
      resolveMenuStripRelease({
        index: MENU_STRIP_COUNT - 1,
        revealed: true,
        count: MENU_STRIP_COUNT,
      }),
    ).toEqual({
      kind: 'pick',
      index: MENU_STRIP_COUNT - 1,
    });
  });

  it('clamps a readout past the end of the row onto the last item', () => {
    expect(resolveMenuStripRelease({ index: 99, revealed: true, count: MENU_STRIP_COUNT })).toEqual(
      {
        kind: 'pick',
        index: MENU_STRIP_COUNT - 1,
      },
    );
  });

  it('falls back to opening the row with an empty roster', () => {
    expect(resolveMenuStripRelease({ index: 3, revealed: true, count: 0 })).toEqual({
      kind: 'open',
    });
  });
});

describe('menuStripCancelIsLive', () => {
  it('is live only while the row is open and nothing is chosen', () => {
    expect(menuStripCancelIsLive(-1, true)).toBe(true);
    expect(menuStripCancelIsLive(-1, false)).toBe(false);
    expect(menuStripCancelIsLive(0, true)).toBe(false);
  });
});

describe('shouldRevealMenuStrip', () => {
  it('pulls the row up as soon as a drag commits, without waiting out the timer', () => {
    expect(shouldRevealMenuStrip(0, false)).toBe(true);
    expect(shouldRevealMenuStrip(-1, false)).toBe(false);
    expect(shouldRevealMenuStrip(2, true)).toBe(false);
  });
});

describe('menuCaptionCenterX', () => {
  const centers = [100, 160, 220, 280, 340, 400, 460, 520, 580, 640];

  it('hides itself when nothing is live', () => {
    expect(menuCaptionCenterX({ centers, live: -1, viewportWidth: 844, margin: 6 })).toBeNull();
  });

  it('parks over the live item when there is room on both sides', () => {
    expect(menuCaptionCenterX({ centers, live: 3, viewportWidth: 844, margin: 6 })).toBe(280);
  });

  it('clamps the near end so the box never runs off the left edge', () => {
    // A clamped row can seat item 0 inside the caption's own half-width of the
    // edge, which is the case the near bound exists for.
    expect(menuCaptionCenterX({ centers: [24, 84], live: 0, viewportWidth: 844, margin: 6 })).toBe(
      6 + MENU_CAPTION_HALF_PX,
    );
    // A live item with room on both sides is left exactly where it sits.
    expect(menuCaptionCenterX({ centers, live: 0, viewportWidth: 844, margin: 6 })).toBe(100);
  });

  it('clamps the far end against the app viewport, not the drawn row', () => {
    // The last item sits at 640 on a 620px box: unclamped the caption would hang
    // off the right edge.
    expect(menuCaptionCenterX({ centers, live: 9, viewportWidth: 620, margin: 6 })).toBe(
      620 - 6 - MENU_CAPTION_HALF_PX,
    );
  });

  it('centres in a viewport too narrow to satisfy both bounds', () => {
    expect(menuCaptionCenterX({ centers, live: 4, viewportWidth: 80, margin: 6 })).toBe(40);
  });

  it('reports nothing for a live index the placement never filled', () => {
    expect(menuCaptionCenterX({ centers: [], live: 0, viewportWidth: 844, margin: 6 })).toBeNull();
  });
});
