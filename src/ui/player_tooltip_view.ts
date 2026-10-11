// Pure view for the mouseover tooltip of another player hovered in the world:
// the rebuild key, the model (resolved through injected lookups so a test needs
// no catalog), and the HTML. Registered in UI_PURE_CORES; the live resolvers
// are wired in player_tooltip.ts and Hud stays a thin consumer.
//
// Line order follows the classic unit tooltip: the class-colored name, the
// Book of Deeds title, the <Guild> line (or a pledge to one), the level and
// class, then the chosen specialization and its role.
import { esc } from './esc';

export interface PlayerTooltipModel {
  name: string;
  classLabel: string;
  classColor: string;
  level: number;
  /** Book of Deeds display title, already localized; absent or '' for none. */
  title?: string;
  guild?: string;
  /** The guild this player pledged to join; shown only when not in a guild. */
  pledgeGuild?: string;
  /** The chosen specialization, already localized; absent when none or unknown. */
  spec?: { name: string; role: string };
}

/** The slice of a hovered Entity the tooltip reads, spelled structurally so a
 *  test needs no full Entity. */
export interface PlayerTooltipSource {
  id: number;
  name: string;
  level: number;
  templateId: string;
  guild: string;
  pledgeGuild?: string;
  title?: string | null;
  specId?: string | null;
}

export interface PlayerTooltipI18n {
  t: (key: string, params?: Record<string, string>) => string;
  fmt: (value: number, opts?: Intl.NumberFormatOptions) => string;
}

/** The catalog lookups the model needs, injected so this core stays pure. */
export interface PlayerTooltipResolvers {
  classLabel(cls: string): string;
  classColor(cls: string): string;
  /** A deed id to its localized title; '' when unknown or not a title reward. */
  titleText(deedId: string): string;
  /** A class plus spec id to its localized name and role; null when unknown. */
  spec(cls: string, specId: string): { name: string; role: string } | null;
}

/** Everything the painted card depends on, so re-hovering the same player each
 *  frame reuses the card while a mid-hover change (a ding, a respec, a new
 *  title or guild) repaints it. */
export function playerTooltipKey(e: PlayerTooltipSource): string {
  return `player:${e.id}:${e.name}:${e.level}:${e.templateId}:${e.guild}:${e.pledgeGuild ?? ''}:${e.title ?? ''}:${e.specId ?? ''}`;
}

export function playerTooltipModel(
  e: PlayerTooltipSource,
  r: PlayerTooltipResolvers,
): PlayerTooltipModel {
  const spec = e.specId ? r.spec(e.templateId, e.specId) : null;
  return {
    name: e.name,
    classLabel: r.classLabel(e.templateId),
    classColor: r.classColor(e.templateId),
    level: e.level,
    title: e.title ? r.titleText(e.title) : '',
    guild: e.guild,
    pledgeGuild: e.pledgeGuild ?? '',
    ...(spec ? { spec } : {}),
  };
}

export function playerTooltipHtml(m: PlayerTooltipModel, deps: PlayerTooltipI18n): string {
  const level = deps.fmt(m.level, { maximumFractionDigits: 0 });
  const title = `<div class="tt-title" style="color:${m.classColor}">${esc(m.name)}</div>`;
  const deedTitle = m.title ? `<div class="tt-sub tt-player-title">${esc(m.title)}</div>` : '';
  // A member's line is their guild; a pledge borrows the line with the
  // nameplate's own pledge wording, so an aspiring member never reads as one.
  // The <> brackets are part of the catalog value, never concatenated here.
  const guild = m.guild
    ? `<div class="tt-sub tt-player-guild">${esc(deps.t('hudChrome.playerTooltip.guild', { guild: m.guild }))}</div>`
    : m.pledgeGuild
      ? `<div class="tt-sub tt-player-guild">${esc(deps.t('hudChrome.nameplate.pledgeTag', { guild: m.pledgeGuild }))}</div>`
      : '';
  const levelClass = `<div class="tt-sub">${esc(
    deps.t('itemUi.equipment.levelClass', { level, className: m.classLabel }),
  )}</div>`;
  const spec = m.spec
    ? `<div class="tt-sub tt-player-spec">${esc(
        deps.t('hudChrome.playerTooltip.specRole', { spec: m.spec.name, role: m.spec.role }),
      )}</div>`
    : '';
  return title + deedTitle + guild + levelClass + spec;
}
