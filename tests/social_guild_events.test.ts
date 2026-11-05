// @vitest-environment happy-dom

// The Social window's Guild tab Events section (menu consolidation step 4:
// guild event booking moved here from the removed Event Calendar window).
// Driven at the DOM through the real SocialWindow: the upcoming list, the
// officer-gated booking form, the add and remove delegation into IWorld, the
// bad-input notice, and the Discord strip at the window's foot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDiscordStatus } from '../src/ui/discord_status';
import { isoDayOf } from '../src/ui/guild_events_view';
import { setLanguage } from '../src/ui/i18n';
import { SocialWindow, type SocialWindowDeps } from '../src/ui/social_window';
import type { GuildEventInfo, IWorld } from '../src/world_api';

let root: HTMLElement;
let guildEventCreate: ReturnType<typeof vi.fn>;
let guildEventRemove: ReturnType<typeof vi.fn>;
let openDiscord: ReturnType<typeof vi.fn>;

const today = isoDayOf(Date.now());
const later = isoDayOf(Date.now() + 3 * 86_400_000);
const earlier = isoDayOf(Date.now() - 3 * 86_400_000);

function guild(rank: string, events: GuildEventInfo[]): unknown {
  return {
    id: 1,
    name: 'Lanternmere Wardens',
    rank,
    motd: '',
    motdSetBy: '',
    members: [],
    events,
    pledgeSettings: { enabled: false, minLevel: 1, note: '', newPlayerFriendly: false },
    pledges: [],
    tier: 1,
  };
}

function openGuildTab(rank: string, events: GuildEventInfo[], discord = false): SocialWindow {
  root = document.createElement('div');
  root.id = 'social-window';
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: SocialWindowDeps = {
    root: () => root,
    world: () =>
      ({
        playerId: 7,
        player: { id: 7, name: 'Aleron', level: 60 },
        realm: 'Ashenvale',
        socialInfo: {
          friends: [],
          ignores: [],
          blocks: [],
          guild: guild(rank, events),
          myPledge: null,
        },
        partyInfo: null,
        searchCharacters: async () => [],
        guildEventCreate,
        guildEventRemove,
      }) as unknown as IWorld,
    discordHook: () => (discord ? openDiscord : null),
    closeOthers: noop,
    hideTooltip: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    showPrompt: noop,
    startWhisper: noop,
    openSelfMenu: noop,
    openUnitMenu: noop,
    openNameMenu: noop,
    isMobileLayout: () => false,
  };
  const win = new SocialWindow(deps);
  win.toggle();
  (root.querySelector('[data-tab="guild"]') as HTMLElement | null)?.click();
  return win;
}

const ev = (id: number, day: string, title: string): GuildEventInfo => ({
  id,
  day,
  hour: 20,
  title,
  note: '',
  createdBy: 'Brannoch',
});

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
  guildEventCreate = vi.fn();
  guildEventRemove = vi.fn();
  openDiscord = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = '';
  setDiscordStatus(null);
});

describe('the Guild tab Events section', () => {
  it('lists upcoming events only, soonest first, with booked-by lines', () => {
    openGuildTab('member', [
      ev(2, later, 'Thornhollow night'),
      ev(1, earlier, 'Old raid'),
      ev(3, today, 'Crypt run'),
    ]);
    const titles = [...root.querySelectorAll('.soc-guild-events .cal-event-title')].map((n) =>
      n.firstChild?.textContent?.trim(),
    );
    expect(titles).toEqual(['Crypt run', 'Thornhollow night']);
    expect(root.querySelector('.soc-guild-events .cal-event-by')?.textContent).toContain(
      'Brannoch',
    );
  });

  it('shows members no booking form and no remove buttons', () => {
    openGuildTab('member', [ev(2, later, 'Thornhollow night')]);
    expect(root.querySelector('[data-act="guild-event-add"]')).toBeNull();
    expect(root.querySelector('[data-act="guild-event-del"]')).toBeNull();
  });

  it('hides the whole section for a member when nothing is booked', () => {
    openGuildTab('member', []);
    expect(root.querySelector('.soc-guild-events')).toBeNull();
  });

  it('books an event for an officer through IWorld, with the hour optional', () => {
    openGuildTab('officer', []);
    const set = (name: string, value: string) => {
      const input = root.querySelector<HTMLInputElement>(
        `.soc-guild-events input[data-field="${name}"]`,
      );
      expect(input, name).not.toBeNull();
      if (input) input.value = value;
    };
    set('gev-title', '  Nythraxis Heroic  ');
    set('gev-note', 'bring flasks');
    set('gev-day', later);
    set('gev-hour', '20');
    (root.querySelector('[data-act="guild-event-add"]') as HTMLElement).click();
    expect(guildEventCreate).toHaveBeenCalledWith(later, 20, 'Nythraxis Heroic', 'bring flasks');
  });

  it('refuses a blank title with the bad-input notice and sends nothing', () => {
    openGuildTab('officer', []);
    (root.querySelector('[data-act="guild-event-add"]') as HTMLElement).click();
    expect(guildEventCreate).not.toHaveBeenCalled();
    const notice = root.querySelector('.soc-notice');
    expect(notice?.className).toContain('err');
    expect(notice?.textContent?.length).toBeGreaterThan(0);
  });

  it('removes an event by id from its row button', () => {
    openGuildTab('officer', [ev(9, later, 'Thornhollow night')]);
    (root.querySelector('[data-act="guild-event-del"][data-event="9"]') as HTMLElement).click();
    expect(guildEventRemove).toHaveBeenCalledWith(9);
  });
});

describe('the Discord strip', () => {
  it('is hidden on a build with no Discord hook', () => {
    openGuildTab('member', []);
    expect(root.querySelector<HTMLElement>('.soc-discord-strip')?.hidden).toBe(true);
  });

  it('names the link state and opens the Discord panel from its button', () => {
    setDiscordStatus({
      linked: true,
      username: 'aelric',
      avatar: null,
      guildMember: true,
      points: 0,
      lifetimePoints: 0,
      statusTier: 1,
      claimedSwagIds: [],
      passwordSet: true,
    });
    openGuildTab('member', [], true);
    const strip = root.querySelector<HTMLElement>('.soc-discord-strip');
    expect(strip?.hidden).toBe(false);
    expect(strip?.textContent).toContain('aelric');
    strip?.querySelector<HTMLElement>('[data-open-discord]')?.click();
    expect(openDiscord).toHaveBeenCalledTimes(1);
  });
});
