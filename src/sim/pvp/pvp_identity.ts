// The rename-proof identity World PvP books key a character by (the
// honorTeamIdentity convention: database character ids online, the stable
// character name offline). Shared by the hourly repeat decay (world_pvp.ts) and
// the King of the Hill bounty books (hill_bounty.ts), so a relog, which mints a
// new entity id, resets neither.
import type { PlayerMeta } from '../sim';

export function pvpIdentityOf(meta: Pick<PlayerMeta, 'characterId' | 'name'>): string {
  return meta.characterId !== undefined
    ? `character:${meta.characterId}`
    : `name:${meta.name.trim().toLowerCase()}`;
}
