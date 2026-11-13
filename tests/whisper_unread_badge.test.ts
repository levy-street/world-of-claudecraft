// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ChatContextMenuPort,
  ChatWindowController,
} from '../src/ui/hud/chat/chat_window_controller';
import {
  WHISPER_UNREAD_BADGE_CLASS,
  WHISPER_UNREAD_DESC_ID,
  WHISPER_UNREAD_HOST_CLASS,
  WHISPER_UNREAD_HOST_IDS,
} from '../src/ui/hud/chat/whisper_unread_badge';

// The real ChatWindowController over a jsdom document carrying the three touch
// controls that lead to chat. `noteChatReceived('whisper')` is the call hud.ts
// makes from its received-whisper branch (pinned in whisper_unread_core.test.ts).

function mount(tabs: string[] = []): ChatWindowController {
  document.body.className = '';
  document.body.innerHTML = `
    <button id="mobile-menu-anchor" aria-label="Quick Actions"></button>
    <button id="mobile-menu-chat" class="mobile-menu-item" aria-label="Open Chat"></button>
    <button id="mobile-chat" class="mobile-btn" aria-label="Open Chat"></button>
    <div id="chatlog-tabs"></div>
    <textarea id="chat-input"></textarea>
    <div id="chatlog"></div>
    <div id="combatlog"></div>
    <div id="ctx-menu"></div>`;
  const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
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
  return controller;
}

const badgeOn = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#${id} > .${WHISPER_UNREAD_BADGE_CLASS}`);
const badgeTexts = (): (string | null)[] =>
  WHISPER_UNREAD_HOST_IDS.map((id) => badgeOn(id)?.textContent ?? null);
const tab = (id: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(
    `#chatlog-tabs [data-tab="${id}"]`,
  ) as HTMLButtonElement;
/** Let the body-class MutationObserver deliver. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('unread chat badge on the touch chat controls', () => {
  let chat: ChatWindowController;
  beforeEach(() => {
    chat = mount();
    document.body.classList.add('mobile-touch');
  });

  it('badges every control that leads to chat when a whisper arrives with chat closed', () => {
    expect(badgeTexts()).toEqual([null, null, null]);
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual(['1', '1', '1']);
    for (const id of WHISPER_UNREAD_HOST_IDS) {
      const host = document.getElementById(id) as HTMLElement;
      expect(host.classList.contains(WHISPER_UNREAD_HOST_CLASS)).toBe(true);
      expect(badgeOn(id)?.classList.contains('ui-badge--corner')).toBe(true);
      expect(badgeOn(id)?.getAttribute('aria-hidden')).toBe('true');
      expect(badgeOn(id)?.style.getPropertyValue('--whisper-unread-color')).toBe('#ff80ff');
    }
  });

  it('increments per whisper and caps the text at 9+', () => {
    chat.noteChatReceived('whisper');
    chat.noteChatReceived('whisper');
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual(['3', '3', '3']);
    for (let i = 0; i < 9; i++) chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual(['9+', '9+', '9+']);
    // One badge per control, however many whispers arrived.
    expect(document.querySelectorAll(`.${WHISPER_UNREAD_BADGE_CLASS}`)).toHaveLength(3);
  });

  it('describes the count to assistive tech without touching the accessible names', () => {
    chat.noteChatReceived('whisper');
    chat.noteChatReceived('whisper');
    const description = document.getElementById(WHISPER_UNREAD_DESC_ID);
    expect(description?.hidden).toBe(true);
    expect(description?.textContent).toBe('Whisper: 2');
    for (const id of WHISPER_UNREAD_HOST_IDS) {
      expect(document.getElementById(id)?.getAttribute('aria-describedby')).toBe(
        WHISPER_UNREAD_DESC_ID,
      );
    }
    expect(document.getElementById('mobile-menu-anchor')?.getAttribute('aria-label')).toBe(
      'Quick Actions',
    );
    expect(document.getElementById('mobile-chat')?.getAttribute('aria-label')).toBe('Open Chat');
  });

  it('clears everything once chat opens on the All tab', async () => {
    chat.noteChatReceived('whisper');
    chat.noteChatReceived('whisper');
    document.body.classList.add('mobile-chat-open');
    await settle();
    expect(badgeTexts()).toEqual([null, null, null]);
    expect(document.getElementById(WHISPER_UNREAD_DESC_ID)).toBeNull();
    for (const id of WHISPER_UNREAD_HOST_IDS) {
      const host = document.getElementById(id) as HTMLElement;
      expect(host.classList.contains(WHISPER_UNREAD_HOST_CLASS)).toBe(false);
      expect(host.hasAttribute('aria-describedby')).toBe(false);
    }
  });

  it('also clears on the read-only log peek', async () => {
    chat.noteChatReceived('whisper');
    document.body.classList.add('mobile-chatlog-peek');
    await settle();
    expect(badgeTexts()).toEqual([null, null, null]);
  });

  it('does not badge a whisper that lands in an open All log', async () => {
    document.body.classList.add('mobile-chat-open');
    await settle();
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual([null, null, null]);
  });

  it('stays lit while chat is open on a tab that hides whispers, until one that shows them', async () => {
    chat = mount(['say', 'whisper']);
    document.body.classList.add('mobile-touch');
    tab('say').click();
    document.body.classList.add('mobile-chat-open');
    await settle();
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual(['1', '1', '1']);
    // Closing and reopening on Say still shows nothing of the whisper.
    document.body.classList.remove('mobile-chat-open');
    await settle();
    document.body.classList.add('mobile-chat-open');
    await settle();
    expect(badgeTexts()).toEqual(['1', '1', '1']);
    tab('whisper').click();
    expect(badgeTexts()).toEqual([null, null, null]);
  });

  it('keeps counting behind a closed panel left on the Whisper tab', () => {
    chat = mount(['whisper']);
    document.body.classList.add('mobile-touch');
    tab('whisper').click();
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual(['1', '1', '1']);
  });

  it('lights for party chat too, in the party colour', () => {
    chat.noteChatReceived('party');
    chat.noteChatReceived('party');
    expect(badgeTexts()).toEqual(['2', '2', '2']);
    for (const id of WHISPER_UNREAD_HOST_IDS) {
      expect(badgeOn(id)?.style.getPropertyValue('--whisper-unread-color')).toBe('#7fd4ff');
    }
    expect(document.getElementById(WHISPER_UNREAD_DESC_ID)?.textContent).toBe('Party: 2');
  });

  it('shows whispers plus party as one count, pink while a whisper is unread', async () => {
    chat = mount(['whisper', 'party']);
    document.body.classList.add('mobile-touch');
    chat.noteChatReceived('party');
    chat.noteChatReceived('party');
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual(['3', '3', '3']);
    expect(badgeOn('mobile-menu-anchor')?.style.getPropertyValue('--whisper-unread-color')).toBe(
      '#ff80ff',
    );
    expect(document.getElementById(WHISPER_UNREAD_DESC_ID)?.textContent).toBe(
      'Whisper: 1 and Party: 2',
    );
    // Reading the whispers leaves the party lines waiting, now in party blue.
    tab('whisper').click();
    document.body.classList.add('mobile-chat-open');
    await settle();
    expect(badgeTexts()).toEqual(['2', '2', '2']);
    expect(badgeOn('mobile-menu-anchor')?.style.getPropertyValue('--whisper-unread-color')).toBe(
      '#7fd4ff',
    );
    tab('party').click();
    expect(badgeTexts()).toEqual([null, null, null]);
  });

  it('never lights for General, Say or any other channel', () => {
    for (const channel of ['general', 'say', 'yell', 'world', 'lfg', 'guild', 'officer']) {
      chat.noteChatReceived(channel);
    }
    expect(badgeTexts()).toEqual([null, null, null]);
  });

  it('never badges on desktop', () => {
    document.body.classList.remove('mobile-touch');
    chat.noteChatReceived('whisper');
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual([null, null, null]);
    expect(document.querySelector(`.${WHISPER_UNREAD_BADGE_CLASS}`)).toBeNull();
  });

  it('skips a control the build does not ship', () => {
    document.getElementById('mobile-chat')?.remove();
    chat.noteChatReceived('whisper');
    expect(badgeTexts()).toEqual(['1', '1', null]);
  });
});
