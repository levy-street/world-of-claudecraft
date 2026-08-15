// @vitest-environment happy-dom

// The clickable deed announcements, driven through the REAL Hud methods (the
// professions_single_line_grants rig): a deed unlock and a guild broadcast
// each render the deed NAME as a chat-deed-link span inside the localized
// line, and activating the link (click or Enter) jumps to that deed's card
// via DeedsWindow.openWithDeed. The link label resolves from the local
// catalog (deedName), never from the wire.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import type { SimEvent } from '../src/sim/types';
import { deedName } from '../src/ui/deed_i18n';
import { Hud } from '../src/ui/hud';
import { t } from '../src/ui/i18n';
import { reliquaryPageName } from '../src/ui/reliquary_i18n';

const UNLOCK_ID = 'prog_first_steps';
const BROADCAST_ID = 'cmb_first_blood';
const ILLUMINATED_PAGE_ID = 'conquerors_hollow_crypt';

// The DOM normalizes an assigned hex (rgb() form differs per engine), so
// round-trip the expected color through the same style property.
const cssColor = (hex: string): string => {
  const el = document.createElement('span');
  el.style.color = hex;
  return el.style.color;
};

interface DeedLinkHarness {
  sim: unknown;
  renderer: { handleEvent: ReturnType<typeof vi.fn> };
  playEventSfx: ReturnType<typeof vi.fn>;
  meters: { onEvent: ReturnType<typeof vi.fn> };
  isNythraxisEvent: ReturnType<typeof vi.fn>;
  chatLogEl: HTMLElement;
  chatTimestamps: boolean;
  chatClock: string;
  chatWindow: { hideIfFiltered: ReturnType<typeof vi.fn> };
  chatAnnouncer: { push: ReturnType<typeof vi.fn> };
  combatAnnouncer: { push: ReturnType<typeof vi.fn> };
  bannerEl: HTMLElement;
  bannerTimer: number | undefined;
  bannerSource: 'unstuck' | null;
  log: ReturnType<typeof vi.fn>;
  deedsWindow: {
    noteUnlocks: ReturnType<typeof vi.fn>;
    openWithDeed: ReturnType<typeof vi.fn>;
  };
  reliquaryWindow: {
    openWithPage: ReturnType<typeof vi.fn>;
  };
  handleDeedUnlocks(events: { deedId: string; retro?: boolean }[]): void;
  handleEvents(events: SimEvent[]): void;
}

function makeHud(): DeedLinkHarness {
  const hud = Object.create(Hud.prototype) as unknown as DeedLinkHarness;
  hud.sim = {
    playerId: 7,
    craftingIdentity: { synced: false },
    craftSkills: {},
    gatheringProficiency: {},
  };
  hud.renderer = { handleEvent: vi.fn() };
  hud.playEventSfx = vi.fn();
  hud.meters = { onEvent: vi.fn() };
  hud.isNythraxisEvent = vi.fn(() => false);
  hud.chatLogEl = document.createElement('div');
  hud.chatTimestamps = false;
  hud.chatClock = '24h';
  hud.chatWindow = { hideIfFiltered: vi.fn() };
  hud.chatAnnouncer = { push: vi.fn() };
  hud.combatAnnouncer = { push: vi.fn() };
  hud.bannerEl = document.createElement('div');
  hud.bannerTimer = undefined;
  hud.bannerSource = null;
  // The plain-text log arm (the retro summary) stays a stub: this suite is
  // about the NODE lines, which run the real logNodes/appendLog path.
  hud.log = vi.fn();
  hud.deedsWindow = { noteUnlocks: vi.fn(), openWithDeed: vi.fn() };
  hud.reliquaryWindow = { openWithPage: vi.fn() };
  return hud;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(audio, 'achievement').mockImplementation(() => {});
  vi.spyOn(audio, 'click').mockImplementation(() => {});
});

describe('the unlock line (handleDeedUnlocks)', () => {
  it('renders the localized line with the deed name as a chat-deed-link span', () => {
    const hud = makeHud();
    hud.handleDeedUnlocks([{ deedId: UNLOCK_ID }]);
    const line = hud.chatLogEl.lastElementChild as HTMLElement;
    expect(line).not.toBeNull();
    // The whole line reads exactly as before, name bracketed link-style.
    expect(line.textContent).toBe(
      t('hudChrome.deeds.unlockedBanner', { name: `[${deedName(UNLOCK_ID)}]` }),
    );
    const link = line.querySelector('span.chat-deed-link') as HTMLElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe(`[${deedName(UNLOCK_ID)}]`);
    expect(link.getAttribute('role')).toBe('button');
    expect(link.tabIndex).toBe(0);
    // The gold announcement color rides the line, the link inherits it.
    expect(line.style.color).toBe(cssColor('#ffd100'));
  });

  it('click and Enter on the link both jump to the deed card', () => {
    const hud = makeHud();
    hud.handleDeedUnlocks([{ deedId: UNLOCK_ID }]);
    const link = hud.chatLogEl.querySelector('span.chat-deed-link') as HTMLElement;
    link.click();
    expect(hud.deedsWindow.openWithDeed).toHaveBeenCalledWith(UNLOCK_ID);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(hud.deedsWindow.openWithDeed).toHaveBeenCalledTimes(2);
  });

  it('announces the full spliced line through the chat live region, timestamp included', () => {
    const hud = makeHud();
    hud.chatTimestamps = true;
    hud.handleDeedUnlocks([{ deedId: UNLOCK_ID }]);
    const line = hud.chatLogEl.lastElementChild as HTMLElement;
    // The timestamp option still decorates the node-body line.
    expect(line.querySelector('.chat-ts')).not.toBeNull();
    // The announcer receives the DIV's text (not the empty text argument the
    // node path passes), so screen readers hear the whole line.
    expect(hud.chatAnnouncer.push).toHaveBeenCalledWith(line.textContent ?? '', expect.any(Number));
    expect((line.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('feeds the drain order to the recent strip and keeps retro out of it', () => {
    const hud = makeHud();
    hud.handleDeedUnlocks([
      { deedId: UNLOCK_ID },
      { deedId: 'retro_x', retro: true },
      { deedId: BROADCAST_ID },
    ]);
    // Non-retro, drain order, catalog-known only (retro_x is also unknown).
    expect(hud.deedsWindow.noteUnlocks).toHaveBeenCalledWith([UNLOCK_ID, BROADCAST_ID]);
    // Two unlock lines rendered, each with its own link.
    expect(hud.chatLogEl.querySelectorAll('span.chat-deed-link')).toHaveLength(2);
  });
});

describe('the broadcast line (case deedBroadcast)', () => {
  const broadcast = (): SimEvent =>
    ({ type: 'deedBroadcast', characterName: 'Hilda', deedId: BROADCAST_ID }) as SimEvent;

  it('renders the guild-green line with the deed name as the clickable jump', () => {
    const hud = makeHud();
    hud.handleEvents([broadcast()]);
    const line = hud.chatLogEl.lastElementChild as HTMLElement;
    expect(line.textContent).toBe(
      t('hudChrome.deeds.broadcastLine', { name: 'Hilda', deed: `[${deedName(BROADCAST_ID)}]` }),
    );
    // Same discipline as the illumination twin below: the t() assertion shares
    // the key and substitution with production, so this literal is the pin on
    // the English prose itself, names substituted.
    expect(line.textContent).toBe('Hilda has accomplished a deed: [First Blood]');
    expect(line.style.color).toBe(cssColor('#40d264'));
    const link = line.querySelector('span.chat-deed-link') as HTMLElement;
    expect(link.textContent).toBe(`[${deedName(BROADCAST_ID)}]`);
    link.click();
    expect(hud.deedsWindow.openWithDeed).toHaveBeenCalledWith(BROADCAST_ID);
  });
});

describe('the illumination broadcast line (case reliquaryIlluminationBroadcast)', () => {
  const illumination = (pageId: string = ILLUMINATED_PAGE_ID): SimEvent =>
    ({ type: 'reliquaryIlluminationBroadcast', characterName: 'Hilda', pageId }) as SimEvent;

  it('renders the guild-green line with the localized page name as the clickable jump', () => {
    const hud = makeHud();
    hud.handleEvents([illumination()]);
    const line = hud.chatLogEl.lastElementChild as HTMLElement;
    expect(line.textContent).toBe(
      t('hudChrome.reliquary.illuminationBroadcastLine', {
        name: 'Hilda',
        page: `[${reliquaryPageName(ILLUMINATED_PAGE_ID)}]`,
      }),
    );
    // The assertion above shares the key and the substitution with production,
    // so it cannot see a reword of the template. This literal is the pin on the
    // English prose itself, names substituted.
    expect(line.textContent).toBe('Hilda has illuminated a Reliquary page: [The Hollow Crypt]');
    expect(line.style.color).toBe(cssColor('#40d264'));
    const link = line.querySelector('span.chat-deed-link') as HTMLElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe(`[${reliquaryPageName(ILLUMINATED_PAGE_ID)}]`);
    link.click();
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenCalledWith(ILLUMINATED_PAGE_ID);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenCalledTimes(2);
  });

  it('a catalog-unknown page renders the plain line with no link (drift guard)', () => {
    // Mixed-version drift (a newer server's page id): the line keeps its
    // prose with the raw id through reliquaryPageName's fallback, and never
    // offers a link that would open the window un-navigated (the Illumination
    // toast's inert-link policy). Rendered through TEXT NODES, never the
    // token-parsing log path: a remote-origin string containing an item-link
    // token must stay literal text, so the branch is structurally inert
    // rather than incidentally safe via the name charset.
    const hud = makeHud();
    hud.handleEvents([illumination('page_from_a_newer_build[[i:evil]]')]);
    const line = hud.chatLogEl.lastElementChild as HTMLElement;
    expect(line.textContent).toBe(
      t('hudChrome.reliquary.illuminationBroadcastLine', {
        name: 'Hilda',
        page: 'page_from_a_newer_build[[i:evil]]',
      }),
    );
    expect(line.style.color).toBe(cssColor('#40d264'));
    // No deed link, and no chat-token element minted from the hostile id.
    expect(line.querySelector('span.chat-deed-link')).toBeNull();
    expect(line.querySelector('span.chat-item-link')).toBeNull();
    expect(line.children).toHaveLength(0);
  });

  it('hud.ts carries the reliquaryIlluminationBroadcast switch arm (source pin)', () => {
    // Belt over the behavior arms above: the real handleEvents switch must
    // name the case in CODE (comments stripped so a commented-out arm cannot
    // satisfy the pin).
    const hudSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/ui/hud.ts'),
      'utf8',
    );
    const code = hudSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("case 'reliquaryIlluminationBroadcast':");
  });
});
