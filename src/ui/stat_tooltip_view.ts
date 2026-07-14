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
import type { StatEffect, StatEffectKind, StatSource, StatTooltipModel } from './stat_tooltip';

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
  'attackPower',
  'rangedAttackPower',
  'critPct',
  'dodgePct',
  'armor',
  'maxHealth',
  'maxMana',
  'spellCritPct',
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

// Crit and dodge are shown as percents (one decimal); every other stat's source
// values are whole numbers.
const isPercentStat = (model: StatTooltipModel) =>
  model.stat === 'critChance' || model.stat === 'dodge' || model.stat === 'warfare';

/** The catalog key for a stat's display name. Most reuse the shared
 *  itemUi.stats.* labels; Spell Power is a character-sheet-only stat whose label
 *  lives in the English-only HUD-chrome domain instead. */
export function statNameKey(stat: StatTooltipModel['stat']): string {
  // Character-sheet rating labels live in the HUD-chrome domain instead of the
  // core item-stats catalog (WARFARE items author ratings, not final percentages).
  return stat === 'spellPower' ||
    stat === 'critRating' ||
    stat === 'hasteRating' ||
    stat === 'warfare'
    ? `hudChrome.statInfo.names.${stat}`
    : `itemUi.stats.${stat}`;
}

function statDescriptionText(model: StatTooltipModel, deps: StatTooltipI18n): string {
  if (model.stat !== 'warfare') return deps.t(`hudChrome.statInfo.desc.${model.stat}`);
  return deps.t('hudChrome.statInfo.desc.warfare', {
    increase: dec1(deps, model.warfareDamageIncrease ?? model.statValue),
    reduction: dec1(deps, model.warfareDamageReduction ?? model.statValue),
  });
}

/** The localized text of one upstream source line: "Base: 40", "From Agility:
 *  +52", "Equipped gear: +85", "Mark of the Wild: +12", "Talents and effects:
 *  +30". Buff lines carry the resolved aura name; the attribute line names the
 *  primary it derives from when known. Contributions other than the base print
 *  with an explicit sign so additions and reductions read clearly. */
export function statSourceText(
  source: StatSource,
  model: StatTooltipModel,
  deps: StatTooltipI18n,
): string {
  const fmt = (v: number) =>
    isPercentStat(model) ? dec1(deps, Math.abs(v)) : int0(deps, Math.abs(v));
  const signed = (v: number) => `${v < 0 ? '−' : '+'}${fmt(v)}`;
  switch (source.kind) {
    case 'base':
      return deps.t('hudChrome.statInfo.sources.base', { value: fmt(source.value) });
    case 'attributes':
      return source.fromStat
        ? deps.t('hudChrome.statInfo.sources.fromAttribute', {
            stat: deps.t(`itemUi.stats.${source.fromStat}`),
            value: signed(source.value),
          })
        : deps.t('hudChrome.statInfo.sources.attributes', { value: signed(source.value) });
    case 'gear':
      return deps.t('hudChrome.statInfo.sources.gear', { value: signed(source.value) });
    case 'buff':
      return deps.t('hudChrome.statInfo.sources.buff', {
        name: source.name ?? '',
        value: signed(source.value),
      });
    case 'talents':
      return deps.t('hudChrome.statInfo.sources.talents', { value: signed(source.value) });
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
    stat: deps.t(statNameKey(model.stat)),
  });
}

/** The "Made up of:" header above a stat's upstream source breakdown, or '' when
 *  the stat has no source lines (the dps estimate). */
export function statSourcesHeader(model: StatTooltipModel, deps: StatTooltipI18n): string {
  if (!model.sources.length) return '';
  return deps.t('hudChrome.statInfo.sources.header');
}

/** The floating tooltip's HTML: the stat name, the "what it does" prose, the
 *  optional "From your N {stat}" downstream header + effect lines, the upstream
 *  "Made up of:" source breakdown (base / attributes / gear / each buff by name /
 *  talents), then any note lines. */
export function statTooltipHtml(model: StatTooltipModel, deps: StatTooltipI18n): string {
  let html = `<div class="tt-title">${esc(deps.t(statNameKey(model.stat)))}</div>`;
  html += `<div class="tt-body">${esc(statDescriptionText(model, deps))}</div>`;
  const header = statBreakdownHeader(model, deps);
  if (header) html += `<div class="tt-bd-head">${esc(header)}</div>`;
  for (const e of model.effects) {
    const cls = GAIN_KINDS.has(e.kind) ? 'tt-green' : 'tt-stat';
    html += `<div class="${cls}">${esc(statEffectText(e, deps))}</div>`;
  }
  const srcHeader = statSourcesHeader(model, deps);
  if (srcHeader) html += `<div class="tt-bd-head">${esc(srcHeader)}</div>`;
  for (const s of model.sources) {
    html += `<div class="tt-stat">${esc(statSourceText(s, model, deps))}</div>`;
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
  const parts = [statDescriptionText(model, deps)];
  const header = statBreakdownHeader(model, deps);
  if (header) parts.push(header);
  for (const e of model.effects) parts.push(statEffectText(e, deps));
  const srcHeader = statSourcesHeader(model, deps);
  if (srcHeader) parts.push(srcHeader);
  for (const s of model.sources) parts.push(statSourceText(s, model, deps));
  parts.push(...statNoteTexts(model, deps));
  return parts.join(' ');
}

/** The stat cell's displayed value text: a one-decimal percent for crit/dodge,
 *  a one-decimal number for the dps estimate, otherwise a whole number. Sourced
 *  from model.statValue so the cell and the tooltip it opens cannot disagree. */
export function statValueText(model: StatTooltipModel, deps: StatTooltipI18n): string {
  if (model.stat === 'warfare') {
    return deps.t('hudChrome.statInfo.warfareValue', {
      increase: dec1(deps, model.warfareDamageIncrease ?? model.statValue),
      reduction: dec1(deps, model.warfareDamageReduction ?? model.statValue),
    });
  }
  if (model.stat === 'critChance' || model.stat === 'dodge')
    return `${dec1(deps, model.statValue)}%`;
  if (model.stat === 'dps') return dec1(deps, model.statValue);
  return int0(deps, model.statValue);
}

/** Build one focusable character-sheet stat cell: "Name: <b>value</b>" plus a
 *  visually-hidden, aria-describedby breakdown carrying the same live numbers as
 *  the (sighted-only) floating tooltip. The HUD attaches the tooltip afterwards
 *  by matching the data-stat attribute. The value comes from formatNumber, so it
 *  is left unescaped (digits / separators / percent only). */
export function statCellHtml(model: StatTooltipModel, deps: StatTooltipI18n): string {
  const name = esc(deps.t(statNameKey(model.stat)));
  const value = statValueText(model, deps);
  const aria = esc(statTooltipAria(model, deps));
  return (
    `<span class="stat-cell" data-stat="${model.stat}" tabindex="0" aria-describedby="statdesc-${model.stat}">` +
    `${name}: <b>${value}</b>` +
    `<span id="statdesc-${model.stat}" class="visually-hidden">${aria}</span></span>`
  );
}
