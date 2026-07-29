// Pure, host-agnostic view model for the inspect ("Profile") window.
//
// The pure-core half of the inspect module pair (inspect_window.ts is the thin
// painter). It turns another player's mirrored entity fields (all already
// client-side: class, skin, worn gear, and the $WOC / Discord / dev identity
// flair) into the structured model the painter draws: a compact header (name,
// deed title, level, class, class color), the three badge decisions (holder /
// Discord / dev, each gated exactly as the old inline card gated them), and the
// worn-gear paperdoll (reused from char_view's buildPaperdollView, so inspect
// inherits the sheet's 6/6 column split). A separate builder covers the thinner
// out-of-range remote-profile card.
//
// DOM-free, i18n-free, and free of any wall-clock call: localized text (deed
// title, badge names/labels) is resolved by the painter and passed in, and the
// "member since N days" math takes an injected `now`, so tests/inspect_view.test.ts
// pins every gate and the day math without a DOM or a real clock.

import { CLASSES } from '../sim/data';
import type { EquipSlot, ItemDef, PlayerClass, SkinCatalog } from '../sim/types';
import { buildPaperdollView, type PaperdollView } from './char_view';

/** Class color as a CSS hex string (mirrors hud.ts classCss): the inspect stage
 *  border / glow / haze take the inspected player's class color. */
export function classColorCss(cls: string): string {
  const color = (CLASSES as Record<string, { color: number }>)[cls]?.color ?? 0x5fa8ff;
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The compact inspect header: name, the optional active-deed title, level, and
 *  the class plus its color. `deedTitle` is null when the player has no active
 *  title (or its text resolved empty). */
export interface InspectHeaderModel {
  name: string;
  deedTitle: string | null;
  level: number;
  cls: PlayerClass;
  classColor: string;
}

/** $WOC holder-tier flair, present only for a connected holder (tier > 0).
 *  `balance` is the on-chain balance when known (> 0), else null. */
export interface InspectHolderModel {
  tierIndex: number;
  balance: number | null;
}

/** Linked-Discord flair, present only when the player has a Discord tier (> 0).
 *  `memberDays` is the whole days since they joined (null when unknown). */
export interface InspectDiscordModel {
  tierIndex: number;
  name: string | null;
  avatar: string | null;
  memberDays: number | null;
  role: string | null;
}

/** Contributor (dev-tier) flair, present only for an actual contributor (tier >
 *  0) AND only while the viewer's showDevBadges preference is on. */
export interface InspectDevModel {
  tierIndex: number;
  mergedPrs: number | null;
  githubLogin: string | null;
}

/** The three identity-flair decisions. A null field means that badge is hidden. */
export interface InspectBadgesModel {
  holder: InspectHolderModel | null;
  discord: InspectDiscordModel | null;
  dev: InspectDevModel | null;
}

/** The full inspect model: header, badges, worn-gear paperdoll, and the skin plus
 *  its catalog the live turntable should show (the catalog picks the rig: a
 *  mech-cosmetic player renders the mech, not their class model). */
export interface InspectViewModel {
  header: InspectHeaderModel;
  badges: InspectBadgesModel;
  gear: PaperdollView;
  skin: number;
  skinCatalog: SkinCatalog;
}

/** The plain inputs the painter feeds in from the inspected entity (localized
 *  strings pre-resolved, `now` injected for the member-days math). */
export interface InspectInput {
  name: string;
  level: number;
  cls: PlayerClass;
  skin: number;
  /** Which catalog `skin` indexes into ('class' or 'mech'), from the entity mirror. */
  skinCatalog: SkinCatalog;
  /** The active deed title text, already resolved by the painter; '' when none. */
  deedTitleText: string;
  equippedItems: Partial<Record<EquipSlot, string>>;
  holderTier: number;
  holderBalance: number | null;
  discordTier: number;
  discordName: string | null;
  discordAvatar: string | null;
  discordJoined: number | null;
  discordRole: string | null;
  devTier: number;
  devMergedPrs: number | null;
  githubLogin: string | null;
  showDevBadges: boolean;
  /** Wall-clock ms, injected (Date.now() at the call site) for the day math. */
  now: number;
}

const MS_PER_DAY = 86_400_000;

/** Build the full inspect model from an inspected player's fields and the item
 *  table. Every badge is gated exactly as the old inline inspect card gated it:
 *  holder/Discord hidden at tier 0, dev hidden at tier 0 OR when showDevBadges is
 *  off. Gear reuses char_view's buildPaperdollView, so inspect and the character
 *  sheet share the identical 6/6 column split. */
export function buildInspectView(
  input: InspectInput,
  items: Record<string, ItemDef>,
): InspectViewModel {
  const header: InspectHeaderModel = {
    name: input.name,
    deedTitle: input.deedTitleText !== '' ? input.deedTitleText : null,
    level: input.level,
    cls: input.cls,
    classColor: classColorCss(input.cls),
  };

  const holder: InspectHolderModel | null =
    input.holderTier > 0
      ? { tierIndex: input.holderTier, balance: input.holderBalance ? input.holderBalance : null }
      : null;

  const memberDays =
    typeof input.discordJoined === 'number'
      ? Math.max(0, Math.floor((input.now - input.discordJoined) / MS_PER_DAY))
      : null;
  const discord: InspectDiscordModel | null =
    input.discordTier > 0
      ? {
          tierIndex: input.discordTier,
          name: input.discordName,
          avatar: input.discordAvatar,
          memberDays,
          role: input.discordRole,
        }
      : null;

  const dev: InspectDevModel | null =
    input.showDevBadges && input.devTier > 0
      ? {
          tierIndex: input.devTier,
          mergedPrs: input.devMergedPrs,
          githubLogin: input.githubLogin,
        }
      : null;

  return {
    header,
    badges: { holder, discord, dev },
    gear: buildPaperdollView(input.equippedItems, items),
    skin: input.skin,
    skinCatalog: input.skinCatalog,
  };
}

/** The out-of-range remote-profile model: the thinner card shown when the named
 *  player is not inside interest scope. No worn gear, no identity flair, no live
 *  turntable, matching the public character sheet the crawlable page already
 *  serves. */
export interface InspectRemoteModel {
  name: string;
  level: number;
  cls: PlayerClass;
  classColor: string;
  guild: string | null;
}

export function buildInspectRemoteView(input: {
  name: string;
  level: number;
  cls: PlayerClass;
  guild: string | null;
}): InspectRemoteModel {
  return {
    name: input.name,
    level: input.level,
    cls: input.cls,
    classColor: classColorCss(input.cls),
    guild: input.guild,
  };
}
