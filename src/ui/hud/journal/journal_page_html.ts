// Markup for the Adventure Journal (strings only, never DOM): the navigation
// list, the boss page header, the difficulty and section tabs, the Overview
// (Strategy by role), Abilities (collapsible phases and mechanics) and Loot
// sections, and Mythic's Coming soon panel. Every label is a t() key, every
// number goes through the locale formatters, every interpolation through
// esc(). The window (adventure_journal_window.ts) owns the state, the DOM, the
// events and the focus; the dungeon-only sections it shares with the old
// guide come from boss_journal/journal_sections.ts.

import { ITEMS } from '../../../sim/data';
import type { ItemDef } from '../../../sim/types';
import {
  choicesHtml,
  damageCompareText,
  formattedJournalValues,
  heroicNotesHtml,
  markChipsHtml,
  markLabels,
  rankLabel,
} from '../../boss_journal/journal_sections';
import type {
  JournalBossView,
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
  tPlural,
} from '../../i18n';
import { iconDataUrl, QUALITY_COLOR } from '../../icons';
import { targetPortraitUrl } from '../../target_portrait_view';
import { svgIcon, type UiIconName } from '../../ui_icons';
import { sourceQualifierBits } from '../loot_explorer';
import type { JournalInstance, JournalTier } from './journal_catalog';
import type { JournalLootRow } from './journal_loot_view';
import type { JournalNavGroup, JournalPageState, JournalTab } from './journal_nav_view';

const ROLE_PRESENTATION: Readonly<Record<JournalRole, [TranslationKey, UiIconName]>> = {
  tank: ['hudChrome.raidBossGuide.roleTank', 'tank'],
  healer: ['hudChrome.raidBossGuide.roleHealer', 'healer'],
  damage: ['hudChrome.raidBossGuide.roleDamage', 'attack'],
  all: ['hudChrome.raidBossGuide.roleAll', 'target'],
};

const FLAG_PRESENTATION: Readonly<Record<JournalFlag, [TranslationKey, UiIconName]>> = {
  deadly: ['hudChrome.raidBossGuide.flagDeadly', 'skull'],
  interruptible: ['hudChrome.raidBossGuide.flagInterruptible', 'alert'],
  important: ['hudChrome.raidBossGuide.flagImportant', 'alert'],
  cleansable: ['hudChrome.raidBossGuide.flagCleansable', 'check'],
};

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

export function tierName(tier: JournalTier): string {
  return t(TIER_KEYS[tier]);
}

export function mobName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

export function instanceName(id: string): string {
  return tEntity({ kind: 'dungeon', id, field: 'name' });
}

/** A page's display name: a council names every member. */
export function pageName(members: readonly string[]): string {
  return formatList(members.map(mobName));
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

// ---- navigation -----------------------------------------------------------------

const GROUP_KEYS: Readonly<Record<'dungeon' | 'raid', TranslationKey>> = {
  dungeon: 'hudChrome.adventureJournal.groupDungeons',
  raid: 'hudChrome.adventureJournal.groupRaids',
};

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
          const progress = t('hudChrome.adventureJournal.bossProgress', {
            defeated: formatNumber(instance.defeatedCount),
            total: formatNumber(instance.bosses.length),
          });
          const meta = [
            instance.current ? t('hudChrome.adventureJournal.youAreHere') : null,
            instance.defeatedCount > 0 ? progress : null,
          ].filter((part): part is string => part !== null);
          const toggleLabel = t(
            instance.expanded
              ? 'hudChrome.adventureJournal.collapseInstance'
              : 'hudChrome.adventureJournal.expandInstance',
            { instance: name },
          );
          const bosses = instance.expanded
            ? `<ul class="aj-boss-list" id="${esc(listId)}">${instance.bosses
                .map((boss) => {
                  const bossName = pageName(boss.members);
                  const rank = rankLabel(boss.rank);
                  const status = boss.engaged
                    ? t('hudChrome.adventureJournal.inCombat')
                    : boss.defeated
                      ? t('hudChrome.raidBossGuide.defeated')
                      : null;
                  const label = formatList(
                    [bossName, rank, status].filter((part): part is string => !!part),
                  );
                  const statusIcon = boss.engaged
                    ? `<span class="aj-boss-status aj-boss-status-engaged">${svgIcon('attack')}</span>`
                    : boss.defeated
                      ? `<span class="aj-boss-status aj-boss-status-defeated">${svgIcon('check')}</span>`
                      : '';
                  return `<li><button type="button" class="aj-boss${boss.selected ? ' active' : ''}${
                    boss.defeated ? ' defeated' : ''
                  }${boss.engaged ? ' engaged' : ''}" data-nav-item data-boss="${esc(boss.key)}" data-boss-instance="${esc(
                    instance.id,
                  )}" ${FOCUS_KEY_ATTR}="boss:${esc(instance.id)}:${esc(boss.key)}"${
                    boss.selected ? ' aria-current="page"' : ''
                  } aria-label="${esc(label)}"><span class="aj-boss-portrait${
                    boss.members.length > 1 ? ' aj-boss-portrait-council' : ''
                  }"><img src="${esc(boss.portraitUrl)}" alt="" aria-hidden="true"></span><span class="aj-boss-text"><span class="aj-boss-name">${esc(
                    bossName,
                  )}</span>${rank ? `<span class="aj-boss-rank">${esc(rank)}</span>` : ''}</span>${statusIcon}</button></li>`;
                })
                .join('')}</ul>`
            : '';
          return `<div class="aj-instance${instance.expanded ? ' expanded' : ''}${
            instance.current ? ' current' : ''
          }${instance.holdsSelection ? ' holds-selection' : ''}"><button type="button" class="aj-instance-toggle" data-nav-item data-instance="${esc(
            instance.id,
          )}" ${FOCUS_KEY_ATTR}="instance:${esc(instance.id)}" aria-expanded="${instance.expanded}"${
            instance.expanded ? ` aria-controls="${esc(listId)}"` : ''
          } aria-label="${esc(toggleLabel)}"><span class="aj-chevron" aria-hidden="true">${svgIcon(
            'next',
          )}</span><span class="aj-instance-text"><span class="aj-instance-name">${esc(name)}</span>${
            meta.length
              ? `<span class="aj-instance-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</span>`
              : ''
          }</span>${instance.current ? `<span class="aj-here-dot" aria-hidden="true"></span>` : ''}</button>${bosses}</div>`;
        })
        .join('')}</section>`;
    })
    .join('')}</nav>`;
}

// ---- the page header ------------------------------------------------------------

export interface JournalStepTarget {
  key: string;
  members: readonly string[];
}

export function stepButtonHtml(step: -1 | 1, target: JournalStepTarget | null): string {
  const icon = step < 0 ? 'prev' : 'next';
  const label = target
    ? t(
        step < 0
          ? 'hudChrome.adventureJournal.previousBoss'
          : 'hudChrome.adventureJournal.nextBoss',
        {
          boss: pageName(target.members),
        },
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

export interface JournalHeroInput {
  instance: JournalInstance;
  members: readonly string[];
  view: JournalBossView;
  overviewView: JournalBossView;
  state: JournalPageState;
  index: number;
  total: number;
  prev: JournalStepTarget | null;
  next: JournalStepTarget | null;
}

export function heroHtml(input: JournalHeroInput): string {
  const { instance, members, view, overviewView, state } = input;
  const kind = t(
    instance.kind === 'raid'
      ? 'hudChrome.adventureJournal.kindRaid'
      : 'hudChrome.adventureJournal.kindDungeon',
  );
  const kicker = t('hudChrome.adventureJournal.pageKicker', {
    instance: instanceName(instance.id),
    kind,
    index: formatNumber(input.index + 1),
    total: formatNumber(input.total),
  });
  const rank = rankLabel(view.rank);
  const status = state.engaged
    ? `<span class="aj-chip aj-chip-engaged">${svgIcon('attack')}${esc(t('hudChrome.adventureJournal.inCombat'))}</span>`
    : state.defeated
      ? `<span class="aj-chip aj-chip-defeated">${svgIcon('check')}${esc(t('hudChrome.raidBossGuide.defeated'))}</span>`
      : '';
  const overview = t(
    overviewView.overviewKey,
    pageValues(instance, overviewView.overviewValues, overviewView.overviewPercentValues),
  );
  const council =
    members.length > 1
      ? `<ul class="aj-council" aria-label="${esc(t('hudChrome.adventureJournal.councilMembers'))}">${members
          .map((mobId) => {
            const portrait = mobPortrait(mobId, view);
            return `<li class="aj-council-member"><img src="${esc(portrait)}" alt="" aria-hidden="true"><span>${esc(
              mobName(mobId),
            )}</span></li>`;
          })
          .join('')}</ul>`
      : '';
  return `<div class="aj-page-head">${stepButtonHtml(-1, input.prev)}<div class="aj-page-kicker">${esc(
    kicker,
  )}</div>${stepButtonHtml(1, input.next)}</div><div class="rbg-hero aj-hero"><div class="rbg-model-slot" data-model-slot></div><div class="rbg-overview"><h2 id="aj-boss-name">${esc(
    pageName(members),
  )}</h2><div class="aj-hero-chips">${rank ? `<span class="rbg-rank rbg-rank-${esc(view.rank ?? '')}">${esc(rank)}</span>` : ''}${status}</div>${council}<p>${esc(
    overview,
  )}</p></div></div>`;
}

/** A council member's portrait: the page's own art for its lead body, else
 *  the member's own committed portrait. */
function mobPortrait(mobId: string, view: JournalBossView): string {
  if (mobId === view.mobId) return view.portraitUrl;
  return targetPortraitUrl(mobId, true) ?? view.portraitUrl;
}

export function difficultyHtml(instance: JournalInstance, tier: JournalTier): string {
  const label = t('hudChrome.raidBossGuide.difficultyLabel');
  return `<div class="rbg-difficulty aj-difficulty"><span>${esc(label)}</span><div class="rbg-segmented" role="group" aria-label="${esc(
    label,
  )}">${instance.tiers
    .map((entry) => {
      const selected = entry === tier;
      return `<button type="button" data-difficulty="${entry}" ${FOCUS_KEY_ATTR}="difficulty:${entry}" aria-pressed="${selected}" aria-label="${esc(
        t('hudChrome.raidBossGuide.chooseDifficulty', { difficulty: tierName(entry) }),
      )}" class="${selected ? 'active' : ''}${entry === 'mythic' ? ' aj-tier-mythic' : ''}">${esc(
        tierName(entry),
      )}</button>`;
    })
    .join('')}</div></div>`;
}

export const SECTION_TAB_CLASS = 'aj-tab';
export const SECTION_TAB_ACTIVE = 'active';

export function sectionTabsHtml(tab: JournalTab, tabs: readonly JournalTab[]): string {
  return `<div class="aj-tabs" role="tablist" aria-label="${esc(t('hudChrome.adventureJournal.sectionsLabel'))}">${tabs
    .map((entry) => {
      const selected = entry === tab;
      return `<button type="button" class="${SECTION_TAB_CLASS}${selected ? ` ${SECTION_TAB_ACTIVE}` : ''}" role="tab" id="aj-tab-${entry}" data-tab="${entry}" ${FOCUS_KEY_ATTR}="tab:${entry}" aria-selected="${selected}" aria-controls="aj-panel" tabindex="${selected ? '0' : '-1'}">${esc(
        t(TAB_KEYS[entry]),
      )}</button>`;
    })
    .join('')}</div>`;
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
    'journal',
  )}</div><div class="aj-soon-kicker">${esc(tierName('mythic'))}</div><h3 id="aj-soon-title">${esc(
    t('hudChrome.adventureJournal.comingSoon'),
  )}</h3><p>${esc(t('hudChrome.adventureJournal.comingSoonBody'))}</p><div class="aj-soon-actions">${back}</div></section>`;
}

// ---- Overview: Strategy by role -------------------------------------------------

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

export function overviewHtml(instance: JournalInstance, view: JournalBossView): string {
  const cards = STRATEGY_ROLES.map((role) => {
    const [labelKey, icon] = ROLE_PRESENTATION[role];
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
    return `<article class="rbg-tip rbg-tip-${role} aj-role-card"><header><span class="rbg-badge rbg-badge-role rbg-badge-${role}" aria-hidden="true">${svgIcon(
      icon,
    )}</span><h3>${esc(t(labelKey))}</h3></header>${body}${watch}</article>`;
  }).join('');
  return `${heroicNotesHtml(view.heroicNotes)}<section class="rbg-tips aj-strategy" aria-labelledby="aj-strategy-title"><div class="rbg-section-title" id="aj-strategy-title">${esc(
    t('hudChrome.adventureJournal.strategyHeading'),
  )}</div><div class="rbg-tip-grid">${cards}</div></section>${choicesHtml(view.choices)}`;
}

// ---- Abilities ------------------------------------------------------------------

function badgeHtml(
  kind: 'role' | 'flag',
  id: string,
  key: TranslationKey,
  icon: UiIconName,
): string {
  const label = t(key);
  return `<span class="rbg-badge rbg-badge-${kind} rbg-badge-${esc(id)}" title="${esc(label)}">${svgIcon(
    icon,
  )}<span>${esc(label)}</span></span>`;
}

function mechanicBadges(mechanic: JournalMechanic): string {
  const roles = mechanic.roles
    .map((role) => badgeHtml('role', role, ...ROLE_PRESENTATION[role]))
    .join('');
  const flags = mechanic.flags
    .map((flag) => badgeHtml('flag', flag, ...FLAG_PRESENTATION[flag]))
    .join('');
  return `<span class="rbg-badges" aria-hidden="true"><span class="rbg-role-badges">${roles}</span><span class="rbg-flag-badges">${flags}</span></span>`;
}

export function mechanicTagLabels(mechanic: JournalMechanic): string[] {
  return [
    ...mechanic.roles.map((role) => t(ROLE_PRESENTATION[role][0])),
    ...mechanic.flags.map((flag) => t(FLAG_PRESENTATION[flag][0])),
    ...markLabels(mechanic.marks),
  ];
}

function mechanicHtml(
  instance: JournalInstance,
  mechanic: JournalMechanic,
  expanded: boolean,
): string {
  const values = pageValues(instance, mechanic.values, mechanic.percentValues);
  const name = t(mechanic.nameKey, values);
  const detailId = `aj-detail-${mechanic.id}`;
  const summaryId = `aj-summary-${mechanic.id}`;
  const action = t(
    expanded ? 'hudChrome.raidBossGuide.collapseAbility' : 'hudChrome.raidBossGuide.expandAbility',
    { ability: name },
  );
  const tags = mechanicTagLabels(mechanic);
  const accessible = tags.length
    ? t('hudChrome.raidBossGuide.abilityControlLabel', { action, details: formatList(tags) })
    : action;
  const summary = t(mechanic.summaryKey, values);
  const response = t('hudChrome.raidBossGuide.whatToDoResponse', {
    response: t(mechanic.responseKey, values),
  });
  const compare = mechanic.compare
    ? `<p class="rbg-compare">${esc(damageCompareText(mechanic.compare))}</p>`
    : '';
  return `<article class="rbg-ability aj-ability${expanded ? ' expanded' : ''}" data-ability="${esc(
    mechanic.id,
  )}"><button type="button" class="rbg-ability-toggle" data-mechanic="${esc(mechanic.id)}" ${FOCUS_KEY_ATTR}="mechanic:${esc(
    mechanic.id,
  )}" aria-expanded="${expanded}"${expanded ? ` aria-controls="${esc(detailId)}"` : ''} aria-describedby="${esc(
    summaryId,
  )}" aria-label="${esc(accessible)}"><img src="${esc(iconDataUrl('ability', mechanic.iconId, 48))}" alt="" aria-hidden="true"><span class="rbg-ability-main"><span class="rbg-expand-mark" aria-hidden="true">${
    expanded ? '−' : '+'
  }</span><span class="rbg-ability-text"><span class="rbg-ability-name">${esc(name)}</span>${markChipsHtml(
    mechanic.marks,
  )}<span class="rbg-ability-summary" id="${esc(summaryId)}">${esc(summary)}</span></span></span>${mechanicBadges(
    mechanic,
  )}</button>${
    expanded
      ? `<div class="rbg-ability-detail" id="${esc(detailId)}" data-detail="${esc(mechanic.id)}"><p>${esc(
          response,
        )}</p>${compare}</div>`
      : ''
  }</article>`;
}

function phaseHtml(
  instance: JournalInstance,
  phase: JournalPhase,
  open: boolean,
  expandedMechanic: string | null,
): string {
  const values = pageValues(instance, phase.values, phase.percentValues);
  const bodyId = `aj-phase-${phase.id}`;
  const name = t(phase.nameKey);
  return `<section class="rbg-phase aj-phase${open ? ' open' : ''}" data-phase="${esc(phase.id)}"><header><div class="rbg-phase-rule"></div><div class="aj-phase-head"><h3><button type="button" class="aj-phase-toggle" data-phase-toggle="${esc(
    phase.id,
  )}" ${FOCUS_KEY_ATTR}="phase:${esc(phase.id)}" aria-expanded="${open}"${open ? ` aria-controls="${esc(bodyId)}"` : ''}><span class="aj-chevron" aria-hidden="true">${svgIcon(
    'next',
  )}</span><span>${esc(name)}</span><span class="aj-phase-count">${esc(
    tPlural('hudChrome.adventureJournal.abilityCountPlural', phase.mechanics.length, {
      count: formatNumber(phase.mechanics.length),
    }),
  )}</span></button></h3><p>${esc(t(phase.summaryKey, values))}</p></div></header>${
    open
      ? `<div class="rbg-abilities" id="${esc(bodyId)}">${phase.mechanics
          .map((mechanic) => mechanicHtml(instance, mechanic, mechanic.id === expandedMechanic))
          .join('')}</div>`
      : ''
  }</section>`;
}

export function abilitiesHtml(
  instance: JournalInstance,
  view: JournalBossView,
  closedPhases: ReadonlySet<string>,
  expandedMechanic: string | null,
): string {
  return `<div class="rbg-phases">${view.phases
    .map((phase) => phaseHtml(instance, phase, !closedPhases.has(phase.id), expandedMechanic))
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
      const color = QUALITY_COLOR[row.quality] ?? QUALITY_COLOR.common;
      return `<li class="aj-loot-row aj-quality-${esc(row.quality)}" tabindex="0" data-item-id="${esc(
        row.itemId,
      )}" ${FOCUS_KEY_ATTR}="loot:${esc(row.itemId)}">${itemIcon(def)}<span class="aj-loot-text"><span class="aj-loot-name" style="color:${color}">${esc(
        itemDisplayName(def),
      )}</span><span class="aj-loot-detail">${esc(bits.join(' · '))}</span></span></li>`;
    })
    .join('')}</ul>`;
}
