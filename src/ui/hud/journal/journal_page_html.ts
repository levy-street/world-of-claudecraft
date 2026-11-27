// Markup for the Adventure Journal (strings only, never DOM): the instance
// list, the phone's breadcrumb and boss strip, the boss banner (portrait,
// "raid, boss N of M", the one-line summary and stat chips, the difficulty
// selector), the underline section tabs, the Overview (the encounter and its
// 3D model, Strategy by role), the Abilities (phase headers with their health
// pill, one row per ability that opens on its full text and fact chips), the
// Loot and Mythic's Coming soon panel. Every label is a t() key, every number
// goes through the locale formatters, every interpolation through esc(). The
// window (adventure_journal_window.ts) owns the state, the DOM, the events and
// the focus; the decisions (pill shape, fact chips, list status) are the pure
// core's (journal_banner_view.ts).

import { ITEMS } from '../../../sim/data';
import type { ItemDef } from '../../../sim/types';
import {
  choicesHtml,
  damageCompareText,
  formattedJournalValues,
  heroicNotesHtml,
  markChipsHtml,
  markLabels,
} from '../../boss_journal/journal_sections';
import type {
  JournalBossView,
  JournalChip,
  JournalFlag,
  JournalMechanic,
  JournalPhase,
  JournalRole,
  JournalTipRole,
} from '../../boss_journal/journal_view';
import { itemDisplayName, tEntity } from '../../entity_i18n';
import { esc } from '../../esc';
import { FOCUS_KEY_ATTR } from '../../focus_restore';
import {
  formatList,
  formatNumber,
  type InterpolationValues,
  type TranslationKey,
  t,
} from '../../i18n';
import { iconDataUrl } from '../../icons';
import { marketNameColor } from '../../market_name_color';
import { targetPortraitUrl } from '../../target_portrait_view';
import { svgIcon, type UiIconName } from '../../ui_icons';
import { sourceQualifierBits } from '../loot_explorer';
import {
  englishTemplate,
  type JournalDamageSchool,
  type JournalNavStatus,
  journalMechanicFacts,
  journalNavStatus,
  journalRangeLabel,
} from './journal_banner_view';
import type { JournalInstance, JournalTier } from './journal_catalog';
import type { JournalLootRow } from './journal_loot_view';
import type {
  JournalNavBoss,
  JournalNavGroup,
  JournalNavInstance,
  JournalPageState,
  JournalTab,
} from './journal_nav_view';

// Small line glyphs drawn for this window (a chevron, a back arrow, the people
// of an everyone tag, a clock and a flame for the fact chips). Decorative:
// every control that carries one has its own accessible name.
const GLYPH_CHEVRON =
  '<svg class="aj-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const GLYPH_BACK =
  '<svg class="aj-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const GLYPH_PEOPLE =
  '<svg class="aj-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="7" cy="6.5" r="2.8" fill="currentColor"/><circle cx="13.5" cy="7.5" r="2.3" fill="currentColor"/><path d="M1.8 16c.4-3 2.5-4.8 5.2-4.8s4.8 1.8 5.2 4.8zM12.6 16c-.2-1.6-.8-2.9-1.7-3.8.8-.5 1.6-.7 2.6-.7 2.2 0 3.9 1.5 4.3 4.5z" fill="currentColor"/></svg>';
const GLYPH_CLOCK =
  '<svg class="aj-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const GLYPH_FLAME =
  '<svg class="aj-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8.6 1.5c.4 2.2-.6 3.4-1.7 4.6C5.7 7.4 4.5 8.7 4.5 10.6A3.5 3.5 0 008 14.5a3.5 3.5 0 003.5-3.6c0-1.5-.7-2.4-1.3-3.2-.1 1-.6 1.7-1.3 2 .4-2.4-.1-5.6-.3-8.2z" fill="currentColor"/></svg>';

const ROLE_PRESENTATION: Readonly<Record<JournalRole, [TranslationKey, UiIconName | null]>> = {
  tank: ['hudChrome.raidBossGuide.roleTank', 'tank'],
  healer: ['hudChrome.raidBossGuide.roleHealer', 'healer'],
  damage: ['hudChrome.raidBossGuide.roleDamage', 'attack'],
  all: ['hudChrome.adventureJournal.roleEveryone', null],
};

const FLAG_PRESENTATION: Readonly<Record<JournalFlag, [TranslationKey, UiIconName]>> = {
  deadly: ['hudChrome.raidBossGuide.flagDeadly', 'skull'],
  interruptible: ['hudChrome.raidBossGuide.flagInterruptible', 'alert'],
  important: ['hudChrome.raidBossGuide.flagImportant', 'alert'],
  cleansable: ['hudChrome.raidBossGuide.flagCleansable', 'check'],
};

/** The flags a row marks beside the name. Important is on most lines and says
 *  nothing a reader acts on, so it stays in the accessible label only. */
const SHOWN_FLAGS: readonly JournalFlag[] = ['deadly', 'interruptible', 'cleansable'];

const STRATEGY_ROLES: readonly JournalTipRole[] = ['tank', 'healer', 'damage'];

const TIER_KEYS: Readonly<Record<JournalTier, TranslationKey>> = {
  normal: 'hudChrome.raidBossGuide.normal',
  heroic: 'hudChrome.raidBossGuide.heroic',
  mythic: 'hudChrome.adventureJournal.mythic',
};

const TAB_KEYS: Readonly<Record<JournalTab, TranslationKey>> = {
  overview: 'hudChrome.adventureJournal.tabOverview',
  abilities: 'hudChrome.adventureJournal.tabAbilities',
  loot: 'hudChrome.adventureJournal.tabLoot',
};

const SCHOOL_KEYS: Readonly<Record<JournalDamageSchool, TranslationKey>> = {
  arcane: 'hudChrome.adventureJournal.factDamageArcane',
  fire: 'hudChrome.adventureJournal.factDamageFire',
  frost: 'hudChrome.adventureJournal.factDamageFrost',
  nature: 'hudChrome.adventureJournal.factDamageNature',
  physical: 'hudChrome.adventureJournal.factDamagePhysical',
  shadow: 'hudChrome.adventureJournal.factDamageShadow',
};

export function tierName(tier: JournalTier): string {
  return t(TIER_KEYS[tier]);
}

export function mobName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

export function instanceName(id: string): string {
  return tEntity({ kind: 'dungeon', id, field: 'name' });
}

/** A page's display name: its own short title (a council's), else every
 *  body's name. */
export function pageName(members: readonly string[], nameKey?: TranslationKey): string {
  return nameKey ? t(nameKey) : formatList(members.map(mobName));
}

/** Placeholder values formatted the way the page's source authored them: the
 *  shipped raid guide keeps its whole-number formatting, data-as-code pages
 *  print fractional cast times. */
export function pageValues(
  instance: JournalInstance,
  values: Readonly<Record<string, number>> | undefined,
  percentValues: readonly string[] = [],
): InterpolationValues | undefined {
  if (!instance.legacyFormat) return formattedJournalValues(values, percentValues);
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      formatNumber(
        value,
        percentValues.includes(name) ? { style: 'percent', maximumFractionDigits: 0 } : undefined,
      ),
    ]),
  );
}

const percent = (value: number): string =>
  formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });

// Private-use characters no catalog string carries: they mark a value's
// place through t() and esc() (neither touches them), then turn into <b>.
const MARK_OPEN = String.fromCharCode(0xe000);
const MARK_CLOSE = String.fromCharCode(0xe001);
const MARKED_VALUE = new RegExp(`${MARK_OPEN}([0-9]+)${MARK_CLOSE}`, 'g');

/** A translated line whose placeholder values print bold. The values are
 *  marked with private-use characters (no catalog string carries them)
 *  before translation and the whole line is escaped afterwards, so neither
 *  the template nor a value can inject markup. */
export function boldValuesHtml(
  key: TranslationKey,
  values: InterpolationValues | undefined,
  plain: readonly string[] = [],
): string {
  if (!values) return esc(t(key));
  const names = Object.keys(values);
  const marked = Object.fromEntries(
    names.map((name, i) => [name, `${MARK_OPEN}${i}${MARK_CLOSE}`]),
  );
  return esc(t(key, marked)).replace(MARKED_VALUE, (_, i: string) => {
    const name = names[Number(i)];
    const text = esc(String(values[name] ?? ''));
    return plain.includes(name) ? text : `<b>${text}</b>`;
  });
}

// ---- the window head and its frame ------------------------------------------------

// One corner ornament of the window's thin metal frame: a bracket that follows
// the rounded corner with a small diamond rivet. Drawn top-left; the other
// three are the same mark mirrored by CSS. Decorative, never hit-tested.
const FRAME_CORNER =
  '<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false"><path d="M1.5 26V10A8.5 8.5 0 0110 1.5h16" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 26V12a6.5 6.5 0 016.5-6.5h14" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.55"/><path d="M10 1.5l2.4 2.4L10 6.3 7.6 3.9z" fill="currentColor"/></svg>';

/** The four corner ornaments of the window's metal frame. */
export function frameCornersHtml(): string {
  return ['tl', 'tr', 'bl', 'br']
    .map(
      (at) => `<span class="aj-corner aj-corner-${at}" aria-hidden="true">${FRAME_CORNER}</span>`,
    )
    .join('');
}

export function headHtml(instance: JournalInstance): string {
  return `<div class="aj-head panel-title"><span class="aj-title-sigil" aria-hidden="true">${svgIcon(
    'journal',
  )}</span><span id="aj-title">${esc(t('hudChrome.adventureJournal.title'))}</span><span class="aj-head-crumb">${esc(
    instanceName(instance.id),
  )}</span><button type="button" class="x-btn aj-close" data-close data-focus-key="close" aria-label="${esc(
    t('hudChrome.adventureJournal.close'),
  )}">${svgIcon('close')}</button></div>`;
}

// ---- navigation -----------------------------------------------------------------

const GROUP_KEYS: Readonly<Record<'dungeon' | 'raid', TranslationKey>> = {
  dungeon: 'hudChrome.adventureJournal.groupDungeons',
  raid: 'hudChrome.adventureJournal.groupRaids',
};

/** The words under a boss in the list (null when there is nothing to say). */
export function navStatusText(status: JournalNavStatus): string | null {
  switch (status) {
    case 'engaged':
      return t('hudChrome.adventureJournal.inCombat');
    case 'defeated':
      return t('hudChrome.raidBossGuide.defeated');
    case 'next':
      return t('hudChrome.adventureJournal.statusNext');
    case 'final':
      return t('hudChrome.raidBossGuide.rankFinal');
    case 'miniboss':
      return t('hudChrome.raidBossGuide.rankMiniboss');
    default:
      return null;
  }
}

function navBossHtml(instance: JournalNavInstance, boss: JournalNavBoss): string {
  const bossName = pageName(boss.members, boss.nameKey);
  const status = journalNavStatus(boss);
  const statusText = navStatusText(status);
  const label = formatList([bossName, statusText].filter((part): part is string => !!part));
  const mark =
    status === 'defeated' ? svgIcon('check') : status === 'engaged' ? svgIcon('attack') : '';
  return `<li><button type="button" class="aj-boss${boss.selected ? ' active' : ''}${
    boss.defeated ? ' defeated' : ''
  }${boss.engaged ? ' engaged' : ''}${boss.next ? ' next' : ''}" data-nav-item data-boss="${esc(
    boss.key,
  )}" data-boss-instance="${esc(instance.id)}" ${FOCUS_KEY_ATTR}="boss:${esc(instance.id)}:${esc(
    boss.key,
  )}"${boss.selected ? ' aria-current="page"' : ''} aria-label="${esc(
    label,
  )}"><span class="aj-boss-portrait"><img src="${esc(
    boss.portraitUrl,
  )}" alt="" aria-hidden="true"></span><span class="aj-boss-text"><span class="aj-boss-name">${esc(
    bossName,
  )}</span>${
    statusText
      ? `<span class="aj-boss-status aj-status-${status}">${mark}<span>${esc(statusText)}</span></span>`
      : ''
  }</span></button></li>`;
}

export function navHtml(groups: readonly JournalNavGroup[]): string {
  return `<nav class="aj-nav" id="aj-nav" aria-label="${esc(t('hudChrome.adventureJournal.navLabel'))}">${groups
    .map((group) => {
      const titleId = `aj-group-${group.kind}`;
      return `<section class="aj-group" aria-labelledby="${titleId}"><h3 class="aj-group-title" id="${titleId}">${esc(
        t(GROUP_KEYS[group.kind]),
      )}</h3>${group.instances
        .map((instance) => {
          const name = instanceName(instance.id);
          const listId = `aj-bosses-${instance.id}`;
          const total = formatNumber(instance.bosses.length);
          const defeated = formatNumber(instance.defeatedCount);
          const toggleLabel = formatList(
            [
              t(
                instance.expanded
                  ? 'hudChrome.adventureJournal.collapseInstance'
                  : 'hudChrome.adventureJournal.expandInstance',
                { instance: name },
              ),
              instance.current ? t('hudChrome.adventureJournal.youAreHere') : null,
              instance.defeatedCount > 0
                ? t('hudChrome.adventureJournal.bossProgress', { defeated, total })
                : null,
            ].filter((part): part is string => part !== null),
          );
          const count =
            instance.defeatedCount > 0
              ? `<span class="aj-instance-count" aria-hidden="true">${esc(
                  t('hudChrome.adventureJournal.bossCount', { defeated, total }),
                )}</span>`
              : '';
          const bosses = instance.expanded
            ? `<ul class="aj-boss-list" id="${esc(listId)}">${instance.bosses
                .map((boss) => navBossHtml(instance, boss))
                .join('')}</ul>`
            : '';
          return `<div class="aj-instance${instance.expanded ? ' expanded' : ''}${
            instance.current ? ' current' : ''
          }${instance.holdsSelection ? ' holds-selection' : ''}"><button type="button" class="aj-instance-toggle" data-nav-item data-instance="${esc(
            instance.id,
          )}" ${FOCUS_KEY_ATTR}="instance:${esc(instance.id)}" aria-expanded="${instance.expanded}"${
            instance.expanded ? ` aria-controls="${esc(listId)}"` : ''
          } aria-label="${esc(toggleLabel)}"><span class="aj-chevron" aria-hidden="true">${GLYPH_CHEVRON}</span><span class="aj-instance-name">${esc(
            name,
          )}</span>${instance.current ? '<span class="aj-here-dot" aria-hidden="true"></span>' : ''}${count}</button>${bosses}</div>`;
        })
        .join('')}</section>`;
    })
    .join('')}</nav>`;
}

/** The phone's top of page: a breadcrumb that opens the instance list, and a
 *  row of the open instance's boss portraits. */
export function mobileTopHtml(groups: readonly JournalNavGroup[], navOpen: boolean): string {
  const group = groups.find((entry) => entry.instances.some((i) => i.holdsSelection));
  const instance = group?.instances.find((entry) => entry.holdsSelection);
  if (!group || !instance) return '';
  const crumb = boldValuesHtml(
    'hudChrome.adventureJournal.mobileCrumb',
    {
      group: t(GROUP_KEYS[group.kind]),
      instance: instanceName(instance.id),
    },
    ['group'],
  );
  const strip = instance.bosses
    .map((boss) => {
      const status = navStatusText(journalNavStatus(boss));
      const label = formatList(
        [
          t('hudChrome.raidBossGuide.browseBoss', { boss: pageName(boss.members, boss.nameKey) }),
          status,
        ].filter((part): part is string => !!part),
      );
      return `<button type="button" class="aj-strip-boss${boss.selected ? ' active' : ''}${
        boss.defeated ? ' defeated' : ''
      }${boss.engaged ? ' engaged' : ''}" data-boss="${esc(boss.key)}" data-boss-instance="${esc(
        instance.id,
      )}" ${FOCUS_KEY_ATTR}="strip:${esc(instance.id)}:${esc(boss.key)}"${
        boss.selected ? ' aria-current="page"' : ''
      } aria-label="${esc(label)}"><img src="${esc(boss.portraitUrl)}" alt="" aria-hidden="true"></button>`;
    })
    .join('');
  return `<div class="aj-mobile-top"><button type="button" class="aj-crumb" data-browse data-focus-key="browse" aria-expanded="${navOpen}" aria-controls="aj-nav" title="${esc(
    t('hudChrome.adventureJournal.openList'),
  )}">${GLYPH_BACK}<span>${crumb}</span></button><div class="aj-strip">${strip}</div></div>`;
}

// ---- the boss banner ------------------------------------------------------------

export interface JournalStepTarget {
  key: string;
  members: readonly string[];
  nameKey?: TranslationKey;
}

export function stepButtonHtml(step: -1 | 1, target: JournalStepTarget | null): string {
  const icon = step < 0 ? 'prev' : 'next';
  const label = target
    ? t(
        step < 0
          ? 'hudChrome.adventureJournal.previousBoss'
          : 'hudChrome.adventureJournal.nextBoss',
        { boss: pageName(target.members, target.nameKey) },
      )
    : t(
        step < 0
          ? 'hudChrome.adventureJournal.noPreviousBoss'
          : 'hudChrome.adventureJournal.noNextBoss',
      );
  return `<button type="button" class="aj-step aj-step-${step < 0 ? 'prev' : 'next'}" data-step="${step}" ${FOCUS_KEY_ATTR}="step:${step}" aria-label="${esc(
    label,
  )}" title="${esc(label)}"${target ? '' : ' disabled'}>${svgIcon(icon)}</button>`;
}

export interface JournalBannerInput {
  instance: JournalInstance;
  members: readonly string[];
  view: JournalBossView;
  state: JournalPageState;
  index: number;
  total: number;
  tier: JournalTier;
  /** The tier has a page to open the 3D model on (not Mythic's panel). */
  modelButton: boolean;
  /** The darkened picture of the boss's room behind the banner, or null for
   *  the plain banner (journal_backdrop_view.ts). Cosmetic only. */
  backdropUrl?: string | null;
  /** The personal progress strip under the chips (journal_progress_html.ts). */
  progressHtml?: string;
  /** The kicker's chip for a page the character is saved on, shown when the
   *  run the player stands in says nothing about this page. */
  savedChipHtml?: string;
}

/** A council member's portrait: the page's own art for its lead body, else
 *  the member's own committed portrait. */
function mobPortrait(mobId: string, view: JournalBossView): string {
  if (mobId === view.mobId) return view.portraitUrl;
  return targetPortraitUrl(mobId, true) ?? view.portraitUrl;
}

function chipHtml(instance: JournalInstance, chip: JournalChip): string {
  return `<li class="aj-stat-chip">${boldValuesHtml(
    chip.key,
    pageValues(instance, chip.values, chip.percentValues),
  )}</li>`;
}

export function bannerHtml(input: JournalBannerInput): string {
  const { instance, members, view, state } = input;
  const kicker = t('hudChrome.adventureJournal.bannerKicker', {
    instance: instanceName(instance.id),
    index: formatNumber(input.index + 1),
    total: formatNumber(input.total),
  });
  const status = state.engaged
    ? `<span class="aj-chip-status aj-chip-engaged">${svgIcon('attack')}${esc(t('hudChrome.adventureJournal.inCombat'))}</span>`
    : state.defeated
      ? `<span class="aj-chip-status aj-chip-defeated">${svgIcon('check')}${esc(t('hudChrome.raidBossGuide.defeated'))}</span>`
      : (input.savedChipHtml ?? '');
  const bossName = pageName(members, view.nameKey);
  const portrait =
    members.length > 1
      ? `<ul class="aj-council" aria-label="${esc(t('hudChrome.adventureJournal.councilMembers'))}">${members
          .map(
            (mobId) =>
              `<li class="aj-council-member" title="${esc(mobName(mobId))}"><img src="${esc(
                mobPortrait(mobId, view),
              )}" alt="${esc(mobName(mobId))}"></li>`,
          )
          .join('')}</ul>`
      : `<div class="aj-portrait"><img src="${esc(view.portraitUrl)}" alt="" aria-hidden="true"></div>`;
  const tagline = view.tagline
    ? `<p class="aj-tagline">${esc(
        t(view.tagline.key, pageValues(instance, view.tagline.values, view.tagline.percentValues)),
      )}</p>`
    : `<p class="aj-tagline aj-tagline-overview">${esc(
        t(view.overviewKey, pageValues(instance, view.overviewValues, view.overviewPercentValues)),
      )}</p>`;
  const chips = view.chips?.length
    ? `<ul class="aj-stat-chips">${view.chips.map((chip) => chipHtml(instance, chip)).join('')}</ul>`
    : '';
  const modelLabel = t('guide.viewer.view3d', { name: bossName });
  const modelButton = input.modelButton
    ? `<button type="button" class="aj-model-jump" data-show-model ${FOCUS_KEY_ATTR}="show-model" aria-label="${esc(
        modelLabel,
      )}" title="${esc(modelLabel)}">${svgIcon('eye')}</button>`
    : '';
  const art = input.backdropUrl
    ? `<img class="aj-banner-art" src="${esc(input.backdropUrl)}" alt="" aria-hidden="true">`
    : '';
  return `<header class="aj-banner${art ? ' has-art' : ''}">${art}<div class="aj-portrait-wrap${members.length > 1 ? ' aj-portrait-wrap-council' : ''}">${portrait}${modelButton}</div><div class="aj-banner-text"><div class="aj-kicker"><span>${esc(
    kicker,
  )}</span>${status}</div><h2 class="aj-boss-title" id="aj-boss-name">${esc(bossName)}</h2>${tagline}${chips}${input.progressHtml ?? ''}</div>${difficultyHtml(
    instance,
    input.tier,
  )}</header>`;
}

/** How many skulls each difficulty wears beside its name (Normal 1, Heroic 2,
 *  Mythic 3): the classic danger mark, decorative (the name says it). */
export const TIER_SKULLS: Readonly<Record<JournalTier, number>> = {
  normal: 1,
  heroic: 2,
  mythic: 3,
};

function skullsHtml(tier: JournalTier): string {
  return `<span class="aj-skulls" aria-hidden="true">${svgIcon('skull').repeat(TIER_SKULLS[tier])}</span>`;
}

export function difficultyHtml(instance: JournalInstance, tier: JournalTier): string {
  const label = t('hudChrome.raidBossGuide.difficultyLabel');
  const soon = instance.tiers.includes('mythic')
    ? `<span class="aj-soon-note">${esc(t('hudChrome.adventureJournal.mythicSoon'))}</span>`
    : '';
  return `<div class="aj-diffbox"><div class="rbg-segmented aj-diff" role="group" aria-label="${esc(
    label,
  )}">${instance.tiers
    .map((entry) => {
      const selected = entry === tier;
      return `<button type="button" data-difficulty="${entry}" ${FOCUS_KEY_ATTR}="difficulty:${entry}" aria-pressed="${selected}" aria-label="${esc(
        t('hudChrome.raidBossGuide.chooseDifficulty', { difficulty: tierName(entry) }),
      )}" class="${selected ? 'active' : ''}${entry === 'mythic' ? ' aj-tier-mythic' : ''}">${skullsHtml(
        entry,
      )}<span class="aj-tier-name">${
        entry === 'mythic' ? svgIcon('lock') : ''
      }<span>${esc(tierName(entry))}</span></span></button>`;
    })
    .join('')}</div>${soon}</div>`;
}

export const SECTION_TAB_CLASS = 'aj-tab';
export const SECTION_TAB_ACTIVE = 'active';

/** The section tabs (absent on Mythic's panel) and the previous / next boss. */
export function tabBarHtml(
  tab: JournalTab,
  tabs: readonly JournalTab[] | null,
  prev: JournalStepTarget | null,
  next: JournalStepTarget | null,
): string {
  const strip = tabs
    ? `<div class="aj-tabs" role="tablist" aria-label="${esc(t('hudChrome.adventureJournal.sectionsLabel'))}">${tabs
        .map((entry) => {
          const selected = entry === tab;
          return `<button type="button" class="${SECTION_TAB_CLASS}${selected ? ` ${SECTION_TAB_ACTIVE}` : ''}" role="tab" id="aj-tab-${entry}" data-tab="${entry}" ${FOCUS_KEY_ATTR}="tab:${entry}" aria-selected="${selected}" aria-controls="aj-panel" tabindex="${selected ? '0' : '-1'}">${esc(
            t(TAB_KEYS[entry]),
          )}</button>`;
        })
        .join('')}</div>`
    : '<div class="aj-tabs-spacer"></div>';
  return `<div class="aj-tabbar">${strip}<div class="aj-steps">${stepButtonHtml(-1, prev)}${stepButtonHtml(
    1,
    next,
  )}</div></div>`;
}

// ---- Mythic ---------------------------------------------------------------------

export function comingSoonHtml(instance: JournalInstance): string {
  const back = instance.tiers
    .filter((tier) => tier !== 'mythic')
    .map(
      (tier) =>
        `<button type="button" class="aj-soon-tier" data-difficulty="${tier}" ${FOCUS_KEY_ATTR}="soon:${tier}">${esc(
          t('hudChrome.adventureJournal.readTier', { difficulty: tierName(tier) }),
        )}</button>`,
    )
    .join('');
  return `<section class="aj-soon" aria-labelledby="aj-soon-title"><div class="aj-soon-sigil" aria-hidden="true">${svgIcon(
    'lock',
  )}</div><div class="aj-soon-kicker">${esc(tierName('mythic'))}</div><h3 id="aj-soon-title">${esc(
    t('hudChrome.adventureJournal.comingSoon'),
  )}</h3><p>${esc(t('hudChrome.adventureJournal.comingSoonBody'))}</p><div class="aj-soon-actions">${back}</div></section>`;
}

// ---- Overview: the encounter, its model, Strategy by role -----------------------

function roleMechanics(view: JournalBossView, role: JournalTipRole): JournalMechanic[] {
  const out: JournalMechanic[] = [];
  for (const phase of view.phases) {
    for (const mechanic of phase.mechanics) {
      if (mechanic.roles.includes(role) && !out.some((m) => m.id === mechanic.id))
        out.push(mechanic);
    }
  }
  return out;
}

function roleIcon(role: JournalRole): string {
  const icon = ROLE_PRESENTATION[role][1];
  return icon ? svgIcon(icon) : GLYPH_PEOPLE;
}

export function overviewHtml(instance: JournalInstance, view: JournalBossView): string {
  const about = `<section class="aj-about" aria-labelledby="aj-about-title"><div class="aj-about-model" data-model-slot></div><div class="aj-about-text"><h3 class="aj-section-title" id="aj-about-title">${esc(
    t('hudChrome.adventureJournal.aboutHeading'),
  )}</h3><p>${esc(
    t(view.overviewKey, pageValues(instance, view.overviewValues, view.overviewPercentValues)),
  )}</p>${heroicNotesHtml(view.heroicNotes)}</div></section>`;
  const cards = STRATEGY_ROLES.map((role) => {
    const [labelKey] = ROLE_PRESENTATION[role];
    const tip = view.tips?.find((entry) => entry.role === role);
    const mechanics = roleMechanics(view, role);
    const watch = mechanics.length
      ? `<div class="aj-watch"><span class="aj-watch-label">${esc(
          t('hudChrome.adventureJournal.watchFor'),
        )}</span><ul>${mechanics
          .map((mechanic) => {
            const name = t(
              mechanic.nameKey,
              pageValues(instance, mechanic.values, mechanic.percentValues),
            );
            return `<li><button type="button" class="aj-watch-link" data-jump="${esc(mechanic.id)}" ${FOCUS_KEY_ATTR}="jump:${esc(
              role,
            )}:${esc(mechanic.id)}" aria-label="${esc(
              t('hudChrome.adventureJournal.jumpToAbility', { ability: name }),
            )}"><img src="${esc(iconDataUrl('ability', mechanic.iconId, 32))}" alt="" aria-hidden="true">${esc(
              name,
            )}</button></li>`;
          })
          .join('')}</ul></div>`
      : '';
    const body = tip
      ? `<p>${esc(t(tip.key, pageValues(instance, tip.values, tip.percentValues)))}</p>`
      : mechanics.length
        ? ''
        : `<p class="aj-muted">${esc(t('hudChrome.adventureJournal.roleNothing'))}</p>`;
    return `<article class="aj-role-card aj-role-card-${role}"><header><span class="aj-role-badge aj-role-${role}" aria-hidden="true">${roleIcon(
      role,
    )}</span><h4>${esc(t(labelKey))}</h4></header>${body}${watch}</article>`;
  }).join('');
  return `${about}<section class="aj-strategy" aria-labelledby="aj-strategy-title"><h3 class="aj-section-title" id="aj-strategy-title">${esc(
    t('hudChrome.adventureJournal.strategyHeading'),
  )}</h3><div class="aj-role-grid">${cards}</div></section>${choicesHtml(view.choices)}`;
}

// ---- Abilities ------------------------------------------------------------------

export function mechanicTagLabels(mechanic: JournalMechanic): string[] {
  return [
    ...mechanic.roles.map((role) => t(ROLE_PRESENTATION[role][0])),
    ...mechanic.flags.map((flag) => t(FLAG_PRESENTATION[flag][0])),
    ...markLabels(mechanic.marks),
  ];
}

function roleTagsHtml(mechanic: JournalMechanic): string {
  return mechanic.roles
    .map(
      (role) =>
        `<span class="aj-role-tag aj-role-${role}">${roleIcon(role)}<span>${esc(
          t(ROLE_PRESENTATION[role][0]),
        )}</span></span>`,
    )
    .join('');
}

function flagTagsHtml(mechanic: JournalMechanic): string {
  return SHOWN_FLAGS.filter((flag) => mechanic.flags.includes(flag))
    .map((flag) => {
      const [key, icon] = FLAG_PRESENTATION[flag];
      return `<span class="aj-flag aj-flag-${flag}">${svgIcon(icon)}<span>${esc(t(key))}</span></span>`;
    })
    .join('');
}

/** An opened ability's fact chips: its hit at this tier and its timer. */
export function factsHtml(mechanic: JournalMechanic): string {
  const facts = journalMechanicFacts(englishTemplate(mechanic.summaryKey), mechanic.values);
  const parts: string[] = [];
  if (facts.damage) {
    const range = {
      min: formatNumber(facts.damage.min, { maximumFractionDigits: 1 }),
      max: formatNumber(facts.damage.max, { maximumFractionDigits: 1 }),
    };
    const key = facts.damage.school
      ? SCHOOL_KEYS[facts.damage.school]
      : 'hudChrome.adventureJournal.factDamage';
    parts.push(`<span class="aj-fact">${GLYPH_FLAME}<span>${esc(t(key, range))}</span></span>`);
  }
  if (facts.every !== null) {
    parts.push(
      `<span class="aj-fact">${GLYPH_CLOCK}<span>${esc(
        t('hudChrome.adventureJournal.factEvery', {
          seconds: formatNumber(facts.every, { maximumFractionDigits: 1 }),
        }),
      )}</span></span>`,
    );
  }
  return parts.length ? `<div class="aj-facts">${parts.join('')}</div>` : '';
}

function mechanicHtml(
  instance: JournalInstance,
  mechanic: JournalMechanic,
  expanded: boolean,
  tier: JournalTier,
): string {
  const values = pageValues(instance, mechanic.values, mechanic.percentValues);
  const name = t(mechanic.nameKey, values);
  const detailId = `aj-detail-${mechanic.id}`;
  const doId = `aj-do-${mechanic.id}`;
  const action = t(
    expanded ? 'hudChrome.raidBossGuide.collapseAbility' : 'hudChrome.raidBossGuide.expandAbility',
    { ability: name },
  );
  const tags = mechanicTagLabels(mechanic);
  const accessible = tags.length
    ? t('hudChrome.raidBossGuide.abilityControlLabel', { action, details: formatList(tags) })
    : action;
  const deadly = mechanic.flags.includes('deadly');
  const compare =
    mechanic.compare && tier === 'heroic'
      ? `<p class="aj-compare">${esc(damageCompareText(mechanic.compare))}</p>`
      : '';
  return `<article class="aj-ab${expanded ? ' open' : ''}${deadly ? ' deadly' : ''}" data-ability="${esc(
    mechanic.id,
  )}"><button type="button" class="aj-ab-row" data-mechanic="${esc(mechanic.id)}" ${FOCUS_KEY_ATTR}="mechanic:${esc(
    mechanic.id,
  )}" aria-expanded="${expanded}"${expanded ? ` aria-controls="${esc(detailId)}"` : ''} aria-describedby="${esc(
    doId,
  )}" aria-label="${esc(accessible)}"><span class="ui-socket aj-ab-socket" aria-hidden="true"><img class="aj-ab-icon" src="${esc(
    iconDataUrl('ability', mechanic.iconId, 48),
  )}" alt=""></span><span class="aj-ab-main"><span class="aj-ab-name"><span class="aj-ab-title">${esc(
    name,
  )}</span>${flagTagsHtml(mechanic)}${markChipsHtml(mechanic.marks)}</span><span class="aj-ab-do" id="${esc(
    doId,
  )}">${esc(t(mechanic.responseKey, values))}</span></span><span class="aj-ab-tags">${roleTagsHtml(
    mechanic,
  )}</span><span class="aj-ab-chev" aria-hidden="true">${GLYPH_CHEVRON}</span></button>${
    expanded
      ? `<div class="aj-ab-detail" id="${esc(detailId)}" data-detail="${esc(mechanic.id)}"><p>${esc(
          t(mechanic.summaryKey, values),
        )}</p>${compare}${factsHtml(mechanic)}</div>`
      : ''
  }</article>`;
}

/** A phase pill's words, or null for a phase with no health band. */
export function phaseRangeText(phase: JournalPhase): string | null {
  const label = journalRangeLabel(phase.health);
  if (!label) return null;
  switch (label.kind) {
    case 'whole':
      return t('hudChrome.adventureJournal.phaseRangeWhole');
    case 'band':
      return t('hudChrome.adventureJournal.phaseRangeBand', {
        from: percent(label.from),
        to: percent(label.to),
      });
    case 'toEnd':
      return t('hudChrome.adventureJournal.phaseRangeToEnd', { from: percent(label.from) });
    case 'at':
      return t('hudChrome.adventureJournal.phaseRangeAt', {
        marks: formatList(label.at.map(percent)),
      });
  }
}

function phaseHtml(
  instance: JournalInstance,
  phase: JournalPhase,
  open: boolean,
  expandedMechanic: string | null,
  tier: JournalTier,
): string {
  const values = pageValues(instance, phase.values, phase.percentValues);
  const bodyId = `aj-phase-${phase.id}`;
  const range = phaseRangeText(phase);
  const summary =
    range && phase.rangeOnly
      ? ''
      : `<p class="aj-phase-summary">${esc(t(phase.summaryKey, values))}</p>`;
  return `<section class="aj-phase${open ? ' open' : ''}" data-phase="${esc(phase.id)}"><h3 class="aj-phase-head"><button type="button" class="aj-phase-toggle" data-phase-toggle="${esc(
    phase.id,
  )}" ${FOCUS_KEY_ATTR}="phase:${esc(phase.id)}" aria-expanded="${open}"${
    open ? ` aria-controls="${esc(bodyId)}"` : ''
  }><span class="aj-phase-name">${esc(t(phase.nameKey))}</span>${
    range ? `<span class="aj-phase-range">${esc(range)}</span>` : ''
  }<span class="aj-chevron" aria-hidden="true">${GLYPH_CHEVRON}</span></button></h3>${
    open
      ? `${summary}<div class="aj-abilities" id="${esc(bodyId)}">${phase.mechanics
          .map((mechanic) =>
            mechanicHtml(instance, mechanic, mechanic.id === expandedMechanic, tier),
          )
          .join('')}</div>`
      : ''
  }</section>`;
}

export function abilitiesHtml(
  instance: JournalInstance,
  view: JournalBossView,
  closedPhases: ReadonlySet<string>,
  expandedMechanic: string | null,
  tier: JournalTier,
): string {
  return `<div class="aj-phases">${view.phases
    .map((phase) => phaseHtml(instance, phase, !closedPhases.has(phase.id), expandedMechanic, tier))
    .join('')}</div>`;
}

export function mechanicTooltipHtml(
  instance: JournalInstance,
  phase: JournalPhase,
  mechanic: JournalMechanic,
  tier: JournalTier,
): string {
  const values = pageValues(instance, mechanic.values, mechanic.percentValues);
  const meta = t('hudChrome.raidBossGuide.tooltipMeta', {
    phase: t(phase.nameKey),
    difficulty: tierName(tier),
  });
  const response = t('hudChrome.raidBossGuide.whatToDoResponse', {
    response: t(mechanic.responseKey, values),
  });
  const compare = mechanic.compare
    ? `<div class="tt-desc">${esc(damageCompareText(mechanic.compare))}</div>`
    : '';
  return `<div class="tt-title">${esc(t(mechanic.nameKey, values))}</div><div class="tt-sub">${esc(
    meta,
  )}</div><div class="tt-desc">${esc(t(mechanic.summaryKey, values))}</div><div class="tt-desc">${esc(
    response,
  )}</div>${compare}`;
}

// ---- Loot -----------------------------------------------------------------------

export function lootHtml(
  rows: readonly JournalLootRow[],
  members: readonly string[],
  tier: JournalTier,
  itemIcon: (item: ItemDef) => string,
): string {
  if (rows.length === 0) {
    return `<section class="aj-loot-empty"><div class="aj-soon-sigil" aria-hidden="true">${svgIcon(
      'chest',
    )}</div><p>${esc(t('hudChrome.adventureJournal.lootNone', { difficulty: tierName(tier) }))}</p></section>`;
  }
  return `<ul class="aj-loot" aria-label="${esc(
    t('hudChrome.adventureJournal.lootLabel', { difficulty: tierName(tier) }),
  )}">${rows
    .map((row) => {
      const def = ITEMS[row.itemId];
      if (!def) return '';
      const bits = sourceQualifierBits({
        category: 'raid',
        chance: row.chance,
        restrictedToClass: row.restrictedToClass,
        gatedByQuestId: row.gatedByQuestId,
      });
      if (members.length > 1) {
        bits.push(t('hudChrome.adventureJournal.lootFrom', { boss: mobName(row.dropsFrom) }));
      }
      // The AA-lifted name palette (rare and epic read 3.8:1 in the raw
      // quality hues on this panel).
      const color = marketNameColor(row.quality);
      return `<li class="aj-loot-row aj-quality-${esc(row.quality)}" tabindex="0" data-item-id="${esc(
        row.itemId,
      )}" ${FOCUS_KEY_ATTR}="loot:${esc(row.itemId)}"><span class="ui-socket ui-socket--bag aj-loot-slot">${itemIcon(
        def,
      )}</span><span class="aj-loot-text"><span class="aj-loot-name" style="color:${color}">${esc(
        itemDisplayName(def),
      )}</span><span class="aj-loot-detail">${esc(bits.join(' · '))}</span></span></li>`;
    })
    .join('')}</ul>`;
}
