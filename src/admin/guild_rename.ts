export interface GuildRenameBody {
  name: string;
  reason: string;
}

export type GuildRenameBuild =
  | { body: GuildRenameBody }
  | { errorKey: 'guilds.renameNameRequired' | 'guilds.renameReasonRequired' };

// The server owns guild-name policy and uniqueness. The dashboard only prevents
// empty submissions and normalizes surrounding operator whitespace.
export function buildGuildRename(name: string, reason: string): GuildRenameBuild {
  const nextName = name.trim();
  if (!nextName) return { errorKey: 'guilds.renameNameRequired' };
  const moderationReason = reason.trim();
  if (!moderationReason) return { errorKey: 'guilds.renameReasonRequired' };
  return { body: { name: nextName, reason: moderationReason } };
}
