// @vitest-environment jsdom
// The legendary celebration chat lines render PLAIN TEXT (the phase 13 review
// round): the chosen legendary name is player-authored, and the load bound
// deliberately admits names carrying chat item-link tokens from persistence,
// so the two legendary lines must not tokenize [[i:...]] into trusted
// clickable item-link spans. This drives the REAL Hud.log wrapper on a bare
// prototype (the guild_motd_plaintext idiom), proving the plainText opt-out
// threads through log() into appendLog; the positive control proves the
// assertion is decisive. The switch arms spelling plainText on both calls are
// pinned at source in tests/craft_celebration_text_view.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { legendaryForgedLine } from '../src/ui/craft_celebration_text_view';
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

interface LogHarness {
  chatLogEl: HTMLElement;
  prependTimestamp(div: HTMLElement): void;
  hideIfFiltered(div: HTMLElement, chan: string): void;
  announceChatLine(div: HTMLElement): void;
  attachTooltip(el: HTMLElement, fn: () => string): void;
  maskChat(text: string): string;
  itemTooltip(item: unknown): string;
  log(
    text: string,
    color?: string,
    decorativeIconUrl?: string,
    channel?: string,
    announceWhenFiltered?: boolean,
    plainText?: boolean,
  ): void;
}

function harness(): { hud: LogHarness; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const hud = Object.create(Hud.prototype) as unknown as LogHarness;
  hud.chatLogEl = el;
  // Neutral stubs for the coordinator state the append path touches.
  hud.prependTimestamp = () => {};
  hud.hideIfFiltered = () => {};
  hud.announceChatLine = () => {};
  hud.attachTooltip = () => {};
  hud.maskChat = (text) => text;
  hud.itemTooltip = () => '';
  return { hud, el };
}

describe('legendary chat lines stay plain text (no item-link minting)', () => {
  it('a chosen name carrying [[i:...]] renders VERBATIM through the plainText log call', () => {
    const { hud, el } = harness();
    // The exact call shape the legendaryForged arm makes: the view bundle plus
    // the spelled channel reaching the plainText parameter.
    const line = legendaryForgedLine(itemId, `Oath of [[i:${itemId}]] Ruin`);
    hud.log(line.text, line.color, line.icon, 'system', false, true);
    const rendered = el.lastElementChild as HTMLElement;
    expect(rendered.querySelector('.chat-item-link')).toBeNull();
    expect(rendered.textContent).toContain(`Oath of [[i:${itemId}]] Ruin`);
  });

  it('positive control: the default log path DOES linkify the same text', () => {
    // Proves the assertion above is decisive: same harness, same text, flag
    // off; if the linkifier were broken entirely, this arm fails instead of
    // the plain arm passing vacuously.
    const { hud, el } = harness();
    const line = legendaryForgedLine(itemId, `Oath of [[i:${itemId}]] Ruin`);
    hud.log(line.text, line.color, line.icon, 'system', false);
    const rendered = el.lastElementChild as HTMLElement;
    expect(rendered.querySelector('.chat-item-link')).not.toBeNull();
    expect(rendered.textContent).not.toContain('[[i:');
  });
});
