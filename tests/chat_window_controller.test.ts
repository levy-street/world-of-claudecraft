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
});
