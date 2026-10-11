// @vitest-environment happy-dom
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

const LINKED: DiscordAccountStatus = {
  linked: true,
  username: 'maxp',
  avatar: null,
  guildMember: true,
  points: 0,
  lifetimePoints: 0,
  statusTier: 1,
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

// A failed relink used to be invisible: the popup/native flow's only error
// surface was #login-error, an element hidden once the player is in-game (the
// only place a relink is ever started from). The panel now shows its own
// notice, and offers a Relink action while already linked so a player never
// has to unlink first just to force a fresh OAuth pass (avatar/username sync).
describe('link-error notice + relink while linked', () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
  });

  it('shows no notice by default', () => {
    renderDiscordWidget(
      el,
      { enabled: true, status: UNLINKED, presence: NO_PRESENCE, inviteUrl: 'u' },
      makeDeps(),
    );
    expect(el.querySelector('.dc-link-error')).toBeNull();
  });

  it('shows the notice when linkError is set, unlinked or linked', () => {
    renderDiscordWidget(
      el,
      { enabled: true, status: UNLINKED, presence: NO_PRESENCE, inviteUrl: 'u', linkError: true },
      makeDeps(),
    );
    expect(el.querySelector('.dc-link-error')).not.toBeNull();

    renderDiscordWidget(
      el,
      { enabled: true, status: LINKED, presence: NO_PRESENCE, inviteUrl: 'u', linkError: true },
      makeDeps(),
    );
    expect(el.querySelector('.dc-link-error')).not.toBeNull();
  });

  it('offers a Relink action while linked, routed through the same onLink as the CTA', () => {
    const deps = makeDeps();
    renderDiscordWidget(
      el,
      { enabled: true, status: LINKED, presence: NO_PRESENCE, inviteUrl: 'u' },
      deps,
    );
    const relinkBtn = el.querySelector('[data-action="relink"]') as HTMLElement;
    expect(relinkBtn).not.toBeNull();
    relinkBtn.click();
    expect(deps.onLink).toHaveBeenCalledTimes(1);
    expect(deps.onUnlink).not.toHaveBeenCalled();
  });
});
