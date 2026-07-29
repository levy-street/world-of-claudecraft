// @vitest-environment happy-dom

// THE BUG (#2529): a runtime language change does not reload the page. It
// dispatches `woc:languagechange`, and `Hud.refreshLocalizedDynamicUi()` forces
// one repaint of every open surface so its t() text lands in the new locale. A
// surface that repaints only when its OWN signature moves never gets that
// repaint, because every one of those signatures is text-independent by design
// (ids, counts, positions), so `setLanguage` alone can never move it.
//
// Nine surfaces were in that state. Each test below runs the same three beats,
// and the middle one is what makes it a regression test rather than a
// smoke test:
//   1. paint in English and record what is on screen;
//   2. switch the locale and drive the surface's ORDINARY repaint path with
//      unchanged data. The old locale is STILL on screen: that is the bug,
//      reproduced, and it is what fails if someone later widens a signature to
//      cover text and deletes the relocalize as redundant;
//   3. call relocalize() and assert the new locale is on screen AND that the two
//      differ (a locale whose value happened to match English would make the
//      whole arm vacuous).
//
// The windows carrying live typed input get a fourth beat: the draft survives.
// A relocalize that fixed the language by wiping a half-written letter would
// trade one bug for a worse one (`src/ui/form_draft.ts` states the contract).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Keybinds } from '../src/game/keybinds';
import type { Renderer } from '../src/render/renderer';
import type { InvSlot } from '../src/sim/types';
import { CalendarWindow, type CalendarWindowDeps } from '../src/ui/calendar_window';
import { CardDuelWindow, type CardDuelWindowDeps } from '../src/ui/card_duel_window';
import { DelveTrackerController } from '../src/ui/hud/delve/delve_tracker_controller';
import { LockpickWindow } from '../src/ui/hud/delve/lockpick_window';
import { ensureLocaleLoaded, setLanguage, type TranslationKey, t } from '../src/ui/i18n';
import { MailboxWindow, type MailboxWindowDeps } from '../src/ui/mailbox_window';
import { SocialWindow, type SocialWindowDeps } from '../src/ui/social_window';
import { TutorialOverlay } from '../src/ui/tutorial';
import type { DelveRunInfo, IWorld, LockpickView } from '../src/world_api';

// A real locale, not the dev pseudo one: the pseudo-locale is a transform of
// English and would still pass a test that never re-resolved anything.
const OTHER = 'es';

beforeAll(async () => {
  await ensureLocaleLoaded(OTHER);
});

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
});

afterEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
  localStorage.clear();
  vi.useRealTimers();
});

/**
 * Read one key in both locales and refuse to run if they match.
 *
 * Without this every assertion below could pass over a locale that fell back to
 * English, which is exactly the state a missing translation leaves. The guard
 * belongs in the test rather than in review: the catalogs move every release.
 */
function bilingual(
  key: TranslationKey,
  values?: Record<string, string | number>,
): { en: string; other: string } {
  setLanguage('en');
  const english = t(key, values);
  setLanguage(OTHER);
  const other = t(key, values);
  setLanguage('en');
  expect(
    other,
    `${key} reads the same in ${OTHER} as in English, so it cannot witness a re-localization`,
  ).not.toBe(english);
  return { en: english, other };
}

function mount(id: string, display = 'none'): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.style.display = display;
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// 1. Mailbox (named by #2529)
// ---------------------------------------------------------------------------

function mailWorld(inventory: InvSlot[] = []): IWorld {
  return {
    inventory,
    copper: 100_000,
    mailInfo: { unread: 0, messages: [], postage: 30, maxAttachments: 3, deliverySeconds: 60 },
    mailMarkRead: () => {},
  } as unknown as IWorld;
}

function openMailbox(): { win: MailboxWindow; root: HTMLElement } {
  const root = mount('mailbox-window');
  const noop = (): void => {};
  const deps: MailboxWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => mailWorld(),
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showError: noop,
    syncBags: noop,
  };
  const win = new MailboxWindow(deps);
  win.open();
  return { win, root };
}

describe('#2529 mailbox: an open Send tab re-localizes without losing the letter', () => {
  it('keeps the old locale on its own repaint path, then relocalizes and preserves the draft', () => {
    const label = bilingual('hudChrome.mailbox.toLabel');
    const { win, root } = openMailbox();
    (root.querySelector('[data-tab="send"]') as HTMLElement).click();
    const labelText = (): string =>
      root.querySelector('label[for="mail-to"]')?.textContent?.trim() ?? '';
    expect(labelText()).toBe(label.en);

    const field = <T extends HTMLInputElement | HTMLTextAreaElement>(id: string): T =>
      root.querySelector<T>(`#${id}`) as T;
    field<HTMLInputElement>('mail-to').value = 'Mira';
    field<HTMLInputElement>('mail-subject').value = 'For you';
    field<HTMLTextAreaElement>('mail-body').value = 'A fang from the hunt.';
    field<HTMLInputElement>('mail-g').value = '2';
    field<HTMLInputElement>('mail-s').value = '30';
    field<HTMLInputElement>('mail-c').value = '7';

    // THE BUG: the slow-band repaint is the only thing that ran before this fix,
    // and on the Send tab it deliberately does nothing at all.
    setLanguage(OTHER);
    win.refreshIfChanged();
    expect(labelText(), 'the send tab repainted itself: this arm no longer proves the gap').toBe(
      label.en,
    );

    win.relocalize();
    expect(labelText()).toBe(label.other);
    expect(field<HTMLInputElement>('mail-to').value).toBe('Mira');
    expect(field<HTMLInputElement>('mail-subject').value).toBe('For you');
    expect(field<HTMLTextAreaElement>('mail-body').value).toBe('A fang from the hunt.');
    expect(field<HTMLInputElement>('mail-g').value).toBe('2');
    expect(field<HTMLInputElement>('mail-s').value).toBe('30');
    expect(field<HTMLInputElement>('mail-c').value).toBe('7');
  });

  it('does not re-open a bags window the player closed, and keeps focus in the dialog', () => {
    const root = mount('mailbox-window');
    const bagsReveals: boolean[] = [];
    const noop = (): void => {};
    const win = new MailboxWindow({
      itemIcon: () => '<span class="item-icon"></span>',
      moneyHtml: () => '',
      itemTooltip: () => '',
      attachTooltip: noop,
      root: () => root,
      world: () => mailWorld(),
      closeOthers: noop,
      hideTooltip: noop,
      captureFocus: () => null,
      restoreFocus: noop,
      showError: noop,
      syncBags: (open) => bagsReveals.push(open),
    });
    win.open();
    (root.querySelector('[data-tab="send"]') as HTMLElement).click();
    expect(bagsReveals, 'opening the Send tab is what docks the bags window').toContain(true);

    // The player closed bags; a language switch must not undo that.
    bagsReveals.length = 0;
    const sendTab = root.querySelector('[data-tab="send"]') as HTMLElement;
    sendTab.focus();
    setLanguage(OTHER);
    win.relocalize();
    expect(bagsReveals, 'the relocalize re-revealed the bags window').toEqual([]);
    // Focus was on a button, not a text field: the window's Tab trap only arms
    // while focus is inside its root, so dropping it to body would let the next
    // Tab walk out of the dialog.
    expect(document.activeElement).toBe(root.querySelector('[data-tab="send"]'));
  });

  it('re-latches the inbox signature so the next slow tick does not rebuild again', () => {
    const tab = bilingual('hudChrome.mailbox.tabSend');
    const { win, root } = openMailbox();
    const sendTab = (): HTMLElement => root.querySelector('[data-tab="send"]') as HTMLElement;
    // open() clears the signature, so the first poll after it always rebuilds.
    // Settle that here, in English, or the staleness arm below would be measuring
    // the open path rather than the elision.
    win.refreshIfChanged();
    expect(sendTab().textContent).toBe(tab.en);

    setLanguage(OTHER);
    win.refreshIfChanged();
    expect(sendTab().textContent).toBe(tab.en);

    win.relocalize();
    const rebuilt = sendTab();
    expect(rebuilt.textContent).toBe(tab.other);

    // A relocalize that CLEARED the signature instead of re-latching it would
    // rebuild a second time here, which on the Send tab would land after the
    // restore above and wipe the draft it just put back.
    win.refreshIfChanged();
    expect(sendTab(), 'the mailbox rebuilt a second time on unchanged data').toBe(rebuilt);
  });
});

// ---------------------------------------------------------------------------
// 2. Calendar (named by #2529)
// ---------------------------------------------------------------------------

function calendarWorld(): IWorld {
  return {
    socialInfo: {
      guild: { name: 'Ashen Vow', rank: 'leader', members: [], events: [] },
    },
    guildEventCreate: () => {},
    guildEventRemove: () => {},
  } as unknown as IWorld;
}

function openCalendar(): { win: CalendarWindow; root: HTMLElement } {
  const root = mount('calendar-window');
  const noop = (): void => {};
  const deps: CalendarWindowDeps = {
    root: () => root,
    world: () => calendarWorld(),
    closeOthers: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showError: noop,
  };
  const win = new CalendarWindow(deps);
  win.open();
  return { win, root };
}

describe('#2529 calendar: an open month re-localizes without losing the booking draft', () => {
  it('holds the old locale through refreshIfChanged, then relocalizes and keeps the form', () => {
    const heading = bilingual('hudChrome.calendar.bookTitle');
    const { win, root } = openCalendar();
    const bookTitle = (): string =>
      root.querySelector('.cal-form-title')?.textContent?.trim() ?? '';
    // open() clears the signature, so the first poll after it always rebuilds.
    // Settle that in English first, or the staleness arm below measures the open
    // path rather than the elision.
    win.refreshIfChanged();
    expect(bookTitle(), 'the guild-master booking form did not render').toBe(heading.en);

    const title = root.querySelector<HTMLInputElement>('#cal-ev-title') as HTMLInputElement;
    const note = root.querySelector<HTMLInputElement>('#cal-ev-note') as HTMLInputElement;
    const hour = root.querySelector<HTMLInputElement>('#cal-ev-hour') as HTMLInputElement;
    title.value = 'Molten Core';
    note.value = 'Bring fire resist';
    hour.value = '20';

    setLanguage(OTHER);
    win.refreshIfChanged();
    expect(bookTitle(), 'the calendar repainted itself: this arm no longer proves the gap').toBe(
      heading.en,
    );

    win.relocalize();
    expect(bookTitle()).toBe(heading.other);
    expect(root.querySelector<HTMLInputElement>('#cal-ev-title')?.value).toBe('Molten Core');
    expect(root.querySelector<HTMLInputElement>('#cal-ev-note')?.value).toBe('Bring fire resist');
    expect(root.querySelector<HTMLInputElement>('#cal-ev-hour')?.value).toBe('20');

    // Re-latched, not cleared: a second rebuild would wipe the restored draft.
    const kept = root.querySelector('#cal-ev-title');
    win.refreshIfChanged();
    expect(
      root.querySelector('#cal-ev-title'),
      'the calendar rebuilt again on unchanged data',
    ).toBe(kept);
  });
});

// ---------------------------------------------------------------------------
// 3. Social (named by #2529)
// ---------------------------------------------------------------------------

type CharacterHit = { name: string; cls: string; level: number };

function socialWorld(
  search: (q: string) => Promise<CharacterHit[]>,
  guild: unknown = null,
): IWorld {
  return {
    playerId: 7,
    player: { id: 7, name: 'Aleron' },
    realm: 'Ashenvale',
    partyInfo: null,
    socialInfo: { friends: [], ignores: [], blocks: [], guild },
    searchCharacters: search,
    guildSetMotd: () => {},
  } as unknown as IWorld;
}

function openSocial(
  search: (q: string) => Promise<CharacterHit[]> = async () => [],
  guild: unknown = null,
): { win: SocialWindow; root: HTMLElement } {
  const root = mount('social-window');
  const noop = (): void => {};
  const deps: SocialWindowDeps = {
    root: () => root,
    world: () => socialWorld(search, guild),
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showPrompt: noop,
    startWhisper: noop,
  };
  const win = new SocialWindow(deps);
  win.toggle();
  return { win, root };
}

describe('#2529 social: an open panel re-localizes without losing the typed name', () => {
  it('holds the old locale through refreshIfChanged, then relocalizes and keeps the draft', () => {
    const tab = bilingual('hud.social.friendsTab');
    const { win, root } = openSocial();
    const firstTab = (): string => root.querySelector('.soc-tab')?.textContent?.trim() ?? '';
    expect(firstTab()).toBe(tab.en);

    const input = root.querySelector<HTMLInputElement>(
      'input[data-field="friend"]',
    ) as HTMLInputElement;
    input.value = 'Mirabel';

    setLanguage(OTHER);
    win.refreshIfChanged();
    expect(firstTab(), 'the social panel repainted itself: this arm no longer proves the gap').toBe(
      tab.en,
    );

    win.relocalize();
    expect(firstTab()).toBe(tab.other);
    expect(root.querySelector<HTMLInputElement>('input[data-field="friend"]')?.value).toBe(
      'Mirabel',
    );

    const kept = root.querySelector('input[data-field="friend"]');
    win.refreshIfChanged();
    expect(root.querySelector('input[data-field="friend"]'), 'the panel rebuilt again').toBe(kept);
  });

  it('carries the guild billboard draft, which refreshList could no longer read', () => {
    // The subtle arm of the three: refreshList protects this draft by reading the
    // LIVE input, but render() destroys `.soc-body` before calling refreshList, so
    // by then there is nothing to read. relocalize has to capture first.
    const heading = bilingual('hudChrome.social.billboard.inputLabel');
    const { win, root } = openSocial(async () => [], {
      name: 'Ashen Vow',
      rank: 'leader',
      members: [{ name: 'Aleron', cls: 'warrior', level: 60, online: true, rank: 'leader' }],
      motd: 'Raid at eight',
      events: [],
    });
    (root.querySelector('[data-tab="guild"]') as HTMLElement | null)?.click();
    const motd = (): HTMLInputElement | null =>
      root.querySelector<HTMLInputElement>('input[data-field="gmotd"]');
    expect(motd(), 'the guild billboard never rendered: the arm proves nothing').not.toBeNull();
    expect(motd()?.getAttribute('aria-label')).toBe(heading.en);
    (motd() as HTMLInputElement).value = 'Raid at nine, bring fire resist';

    setLanguage(OTHER);
    win.relocalize();
    expect(motd()?.getAttribute('aria-label')).toBe(heading.other);
    expect(motd()?.value, 'the billboard draft was lost in the rebuild').toBe(
      'Raid at nine, bring fire resist',
    );
  });

  it('drops a search still in flight, so its results cannot land on the rebuilt DOM', async () => {
    vi.useFakeTimers();
    let searches = 0;
    const { win, root } = openSocial(async () => {
      searches++;
      return [{ name: 'Mirabel', cls: 'mage', level: 12 }];
    });
    const input = root.querySelector<HTMLInputElement>(
      'input[data-field="friend"]',
    ) as HTMLInputElement;
    input.value = 'Mir';
    input.dispatchEvent(new Event('input'));

    // Mid-debounce: the timer is armed and has NOT fired. relocalize must clear
    // it, or the search resolves against a listbox that no longer exists.
    setLanguage(OTHER);
    win.relocalize();
    await vi.advanceTimersByTimeAsync(1000);
    expect(searches, 'a search armed before the relocalize still ran after it').toBe(0);
    expect(root.querySelectorAll('.soc-suggest .soc-sugg-item')).toHaveLength(0);
  });

  it('drops the pending suggestion list with the listbox the rebuild destroys', async () => {
    vi.useFakeTimers();
    const { win, root } = openSocial(async () => [
      { name: 'Mirabel', cls: 'mage', level: 12 },
      { name: 'Miranda', cls: 'rogue', level: 9 },
    ]);
    const input = root.querySelector<HTMLInputElement>(
      'input[data-field="friend"]',
    ) as HTMLInputElement;
    input.value = 'Mir';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(500);
    expect(
      root.querySelectorAll('.soc-suggest[data-for="friend"] .soc-sugg-item').length,
      'the typeahead never opened, so the stranded-list arm proves nothing',
    ).toBe(2);

    setLanguage(OTHER);
    win.relocalize();

    // render() destroyed the listbox. If `suggest` survived it, ArrowDown would
    // still move a highlight through items nobody can see, and point the
    // combobox at an element id that no longer exists.
    const rebuilt = root.querySelector<HTMLInputElement>(
      'input[data-field="friend"]',
    ) as HTMLInputElement;
    expect(rebuilt.value).toBe('Mir');
    rebuilt.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(
      rebuilt.getAttribute('aria-activedescendant'),
      'a stranded suggestion list survived the relocalize rebuild',
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Card duel (named by #2529; its relocalize existed with no caller at all)
// ---------------------------------------------------------------------------

function openCardDuel(): { win: CardDuelWindow; root: HTMLElement } {
  const root = mount('card-duel-window');
  const noop = (): void => {};
  const deps: CardDuelWindowDeps = {
    root: () => root,
    world: () =>
      ({
        cardMinigameInfo: { queued: false, inQueue: 0, match: null },
        joinCardDuelQueue: noop,
        leaveCardDuelQueue: noop,
        forfeitCardDuel: noop,
        playCardInDuel: noop,
      }) as unknown as IWorld,
    closeOthers: noop,
    captureFocus: () => null,
    restoreFocus: noop,
  };
  const win = new CardDuelWindow(deps);
  win.toggle();
  return { win, root };
}

describe('#2529 card duel: the orphaned relocalize is the only thing that repaints it', () => {
  it('no-ops on a direct render() and repaints on relocalize()', () => {
    const title = bilingual('cardDuel.title');
    const { win, root } = openCardDuel();
    const heading = (): string => root.querySelector('#card-duel-title')?.textContent?.trim() ?? '';
    expect(heading()).toBe(title.en);

    // The signature check lives INSIDE render(), so wiring the fan-out to
    // render() (the shape three other windows use) would have been a silent
    // no-op here. That is why this window needs its relocalize called.
    setLanguage(OTHER);
    win.render();
    expect(heading(), 'render() rebuilt on an unchanged signature').toBe(title.en);

    win.relocalize();
    expect(heading()).toBe(title.other);

    // relocalize() clears then re-latches inside the same render, so the medium
    // band goes straight back to eliding.
    const kept = root.querySelector('#card-duel-title');
    win.render();
    expect(root.querySelector('#card-duel-title'), 'the duel window rebuilt again').toBe(kept);
  });
});

// ---------------------------------------------------------------------------
// 5. Delve tracker: the fan-out already CALLED it, and the call did nothing
// ---------------------------------------------------------------------------

function delveRun(): DelveRunInfo {
  return {
    delveId: 'collapsed_reliquary',
    tierId: 'normal',
    slot: 0,
    origin: { x: 0, z: 0 },
    moduleIndex: 0,
    moduleCount: 2,
    modules: ['reliquary_sunken_ossuary', 'reliquary_finale'],
    objective: { kind: 'kill_boss', counts: [0], complete: false },
    affixes: [],
    completed: false,
    exitPortalOpen: false,
    bountiful: false,
    rite: null,
  } as unknown as DelveRunInfo;
}

describe('#2529 delve tracker: the fan-out arm was present but inert', () => {
  it('ignores a plain update() after a language switch and repaints on relocalize()', () => {
    const heading = bilingual('delveUi.tracker.title');
    const element = mount('delve-tracker', 'block');
    const world = { delveRun: delveRun(), delveMarks: 3 } as Pick<
      IWorld,
      'delveRun' | 'delveMarks'
    >;
    const controller = new DelveTrackerController({
      element,
      world: () => world,
      delveName: () => 'Collapsed Reliquary',
      mobName: () => 'Deacon Varric',
      attachTooltip: () => {},
      closeRitePanel: () => {},
    });
    controller.update();
    const title = (): string => element.querySelector('.dt-header')?.textContent?.trim() ?? '';
    expect(title()).toBe(heading.en);

    // This is exactly what refreshLocalizedDynamicUi used to do: call update().
    setLanguage(OTHER);
    controller.update();
    expect(title(), 'update() repainted on an unchanged signature: the arm is moot').toBe(
      heading.en,
    );

    controller.relocalize();
    expect(title()).toBe(heading.other);

    const kept = element.querySelector('.dt-header');
    controller.update();
    expect(element.querySelector('.dt-header'), 'the tracker rebuilt again').toBe(kept);
  });

  it('needs no open check: with no run it clears the strip instead of painting', () => {
    // The one relocalize in the nine with no open guard of its own. It leans on
    // update()'s no-run arm, so that arm is what has to be pinned.
    const element = mount('delve-tracker', 'block');
    element.innerHTML = 'stale';
    const closeRitePanel = vi.fn();
    const controller = new DelveTrackerController({
      element,
      world: () => ({ delveRun: null, delveMarks: 0 }) as Pick<IWorld, 'delveRun' | 'delveMarks'>,
      delveName: () => 'Collapsed Reliquary',
      mobName: () => 'Deacon Varric',
      attachTooltip: () => {},
      closeRitePanel,
    });
    setLanguage(OTHER);
    controller.relocalize();
    expect(element.innerHTML).toBe('');
    expect(element.style.display).toBe('none');
    expect(closeRitePanel).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Lockpick board
// ---------------------------------------------------------------------------

const LOCK_VIEW: LockpickView = {
  sessionId: 'lp_1_0',
  objectId: 1,
  w: 4,
  h: 4,
  col: 0,
  row: 2,
  page: 1,
  pageCount: 2,
  tries: 2,
  triesTotal: 2,
  lootTier: 'premium',
  allowed: ['set', 'steady', 'ease'],
  visible: [],
  stepTimeoutMs: 15000,
};

function lockpickHarness(state: () => LockpickView | null): {
  win: LockpickWindow;
  panel: HTMLElement;
} {
  const panel = mount('lockpick-panel', 'block');
  const win = new LockpickWindow({
    panel: () => panel,
    getState: state,
    tierName: (tier) => tier,
    onEngage: () => {},
    onAction: () => {},
    onAbort: () => {},
    onClose: () => {},
  });
  return { win, panel };
}

describe('#2529 lockpick: both halves of the panel re-localize', () => {
  it('ignores the per-frame repaint after a language switch and repaints the board', () => {
    // Captured BEFORE the window is touched, so beat 3 compares against an
    // independently read value rather than re-resolving the same t() call the
    // painter just made (which would be a near-tautology).
    const title = bilingual('lockpickUi.boardTitle', { tier: LOCK_VIEW.lootTier });
    const { win, panel } = lockpickHarness(() => LOCK_VIEW);
    win.openBoard();
    const heading = (): string => panel.querySelector('.panel-title span')?.textContent ?? '';
    expect(heading()).toBe(title.en);

    setLanguage(OTHER);
    win.repaintIfChanged();
    expect(heading(), 'the board repainted itself: this arm no longer proves the gap').toBe(
      title.en,
    );

    win.relocalize();
    expect(heading()).toBe(title.other);

    // relocalize() CLEARS lastSig here and leans on repaintIfChanged to re-latch
    // inside the same call, which is a different mechanism from the re-latching
    // siblings and the one worth pinning: a leaked clear would rebuild the board
    // on every frame for the rest of the attempt.
    const kept = panel.querySelector('.panel-title span');
    win.repaintIfChanged();
    expect(panel.querySelector('.panel-title span'), 'the board rebuilt again').toBe(kept);
    win.stopTimer();
  });

  it('leaves the countdown reading the live remaining, not a full budget', () => {
    // renderBoard re-emits the bar at width:100% and the full-duration label, and
    // syncTimer deliberately does not restart the clock (the timer key did not
    // move), so a naive relocalize would show a full timer on a TIMED minigame
    // until the running interval's next tick.
    vi.useFakeTimers();
    const { win, panel } = lockpickHarness(() => LOCK_VIEW);
    win.openBoard();
    const bar = (): string =>
      (panel.querySelector('#lp-timer-bar') as HTMLElement | null)?.style.width ?? '';
    expect(bar()).toBe('100%');
    vi.advanceTimersByTime(9_000);
    const midAttempt = bar();
    expect(midAttempt, 'the countdown never advanced: the arm proves nothing').not.toBe('100%');

    setLanguage(OTHER);
    win.relocalize();
    expect(bar(), 'the rebuild snapped the countdown back to a full budget').not.toBe('100%');
    win.stopTimer();
  });

  it('repaints the ante selector, which has no signature and no driver at all', () => {
    // The state BEFORE a session exists: the player opened the chest and has not
    // chosen an ante, so getState() is null and the board path cannot reach it.
    const heading = bilingual('lockpickUi.pickTitle');
    const { win, panel } = lockpickHarness(() => null);
    win.renderAnte(7, false);
    const title = (): string => panel.querySelector('.panel-title span')?.textContent ?? '';
    expect(title()).toBe(heading.en);

    setLanguage(OTHER);
    win.repaintIfChanged();
    expect(title(), 'something already repaints the ante selector: the arm is moot').toBe(
      heading.en,
    );

    win.relocalize();
    expect(title()).toBe(heading.other);
  });

  it('drops the retained ante inputs once a board has painted over them', () => {
    // The sequence that makes a stale retention visible: the selector paints, the
    // player picks an ante and the board replaces it, then the session ends while
    // the panel is still up (getState() goes null again). If renderBoard had not
    // dropped the retained pair, the relocalize below would paint a dead ante
    // selector back over whatever the panel is showing.
    let state: LockpickView | null = null;
    const { win, panel } = lockpickHarness(() => state);
    win.renderAnte(7, false);
    expect(panel.querySelector('[data-ante]')).not.toBeNull();
    state = LOCK_VIEW;
    win.openBoard();
    win.stopTimer();
    expect(panel.querySelector('[data-ante]')).toBeNull();

    state = null;
    setLanguage(OTHER);
    win.relocalize();
    expect(
      panel.querySelector('[data-ante]'),
      'a stale retained ante repainted the selector after the session ended',
    ).toBeNull();
  });
});

// The ninth surface, MobileActionRingPainter, is pinned in its own suite
// (tests/mobile_action_ring_painter.test.ts), which already owns the fake
// action-bar facet and slot descriptors this file would otherwise duplicate.

// ---------------------------------------------------------------------------
// 7. Tutorial overlay
// ---------------------------------------------------------------------------

function tutorialWorld(over: Record<string, unknown> = {}): IWorld {
  return {
    playerId: 7,
    player: { id: 7, level: 1, name: 'Aleron', pos: { x: 0, y: 0, z: 0 } },
    questsDone: new Set<string>(),
    questLog: new Map(),
    questState: () => null,
    entities: new Map(),
    ...over,
  } as unknown as IWorld;
}

const FAKE_RENDERER = {
  worldToScreen: () => ({ x: 0, y: 0, behind: false }),
} as unknown as Renderer;
const FAKE_KEYBINDS = {
  primaryLabel: (id: string) => id.toUpperCase(),
} as unknown as Keybinds;

describe('#2529 tutorial: the coachmark card re-localizes mid-step', () => {
  it('holds the old locale through update() and repaints on relocalize()', () => {
    const heading = bilingual('hud.tutorial.moveTitle');
    mount('ui', 'block');
    const world = tutorialWorld();
    const overlay = new TutorialOverlay();
    overlay.update(world, FAKE_RENDERER, FAKE_KEYBINDS);
    const title = (): string => document.querySelector('.tut-title')?.textContent ?? '';
    expect(title(), 'the tutorial card never rendered: the arm proves nothing').toBe(heading.en);

    setLanguage(OTHER);
    overlay.update(world, FAKE_RENDERER, FAKE_KEYBINDS);
    expect(title(), 'update() repainted on an unchanged step: the arm is moot').toBe(heading.en);

    overlay.relocalize(world, FAKE_KEYBINDS);
    expect(title()).toBe(heading.other);

    // The card reuses its element refs rather than rebuilding, so idempotence is
    // pinned on the node identity plus the text staying put across a follow-up
    // update() with the step unchanged.
    const card = document.querySelector('.tut-card');
    overlay.update(world, FAKE_RENDERER, FAKE_KEYBINDS);
    expect(document.querySelector('.tut-card')).toBe(card);
    expect(title()).toBe(heading.other);
  });

  it('paints nothing before a step exists, so the fan-out can call it unconditionally', () => {
    mount('ui', 'block');
    const overlay = new TutorialOverlay();
    setLanguage(OTHER);
    overlay.relocalize(tutorialWorld(), FAKE_KEYBINDS);
    expect(document.querySelector('.tut-card'), 'relocalize built a card with no step').toBeNull();
  });

  it('refuses a world with no player rather than throwing out of the fan-out', () => {
    // update() and isFreshCharacter both guard this: player is TYPED as an Entity
    // but is absent in the online pre-snapshot window, and renderPanel reads
    // player.name. A throw here would skip every fan-out arm after the tutorial.
    const heading = bilingual('hud.tutorial.moveTitle');
    mount('ui', 'block');
    const overlay = new TutorialOverlay();
    overlay.update(tutorialWorld(), FAKE_RENDERER, FAKE_KEYBINDS);
    const title = (): string => document.querySelector('.tut-title')?.textContent ?? '';
    expect(title()).toBe(heading.en);

    setLanguage(OTHER);
    expect(() => overlay.relocalize(tutorialWorld({ player: null }), FAKE_KEYBINDS)).not.toThrow();
    expect(title(), 'it painted from a world with no player').toBe(heading.en);
  });
});

// ---------------------------------------------------------------------------
// 8. The contract every one of them states: safe to call while closed
// ---------------------------------------------------------------------------

// Every relocalize doc comment in the change claims to be self-gated so the
// fan-out can call it unconditionally, and the fan-out does exactly that. Only
// the spellbook proved it (in its own suite), so a dropped `if (!this.opened)
// return;` would paint into a hidden root and leave every other assertion in
// this file green.
describe('#2529 a closed surface paints nothing when the fan-out reaches it', () => {
  const cases: ReadonlyArray<[string, () => HTMLElement]> = [
    [
      'calendar',
      () => {
        const { win, root } = openCalendar();
        win.close();
        root.innerHTML = '';
        win.relocalize();
        return root;
      },
    ],
    [
      'mailbox',
      () => {
        const { win, root } = openMailbox();
        win.close();
        root.innerHTML = '';
        win.relocalize();
        return root;
      },
    ],
    [
      'social',
      () => {
        const { win, root } = openSocial();
        win.close();
        root.innerHTML = '';
        win.relocalize();
        return root;
      },
    ],
    [
      'card duel',
      () => {
        const { win, root } = openCardDuel();
        win.close();
        root.innerHTML = '';
        win.relocalize();
        return root;
      },
    ],
    [
      'lockpick',
      () => {
        const { win, panel } = lockpickHarness(() => LOCK_VIEW);
        win.openBoard();
        win.stopTimer();
        panel.style.display = 'none';
        panel.innerHTML = '';
        win.relocalize();
        return panel;
      },
    ],
  ];

  it.each(cases)('%s', (_name, run) => {
    setLanguage(OTHER);
    expect(run().innerHTML).toBe('');
  });
});
