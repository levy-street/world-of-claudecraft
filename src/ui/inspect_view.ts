// Pure, host-agnostic view model for the inspect ("Profile") window.
//
// The pure-core half of the inspect module pair (inspect_window.ts is the thin
// painter). It turns another player's mirrored entity fields (all already
// client-side: class, skin, worn gear, the $WOC / Discord / dev identity flair,
// and the server-computed Curator standing) into the structured model the
// painter draws: a compact header (name, deed title, level, class, class color,
// Book of Deeds border accent), the four badge decisions (holder / Discord / dev
// / Curator sigil, each gated exactly as the old inline card gated them), the
// Reliquary standing line, and the worn-gear paperdoll (reused from char_view's
// buildPaperdollView, so inspect inherits the sheet's 6/6 column split). A
// separate builder covers the thinner out-of-range remote-profile card.
//
// DOM-free, i18n-free, and free of any wall-clock call: localized text (deed
// title, badge names/labels) is resolved by the painter and passed in, and the
// "member since N days" math takes an injected `now`, so tests/inspect_view.test.ts
// pins every gate and the day math without a DOM or a real clock.

import { CLASSES } from '../sim/data';
import type { EquipSlot, ItemDef, PlayerClass, SkinCatalog } from '../sim/types';
import { buildPaperdollView, type PaperdollView } from './char_view';
import { borderAccent, deedBorderSlug } from './deed_border_view';

/** Class color as a CSS hex string (mirrors hud.ts classCss): the inspect stage
 *  border / glow / haze take the inspected player's class color. */
export function classColorCss(cls: string): string {
  const color = (CLASSES as Record<string, { color: number }>)[cls]?.color ?? 0x5fa8ff;
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The Book of Deeds border accent for the header name row: the slug the painter
 *  writes into `data-border` plus that slug's palette, resolved here so the
 *  painter carries no color of its own. Null means "no accent to draw", which is
 *  every borderless, stale, title-reward, or drifted id (deed_border_view.ts owns
 *  both lookups and answers the empty case rather than guessing). */
export interface InspectBorderModel {
  slug: string;
  frame: string;
  edge: string;
  glow: string;
}

/** The compact inspect header: name, the optional active-deed title, level, the
 *  class plus its color, and the optional Book of Deeds border accent.
 *  `deedTitle` is null when the player has no active title (or its text resolved
 *  empty); `border` is null when there is no accent to draw. */
export interface InspectHeaderModel {
  name: string;
  deedTitle: string | null;
  level: number;
  cls: PlayerClass;
  classColor: string;
  border: InspectBorderModel | null;
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

/** Curator-sigil flair: the Reliquary's single-rung honor mark, present only for
 *  an Eternal Curator (rank 5). `rank` rides along so the painter resolves the
 *  rung's own localized name rather than hardcoding one. */
export interface InspectCuratorBadgeModel {
  rank: number;
}

/** The four identity-flair decisions. A null field means that badge is hidden. */
export interface InspectBadgesModel {
  holder: InspectHolderModel | null;
  discord: InspectDiscordModel | null;
  dev: InspectDevModel | null;
  curator: InspectCuratorBadgeModel | null;
}

/** The Reliquary standing line: the Curator rank plus the character-scoped
 *  completion pair behind it. Null for an unranked player, and null when the
 *  server sent a rank without the pair (the line is a PAIR readout, so it fails
 *  closed rather than printing a half line). */
export interface InspectCuratorModel {
  rank: number;
  owned: number;
  total: number;
}

/**
 * The one Curator rank that carries the sigil. A literal, not the ladder's
 * length: the badge is locked to Eternal Curator to keep it exclusive, so a
 * future sixth rung must be a deliberate decision here rather than silently
 * moving the honor. tests/inspect_view.test.ts pins it against the live ladder's
 * top rung, so a re-tiered ladder reds instead of drifting.
 */
export const CURATOR_SIGIL_MIN_RANK = 5;

/** The full inspect model: header, badges, worn-gear paperdoll, and the skin plus
 *  its catalog the live turntable should show (the catalog picks the rig: a
 *  mech-cosmetic player renders the mech, not their class model). */
export interface InspectViewModel {
  header: InspectHeaderModel;
  badges: InspectBadgesModel;
  /** The Reliquary standing line, or null when there is none to show. */
  curator: InspectCuratorModel | null;
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
  /** The active Book of Deeds BORDER as a deed ID (the raw wire value, never a
   *  slug and never display text); null for a borderless player. */
  border: string | null;
  /** Server-computed Curator rank: 0 unranked, 1-5 Apprentice…Eternal Curator. */
  curatorRank: number;
  /** Character-scoped relics owned / total behind that rank, both null when the
   *  server sent no standing (an offline world, or a pre-Curator server). */
  relicsOwned: number | null;
  relicsTotal: number | null;
  /**
   * The viewer's OWN live standing, supplied only when the inspected player IS
   * the viewer, and preferred over the three wire fields above when present.
   *
   * The three wire fields answer "what did the server last broadcast about this
   * player", which is the only thing available for anyone else and is exactly
   * right for them. For yourself it is the wrong source twice over: offline
   * there is no server to have broadcast anything, so self-inspect showed NO
   * standing at all, and online the broadcast rides the 60s flair cycle, so
   * self-inspect showed a standing up to a minute stale while the Reliquary
   * window open beside it showed the live one. Both hosts can answer this
   * locally and exactly, so for yourself they do.
   *
   * Null (the default) is every other player, and leaves the entity-derived
   * behavior untouched.
   */
  selfStanding?: { curatorRank: number; owned: number; total: number } | null;
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
 *  off. The Curator additions gate the same fail-closed way: the sigil at rank
 *  CURATOR_SIGIL_MIN_RANK, the standing line at rank >= 1 WITH its pair, and the
 *  border accent on the palette. Those two gates read `selfStanding` when the
 *  caller supplied it (the viewer inspecting themselves) and the mirrored wire
 *  fields otherwise. Gear reuses char_view's buildPaperdollView, so inspect and
 *  the character sheet share the identical 6/6 column split. */
export function buildInspectView(
  input: InspectInput,
  items: Record<string, ItemDef>,
): InspectViewModel {
  // The border accent is gated on the PALETTE, exactly as the unit-frame's
  // paintPortraitBorder gates it: an id whose content record is gone, a
  // title-reward deed, or a slug the table does not cover resolves to no accent,
  // so a drifted id renders like a borderless player instead of a bare frame.
  const borderSlug = deedBorderSlug(input.border);
  const accent = borderAccent(borderSlug);
  const header: InspectHeaderModel = {
    name: input.name,
    deedTitle: input.deedTitleText !== '' ? input.deedTitleText : null,
    level: input.level,
    cls: input.cls,
    classColor: classColorCss(input.cls),
    border: accent
      ? { slug: borderSlug, frame: accent.frame, edge: accent.edge, glow: accent.glow }
      : null,
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

  // ONE standing for both the line and the sigil, resolved before either gate:
  // the viewer's own live reads when inspecting themselves, the mirrored wire
  // fields for anybody else. Resolving it here rather than at each gate is what
  // keeps the two from ever disagreeing about which source they read.
  const standing = input.selfStanding ?? null;
  const rank = standing !== null ? standing.curatorRank : input.curatorRank;
  const owned = standing !== null ? standing.owned : input.relicsOwned;
  const total = standing !== null ? standing.total : input.relicsTotal;

  // The Reliquary line needs the whole PAIR: a rank with no counts behind it
  // would print a label and nothing to read, so it fails closed the same way a
  // missing badge does.
  const curator: InspectCuratorModel | null =
    rank > 0 && owned !== null && total !== null ? { rank, owned, total } : null;

  // The sigil is rank-derived alone: the pair is presentation for the line, not
  // evidence of the honor, so a standing whose counts went missing still shows
  // the badge the rank earned.
  const curatorBadge: InspectCuratorBadgeModel | null =
    rank >= CURATOR_SIGIL_MIN_RANK ? { rank } : null;

  return {
    header,
    badges: { holder, discord, dev, curator: curatorBadge },
    curator,
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
