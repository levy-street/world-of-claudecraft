// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Settings } from '../src/game/settings';
import {
  CHAT_UNREAD_BOX_HOST_ID,
  CHAT_UNREAD_BOX_ID,
  CHAT_UNREAD_COUNT_CLASS,
  CHAT_UNREAD_HEAD_CLASS,
  CHAT_UNREAD_ROW_CLASS,
} from '../src/ui/hud/chat/chat_unread_box';
import {
  type ChatContextMenuPort,
  ChatWindowController,
} from '../src/ui/hud/chat/chat_window_controller';
import {
  WHISPER_UNREAD_BADGE_CLASS,
  WHISPER_UNREAD_DESC_ID,
} from '../src/ui/hud/chat/whisper_unread_badge';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

// The real ChatWindowController over a jsdom document carrying the Quick
// Actions seat the unread box hangs over. `noteChatReceived(channel)` is the
// call hud.ts makes for a line another player sent (pinned in
// whisper_unread_core.test.ts). #mobile-menu-chat stands in for the touch
// controls' Chat button: its click opens chat the way tapChat() does.

function mount(tabs: string[] = []): ChatWindowController {
  document.body.className = '';
  document.body.innerHTML = `
    <div id="${CHAT_UNREAD_BOX_HOST_ID}">
      <button id="mobile-menu-anchor" aria-expanded="false" aria-label="Quick Actions"></button>
    </div>
    <button id="mobile-menu-chat" class="mobile-menu-item" aria-label="Open Chat"></button>
    <div id="chatlog-tabs"></div>
    <textarea id="chat-input"></textarea>
    <div id="chatlog"></div>
    <div id="combatlog"></div>
    <div id="ctx-menu"></div>`;
  const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  byId('mobile-menu-chat').addEventListener('click', () => {
    document.body.classList.toggle('mobile-chat-open');
  });
  const contextMenu: ChatContextMenuPort = {
    element: byId('ctx-menu'),
    opener: () => null,
    setOpener: () => {},
    close: () => {},
    place: () => {},
    bind: () => {},
  };
  const values = new Map<string, string>([['woc_chat_tabs', JSON.stringify(tabs)]]);
  const controller = new ChatWindowController({
    document,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    },
    chatLog: byId('chatlog'),
    combatLog: byId('combatlog'),
    contextMenu,
    sendChat: () => {},
    isMobileLayout: () => document.body.classList.contains('mobile-touch'),
    itemDisplayName: () => null,
    questTitle: (questId) => questId,
    selectedQuestId: () => null,
    hasQuest: () => false,
    showError: () => {},
    openWhoTab: () => false,
    openGroupFinder: () => {},
  });
  controller.init();
  document.body.classList.add('mobile-touch');
  return controller;
}

const box = (): HTMLElement | null => document.getElementById(CHAT_UNREAD_BOX_ID);
const boxShown = (): boolean => box() !== null && !box()?.hidden;
const row = (channel: string): HTMLButtonElement =>
  box()?.querySelector(`.${CHAT_UNREAD_ROW_CLASS}[data-chan="${channel}"]`) as HTMLButtonElement;
const head = (): HTMLButtonElement =>
  box()?.querySelector(`.${CHAT_UNREAD_HEAD_CLASS}`) as HTMLButtonElement;
const countOf = (el: Element): string | null =>
  el.querySelector(`.${CHAT_UNREAD_COUNT_CLASS}`)?.textContent ?? null;
/** The visible rows as "channel=count", in DOM order. */
const shownRows = (): string[] =>
  boxShown()
    ? Array.from(box()?.querySelectorAll<HTMLElement>(`.${CHAT_UNREAD_ROW_CLASS}`) ?? [])
        .filter((el) => !el.hidden)
        .map((el) => `${el.dataset.chan}=${countOf(el)}`)
    : [];
const activeTab = (): string | undefined =>
  document.querySelector<HTMLElement>('#chatlog-tabs .chat-tab.active')?.dataset.tab;
const receive = (chat: ChatWindowController, channel: string, times = 1): void => {
  for (let i = 0; i < times; i++) chat.noteChatReceived(channel);
};
/** Let the body-class MutationObserver deliver. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('unread chat box on the touch HUD', () => {
  let chat: ChatWindowController;
  beforeEach(async () => {
    localStorage.clear();
    // A controller has no teardown (the HUD builds one per page), so the ones
    // earlier tests built still watch this body. Leaving touch drops their
    // counts, which keeps them from painting a box of their own below.
    document.body.className = '';
    await settle();
    chat = mount();
  });
  const remount = async (tabs: string[]): Promise<ChatWindowController> => {
    document.body.className = '';
    await settle();
    return mount(tabs);
  };

  it('is absent until something is unread, then shows only the non-zero rows', () => {
    expect(box()).toBeNull();
    receive(chat, 'party', 3);
    expect(box()?.parentElement?.id).toBe(CHAT_UNREAD_BOX_HOST_ID);
    expect(box()?.getAttribute('role')).toBe('group');
    expect(shownRows()).toEqual(['party=3']);
    receive(chat, 'whisper');
    // Whisper leads: it is the one addressed to the player.
    expect(shownRows()).toEqual(['whisper=1', 'party=3']);
    expect(countOf(head())).toBe('4');
    expect(head().textContent).toContain('Chat');
  });

  it('names every row for assistive tech, so a pill is never colour-only', () => {
    receive(chat, 'party', 3);
    receive(chat, 'whisper');
    expect(row('party').getAttribute('aria-label')).toBe('Party: 3');
    expect(row('whisper').getAttribute('aria-label')).toBe('Whisper: 1');
    expect(head().getAttribute('aria-label')).toBe('Chat: 4');
    expect(box()?.getAttribute('aria-label')).toBe('Chat');
    expect(row('party').textContent).toContain('Party');
    expect(row('party').style.getPropertyValue('--chat-unread-color')).toBe('#7fd4ff');
    expect(row('whisper').style.getPropertyValue('--chat-unread-color')).toBe('#ff80ff');
  });

  it('keeps the General row off by default and shows it once the player turns it on', () => {
    receive(chat, 'general', 12);
    // General alone never raises the box by default.
    expect(boxShown()).toBe(false);
    receive(chat, 'whisper');
    expect(shownRows()).toEqual(['whisper=1']);
    new Settings().set('chatUnreadBoxGeneral', true);
    // The lines that arrived while it was off are counted, not lost.
    expect(shownRows()).toEqual(['whisper=1', 'general=12']);
    expect(countOf(head())).toBe('13');
  });

  it('hides when the setting is off, and leaves the whisper badge on the controls', () => {
    receive(chat, 'whisper', 2);
    expect(boxShown()).toBe(true);
    new Settings().set('chatUnreadBox', false);
    expect(boxShown()).toBe(false);
    const badge = document.querySelector(`#mobile-menu-anchor > .${WHISPER_UNREAD_BADGE_CLASS}`);
    expect(badge?.textContent).toBe('2');
    new Settings().set('chatUnreadBox', true);
    expect(shownRows()).toEqual(['whisper=2']);
  });

  it('drives the box and the round badge from one counter', () => {
    receive(chat, 'whisper', 3);
    receive(chat, 'party', 5);
    const badge = (): string | null =>
      document.querySelector(`#mobile-menu-anchor > .${WHISPER_UNREAD_BADGE_CLASS}`)?.textContent ??
      null;
    expect(badge()).toBe('3');
    expect(countOf(row('whisper'))).toBe('3');
    // The badge stays whispers-only: party traffic never lights it.
    receive(chat, 'party', 5);
    expect(badge()).toBe('3');
  });

  it('caps a row at 99+', () => {
    receive(chat, 'party', 99);
    expect(countOf(row('party'))).toBe('99');
    receive(chat, 'party');
    expect(countOf(row('party'))).toBe('99+');
    expect(row('party').getAttribute('aria-label')).toBe('Party: 100');
  });

  it('ignores channels it does not track', () => {
    receive(chat, 'guild', 4);
    receive(chat, 'say', 4);
    receive(chat, 'world', 4);
    expect(box()).toBeNull();
  });

  it('hides once everything is read: opening chat on All clears all rows', async () => {
    new Settings().set('chatUnreadBoxGeneral', true);
    receive(chat, 'whisper');
    receive(chat, 'party', 3);
    receive(chat, 'general', 12);
    expect(shownRows()).toEqual(['whisper=1', 'party=3', 'general=12']);
    document.body.classList.add('mobile-chat-open');
    await settle();
    expect(boxShown()).toBe(false);
    document.body.classList.remove('mobile-chat-open');
    await settle();
    expect(boxShown()).toBe(false);
  });

  it('a row tap opens chat on that channel tab and clears only that row', async () => {
    chat = await remount(['party', 'whisper']);
    receive(chat, 'whisper', 2);
    receive(chat, 'party', 3);
    row('party').click();
    expect(activeTab()).toBe('party');
    expect(document.body.classList.contains('mobile-chat-open')).toBe(true);
    expect(shownRows()).toEqual(['whisper=2']);
    // The whisper is still waiting, so the badge on the controls stays lit.
    expect(
      document.querySelector(`#mobile-menu-anchor > .${WHISPER_UNREAD_BADGE_CLASS}`)?.textContent,
    ).toBe('2');
  });

  it('a whisper row tap lands on the Whisper tab when it is open', async () => {
    chat = await remount(['party', 'whisper']);
    receive(chat, 'whisper', 2);
    receive(chat, 'party', 3);
    row('whisper').click();
    expect(activeTab()).toBe('whisper');
    expect(shownRows()).toEqual(['party=3']);
  });

  it('a row tap falls back to All when that tab is not open, which reads everything', async () => {
    chat = await remount(['say']);
    receive(chat, 'whisper', 2);
    receive(chat, 'party', 3);
    row('whisper').click();
    expect(activeTab()).toBe('all');
    expect(document.body.classList.contains('mobile-chat-open')).toBe(true);
    expect(boxShown()).toBe(false);
  });

  it('a header tap opens chat on All even when the row tabs are open', async () => {
    chat = await remount(['party', 'whisper']);
    document.querySelector<HTMLElement>('#chatlog-tabs [data-tab="party"]')?.click();
    receive(chat, 'whisper', 2);
    head().click();
    expect(activeTab()).toBe('all');
    expect(document.body.classList.contains('mobile-chat-open')).toBe(true);
    expect(boxShown()).toBe(false);
  });

  it('never opens a second time over an already open chat', async () => {
    chat = await remount(['say', 'party']);
    document.querySelector<HTMLElement>('#chatlog-tabs [data-tab="say"]')?.click();
    document.body.classList.add('mobile-chat-open');
    await settle();
    receive(chat, 'party');
    row('party').click();
    // The opener toggles, so a second click would have closed the panel.
    expect(document.body.classList.contains('mobile-chat-open')).toBe(true);
    expect(activeTab()).toBe('party');
  });

  it('hands focus to the tab it opened when the activated row clears itself', async () => {
    chat = await remount(['party']);
    receive(chat, 'party', 2);
    row('party').focus();
    row('party').click();
    expect(boxShown()).toBe(false);
    const active = document.activeElement as HTMLElement | null;
    expect(active?.classList.contains('chat-tab')).toBe(true);
    expect(active?.dataset.tab).toBe('party');
  });

  it('names the group once: the header carries the total, the group only the title', () => {
    receive(chat, 'whisper', 2);
    expect(box()?.getAttribute('aria-label')).toBe('Chat');
    expect(head().getAttribute('aria-label')).toBe('Chat: 2');
  });

  it('repaints the box and the badge in the new language on a language switch', async () => {
    receive(chat, 'whisper', 12);
    receive(chat, 'party', 3);
    const badge = (): string | null =>
      document.querySelector(`#mobile-menu-anchor > .${WHISPER_UNREAD_BADGE_CLASS}`)?.textContent ??
      null;
    expect(row('party').getAttribute('aria-label')).toBe('Party: 3');
    expect(badge()).toBe('9+');
    await ensureLocaleLoaded('de_DE');
    setLanguage('de_DE');
    try {
      // Nothing repaints until the shell announces the switch.
      expect(row('party').getAttribute('aria-label')).toBe('Party: 3');
      document.dispatchEvent(new CustomEvent('woc:languagechange'));
      const party = t('hud.core.chatChannels.names.party');
      const whisper = t('hud.chat.context.whisper');
      const title = t('hud.core.mobileChat');
      expect(row('party').getAttribute('aria-label')).toBe(`${party}: 3`);
      expect(row('party').textContent).toContain(party);
      expect(row('whisper').getAttribute('aria-label')).toBe(`${whisper}: 12`);
      expect(head().getAttribute('aria-label')).toBe(`${title}: 15`);
      expect(box()?.getAttribute('aria-label')).toBe(title);
      expect(document.getElementById(WHISPER_UNREAD_DESC_ID)?.textContent).toBe(`${whisper}: 12`);
      // The switch must actually have changed something, or this proves nothing.
      expect([party, whisper, title]).not.toEqual(['Party', 'Whisper', 'Chat']);
    } finally {
      setLanguage('en');
      document.dispatchEvent(new CustomEvent('woc:languagechange'));
    }
    expect(row('party').getAttribute('aria-label')).toBe('Party: 3');
  });

  it('never shows on desktop', () => {
    document.body.classList.remove('mobile-touch');
    receive(chat, 'whisper', 2);
    receive(chat, 'party', 2);
    expect(box()).toBeNull();
  });

  it('stays out of a document with no Quick Actions seat', () => {
    document.getElementById(CHAT_UNREAD_BOX_HOST_ID)?.remove();
    receive(chat, 'whisper');
    expect(box()).toBeNull();
  });
});
