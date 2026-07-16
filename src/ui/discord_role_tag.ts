// Single source mapping a special Discord role KEY (src/sim/discord_roles.ts) to
// its localized nameplate / inspect tag label. The world nameplate painter and
// both HUD discord cards (target frame + inspect card) resolve the tag through
// here, so the surfaced role set never drifts between those surfaces: that drift
// is exactly what once dropped Admin and Artist out of the game. Completeness
// against DISCORD_SPECIAL_ROLES is pinned by tests/discord_roles.test.ts.
import { type TranslationKey, t } from './i18n';

// One literal entry per DISCORD_SPECIAL_ROLES key. The label is a literal
// TranslationKey (not built from a template) so tsc verifies each key exists in
// the catalog, and the test above verifies the set matches the role catalog.
const DISCORD_ROLE_TAG_KEYS: Record<string, TranslationKey> = {
  levyst: 'hudChrome.discord.roleTag.levyst',
  admin: 'hudChrome.discord.roleTag.admin',
  coredevs: 'hudChrome.discord.roleTag.coredevs',
  devs: 'hudChrome.discord.roleTag.devs',
  seniormods: 'hudChrome.discord.roleTag.seniormods',
  mods: 'hudChrome.discord.roleTag.mods',
  juniormods: 'hudChrome.discord.roleTag.juniormods',
  artists: 'hudChrome.discord.roleTag.artists',
  contentcreator: 'hudChrome.discord.roleTag.contentcreator',
  legend: 'hudChrome.discord.roleTag.legend',
  shill: 'hudChrome.discord.roleTag.shill',
};

/** The i18n label key for a special role key, or undefined when it is not one. */
export function discordRoleTagKey(key: string | undefined | null): TranslationKey | undefined {
  return key ? DISCORD_ROLE_TAG_KEYS[key] : undefined;
}

/** The localized nameplate / inspect tag label for a special role key, '' when none. */
export function discordRoleTagLabel(key: string | undefined | null): string {
  const tk = discordRoleTagKey(key);
  return tk ? t(tk) : '';
}
