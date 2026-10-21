// Realm-overlay types — display metadata that overlays the base sim without
// mutating it. A "realm" describes how the same underlying world should look
// and read (strings, colors, class skins, item-rarity flavor). It never
// touches Sim state, so the base game can be rebalanced or restructured and
// realm packs keep working.

/** Stable realm identifier (e.g. 'classic', 'hardcore'). Free-form string so
 *  consumers can register any set of realms. */
export type RealmId = string;

export type RealmRole = 'Tank' | 'DPS' | 'Healer' | 'Support' | 'Assassin' | 'Summoner';

/** A class skin: how a realm presents one of the underlying base classes. */
export interface RealmClassSkin {
  id: string;
  name: string;
  role: RealmRole;
  icon: string;
  color: string;
  lore: string;
  baseStats: RealmClassStats;
  skills: RealmClassSkill[];
  skillTrees: string[];
}

export interface RealmClassStats {
  maxHp: number; maxMp: number; str: number; dex: number; vit: number;
  nrg: number; dmg: number; def: number; spd: number;
}

export interface RealmClassSkill {
  name: string; icon: string; mp: number; type: string;
  dmg: number; range: number; desc: string; color: string;
}

/** Per-realm branding & UX overrides. Every field optional — unset fields keep
 *  the base value, so a realm can re-skin without forking index.html. */
export interface RealmBranding {
  /** Square logo path. Falls back to the base logo when undefined. */
  logoSrc?: string;
  /** Brand text shown in the header / SEO title. */
  brandText?: string;
  /** Loading-screen background image. */
  loadingScreenSrc?: string;
  /** Community Discord invite URL. */
  discordUrl?: string;
  /** Source repo URL. */
  githubUrl?: string;
  /** Show the Donate button. Defaults to false. */
  showDonate?: boolean;
  /** Show an optional SSO sign-in button on the login panel. */
  showSsoButton?: boolean;
}

export interface RealmContent {
  id: RealmId;
  name: string;
  tagline: string;
  description: string;
  mood: string;
  accentHex: string;
  bgGradient: string;
  previewColors: { primary: string; secondary: string; bg: string };
  classes: RealmClassSkin[];
  branding?: RealmBranding;
  /** Auto-load this realm when no preference exists. */
  isDefault?: boolean;
  /** Cross-realm hub: characters from any realm are admitted but combat /
   *  questing are disabled (e.g. a trade hub). */
  crossRealm?: boolean;
  /** First-person-only realm: lock the camera to first-person. */
  fpsOnly?: boolean;
}
