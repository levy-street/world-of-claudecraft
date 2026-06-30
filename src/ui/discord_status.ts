// Client-side Discord integration state surfaced in the HUD widget.
//
// Discord link status, reward points/tier, server presence and voice-room
// membership are all external account/network state, NOT world state, so (like
// src/ui/wallet_balance.ts) they do not belong on IWorld. main.ts is the one
// layer that knows both net and ui; it fetches this state over REST and pushes
// it in here, and the HUD reads it out. A single listener re-renders the widget
// when anything changes. src/ui never imports src/net, so these view-facing
// types are owned here.

/** A member currently sitting in the featured Discord voice room. */
export interface DiscordVoiceMember {
  id: string;
  name: string;
  speaking: boolean;
  selfMute: boolean;
}

/** The linked account's reward + link state (server-authoritative). */
export interface DiscordAccountStatus {
  linked: boolean;
  username: string | null;
  /** Discord profile-picture URL (CDN), or null for a default avatar. */
  avatar: string | null;
  /** Whether the linked user is a member of the official Discord guild. */
  guildMember: boolean;
  /** Spendable reward points. */
  points: number;
  /** Lifetime reward points (drives the status tier; never decreases). */
  lifetimePoints: number;
  /** 1-based status rung (0 = not linked). */
  statusTier: number;
  /** Swag ids already claimed by this account. */
  claimedSwagIds: string[];
}

/** Live Discord presence pushed by the bot via the server. */
export interface DiscordPresenceState {
  /** Members currently online in the Discord guild. */
  onlineCount: number;
  /** Total members in the Discord guild. */
  memberTotal: number;
  /** Name of the featured voice room, or null when none is configured. */
  voiceChannelName: string | null;
  /** Who is currently in the featured voice room. */
  voice: DiscordVoiceMember[];
}

const UNLINKED: DiscordAccountStatus = {
  linked: false,
  username: null,
  avatar: null,
  guildMember: false,
  points: 0,
  lifetimePoints: 0,
  statusTier: 0,
  claimedSwagIds: [],
};

const NO_PRESENCE: DiscordPresenceState = {
  onlineCount: 0,
  memberTotal: 0,
  voiceChannelName: null,
  voice: [],
};

let enabled = false;
let status: DiscordAccountStatus = UNLINKED;
let presence: DiscordPresenceState = NO_PRESENCE;
let inviteUrl = '';
let listener: (() => void) | null = null;

/** Whether the Discord feature is enabled in this client build. */
export function discordUiEnabled(): boolean {
  return enabled;
}

export function discordStatus(): DiscordAccountStatus {
  return status;
}

export function discordPresence(): DiscordPresenceState {
  return presence;
}

export function discordInviteUrl(): string {
  return inviteUrl;
}

export function setDiscordUiEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  listener?.();
}

export function setDiscordInviteUrl(value: string): void {
  if (inviteUrl === value) return;
  inviteUrl = value;
  listener?.();
}

export function setDiscordStatus(value: DiscordAccountStatus | null): void {
  status = value ?? UNLINKED;
  listener?.();
}

export function setDiscordPresence(value: DiscordPresenceState | null): void {
  presence = value ?? NO_PRESENCE;
  listener?.();
}

/** Reset to logged-out defaults (called on logout / disconnect). */
export function resetDiscordStatus(): void {
  status = UNLINKED;
  presence = NO_PRESENCE;
  listener?.();
}

/** Register the HUD's re-render hook (one consumer: the Discord widget). */
export function onDiscordStatusChange(cb: () => void): void {
  listener = cb;
}
