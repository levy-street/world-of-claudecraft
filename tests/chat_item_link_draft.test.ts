import { afterEach, describe, expect, it, vi } from 'vitest';
import { heroicVariantId } from '../src/sim/content/heroic_variants';
import { ITEMS } from '../src/sim/data';
import { setLanguage } from '../src/ui/i18n';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

describe('item links in a chat draft', () => {
  it('preserves distinct base and heroic item ids when their display names match', async () => {
    const input = {
      value: '',
      placeholder: '',
      style: { display: '' },
      focus: vi.fn(),
    };
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => (selector === '#chat-input' ? input : null)),
    });

    const { Hud } = await import('../src/ui/hud');
    const hud = Object.create(Hud.prototype) as InstanceType<typeof Hud>;
    const draftHud = hud as unknown as {
      pendingChatLinks: Map<string, string>;
      activeChatTab: string;
      stickyChannel: string;
      activeChatPlaceholder: () => string;
    };
    draftHud.pendingChatLinks = new Map();
    draftHud.activeChatTab = 'all';
    // The All tab falls back to the sticky send channel; say is the neutral default
    // (a bare Object.create instance skips the field initializer, so set it here).
    draftHud.stickyChannel = 'say';
    draftHud.activeChatPlaceholder = () => 'Chat';

    setLanguage('en');
    const baseId = 'moonshroud_robe';
    const heroicId = heroicVariantId(baseId);
    expect(ITEMS[heroicId].name).toBe(ITEMS[baseId].name);

    hud.insertItemChatLink(baseId);
    hud.insertItemChatLink(heroicId);

    expect(input.value).toBe('[Moonwrack Robe] [Moonwrack Robe]');
    expect(hud.composeChatSend(input.value)).toBe(`/say [[i:${baseId}]] [[i:${heroicId}]]`);
  }, 15_000);
});
