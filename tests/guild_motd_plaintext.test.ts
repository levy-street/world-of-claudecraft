// @vitest-environment jsdom
// The guild billboard login echo renders PLAIN TEXT (PR 2785 review): the
// billboard's home rendering (social_window.ts) is esc()'d plain text with no
// item links, so the chat-log echo of the same guild-controlled text must not
// tokenize [[i:...]] into trusted clickable item-link spans. This drives the
// REAL Hud.appendLog on a bare prototype (the chat_hud_client_seam idiom) and
// asserts both arms: the plainText path keeps the token literal, and the
// default chat path still linkifies (so this suite fails loudly if the flag
// ever inverts or the linkifier moves).
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

// A real merged-table item id, derived so a content rename cannot silently rot
// the fixture into the unknown-id arm.
const itemId = Object.keys(ITEMS)[0] as string;

interface AppendLogHarness {
  chatLogEl: HTMLElement;
  prependTimestamp(div: HTMLElement): void;
  hideIfFiltered(div: HTMLElement, chan: string): void;
  announceChatLine(div: HTMLElement): void;
  attachTooltip(el: HTMLElement, fn: () => string): void;
  maskChat(text: string): string;
  itemTooltip(item: unknown): string;
  appendLog(
    el: HTMLElement,
    text: string,
    color: string,
    timestamp?: boolean,
    chan?: string,
    decorativeIconUrl?: string,
    plainText?: boolean,
  ): void;
}

function harness(): { hud: AppendLogHarness; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const hud = Object.create(Hud.prototype) as unknown as AppendLogHarness;
  hud.chatLogEl = el;
  // Neutral stubs for the coordinator state appendLog touches around the
  // segment rendering (timestamps, tab filters, the AT announcer, tooltips).
  hud.prependTimestamp = () => {};
  hud.hideIfFiltered = () => {};
  hud.announceChatLine = () => {};
  hud.attachTooltip = () => {};
  hud.maskChat = (text) => text;
  hud.itemTooltip = () => '';
  return { hud, el };
}

describe('guild billboard echo stays plain text (no item-link minting)', () => {
  it('plainText appendLog keeps a [[i:...]] token LITERAL: one text node, no link span', () => {
    const { hud, el } = harness();
    const motd = `Raid loot council: bring [[i:${itemId}]] offers`;
    hud.appendLog(el, motd, '#abc', false, 'guild', undefined, true);
    const line = el.lastElementChild as HTMLElement;
    expect(line.querySelector('.chat-item-link')).toBeNull();
    expect(line.textContent).toBe(motd); // verbatim, token intact as typed
  });

  it('positive control: the default chat path DOES linkify the same text', () => {
    // Proves the assertion above is decisive: same harness, same text, flag
    // off; if the linkifier were broken entirely, this arm fails instead of
    // the plain arm passing vacuously.
    const { hud, el } = harness();
    hud.appendLog(el, `Raid loot council: bring [[i:${itemId}]] offers`, '#abc', false, 'guild');
    const line = el.lastElementChild as HTMLElement;
    expect(line.querySelector('.chat-item-link')).not.toBeNull();
    expect(line.textContent).not.toContain('[[i:');
  });
});
