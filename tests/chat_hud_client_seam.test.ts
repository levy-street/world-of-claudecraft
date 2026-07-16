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
      stickyTarget: string;
      pendingChatLinks: readonly unknown[];
      chatInputTintTarget(): string;
    };
    state.activeChatTab = 'all';
    state.stickyTarget = 'say';
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

  it('stays on the last channel sent, including a whisper reply (v0.26.0 regression)', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const hud = Object.create(Hud.prototype) as InstanceType<typeof Hud>;
    const state = hud as unknown as {
      activeChatTab: string;
      stickyTarget: string;
      pendingChatLinks: readonly unknown[];
      chatInputTintTarget(): string;
      noteSentChannel(line: string): void;
    };
    state.activeChatTab = 'all';
    state.stickyTarget = 'say';
    state.pendingChatLinks = [];

    // Send in party: the sticky target follows there.
    state.noteSentChannel(hud.composeChatSend('/p on my way'));
    expect(state.stickyTarget).toBe('party');

    // Reply to a whisper: the sticky target follows to whisper, and the NEXT plain
    // line keeps replying (/r) instead of snapping back to party (the regression).
    state.noteSentChannel(hud.composeChatSend('/r sure thing'));
    expect(state.stickyTarget).toBe('whisper');
    expect(hud.composeChatSend('and thanks')).toBe('/r and thanks');
    expect(state.chatInputTintTarget()).toBe('whisper');
  });
});
