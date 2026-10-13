// Emit-only encounter guidance. Raid tactics and tuning stay in the existing journal.
import type { DungeonDifficulty } from '../sim/types';
import type { FinderEncounterViewModel } from './dungeon_finder_view';
import { esc } from './esc';
import { formatNumber, type InterpolationValues, type TranslationKey, t } from './i18n';
import {
  type RaidBossGuideBoss,
  type RaidBossGuideTextKey,
  raidBossGuideView,
} from './raid_boss_guide_view';

const RAID_BOSSES: Readonly<Record<string, RaidBossGuideBoss>> = {
  ignivar_herald_of_the_last_flame: 'ignivar',
  varkhul_forgefather_of_the_last_flame: 'varkhul',
  nythraxis_scourge_of_thornpeak: 'nythraxis',
};

// The regular dungeon drivers are instant, not interruptible casts. Cleaves
// splash around the primary target, unlike the frontal-only rift variant.
// Sources: mob/{mob_swing,boss_mechanics,locomotion}.ts and content/{dungeons,
// temple,wildheart,zone3}.ts. Do not infer counterplay from an ability's name.
const DUNGEON_RESPONSES = {
  shadow_pulse: 'pulse',
  mist_surge: 'pulse',
  lunar_tide: 'pulse',
  shadow_nova: 'pulse',
  sealbreak_shockwave: 'pulse',
  wildheart_pulse: 'pulse',
  reaping_arc: 'cleave',
  grave_cleaver: 'cleave',
  deathstalker_cleave: 'cleave',
  tusk_sweep: 'cleave',
  summons_adds: 'adds',
  enrage: 'enrage',
  shuddering_stomp: 'stomp',
  beast_pit_quake: 'stomp',
  grave_inferno: 'inferno',
  profane_mending: 'mending',
  ancestral_sap: 'mending',
  mana_burn: 'manaBurn',
  mortal_wound: 'mortalWound',
  bloodmane_rend: 'bleed',
  call_of_the_hunt: 'haste',
  thickhide_ward: 'ward',
  jaguar_roar: 'knockback',
} as const;

// The raid journal owns a template-key type; adapt it at the localization
// boundary just as raid_boss_guide_window.ts does.
function raidText(key: RaidBossGuideTextKey, values?: InterpolationValues): string {
  return t(key as TranslationKey, values);
}

function formattedValues(
  values: Readonly<Record<string, number>> | undefined,
  percentValues: readonly string[] = [],
): InterpolationValues | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      formatNumber(
        value,
        percentValues.includes(key) ? { style: 'percent', maximumFractionDigits: 0 } : undefined,
      ),
    ]),
  );
}

/** Body only: the window owns the native disclosure and preserves its open state. */
export function encounterGuideHtml(
  encounter: Pick<FinderEncounterViewModel, 'mobId' | 'mechanics'>,
  difficulty: DungeonDifficulty,
): string {
  const boss = RAID_BOSSES[encounter.mobId];
  if (boss) {
    const guide = raidBossGuideView(boss, difficulty);
    return (
      `<p class="df-encounter-guide-intro">${esc(raidText(guide.overviewKey))}</p>` +
      guide.phases
        .map((phase) => {
          const values = formattedValues(phase.values, phase.percentValues);
          return `<section class="df-encounter-guide-phase"><h4>${esc(raidText(phase.nameKey))}</h4><p>${esc(raidText(phase.summaryKey, values))}</p><div class="df-encounter-guide-mechanics">${phase.mechanics
            .map((mechanic) => {
              const mechanicValues = formattedValues(mechanic.values, mechanic.percentValues);
              return `<article class="df-encounter-guide-mechanic"><h5>${esc(raidText(mechanic.nameKey))}</h5><p>${esc(raidText(mechanic.summaryKey, mechanicValues))}</p><p class="df-encounter-guide-response"><strong>${esc(t('hudChrome.raidBossGuide.whatToDo'))}</strong> ${esc(raidText(mechanic.responseKey, mechanicValues))}</p></article>`;
            })
            .join('')}</div></section>`;
        })
        .join('')
    );
  }
  if (!encounter.mechanics.length) {
    return `<p class="df-encounter-guide-intro">${esc(t('hudChrome.finder.guideUnavailable'))}</p>`;
  }
  return `<div class="df-encounter-guide-mechanics">${encounter.mechanics
    .map((mechanic) => {
      if (!Object.hasOwn(DUNGEON_RESPONSES, mechanic)) {
        return `<p class="df-encounter-guide-intro">${esc(t('hudChrome.finder.guideUnavailable'))}</p>`;
      }
      const mechanicKey = mechanic as keyof typeof DUNGEON_RESPONSES;
      const response = DUNGEON_RESPONSES[mechanicKey];
      return `<article class="df-encounter-guide-mechanic"><h5>${esc(t(`hudChrome.finder.mech.${mechanicKey}`))}</h5><p>${esc(t(`hudChrome.finder.guide.${response}`))}</p></article>`;
    })
    .join('')}</div>`;
}
