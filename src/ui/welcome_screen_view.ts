// Pure view model for the post-login Welcome Screen (news, patch notes, Join our
// Discord strip, Season 1 Armory promo, Continue button).
//
// DOM-free and i18n-free: takes the raw platform/server/account state and returns
// which tiles show, the Continue button state, the NEW-badge marker check, the
// one-shot Armory-open intent semantics, and the Discord-strip visibility rule.
// The thin consumer (welcome_screen_window.ts) maps stable keys to t() and paints.
// Unit-tested in tests/welcome_screen_view.test.ts. Mirrors src/ui/discord_widget_view.ts.
import { type StorePromoVisibilityInput, shouldShowStorePromo } from './store_promo_card';

export interface WelcomeReleaseSummary {
  id: number;
  tag: string;
  name: string;
  publishedAt: string;
}

export interface WelcomePlatformInput extends StorePromoVisibilityInput {
  /** True for the offline (no-server) entry path. */
  offline: boolean;
}

export interface WelcomeDiscordInput {
  /** GET /api/discord `enabled`; false or unknown (fetch failed) hides the strip only if explicitly false. */
  enabled: boolean | null;
  linked: boolean | null;
  guildMember: boolean | null;
  /** True when the GET /api/discord call itself failed (fail-open, unlike the store card). */
  fetchFailed: boolean;
}

export interface WelcomeChestInput {
  /** `eligibility.eligible === true && spin.claimed === false` from GET /api/daily-rewards. */
  ready: boolean;
  /** True when the daily-rewards fetch failed or has not resolved yet. */
  unknown: boolean;
}

export interface WelcomeConnectionInput {
  /** True once world.connected && the player entity exists in world.entities. */
  ready: boolean;
  /** Offline entry never waits on a connection. */
  offline: boolean;
}

export interface WelcomeNewsInput {
  state: 'loading' | 'loaded' | 'failed';
  releases: WelcomeReleaseSummary[];
}

export type ContinueButtonState = 'connecting' | 'ready';

export interface WelcomeScreenView {
  newsState: WelcomeNewsInput['state'];
  /** Releases newer than the stored last-seen marker (drives the NEW badge; capped at 5 total). */
  releases: (WelcomeReleaseSummary & { isNew: boolean })[];
  showArmoryCard: boolean;
  showChestTile: boolean;
  showDiscordStrip: boolean;
  continueState: ContinueButtonState;
}

const MAX_RELEASES_SHOWN = 5;

/** Client-side half of the Season 1 Armory gate: platform AND the server flag. */
export function armoryCardVisible(
  platform: WelcomePlatformInput,
  armoryPromoEnabledOnServer: boolean,
): boolean {
  if (platform.offline) return false;
  return shouldShowStorePromo(platform) && armoryPromoEnabledOnServer;
}

/** Chest tile rides the same platform gate as the Armory card, plus reward readiness. */
export function chestTileVisible(
  platform: WelcomePlatformInput,
  chest: WelcomeChestInput,
): boolean {
  if (platform.offline) return false;
  if (!shouldShowStorePromo(platform)) return false;
  return chest.ready && !chest.unknown;
}

/**
 * Discord strip: fail-OPEN (shown) when the status fetch failed or in offline mode,
 * hidden only when explicitly linked AND a guild member, hidden when the guild
 * integration is explicitly disabled (enabled === false).
 */
export function discordStripVisible(discord: WelcomeDiscordInput, offline: boolean): boolean {
  if (offline) return true;
  if (discord.fetchFailed) return true;
  if (discord.enabled === false) return false;
  return !(discord.linked === true && discord.guildMember === true);
}

/** Continue is disabled only while an online connection is still establishing. */
export function continueButtonState(connection: WelcomeConnectionInput): ContinueButtonState {
  if (connection.offline) return 'ready';
  return connection.ready ? 'ready' : 'connecting';
}

/**
 * Marks each release NEW relative to the stored last-seen id, then caps the list at 5.
 * Generic over T so a caller holding the FULL release shape (body/url/prerelease, see
 * NewsReleaseEntry in news_feed.ts) gets those fields back too, not just the minimal
 * WelcomeReleaseSummary shape: the welcome screen's compact news layout
 * (renderWelcomeNews) needs the full article to render the expanded latest release.
 */
export function markNewReleases<T extends WelcomeReleaseSummary>(
  releases: T[],
  lastSeenReleaseId: number | null,
): (T & { isNew: boolean })[] {
  return releases
    .slice(0, MAX_RELEASES_SHOWN)
    .map((r) => ({ ...r, isNew: lastSeenReleaseId === null || r.id > lastSeenReleaseId }));
}

/** The next last-seen marker to persist once the player has viewed this screen. */
export function nextLastSeenReleaseId(
  releases: WelcomeReleaseSummary[],
  previous: number | null,
): number | null {
  const max = releases.reduce((m, r) => Math.max(m, r.id), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(max)) return previous;
  return previous === null ? max : Math.max(previous, max);
}

export function buildWelcomeScreenView(
  platform: WelcomePlatformInput,
  news: WelcomeNewsInput,
  discord: WelcomeDiscordInput,
  chest: WelcomeChestInput,
  connection: WelcomeConnectionInput,
  armoryPromoEnabledOnServer: boolean,
  lastSeenReleaseId: number | null,
): WelcomeScreenView {
  return {
    newsState: news.state,
    releases: markNewReleases(news.releases, lastSeenReleaseId),
    showArmoryCard: armoryCardVisible(platform, armoryPromoEnabledOnServer),
    showChestTile: chestTileVisible(platform, chest),
    showDiscordStrip: discordStripVisible(discord, platform.offline),
    continueState: continueButtonState(connection),
  };
}

// --- One-shot Armory-open intent -------------------------------------------
//
// Clicking the Armory card sets a ONE-SHOT, NON-PERSISTENT intent to open the WOC
// Store once the HUD exists (after finishIntro when the spawn pan played, otherwise
// right after the loading fade). A crash/reload must never surprise-open the store
// on a later login, so this is sessionStorage-backed (cleared on tab close), not
// localStorage, and is always cleared the moment it is consumed.
const ARMORY_INTENT_KEY = 'woc.welcome.openArmoryIntent';

export function setArmoryOpenIntent(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(ARMORY_INTENT_KEY, '1');
}

/** Reads and clears the intent in one call: a second read in the same session sees nothing. */
export function consumeArmoryOpenIntent(storage: Pick<Storage, 'getItem' | 'removeItem'>): boolean {
  const had = storage.getItem(ARMORY_INTENT_KEY) === '1';
  if (had) storage.removeItem(ARMORY_INTENT_KEY);
  return had;
}
