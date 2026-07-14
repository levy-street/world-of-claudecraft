import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

describe('Hud to ClientWorld chat seam', () => {
  it('sends an explicit /say command when the Hud presents the neutral Say channel', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const hud = Object.create(Hud.prototype) as InstanceType<typeof Hud>;
    const state = hud as unknown as {
      activeChatTab: string;
      stickyChannel: string;
      pendingChatLinks: readonly unknown[];
      chatInputTintTarget(): string;
    };
    state.activeChatTab = 'all';
    state.stickyChannel = 'say';
    state.pendingChatLinks = [];

    const sent: unknown[] = [];
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    Object.assign(client as unknown as Record<string, unknown>, {
      connected: true,
      spectating: null,
      ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
    });

    expect(state.chatInputTintTarget()).toBe('say');
    client.chat(hud.composeChatSend('hello nearby players'));

    expect(sent).toEqual([{ t: 'cmd', cmd: 'chat', text: '/say hello nearby players' }]);
  });
});
