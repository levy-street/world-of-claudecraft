// Decides when the guild billboard (MOTD) is echoed into the chat log: on fresh
// login (nothing shown yet) and whenever its TEXT changes mid-session. The caller
// (Hud) owns the last-shown latch and passes it in, so this stays a pure,
// Node-testable function. Keying off the MOTD value, never off social-frame
// arrival, is deliberate: the social snapshot is re-pushed on ANY social change
// (roster edits, friends going online), and none of those may re-trigger the line.

// The structural subset of IWorld's SocialInfo this decision reads. Both world
// shapes assign to it: the offline Sim pins socialInfo to null (the echo is
// online-only), and ClientWorld mirrors the social frame, where the motd field
// can be absent at runtime despite its wire type, hence the optional member.
export interface GuildMotdSocialView {
  guild: { motd?: string | null } | null;
}

export interface GuildMotdLineDecision {
  /** The MOTD text to log verbatim, or null when nothing should be shown. */
  emit: string | null;
  /** The next value for the caller's last-shown latch. */
  nextShown: string | null;
}

export function decideGuildMotdLine(
  lastShown: string | null,
  social: GuildMotdSocialView | null | undefined,
): GuildMotdLineDecision {
  const text = social?.guild?.motd ?? '';
  // Empty (offline, guildless, or a cleared billboard) shows nothing and resets
  // the latch, so a billboard cleared and later set back to the SAME text shows
  // again: from the player's view it changed twice.
  if (text.trim() === '') return { emit: null, nextShown: null };
  if (text === lastShown) return { emit: null, nextShown: lastShown };
  return { emit: text, nextShown: text };
}
