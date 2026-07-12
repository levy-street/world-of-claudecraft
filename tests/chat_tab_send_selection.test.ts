import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat tab send selection', () => {
  it('routes plain text through each tab selected by the HUD', async () => {
    const classList = { toggle: vi.fn() };
    const tabList = { querySelectorAll: vi.fn(() => []) };
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => (selector === '#chatlog-tabs' ? tabList : null)),
      getElementById: vi.fn(() => null),
    });

    const { Hud } = await import('../src/ui/hud');
    const hud = Object.create(Hud.prototype) as InstanceType<typeof Hud>;
    const state = hud as unknown as {
      activeChatTab: string;
      pendingChatLinks: Array<{ display: string; token: string }>;
      chatLogEl: {
        children: never[];
        classList: typeof classList;
        scrollTop: number;
        scrollHeight: number;
      };
      combatLogEl: { classList: typeof classList };
      selectChatTab: (tab: string, persist: boolean) => void;
    };
    state.activeChatTab = 'party';
    state.pendingChatLinks = [];
    state.chatLogEl = { children: [], classList, scrollTop: 0, scrollHeight: 0 };
    state.combatLogEl = { classList };

    state.selectChatTab('party', false);
    expect(hud.composeChatSend('pull on 3')).toBe('/p pull on 3');

    state.selectChatTab('world', false);
    expect(hud.composeChatSend('need one healer')).toBe('/world need one healer');

    state.selectChatTab('all', false);
    expect(hud.composeChatSend('back in chat')).toBe('/s back in chat');
  }, 15_000);

  it('selects a channel opened from the add-tab menu', () => {
    const source = fs.readFileSync('src/ui/hud.ts', 'utf8');
    expect(source).toMatch(/else this\.addChatTab\(act, \{ select: true \}\);/);
  });
});
