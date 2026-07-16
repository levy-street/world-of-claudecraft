import { afterEach, describe, expect, it } from 'vitest';
import { heroicVariantId } from '../src/sim/content/heroic_variants';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import type { ChatContextMenuPort } from '../src/ui/hud/chat/chat_window_controller';
import { ChatWindowController } from '../src/ui/hud/chat/chat_window_controller';
import { setLanguage } from '../src/ui/i18n';
import { FakeDocument } from './helpers/fake_dom';

afterEach(() => {
  setLanguage('en');
});

describe('item links in a chat draft', () => {
  it('preserves distinct base and heroic item ids when their display names match', () => {
    const document = new FakeDocument();
    document.element('chatlog-tabs');
    const input = document.element('chat-input', 'input');
    const chatLog = document.element('chatlog');
    const combatLog = document.element('combatlog');
    const menu = document.element('ctx-menu');
    const contextMenu: ChatContextMenuPort = {
      element: menu as unknown as HTMLElement,
      opener: () => null,
      setOpener: () => {},
      close: () => {},
      place: () => {},
      bind: () => {},
    };
    const controller = new ChatWindowController({
      document: document as unknown as Document,
      storage: { getItem: () => null, setItem: () => {} },
      chatLog: chatLog as unknown as HTMLElement,
      combatLog: combatLog as unknown as HTMLElement,
      contextMenu,
      sendChat: () => {},
      isMobileLayout: () => false,
      itemDisplayName: (itemId) => {
        const item = ITEMS[itemId];
        return item ? itemDisplayName(item) : null;
      },
      questTitle: (questId) => questId,
      selectedQuestId: () => null,
      hasQuest: () => false,
      showError: () => {},
    });
    controller.init();

    setLanguage('en');
    const baseId = 'moonshroud_robe';
    const heroicId = heroicVariantId(baseId);
    expect(ITEMS[heroicId].name).toBe(ITEMS[baseId].name);

    controller.insertItemLink(baseId);
    controller.insertItemLink(heroicId);

    expect(input.value).toBe('[Moonwrack Robe] [Moonwrack Robe]');
    expect(controller.composeSend(input.value)).toBe(`/say [[i:${baseId}]] [[i:${heroicId}]]`);
  }, 15_000);
});
