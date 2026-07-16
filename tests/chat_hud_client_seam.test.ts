import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Hud } from '../src/ui/hud';
import {
  ChatWindowController,
  type ChatWindowControllerDeps,
} from '../src/ui/hud/chat/chat_window_controller';

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
      chatWindow: { composeSend(typed: string): string };
    };
    state.chatWindow = {
      composeSend: (typed) => `/say ${typed}`,
    };

    const sent: unknown[] = [];
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    Object.assign(client as unknown as Record<string, unknown>, {
      connected: true,
      spectating: null,
      ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
    });

    client.chat(hud.composeChatSend('hello nearby players'));

    expect(sent).toEqual([{ t: 'cmd', cmd: 'chat', text: '/say hello nearby players' }]);
  });

  it('stays on the last channel sent, including a whisper reply (v0.26.0 regression)', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const hud = Object.create(Hud.prototype) as InstanceType<typeof Hud>;
    // The Hud delegates chat compose/sticky state to its ChatWindowController; a
    // bare instance never ran init, so its state is the field defaults (All tab,
    // sticky say). No dep is exercised by compose/noteSent, so an empty deps
    // object is enough here.
    const controller = new ChatWindowController({} as ChatWindowControllerDeps);
    (hud as unknown as { chatWindow: ChatWindowController }).chatWindow = controller;
    const state = controller as unknown as {
      stickyTarget: string;
      inputTintTarget(): string;
    };

    // Send in party: the sticky target follows there.
    hud.noteSentChannel(hud.composeChatSend('/p on my way'));
    expect(state.stickyTarget).toBe('party');

    // Reply to a whisper: the sticky target follows to whisper, and the NEXT plain
    // line keeps replying (/r) instead of snapping back to party (the regression).
    hud.noteSentChannel(hud.composeChatSend('/r sure thing'));
    expect(state.stickyTarget).toBe('whisper');
    expect(hud.composeChatSend('and thanks')).toBe('/r and thanks');
    expect(state.inputTintTarget()).toBe('whisper');
  });
});
