import { describe, expect, it } from 'vitest';
import {
  armoryCardVisible,
  buildWelcomeScreenView,
  chestTileVisible,
  consumeArmoryOpenIntent,
  continueButtonState,
  discordStripVisible,
  markNewReleases,
  nextLastSeenReleaseId,
  setArmoryOpenIntent,
  type WelcomeChestInput,
  type WelcomeDiscordInput,
  type WelcomePlatformInput,
} from '../src/ui/welcome_screen_view';

const DESKTOP_WEB: WelcomePlatformInput = {
  nativeApp: false,
  desktopApp: false,
  mobileTouch: false,
  offline: false,
};
const STEAM_DESKTOP: WelcomePlatformInput = { ...DESKTOP_WEB, desktopApp: true };
const MOBILE_WEB: WelcomePlatformInput = { ...DESKTOP_WEB, mobileTouch: true };
const NATIVE_APP: WelcomePlatformInput = { ...DESKTOP_WEB, nativeApp: true };
const OFFLINE: WelcomePlatformInput = { ...DESKTOP_WEB, offline: true };

describe('welcome_screen_view: gating matrix', () => {
  it('Armory card: desktop web AND server flag both must be true', () => {
    expect(armoryCardVisible(DESKTOP_WEB, true)).toBe(true);
    expect(armoryCardVisible(DESKTOP_WEB, false)).toBe(false);
  });

  it('Armory card: hidden on Steam desktop, mobile web, native apps, and offline regardless of the server flag', () => {
    expect(armoryCardVisible(STEAM_DESKTOP, true)).toBe(false);
    expect(armoryCardVisible(MOBILE_WEB, true)).toBe(false);
    expect(armoryCardVisible(NATIVE_APP, true)).toBe(false);
    expect(armoryCardVisible(OFFLINE, true)).toBe(false);
  });

  it('chest tile: shown on desktop web only when claimable', () => {
    const ready: WelcomeChestInput = { ready: true, unknown: false };
    const notReady: WelcomeChestInput = { ready: false, unknown: false };
    const unknown: WelcomeChestInput = { ready: true, unknown: true };
    expect(chestTileVisible(DESKTOP_WEB, ready)).toBe(true);
    expect(chestTileVisible(DESKTOP_WEB, notReady)).toBe(false);
    expect(chestTileVisible(DESKTOP_WEB, unknown)).toBe(false);
  });

  it('chest tile: hidden on Steam desktop, mobile web, native apps, and offline even when ready', () => {
    const ready: WelcomeChestInput = { ready: true, unknown: false };
    expect(chestTileVisible(STEAM_DESKTOP, ready)).toBe(false);
    expect(chestTileVisible(MOBILE_WEB, ready)).toBe(false);
    expect(chestTileVisible(NATIVE_APP, ready)).toBe(false);
    expect(chestTileVisible(OFFLINE, ready)).toBe(false);
  });

  it('continue button: online path disabled until connection is ready', () => {
    expect(continueButtonState({ ready: false, offline: false })).toBe('connecting');
    expect(continueButtonState({ ready: true, offline: false })).toBe('ready');
  });

  it('continue button: offline path is always ready, no connection wait', () => {
    expect(continueButtonState({ ready: false, offline: true })).toBe('ready');
  });
});

describe('welcome_screen_view: Discord strip rules', () => {
  const base: WelcomeDiscordInput = {
    enabled: true,
    linked: false,
    guildMember: false,
    fetchFailed: false,
  };

  it('hidden only when linked AND a guild member', () => {
    expect(discordStripVisible({ ...base, linked: true, guildMember: true }, false)).toBe(false);
  });

  it('shown when unlinked', () => {
    expect(discordStripVisible(base, false)).toBe(true);
  });

  it('shown when linked but not a guild member', () => {
    expect(discordStripVisible({ ...base, linked: true, guildMember: false }, false)).toBe(true);
  });

  it('fails open (shown) when the status fetch failed, even if it would otherwise look linked+member', () => {
    expect(
      discordStripVisible(
        { enabled: null, linked: null, guildMember: null, fetchFailed: true },
        false,
      ),
    ).toBe(true);
  });

  it('shown in offline mode regardless of any discord state', () => {
    expect(discordStripVisible({ ...base, linked: true, guildMember: true }, true)).toBe(true);
  });

  it('hidden when the guild integration is explicitly disabled', () => {
    expect(discordStripVisible({ ...base, enabled: false }, false)).toBe(false);
  });
});

describe('welcome_screen_view: NEW-badge marker logic', () => {
  const releases = [
    { id: 5, tag: 'v0.26.0', name: 'v0.26.0', publishedAt: '2026-07-10T00:00:00Z' },
    { id: 4, tag: 'v0.25.0', name: 'v0.25.0', publishedAt: '2026-06-01T00:00:00Z' },
    { id: 3, tag: 'v0.24.0', name: 'v0.24.0', publishedAt: '2026-05-01T00:00:00Z' },
  ];

  it('marks every release NEW when no marker is stored yet (first-ever visit)', () => {
    const marked = markNewReleases(releases, null);
    expect(marked.every((r) => r.isNew)).toBe(true);
  });

  it('marks only releases newer than the stored marker', () => {
    const marked = markNewReleases(releases, 4);
    expect(marked.find((r) => r.id === 5)?.isNew).toBe(true);
    expect(marked.find((r) => r.id === 4)?.isNew).toBe(false);
    expect(marked.find((r) => r.id === 3)?.isNew).toBe(false);
  });

  it('caps the shown list at 5 releases', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 8 - i,
      tag: `v${8 - i}`,
      name: `v${8 - i}`,
      publishedAt: '2026-01-01T00:00:00Z',
    }));
    expect(markNewReleases(many, null)).toHaveLength(5);
  });

  it('advances the last-seen marker to the max seen release id, never backwards', () => {
    expect(nextLastSeenReleaseId(releases, null)).toBe(5);
    expect(nextLastSeenReleaseId(releases, 5)).toBe(5);
    expect(nextLastSeenReleaseId(releases, 10)).toBe(10);
    expect(nextLastSeenReleaseId([], 3)).toBe(3);
  });

  it('preserves extra fields on a superset type (e.g. the full release body/url/prerelease shape the Welcome Screen painter renders from), not just the minimal WelcomeReleaseSummary shape', () => {
    const fullReleases = releases.map((r) => ({
      ...r,
      body: `body for ${r.tag}`,
      url: `https://example.com/${r.tag}`,
      prerelease: false,
    }));
    const marked = markNewReleases(fullReleases, 4);
    expect(marked.find((r) => r.id === 5)).toMatchObject({
      body: 'body for v0.26.0',
      url: 'https://example.com/v0.26.0',
      prerelease: false,
      isNew: true,
    });
  });
});

describe('welcome_screen_view: one-shot Armory-open intent', () => {
  function fakeStorage(): Storage {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  it('is absent until set', () => {
    expect(consumeArmoryOpenIntent(fakeStorage())).toBe(false);
  });

  it('fires exactly once: set, then consumed, then gone', () => {
    const storage = fakeStorage();
    setArmoryOpenIntent(storage);
    expect(consumeArmoryOpenIntent(storage)).toBe(true);
    expect(consumeArmoryOpenIntent(storage)).toBe(false);
  });
});

describe('welcome_screen_view: feed-failure fallback', () => {
  it('buildWelcomeScreenView surfaces a failed news state without touching the other tiles', () => {
    const view = buildWelcomeScreenView(
      DESKTOP_WEB,
      { state: 'failed', releases: [] },
      { enabled: true, linked: false, guildMember: false, fetchFailed: false },
      { ready: false, unknown: true },
      { ready: true, offline: false },
      true,
      null,
    );
    expect(view.newsState).toBe('failed');
    expect(view.releases).toEqual([]);
    expect(view.continueState).toBe('ready');
    expect(view.showArmoryCard).toBe(true);
    expect(view.showDiscordStrip).toBe(true);
    expect(view.showChestTile).toBe(false);
  });
});
