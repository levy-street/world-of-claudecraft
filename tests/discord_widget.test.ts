// @vitest-environment jsdom
//
// Consolidated Discord entry point: the corner community tray's separate
// "Discord" invite link (index.html #community-hud) was removed as a
// duplicate of the Discord (U) icon-rail button, which opens this panel. To
// keep the panel a full replacement (no capability regression for a player
// who is not yet linked and just wants to join the server), the unlinked
// state renders a plain "join the server" action alongside the link CTA.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordAccountStatus, DiscordPresenceState } from '../src/ui/discord_status';
import { renderDiscordWidget } from '../src/ui/discord_widget';

const UNLINKED: DiscordAccountStatus = {
  linked: false,
  username: null,
  avatar: null,
  guildMember: false,
  points: 0,
  lifetimePoints: 0,
  statusTier: 0,
  claimedSwagIds: [],
  passwordSet: true,
};

const NO_PRESENCE: DiscordPresenceState = {
  onlineCount: 0,
  memberTotal: 0,
  voiceChannelName: null,
  voice: [],
};

function makeDeps() {
  return {
    attachTooltip: () => {},
    hideTooltip: () => {},
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    onOpenUrl: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('renderDiscordWidget (unlinked mode)', () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
  });

  it('offers both the account-link CTA and a plain join-the-server action', () => {
    const deps = makeDeps();
    renderDiscordWidget(
      el,
      {
        enabled: true,
        status: UNLINKED,
        presence: NO_PRESENCE,
        inviteUrl: 'https://discord.gg/test',
      },
      deps,
    );
    expect(el.querySelector('[data-action="link"]')).not.toBeNull();
    expect(el.querySelector('[data-action="join-server"]')).not.toBeNull();
  });

  it('the join-server action opens the same invite URL the removed corner tray link used to', () => {
    const deps = makeDeps();
    renderDiscordWidget(
      el,
      {
        enabled: true,
        status: UNLINKED,
        presence: NO_PRESENCE,
        inviteUrl: 'https://discord.gg/test',
      },
      deps,
    );
    (el.querySelector('[data-action="join-server"]') as HTMLElement).click();
    expect(deps.onOpenUrl).toHaveBeenCalledWith('https://discord.gg/test');
    expect(deps.onLink).not.toHaveBeenCalled();
  });

  it('the link CTA still only triggers account linking, not the invite', () => {
    const deps = makeDeps();
    renderDiscordWidget(
      el,
      {
        enabled: true,
        status: UNLINKED,
        presence: NO_PRESENCE,
        inviteUrl: 'https://discord.gg/test',
      },
      deps,
    );
    (el.querySelector('[data-action="link"]') as HTMLElement).click();
    expect(deps.onLink).toHaveBeenCalledTimes(1);
    expect(deps.onOpenUrl).not.toHaveBeenCalled();
  });
});
