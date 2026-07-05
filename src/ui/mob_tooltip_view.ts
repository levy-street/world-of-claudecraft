// ---------------------------------------------------------------------------
// World mob-hover tooltip VIEW (pure: no DOM, no i18n runtime binding, no
// render/sim coupling). Mirrors stat_tooltip_view.ts: i18n + number formatting
// are injected so this module stays host-agnostic and is unit-tested directly.
// The caller (src/ui/hud.ts) resolves the entity/template/con-color, plus the
// already-localized Questie-style quest lines; this only turns the resolved
// MobTooltipModel into the tooltip's HTML.
// ---------------------------------------------------------------------------
import { esc } from './esc';

/** One Questie-style quest line pair: the quest's already-localized title
 *  (green) over its objective progress line (gold), e.g.
 *  "Wolves at the Door" / "Forest Wolf slain: 3/8". */
export interface MobTooltipQuestLine {
  title: string;
  progress: string;
}

export interface MobTooltipModel {
  /** Already-localized display name. */
  name: string;
  level: number;
  /** Already-localized creature-type label (e.g. "Beasts"). */
  familyLabel: string;
  /** Nameplate con-color hex, so the tooltip name matches the in-world label. */
  color: string;
  /** Whether the mob will attack the viewer (Entity.hostile), for the reaction line. */
  hostile: boolean;
  /** Active-quest objectives this mob advances (Questie-style), rendered
   *  between the level/family line and the reaction line. Empty = no lines. */
  quests: MobTooltipQuestLine[];
}

/** The localization + number-formatting surface the view borrows from the HUD,
 *  same shape as StatTooltipI18n (stat_tooltip_view.ts). */
export interface MobTooltipI18n {
  t: (key: string, params?: Record<string, string>) => string;
  fmt: (value: number, opts?: Intl.NumberFormatOptions) => string;
}

export function mobTooltipHtml(m: MobTooltipModel, deps: MobTooltipI18n): string {
  const level = deps.fmt(m.level, { maximumFractionDigits: 0 });
  const title = `<div class="tt-title" style="color:${m.color}">${esc(m.name)}</div>`;
  const sub = `<div class="tt-sub" style="color:${m.color}">${esc(
    deps.t('hudChrome.mobTooltip.levelFamily', { level, family: m.familyLabel }),
  )}</div>`;
  // Questie-style quest lines: quest title (green) over its progress (gold),
  // one pair per active objective this mob advances.
  let quests = '';
  for (const q of m.quests) {
    quests +=
      `<div class="tt-quest-name">${esc(q.title)}</div>` +
      `<div class="tt-quest-obj">${esc(q.progress)}</div>`;
  }
  const reactionClass = m.hostile ? 'tt-red' : 'tt-green';
  const reactionKey = m.hostile ? 'hudChrome.mobTooltip.hostile' : 'hudChrome.mobTooltip.friendly';
  const reaction = `<div class="${reactionClass}">${esc(deps.t(reactionKey))}</div>`;
  return title + sub + quests + reaction;
}
