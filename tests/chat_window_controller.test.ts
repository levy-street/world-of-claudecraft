import { readFileSync } from 'node:fs';
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

function keydown(key: string, altKey = false): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  Object.defineProperty(event, 'altKey', { value: altKey });
  return event;
}

function dragEvent(type: string): Event {
  return new Event(type, { cancelable: true });
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
  isMobileLayout = false,
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
    isMobileLayout: () => isMobileLayout,
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

function tabsBar(harness: Harness): FakeElement {
  const bar = harness.document.getElementById('chatlog-tabs');
  if (!bar) throw new Error('missing #chatlog-tabs');
  return bar;
}

function tabButton(harness: Harness, id: string): FakeElement {
  const button = tabsBar(harness).children.find((child) => child.dataset.tab === id);
  if (!button) throw new Error(`no tab button for ${id}`);
  return button;
}

function addButton(harness: Harness): FakeElement {
  const button = tabsBar(harness).children.find((child) =>
    child.classList.contains('chat-tab-add'),
  );
  if (!button) throw new Error('no "+" add button');
  return button;
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

  // Issue #1365: chat tabs can be dragged to reorder, and the order persists.
  it('drops the /bg send-stickiness when the match ends, so plain text goes to say', () => {
    // Review catch: the server clears its own remembered channel on bgEnd, but
    // the HUD composes a plain line through ITS sticky before anything is sent.
    // Without the client half, the first plain line after every match is still
    // composed as "/bg ..." and comes back refused.
    const harness = makeHarness();
    harness.controller.init();

    harness.controller.noteSentChannel('/bg incoming mid', false);
    expect(harness.controller.composeSend('on my way'), 'the sticky is live').toBe('/bg on my way');

    harness.controller.clearBattlegroundSticky();

    // Composed for SAY (the explicit prefix is how this controller spells the
    // default), which is the point: it reaches say instead of being refused by a
    // battleground the player already left.
    expect(harness.controller.composeSend('on my way'), 'plain text falls back to say').toBe(
      '/say on my way',
    );
  });

  it('is actually WIRED to the bgEnd arm, not just callable', () => {
    // The two cases above drive the method directly, so they would both stay
    // green if the hud stopped calling it: they pin the behavior, not the hookup.
    // This reads the source instead, which is the same shape the repo already
    // uses for hud wiring it cannot reach from a unit test. It proves the call
    // EXISTS inside the bgEnd arm; it cannot prove the arm runs, which the sim
    // suite covers by asserting bgEnd is emitted.
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const arm = hud.slice(hud.indexOf("case 'bgEnd': {"));
    const armEnd = arm.indexOf("case '");
    expect(
      arm.slice(0, armEnd > 0 ? armEnd : 4000),
      'the bgEnd arm must clear the battleground send-stickiness',
    ).toContain('clearBattlegroundSticky()');
  });

  it('leaves a NON-battleground sticky alone when a match ends', () => {
    // The reset is scoped: a player who was last talking in party or guild keeps
    // that sticky across a battleground ending they were not chatting in.
    const harness = makeHarness();
    harness.controller.init();
    harness.controller.noteSentChannel('/p pulling now', false);
    harness.controller.clearBattlegroundSticky();
    expect(harness.controller.composeSend('pulling now')).toBe('/p pulling now');
  });

  describe('tab reordering (issue #1365)', () => {
    it('drags a channel tab onto a sibling to reorder it, and persists the new order', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild","party"]' });
      harness.controller.init();

      tabButton(harness, 'world').dispatchEvent(dragEvent('dragstart'));
      tabButton(harness, 'party').dispatchEvent(dragEvent('dragover'));
      tabButton(harness, 'party').dispatchEvent(dragEvent('drop'));
      tabButton(harness, 'world').dispatchEvent(dragEvent('dragend'));

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["guild","world","party"]');
      const order = tabsBar(harness)
        .children.filter((child) => child.dataset.tab)
        .map((child) => child.dataset.tab);
      expect(order).toEqual(['all', 'combat', 'guild', 'world', 'party']);
      // The dragged tab keeps keyboard focus after the strip rebuilds.
      expect(tabButton(harness, 'world').focused).toBe(true);
    });

    it('drags a channel tab onto the "+" add button to move it to the end', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild","party"]' });
      harness.controller.init();

      tabButton(harness, 'world').dispatchEvent(dragEvent('dragstart'));
      addButton(harness).dispatchEvent(dragEvent('dragover'));
      addButton(harness).dispatchEvent(dragEvent('drop'));

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["guild","party","world"]');
    });

    it('a stray drop on "+" with no drag in progress leaves the tab order untouched', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      addButton(harness).dispatchEvent(dragEvent('drop'));

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["world","guild"]');
    });

    it('reorders a channel tab with Alt+ArrowRight, the non-drag accessible path, and persists it', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      tabButton(harness, 'world').dispatchEvent(keydown('ArrowRight', true));

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["guild","world"]');
      expect(tabButton(harness, 'world').focused).toBe(true);
    });

    it('Alt+ArrowLeft at the leftmost channel tab is a no-op that leaves the keystroke unconsumed', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      const event = keydown('ArrowLeft', true);
      tabButton(harness, 'world').dispatchEvent(event);

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["world","guild"]');
      // Not consumed: the browser's own Alt+Left back-navigation is left alone.
      expect(event.defaultPrevented).toBe(false);
    });

    it('Alt+Arrow on All/Combat never reorders (they are not channel tabs)', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      const event = keydown('ArrowRight', true);
      tabButton(harness, 'all').dispatchEvent(event);

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["world","guild"]');
      expect(event.defaultPrevented).toBe(false);
    });

    it('plain ArrowRight roves keyboard focus across the tablist without activating a tab', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world"]' });
      harness.controller.init();

      tabButton(harness, 'all').dispatchEvent(keydown('ArrowRight'));

      expect(tabButton(harness, 'combat').focused).toBe(true);
      expect(tabButton(harness, 'combat').tabIndex).toBe(0);
      expect(tabButton(harness, 'all').tabIndex).toBe(-1);
      // Roving focus never activates a tab: still showing the All view.
      expect(harness.chatLog.classList.contains('active')).toBe(true);
      expect(harness.combatLog.classList.contains('active')).toBe(false);
    });

    it('wraps roving focus from the last tab back to the first (and vice versa)', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world"]' });
      harness.controller.init();

      tabButton(harness, 'world').dispatchEvent(keydown('ArrowRight'));
      expect(tabButton(harness, 'all').focused).toBe(true);

      tabButton(harness, 'all').dispatchEvent(keydown('ArrowLeft'));
      expect(tabButton(harness, 'world').focused).toBe(true);
    });

    it('roving ArrowRight then Alt+ArrowLeft reorders an inactive channel tab reached only by keyboard', () => {
      // This is the exact accessibility gap a plain "only the active tab is
      // reachable" implementation would have: without roving nav, a keyboard
      // user starting on All could never Tab onto an inactive channel tab to
      // reorder it with Alt+Arrow.
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      tabButton(harness, 'all').dispatchEvent(keydown('ArrowRight'));
      tabButton(harness, 'combat').dispatchEvent(keydown('ArrowRight'));
      expect(tabButton(harness, 'world').tabIndex).toBe(0);

      // "world" sits first in chatTabs; Alt+ArrowRight swaps it past "guild".
      tabButton(harness, 'world').dispatchEvent(keydown('ArrowRight', true));

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["guild","world"]');
      // Reordering via keyboard never changes which view is active.
      expect(harness.chatLog.classList.contains('active')).toBe(true);
    });

    it('clears the roving focus target when its tab closes, falling back to the active tab', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      tabButton(harness, 'all').dispatchEvent(keydown('ArrowRight'));
      tabButton(harness, 'combat').dispatchEvent(keydown('ArrowRight'));
      expect(tabButton(harness, 'world').tabIndex).toBe(0);

      tabButton(harness, 'world').dispatchEvent(new Event('contextmenu', { cancelable: true }));

      expect(harness.storage.getItem('woc_chat_tabs')).toBe('["guild"]');
      expect(tabButton(harness, 'all').tabIndex).toBe(0);
    });

    it('clicking a tab re-latches the roving tabindex to it, even after roving elsewhere', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      // Rove onto "world" without activating it (the roving target and the
      // active tab now disagree).
      tabButton(harness, 'all').dispatchEvent(keydown('ArrowRight'));
      tabButton(harness, 'combat').dispatchEvent(keydown('ArrowRight'));
      expect(tabButton(harness, 'world').tabIndex).toBe(0);

      tabButton(harness, 'guild').dispatchEvent(new Event('click'));

      expect(tabButton(harness, 'guild').tabIndex).toBe(0);
      expect(tabButton(harness, 'world').tabIndex).toBe(-1);
    });

    it('shows drag-visual classes during a drag and clears them on drop and on dragend', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world","guild"]' });
      harness.controller.init();

      const source = tabButton(harness, 'world');
      source.dispatchEvent(dragEvent('dragstart'));
      expect(source.classList.contains('chat-tab-dragging')).toBe(true);

      const target = tabButton(harness, 'guild');
      target.dispatchEvent(dragEvent('dragover'));
      expect(target.classList.contains('drop-target')).toBe(true);

      target.dispatchEvent(dragEvent('dragleave'));
      expect(target.classList.contains('drop-target')).toBe(false);

      // Dropping "world" back onto itself is a no-op reorder (reorderChatTabs
      // returns the same array), so dropDraggingTab returns before renderTabs()
      // would otherwise wipe the drag-visual classes via its rebuild; dragend's
      // explicit cleanup is what clears them here.
      source.dispatchEvent(dragEvent('dragover'));
      expect(source.classList.contains('drop-target')).toBe(true);
      source.dispatchEvent(dragEvent('drop'));
      source.dispatchEvent(dragEvent('dragend'));

      expect(tabButton(harness, 'world').classList.contains('chat-tab-dragging')).toBe(false);
      expect(tabButton(harness, 'world').classList.contains('drop-target')).toBe(false);
    });

    it('channel tabs are not draggable on mobile layout, where drag would fight swipe-to-scroll', () => {
      const harness = makeHarness({ woc_chat_tabs: '["world"]' }, null, true);
      harness.controller.init();

      expect(tabButton(harness, 'world').draggable).toBe(false);
    });
  });
});
