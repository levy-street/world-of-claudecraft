// Pure core for the Social window's Discord strip (menu consolidation step 5):
// the Discord window's rail button and U key left, so Social carries a compact
// footer strip instead: link state, the server's online count, the featured
// voice room, and one button that opens the full Discord panel. This decides
// what the strip shows; social_window.ts paints it.

import type { DiscordAccountStatus, DiscordPresenceState } from './discord_status';

export interface SocialDiscordStripInput {
  /** The Discord entry exists on this build (the panel hook is attached). */
  enabled: boolean;
  status: DiscordAccountStatus;
  presence: DiscordPresenceState;
}

export type SocialDiscordStrip =
  | { readonly visible: false }
  | {
      readonly visible: true;
      /** The linked username, or null when the account is not linked. */
      readonly username: string | null;
      readonly onlineCount: number;
      /** The featured voice room and how many sit in it, when one is set. */
      readonly voiceChannel: string | null;
      readonly voiceCount: number;
    };

export function buildSocialDiscordStrip(input: SocialDiscordStripInput): SocialDiscordStrip {
  if (!input.enabled) return { visible: false };
  const { status, presence } = input;
  return {
    visible: true,
    username: status.linked ? status.username : null,
    onlineCount: Math.max(0, presence.onlineCount),
    voiceChannel: presence.voiceChannelName,
    voiceCount: presence.voice.length,
  };
}
