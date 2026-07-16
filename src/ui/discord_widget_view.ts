// Pure view model for the Discord HUD widget.
//
// DOM-free and i18n-free: it takes the raw external state (link/rewards +
// presence + feature flag) and returns the structure the widget draws (which
// mode, which swag rows are claimable, the voice roster). The thin consumer
// (discord_widget.ts) maps the stable keys to t() and paints. Unit-tested in
// tests/discord_widget_view.test.ts. Mirrors src/ui/hud/vendor/vendor_view.ts.
import {
  canClaimSwag,
  DISCORD_STATUS_DEFS,
  DISCORD_SWAG,
  pointsToNextStatus,
  type SwagItem,
} from '../sim/discord_tier';
import type {
  DiscordAccountStatus,
  DiscordPresenceState,
  DiscordVoiceMember,
} from './discord_status';

export type DiscordWidgetMode = 'disabled' | 'unlinked' | 'linked';

export interface DiscordSwagRow {
  id: string;
  /** Stable label key (consumer resolves via t('hudChrome.discord.swag.<key>')). */
  key: string;
  kind: SwagItem['kind'];
  cost: number;
  minTier: number;
  claimed: boolean;
  claimable: boolean;
  /** Why a row is not claimable, for the disabled-button tooltip. */
  reason: 'ok' | 'claimed' | 'tier' | 'points';
}

export interface DiscordTierRow {
  /** 1-based rung index. */
  index: number;
  /** Stable key (drives the localized name + accent color in the consumer). */
  key: string;
  /** Lifetime points needed to reach this rung. */
  threshold: number;
  /** Whether the player has reached this rung. */
  reached: boolean;
  /** Whether this is the player's current rung. */
  current: boolean;
}

export interface DiscordWidgetView {
  mode: DiscordWidgetMode;
  username: string | null;
  /** Discord profile-picture URL, or null for a default avatar. */
  avatar: string | null;
  /** The player's current character name, for the profile link (null if unknown). */
  characterName: string | null;
  /** Public profile URL for the current character (/c/<name>), or null. */
  characterUrl: string | null;
  guildMember: boolean;
  /** Linked but not in the guild -> show a "join the Discord" nudge. */
  showJoinCta: boolean;
  points: number;
  lifetimePoints: number;
  tierIndex: number;
  /** Points needed to reach the next rung, or null at the top rung. */
  pointsToNext: number | null;
  /** The full status ladder, for the U-panel tier display (color/icon per stage). */
  tiers: DiscordTierRow[];
  swag: DiscordSwagRow[];
  /** Count of claimable swag rows (drives a badge on the widget button). */
  claimableCount: number;
  onlineCount: number;
  voiceChannelName: string | null;
  voice: DiscordVoiceMember[];
  inviteUrl: string;
}

export function buildDiscordWidgetView(input: {
  enabled: boolean;
  status: DiscordAccountStatus;
  presence: DiscordPresenceState;
  inviteUrl: string;
  /** Current character name (the widget links it to its public profile). */
  characterName?: string | null;
  /** Origin for building the character profile URL (defaults to '' in tests). */
  origin?: string;
}): DiscordWidgetView {
  const { enabled, status, presence, inviteUrl } = input;
  const characterName = input.characterName?.trim() || null;
  const origin = input.origin ?? '';
  const characterUrl = characterName ? `${origin}/c/${encodeURIComponent(characterName)}` : null;

  const swag: DiscordSwagRow[] = DISCORD_SWAG.map((item) => {
    const claimed = status.claimedSwagIds.includes(item.id);
    const verdict = canClaimSwag({
      swag: item,
      spendablePoints: status.points,
      statusTier: status.statusTier,
      claimedIds: status.claimedSwagIds,
    });
    return {
      id: item.id,
      key: item.key,
      kind: item.kind,
      cost: item.cost,
      minTier: item.minTier,
      claimed,
      claimable: verdict.ok,
      reason: verdict.reason,
    };
  });

  const tiers: DiscordTierRow[] = DISCORD_STATUS_DEFS.map((def) => ({
    index: def.index,
    key: def.key,
    threshold: def.threshold,
    reached: status.lifetimePoints >= def.threshold,
    current: def.index === status.statusTier,
  }));

  const mode: DiscordWidgetMode = !enabled ? 'disabled' : status.linked ? 'linked' : 'unlinked';

  return {
    mode,
    username: status.username,
    avatar: status.avatar,
    characterName: status.linked ? characterName : null,
    characterUrl: status.linked ? characterUrl : null,
    guildMember: status.guildMember,
    showJoinCta: status.linked && !status.guildMember,
    points: status.points,
    lifetimePoints: status.lifetimePoints,
    tierIndex: status.statusTier,
    pointsToNext: status.linked ? pointsToNextStatus(status.lifetimePoints) : null,
    tiers: status.linked ? tiers : [],
    swag: status.linked ? swag : [],
    claimableCount: status.linked ? swag.filter((s) => s.claimable).length : 0,
    onlineCount: Math.max(0, presence.onlineCount),
    voiceChannelName: presence.voiceChannelName,
    voice: presence.voice,
    inviteUrl,
  };
}
