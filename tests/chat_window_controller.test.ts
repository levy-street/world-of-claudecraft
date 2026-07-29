import { describe, expect, it } from 'vitest';
import {
  type ChatContextMenuPort,
  ChatWindowController,
} from '../src/ui/hud/chat/chat_window_controller';
import { t } from '../src/ui/i18n';
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

// An item and a quest the client can name but the chat-link parser cannot
// encode (its charset is [A-Za-z0-9_]+). No shipped content id looks like this;
// the day one does, these are what keeps it from reaching chat as raw source.
const ODD_ITEM_ID = 'qa-test.item';
const ODD_QUEST_ID = 'q-odd.quest';

const ITEM_NAMES: Record<string, string> = {
  sword: 'Iron Sword',
  [ODD_ITEM_ID]: 'Odd Relic',
};

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
    // ODD_ITEM_ID / ODD_QUEST_ID resolve like any other content record: they are
    // in the tables and they have names. The ONLY thing wrong with them is the
    // charset, which is exactly the case #2459 is about.
    itemDisplayName: (itemId) => ITEM_NAMES[itemId] ?? null,
    questTitle: (questId) => (questId === 'q_wolves' ? 'Thin the Pack' : questId),
    selectedQuestId: () => selectedQuest,
    hasQuest: (questId) => questId === 'q_wolves' || questId === ODD_QUEST_ID,
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

  // #2459: three encode sites used to mint a token from an id the chat parser
  // cannot match. Such a token is not dropped by parseChatSegments, it survives
  // as a text segment, so the player and every recipient read the literal
  // "[[i:...]]" source instead of a link.
  it('drops a shift-click item link rather than drafting a token the parser will not match', () => {
    const harness = makeHarness();
    harness.controller.init();

    harness.controller.insertItemLink(ODD_ITEM_ID);

    // Nothing drafted at all: no label, and no pending mapping left behind that
    // a later send could splice in. The label assertion has to come FIRST,
    // because applyPendingLinks drains the queue on its first non-empty call, so
    // a composeSend of unrelated text ahead of it would empty the very thing
    // this is trying to observe.
    expect(harness.input.value).toBe('');
    expect(harness.controller.composeSend('[Odd Relic]')).not.toContain('[[i:');
    expect(harness.controller.composeSend('look at this')).toBe('/say look at this');
  });

  it('still drafts the linkable stacks around a dropped one', () => {
    // The guard must be per-link, not a latch that poisons the rest of the draft.
    const harness = makeHarness();
    harness.controller.init();

    harness.controller.insertItemLink('sword');
    harness.controller.insertItemLink(ODD_ITEM_ID);
    harness.controller.insertItemLink('sword');

    expect(harness.input.value).toBe('[Iron Sword] [Iron Sword]');
    expect(harness.controller.composeSend(harness.input.value)).toBe(
      '/say [[i:sword]] [[i:sword]]',
    );
  });

  it('drops a questlog shift-click link on an unlinkable quest id', () => {
    const harness = makeHarness();
    harness.controller.init();

    harness.controller.insertQuestLink(ODD_QUEST_ID);

    expect(harness.input.value).toBe('');
    expect(harness.controller.composeSend(`[${ODD_QUEST_ID}]`)).not.toContain('[[q:');
  });

  it('refuses /share for an unlinkable quest id and says why, rather than sending raw text', () => {
    const harness = makeHarness({}, ODD_QUEST_ID);
    harness.controller.init();

    // The command is still consumed (it is a /share), but nothing goes out.
    expect(harness.controller.maybeHandleQuestShareCommand('/share')).toBe(true);
    expect(harness.sent).toEqual([]);
    // Which string, spelled out: "can't be shared" is the truthful outcome, and
    // the sibling "select a quest" copy would be a lie here (one IS selected and
    // hasQuest already returned true for it).
    expect(harness.errors).toEqual([t('hudChrome.questShare.notShareable')]);
    expect(harness.errors[0]).not.toBe(t('hudChrome.questShare.noQuestSelected'));
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
