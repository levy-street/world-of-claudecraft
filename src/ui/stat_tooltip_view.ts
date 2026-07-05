// ---------------------------------------------------------------------------
// Character-sheet stat tooltip VIEW (pure: no DOM, no i18n runtime binding)
//
// Turns the structured StatTooltipModel (built by the pure model in
// stat_tooltip.ts) into the strings the HUD paints: the floating tooltip's
// HTML, the visually-hidden plain-text aria description that mirrors it, and
// the focusable stat-cell markup. Splitting the rendering out of hud.ts leaves
// the HUD a thin caller that only resolves the live model from the sim and
// wires attachTooltip, mirroring the unit_portrait.ts core + thin-painter split
// the src/ui/CLAUDE.md "new self-contained panel goes in its own module" rule
// calls for.
//
// i18n + number formatting are INJECTED (StatTooltipI18n) so this module is
// host-agnostic and unit-tested directly (tests/stat_tooltip_view.test.ts): the
// catalog keys it builds always exist, but it never imports the i18n runtime.
// ---------------------------------------------------------------------------
import { esc } from './esc';
import type { StatEffect, StatEffectKind, StatTooltipModel } from './stat_tooltip';

/** The localization + number-formatting surface the view borrows from the HUD.
 *  `t` takes a dotted catalog key (the HUD casts it to TranslationKey) plus
 *  already-stringified placeholder values; `fmt` is ui/i18n `formatNumber`, so
 *  every displayed number is locale-aware rather than hand-built. */
export interface StatTooltipI18n {
  t: (key: string, params?: Record<string, string>) => string;
  fmt: (value: number, opts?: Intl.NumberFormatOptions) => string;
}

// Effect kinds that read as a GAIN the stat grants (green), versus neutral
// informational facts (white): regen rates, the armor cell's damage reduction,
// and the dps the attack-power cell already folds in.
const GAIN_KINDS: ReadonlySet<StatEffectKind> = new Set<StatEffectKind>([
  'attackPower', 'rangedAttackPower', 'critPct', 'dodgePct',
  'armor', 'maxHealth', 'maxMana', 'spellCritPct',
]);

const int0 = (deps: StatTooltipI18n, v: number) => deps.fmt(v, { maximumFractionDigits: 0 });
const dec1 = (deps: StatTooltipI18n, v: number) =>
  deps.fmt(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The localized text of one contribution line (no markup), shared by the
 *  visual tooltip and the aria description so they read identical numbers.
 *  Whole-number gains (attack power, armor, health/mana pools and regen) print
 *  as integers; chances and the dps contribution keep one decimal. */
export function statEffectText(e: StatEffect, deps: StatTooltipI18n): string {
  const key = `hudChrome.statInfo.effects.${e.kind}`;
  switch (e.kind) {
    case 'attackPower':
    case 'rangedAttackPower':
    case 'armor':
    case 'maxHealth':
    case 'maxMana':
    case 'healthRegen':
    case 'manaRegen':
      return deps.t(key, { value: int0(deps, e.value) });
    case 'critPct':
    case 'dodgePct':
    case 'spellCritPct':
    case 'dpsFromAp':
      return deps.t(key, { value: dec1(deps, e.value) });
    case 'damageReduction':
      return deps.t(key, { level: int0(deps, e.level ?? 0), value: dec1(deps, e.value) });
  }
}

/** The localized note lines for a model (minor-for-class, the shared 5% base
 *  chance, the dps-estimate caveat), in display order. */
export function statNoteTexts(model: StatTooltipModel, deps: StatTooltipI18n): string[] {
  const notes: string[] = [];
  if (model.minorForClass) notes.push(deps.t('hudChrome.statInfo.notes.minorForClass'));
  if (model.baseChanceNote) notes.push(deps.t('hudChrome.statInfo.notes.baseChance'));
  if (model.dpsApproxNote) notes.push(deps.t('hudChrome.statInfo.notes.dpsApprox'));
  return notes;
}

/** The "From your N {stat}:" header above a primary stat's breakdown, or '' for
 *  derived cells and empty breakdowns. */
export function statBreakdownHeader(model: StatTooltipModel, deps: StatTooltipI18n): string {
  if (!model.isPrimary || !model.effects.length) return '';
  return deps.t('hudChrome.statInfo.fromYour', {
    value: int0(deps, model.statValue),
    stat: deps.t(`itemUi.stats.${model.stat}`),
  });
}

/** The floating tooltip's HTML: the stat name, the "what it does" prose, the
 *  optional "From your N {stat}" header, one line per contribution (green for a
 *  gain, white for an informational fact), then any note lines. */
export function statTooltipHtml(model: StatTooltipModel, deps: StatTooltipI18n): string {
  let html = `<div class="tt-title">${esc(deps.t(`itemUi.stats.${model.stat}`))}</div>`;
  html += `<div class="tt-body">${esc(deps.t(`hudChrome.statInfo.desc.${model.stat}`))}</div>`;
  const header = statBreakdownHeader(model, deps);
  if (header) html += `<div class="tt-bd-head">${esc(header)}</div>`;
  for (const e of model.effects) {
    const cls = GAIN_KINDS.has(e.kind) ? 'tt-green' : 'tt-stat';
    html += `<div class="${cls}">${esc(statEffectText(e, deps))}</div>`;
  }
  for (const note of statNoteTexts(model, deps)) html += `<div class="tt-sub">${esc(note)}</div>`;
  return html;
}

/** Plain-text equivalent for assistive tech (aria-describedby): the description,
 *  the live "From your N {stat}" breakdown, and any notes, so screen-reader
 *  users get the same class-aware numbers a sighted user reads in the floating,
 *  sighted-only tooltip. The stat name is omitted here because the cell's own
 *  visible text already names it. */
export function statTooltipAria(model: StatTooltipModel, deps: StatTooltipI18n): string {
  const parts = [deps.t(`hudChrome.statInfo.desc.${model.stat}`)];
  const header = statBreakdownHeader(model, deps);
  if (header) parts.push(header);
  for (const e of model.effects) parts.push(statEffectText(e, deps));
  parts.push(...statNoteTexts(model, deps));
  return parts.join(' ');
}

/** The stat cell's displayed value text: a one-decimal percent for crit/dodge,
 *  a one-decimal number for the dps estimate, otherwise a whole number. Sourced
 *  from model.statValue so the cell and the tooltip it opens cannot disagree. */
export function statValueText(model: StatTooltipModel, deps: StatTooltipI18n): string {
  if (model.stat === 'critChance' || model.stat === 'dodge') return `${dec1(deps, model.statValue)}%`;
  if (model.stat === 'dps') return dec1(deps, model.statValue);
  return int0(deps, model.statValue);
}

/** Build one focusable character-sheet stat cell: "Name: <b>value</b>" plus a
 *  visually-hidden, aria-describedby breakdown carrying the same live numbers as
 *  the (sighted-only) floating tooltip. The HUD attaches the tooltip afterwards
 *  by matching the data-stat attribute. The value comes from formatNumber, so it
 *  is left unescaped (digits / separators / percent only). */
export function statCellHtml(model: StatTooltipModel, deps: StatTooltipI18n): string {
  const name = esc(deps.t(`itemUi.stats.${model.stat}`));
  const value = statValueText(model, deps);
  const aria = esc(statTooltipAria(model, deps));
  return `<span class="stat-cell" data-stat="${model.stat}" tabindex="0" aria-describedby="statdesc-${model.stat}">`
    + `${name}: <b>${value}</b>`
    + `<span id="statdesc-${model.stat}" class="visually-hidden">${aria}</span></span>`;
}
