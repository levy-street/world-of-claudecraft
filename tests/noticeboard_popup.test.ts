// @vitest-environment happy-dom
//
// The guild-signpost popup renders AUTHORED noticeboard listings only (the
// bare guild-plus-note card); a board with no authored rows opens the guild
// board window instead (tests/guild_board_window.test.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoticeboardListing } from '../src/sim/types';
import { NoticeboardPopup } from '../src/ui/noticeboard_popup';

describe('NoticeboardPopup', () => {
  let popup: NoticeboardPopup;

  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
    popup = new NoticeboardPopup();
  });

  afterEach(() => {
    popup.hide();
    document.body.innerHTML = '';
  });

  it('renders each authored listing as a guild-plus-note card', () => {
    // Arrange
    const listings: NoticeboardListing[] = [
      { guild: 'Authored', note: 'hand-written call' },
      { guild: 'Second', note: 'another call' },
    ];

    // Act
    popup.show(listings);

    // Assert
    const items = [...document.querySelectorAll('.nb-item')];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.nb-guild')?.textContent).toBe('Authored');
    expect(items[0].querySelector('.nb-note')?.textContent).toBe('hand-written call');
  });

  it('closes on its one button and clears the card', () => {
    // Arrange
    popup.show([{ guild: 'Authored', note: 'x' }]);

    // Act
    (document.querySelector('.nb-popup .tut-skip') as HTMLButtonElement).click();

    // Assert
    expect(document.querySelector('.nb-popup')).toBeNull();
  });
});
