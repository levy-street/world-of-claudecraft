import { describe, expect, it } from 'vitest';
import {
  type ChatContextMenuPort,
  ChatWindowController,
} from '../src/ui/hud/chat/chat_window_controller';
import { FakeDocument, type FakeElement } from './helpers/fake_dom';

class MemoryStorage {
  readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

interface Harness {
  controller: ChatWindowController;
  document: FakeDocument;
  input: FakeElement;
  chatLog: FakeElement;
  combatLog: FakeElement;
  storage: MemoryStorage;
  sent: string[];
  errors: string[];
}

function makeHarness(
  initialStorage: Record<string, string> = {},
  selectedQuest: string | null = null,
): Harness {
  const document = new FakeDocument();
  const tabs = document.element('chatlog-tabs');
  tabs.clientWidth = 400;
  const input = document.element('chat-input', 'input');
  const chatLog = document.element('chatlog');
  const combatLog = document.element('combatlog');
  const menu = document.element('ctx-menu');
  const storage = new MemoryStorage(initialStorage);
  const sent: string[] = [];
  const errors: string[] = [];
  let opener: HTMLElement | null = null;
  const contextMenu: ChatContextMenuPort = {
    element: menu as unknown as HTMLElement,
    opener: () => opener,
    setOpener: (next) => {
      opener = next;
    },
    close: () => {
      menu.style.display = 'none';
      opener = null;
    },
    place: () => {},
    bind: () => {},
  };
  const controller = new ChatWindowController({
    document: document as unknown as Document,
    storage,
    chatLog: chatLog as unknown as HTMLElement,
    combatLog: combatLog as unknown as HTMLElement,
    contextMenu,
    sendChat: (line) => sent.push(line),
    isMobileLayout: () => false,
    itemDisplayName: (itemId) => (itemId === 'sword' ? 'Iron Sword' : null),
    questTitle: (questId) => (questId === 'q_wolves' ? 'Thin the Pack' : questId),
    selectedQuestId: () => selectedQuest,
    hasQuest: (questId) => questId === 'q_wolves',
    showError: (text) => errors.push(text),
  });
  return { controller, document, input, chatLog, combatLog, storage, sent, errors };
}

describe('ChatWindowController', () => {
  it('restores tabs once, rejoins opt-in channels, and applies the active filter', () => {
    const harness = makeHarness({
      woc_chat_tabs: '["world","lfg","party"]',
      woc_chat_active_tab: 'world',
    });
    const worldLine = harness.document.createElement('div');
    worldLine.dataset.chan = 'world';
    const partyLine = harness.document.createElement('div');
    partyLine.dataset.chan = 'party';
    harness.chatLog.append(worldLine, partyLine);

    harness.controller.init();
    harness.controller.init();

    expect(harness.sent).toEqual(['/join world', '/join lfg']);
    expect(worldLine.classList.contains('chat-hidden')).toBe(false);
    expect(partyLine.classList.contains('chat-hidden')).toBe(true);
    expect(harness.chatLog.classList.contains('active')).toBe(true);
    expect(harness.combatLog.classList.contains('active')).toBe(false);
    expect(harness.controller.composeSend('need one tank')).toBe('/world need one tank');
    expect(harness.input.style.color).toBe('#ff9d5c');
  });

  it('mirrors typed joins without sending a duplicate command or changing the send tab', () => {
    const harness = makeHarness();
    harness.controller.init();

    harness.controller.syncTabsForInput('/join world');

    expect(harness.sent).toEqual([]);
    expect(harness.storage.getItem('woc_chat_tabs')).toBe('["world"]');
    expect(harness.controller.composeSend('hello')).toBe('/say hello');
  });

  it('converts inserted quest and item labels once, then clears the draft mapping', () => {
    const harness = makeHarness();
    harness.controller.init();
    harness.controller.insertQuestLink('q_wolves');
    harness.controller.insertItemLink('sword');
    harness.controller.insertItemLink('missing');

    expect(harness.input.value).toBe('[Thin the Pack] [Iron Sword]');
    expect(harness.input.focused).toBe(true);
    expect(harness.controller.composeSend(harness.input.value)).toBe(
      '/say [[q:q_wolves]] [[i:sword]]',
    );
    expect(harness.controller.composeSend('[Thin the Pack]')).toBe('/say [Thin the Pack]');
  });

  it('handles quest sharing through the injected authoritative quest state', () => {
    const missing = makeHarness();
    missing.controller.init();
    expect(missing.controller.maybeHandleQuestShareCommand('/share')).toBe(true);
    expect(missing.sent).toEqual([]);
    expect(missing.errors).toHaveLength(1);

    const selected = makeHarness({}, 'q_wolves');
    selected.controller.init();
    expect(selected.controller.maybeHandleQuestShareCommand('/share now')).toBe(true);
    expect(selected.sent).toEqual(['/p [[q:q_wolves]]']);
    expect(selected.controller.maybeHandleQuestShareCommand('/party hello')).toBe(false);
  });

  it('composes plain text as a reply on a restored whisper tab', () => {
    const harness = makeHarness({
      woc_chat_tabs: '["whisper"]',
      woc_chat_active_tab: 'whisper',
    });
    harness.controller.init();

    expect(harness.controller.composeSend('ready')).toBe('/r ready');
    expect(harness.input.style.color).toBe('#ff80ff');
  });

  const sysToggle = (harness: Harness): FakeElement => {
    const bar = harness.document.getElementById('chatlog-tabs');
    if (!bar) throw new Error('tab strip missing');
    const button = bar.querySelector('.chat-tab-sysfilter') as unknown as FakeElement | null;
    if (!button) throw new Error('system-filter toggle missing');
    return button;
  };

  it('starts the system-filter toggle pressed and hides system lines when persisted on', () => {
    const harness = makeHarness({ woc_chat_hide_system: '1' });
    const chatLine = harness.document.createElement('div');
    chatLine.dataset.chan = 'say';
    const systemLine = harness.document.createElement('div');
    systemLine.dataset.chan = 'system';
    harness.chatLog.append(chatLine, systemLine);

    harness.controller.init();

    expect(sysToggle(harness).getAttribute('aria-pressed')).toBe('true');
    expect(chatLine.classList.contains('chat-hidden')).toBe(false);
    expect(systemLine.classList.contains('chat-hidden')).toBe(true);
  });

  it('defaults the system-filter toggle to off, showing system lines, when nothing is persisted', () => {
    const harness = makeHarness();
    const systemLine = harness.document.createElement('div');
    systemLine.dataset.chan = 'system';
    harness.chatLog.append(systemLine);

    harness.controller.init();

    expect(sysToggle(harness).getAttribute('aria-pressed')).toBe('false');
    expect(systemLine.classList.contains('chat-hidden')).toBe(false);
  });

  it('flips, persists, and re-applies the filter to existing lines when the toggle is clicked', () => {
    const harness = makeHarness();
    const systemLine = harness.document.createElement('div');
    systemLine.dataset.chan = 'system';
    harness.chatLog.append(systemLine);
    harness.controller.init();
    const button = sysToggle(harness);

    button.dispatchEvent(new Event('click'));

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(harness.storage.getItem('woc_chat_hide_system')).toBe('1');
    expect(systemLine.classList.contains('chat-hidden')).toBe(true);

    button.dispatchEvent(new Event('click'));

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(harness.storage.getItem('woc_chat_hide_system')).toBe('0');
    expect(systemLine.classList.contains('chat-hidden')).toBe(false);
  });

  it('hides the toggle off the All view yet keeps it a control, never a selectable tab', () => {
    const harness = makeHarness({
      woc_chat_tabs: '["world"]',
      woc_chat_active_tab: 'all',
    });
    harness.controller.init();
    const button = sysToggle(harness);

    // On the All view: visible, and it never takes tab-selection state.
    expect(button.classList.contains('chat-tab-sysfilter-hidden')).toBe(false);
    expect(button.getAttribute('aria-selected')).toBe(null);
    expect(button.tabIndex).toBe(0);

    // Switch to a channel tab: the toggle hides (its effect is All-only) but stays a control.
    const bar = harness.document.getElementById('chatlog-tabs');
    if (!bar) throw new Error('tab strip missing');
    const worldTab = bar
      .querySelectorAll('.chat-tab')
      .map((element) => element as unknown as FakeElement)
      .find((element) => element.dataset.tab === 'world');
    if (!worldTab) throw new Error('world tab missing');
    worldTab.dispatchEvent(new Event('click'));

    expect(button.classList.contains('chat-tab-sysfilter-hidden')).toBe(true);
    expect(button.getAttribute('aria-selected')).toBe(null);
    expect(button.tabIndex).toBe(0);
  });

  it('keeps the toggle hidden through a tab-strip re-render on a channel tab', () => {
    // A typed "/join" adds a tab via addTab(select: false), which re-renders the
    // strip without a selectTab call. renderTabs() must still leave the toggle
    // hidden while a channel tab is active (it ends with updateActiveTabStyles),
    // so the toggle never resurfaces on a non-All view after the rebuild.
    const harness = makeHarness({
      woc_chat_tabs: '["world"]',
      woc_chat_active_tab: 'world',
    });
    harness.controller.init();
    expect(sysToggle(harness).classList.contains('chat-tab-sysfilter-hidden')).toBe(true);

    harness.controller.syncTabsForInput('/join lfg');

    // The rebuilt strip has the new tab and the toggle is still hidden (world active).
    expect(harness.storage.getItem('woc_chat_tabs')).toBe('["world","lfg"]');
    expect(sysToggle(harness).classList.contains('chat-tab-sysfilter-hidden')).toBe(true);
  });
});
