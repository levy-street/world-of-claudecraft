// Sunken Bastion journal (data-as-code): the Shipwreck Captain, Knight-
// Commander Olen, the Gaol Turnkey, Gaoler Ossick and Vael, in route order.
// Every number is read from the encounter tuning
// (src/sim/encounters/sunken_bastion/ids.ts, ghost_captain_ids.ts) or the mob
// templates (src/sim/content/dungeons.ts, sunken_bastion.ts), and heroic
// damage comes from the sim's difficulty stamp (../journal_tuning.ts). The
// fight rules each line states are the encounter modules (ghost_captain.ts,
// olen.ts, turnkey.ts, ossick*.ts, vael*.ts).

import { MOBS } from '../../../sim/data';
import {
  GHOST_CAPTAIN_ANCHOR,
  GHOST_CAPTAIN_BOARDING,
  GHOST_CAPTAIN_BROADSIDE,
  GHOST_CAPTAIN_ID,
  GHOST_CAPTAIN_TUNING,
} from '../../../sim/encounters/sunken_bastion/ghost_captain_ids';
import {
  anchorHits,
  brineRadius,
  cageHits,
  OLEN_HALLOWED_BRINE,
  OLEN_ID,
  OLEN_KIT,
  OLEN_OATH_KNEEL,
  OLEN_REBOUNDING_BULWARK,
  OLEN_TIDE_SENTENCE,
  OSSICK_ANCHOR,
  OSSICK_CUDGEL,
  OSSICK_ID,
  OSSICK_SHACKLE,
  OSSICK_TUNING,
  sentenceRadius,
  shackleRange,
  TURNKEY_ID,
  TURNKEY_IRON_CAGE,
  TURNKEY_TUNING,
  VAEL_ID,
  VAEL_MIST_SURGE,
  VAEL_SHADOWSTEP,
  VAEL_TUNING,
  VAEL_VEIL_GATHER,
} from '../../../sim/encounters/sunken_bastion/ids';
import { OLEN_VIGIL_MAX } from '../../../sim/encounters/sunken_bastion/olen';
import type { TranslationKey } from '../../i18n';
import { heroicMechanicScale, mechanicFactor, tierDamage, tierFixed } from '../journal_tuning';
import type {
  DungeonJournalDef,
  JournalBossDef,
  JournalDifficulty,
  JournalValues,
} from '../journal_view';

const k = (suffix: string): TranslationKey => `bossJournal.bastion.${suffix}` as TranslationKey;
const common = (suffix: string): TranslationKey => `bossJournal.common.${suffix}` as TranslationKey;
const cast = (id: string): TranslationKey => `abilityUi.cast.${id}` as TranslationKey;

const D = 'sunken_bastion';
const C = GHOST_CAPTAIN_TUNING;
const O = OLEN_KIT;
const TK = TURNKEY_TUNING;
const OS = OSSICK_TUNING;
const V = VAEL_TUNING;
const CAPTAIN_ADDS = MOBS[GHOST_CAPTAIN_ID]?.summonAdds;
const VAEL_ADDS = MOBS[VAEL_ID]?.summonAdds;
const PRISONER_ADDS = MOBS[TURNKEY_ID]?.summonAdds;
const REAPING_ARC = MOBS[OLEN_ID]?.cleave;

/** One value per tier from a heroic-aware sim helper. */
function tierOf(
  name: string,
  at: (heroic: boolean) => number,
): Readonly<Record<JournalDifficulty, JournalValues>> {
  return tierFixed({ [name]: at(false) }, { [name]: at(true) });
}

/** Merge several per-tier value bags. */
function tiers(
  ...bags: Readonly<Record<JournalDifficulty, JournalValues>>[]
): Readonly<Record<JournalDifficulty, JournalValues>> {
  return {
    normal: Object.assign({}, ...bags.map((b) => b.normal)),
    heroic: Object.assign({}, ...bags.map((b) => b.heroic)),
  };
}

/** A fixed per-second amount scaled like the fire site (base x factor). */
function perSecond(
  mobId: string,
  name: string,
  normal: number,
  heroicBase: number,
): Readonly<Record<JournalDifficulty, JournalValues>> {
  return tierFixed(
    { [name]: Math.round(normal * mechanicFactor(D, mobId, 'normal')) },
    { [name]: Math.round(heroicBase * mechanicFactor(D, mobId, 'heroic')) },
  );
}

const CAPTAIN: JournalBossDef = {
  mobId: GHOST_CAPTAIN_ID,
  rank: 'miniboss',
  overviewKey: k('captain.overview'),
  phases: [
    {
      id: 'moat',
      nameKey: k('captain.phaseName'),
      summaryKey: k('captain.phaseSummary'),
      values: { first: C.first, recovery: C.recovery },
      mechanics: [
        {
          id: 'spectral-broadside',
          iconId: 'dgn_bastion_broadside',
          nameKey: cast(GHOST_CAPTAIN_BROADSIDE),
          castId: GHOST_CAPTAIN_BROADSIDE,
          summaryKey: k('captain.broadsideSummary'),
          responseKey: k('captain.broadsideResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            warn: C.broadsideWarning,
            lanes: C.broadsideOffsets.length,
            length: C.broadsideLength,
          },
          difficultyValues: tierDamage(D, GHOST_CAPTAIN_ID, C.broadsideMin, C.broadsideMax),
          compare: true,
        },
        {
          id: 'cursed-anchor',
          iconId: 'dgn_bastion_cursed_anchor',
          nameKey: cast(GHOST_CAPTAIN_ANCHOR),
          castId: GHOST_CAPTAIN_ANCHOR,
          summaryKey: k('captain.anchorSummary'),
          responseKey: k('captain.anchorResponse'),
          roles: ['all'],
          flags: ['important'],
          values: { warn: C.anchorWarning, length: C.anchorLength, seconds: C.anchorSeconds },
          difficultyValues: tierDamage(D, GHOST_CAPTAIN_ID, C.anchorMin, C.anchorMax),
          compare: true,
        },
        {
          id: 'phantom-boarding',
          iconId: 'dgn_bastion_boarding',
          nameKey: cast(GHOST_CAPTAIN_BOARDING),
          castId: GHOST_CAPTAIN_BOARDING,
          summaryKey: k('captain.boardingSummary'),
          responseKey: k('captain.boardingResponse'),
          roles: ['all'],
          flags: ['important'],
          values: { warn: C.boardingWarning, length: C.boardingLength },
          difficultyValues: tierDamage(D, GHOST_CAPTAIN_ID, C.boardingMin, C.boardingMax),
          compare: true,
        },
        {
          id: 'sailors',
          iconId: 'dgn_bastion_sailors',
          nameKey: k('captain.sailorsName'),
          summaryKey: k('captain.sailorsSummary'),
          responseKey: k('captain.sailorsResponse'),
          roles: ['tank', 'damage'],
          flags: [],
          values: {
            count: CAPTAIN_ADDS?.count ?? 0,
            first: CAPTAIN_ADDS?.atHpPct[0] ?? 0,
            second: CAPTAIN_ADDS?.atHpPct[1] ?? 0,
          },
          percentValues: ['first', 'second'],
        },
      ],
    },
  ],
  tips: {
    tank: k('captain.tipTank'),
    healer: k('captain.tipHealer'),
    damage: k('captain.tipDamage'),
  },
  heroicNotes: [common('heroicHarder')],
  heroicNoteValues: { scale: heroicMechanicScale(D, GHOST_CAPTAIN_ID) },
};

const OLEN: JournalBossDef = {
  mobId: OLEN_ID,
  rank: 'boss',
  overviewKey: k('olen.overview'),
  phases: [
    {
      id: 'breach',
      nameKey: k('olen.phaseBreachName'),
      summaryKey: k('olen.phaseBreachSummary'),
      mechanics: [
        {
          id: 'hallowed-brine',
          iconId: 'dgn_bastion_brine',
          nameKey: cast(OLEN_HALLOWED_BRINE),
          castId: OLEN_HALLOWED_BRINE,
          summaryKey: k('olen.brineSummary'),
          responseKey: k('olen.brineResponse'),
          roles: ['tank', 'all'],
          flags: ['important'],
          values: {
            every: O.brineEvery,
            cast: O.brineCast,
            seconds: O.brineSeconds,
            shield: O.brineShield,
          },
          percentValues: ['shield'],
          difficultyValues: tiers(
            tierOf('radius', brineRadius),
            perSecond(OLEN_ID, 'perSecond', O.brinePerSecond, O.brinePerSecondHeroic),
          ),
        },
        {
          id: 'rebounding-bulwark',
          iconId: 'dgn_bastion_bulwark',
          nameKey: cast(OLEN_REBOUNDING_BULWARK),
          castId: OLEN_REBOUNDING_BULWARK,
          summaryKey: k('olen.bulwarkSummary'),
          responseKey: k('olen.bulwarkResponse'),
          roles: ['all'],
          flags: ['important'],
          values: { every: O.bulwarkEvery, cast: O.bulwarkCast, reach: O.bulwarkReach },
          difficultyValues: tierDamage(D, OLEN_ID, O.bulwarkMin, O.bulwarkMax, {
            normal: { hits: O.bulwarkHits },
            heroic: { hits: O.bulwarkHitsHeroic },
          }),
          compare: true,
        },
        {
          id: 'sentence-of-the-tide',
          iconId: 'dgn_bastion_sentence',
          nameKey: cast(OLEN_TIDE_SENTENCE),
          castId: OLEN_TIDE_SENTENCE,
          summaryKey: k('olen.sentenceSummary'),
          responseKey: k('olen.sentenceResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: { every: O.sentenceEvery, cast: O.sentenceCast, seconds: O.sentenceSeconds },
          difficultyValues: tiers(
            tierDamage(D, OLEN_ID, O.sentenceMin, O.sentenceMax),
            tierOf('radius', sentenceRadius),
          ),
          compare: true,
        },
        {
          id: 'reaping-arc',
          iconId: 'dgn_bastion_reaping_arc',
          nameKey: k('olen.arcName'),
          summaryKey: k('olen.arcSummary'),
          responseKey: k('olen.arcResponse'),
          roles: ['all'],
          flags: [],
          values: { radius: REAPING_ARC?.radius ?? 0, share: REAPING_ARC?.mult ?? 0 },
          percentValues: ['share'],
        },
      ],
    },
    {
      id: 'oath',
      nameKey: k('olen.phaseOathName'),
      summaryKey: k('olen.phaseOathSummary'),
      values: { health: O.oathAt },
      percentValues: ['health'],
      mechanics: [
        {
          id: 'unbroken-oath',
          iconId: 'dgn_bastion_oath',
          nameKey: cast(OLEN_OATH_KNEEL),
          castId: OLEN_OATH_KNEEL,
          summaryKey: k('olen.oathSummary'),
          responseKey: k('olen.oathResponse'),
          roles: ['tank', 'damage'],
          flags: ['important'],
          values: {
            health: O.oathAt,
            max: OLEN_VIGIL_MAX,
            stun: O.oathBrokenStun,
            vuln: O.oathBrokenVuln,
            vulnSeconds: O.oathBrokenVulnSeconds,
          },
          percentValues: ['health', 'vuln'],
          difficultyValues: tierFixed({ count: O.oathSoldiers }, { count: O.oathSoldiersHeroic }),
        },
      ],
    },
  ],
  tips: {
    tank: k('olen.tipTank'),
    healer: k('olen.tipHealer'),
    damage: k('olen.tipDamage'),
  },
  tipValues: { radius: REAPING_ARC?.radius ?? 0, reach: O.bulwarkReach },
  choices: [
    {
      id: 'spread',
      iconId: 'dgn_bastion_bulwark',
      nameKey: k('olen.choiceName'),
      gainKey: k('olen.choiceGain'),
      riskKey: k('olen.choiceRisk'),
      values: { radius: REAPING_ARC?.radius ?? 0, reach: O.bulwarkReach },
    },
  ],
  heroicNotes: [common('heroicHarder'), k('olen.heroicChanges')],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, OLEN_ID),
    radius: brineRadius(true),
    hits: O.bulwarkHitsHeroic,
    sentence: sentenceRadius(true),
    count: O.oathSoldiersHeroic,
  },
};

const TURNKEY: JournalBossDef = {
  mobId: TURNKEY_ID,
  rank: 'miniboss',
  overviewKey: k('turnkey.overview'),
  phases: [
    {
      id: 'gaol',
      nameKey: k('turnkey.phaseName'),
      summaryKey: k('turnkey.phaseSummary'),
      mechanics: [
        {
          id: 'iron-cage',
          iconId: 'dgn_bastion_cage',
          nameKey: cast(TURNKEY_IRON_CAGE),
          castId: TURNKEY_IRON_CAGE,
          summaryKey: { normal: k('turnkey.cageSummary'), heroic: k('turnkey.cageHeroicSummary') },
          responseKey: k('turnkey.cageResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            every: TK.cageEvery,
            cast: TK.cageCast,
            press: TK.pressPoints,
            helper: TK.helperPoints,
            max: TK.cageMax,
            cages: TK.cagesHeroic,
          },
          difficultyValues: tiers(
            tierOf('hits', cageHits),
            tierFixed({ crush: TK.crushShare }, { crush: TK.crushShareHeroic }),
          ),
          percentValues: ['crush'],
        },
        {
          id: 'open-the-cells',
          iconId: 'dgn_bastion_prisoners',
          nameKey: k('turnkey.cellsName'),
          summaryKey: k('turnkey.cellsSummary'),
          responseKey: k('turnkey.cellsResponse'),
          roles: ['tank', 'damage'],
          flags: [],
          values: {
            count: PRISONER_ADDS?.count ?? 0,
            health: PRISONER_ADDS?.atHpPct[0] ?? 0,
          },
          percentValues: ['health'],
        },
      ],
    },
  ],
  tips: {
    tank: k('turnkey.tipTank'),
    healer: k('turnkey.tipHealer'),
    damage: k('turnkey.tipDamage'),
  },
  heroicNotes: [common('heroicHarder'), k('turnkey.heroicCages'), k('turnkey.heroicFlood')],
  heroicNoteValues: { scale: heroicMechanicScale(D, TURNKEY_ID), cages: TK.cagesHeroic },
};

const OSSICK: JournalBossDef = {
  mobId: OSSICK_ID,
  rank: 'boss',
  overviewKey: k('ossick.overview'),
  phases: [
    {
      id: 'yard',
      nameKey: k('ossick.phaseName'),
      summaryKey: k('ossick.phaseSummary'),
      values: { first: OS.cells[0], second: OS.cells[1], count: OS.prisonersPerCell },
      percentValues: ['first', 'second'],
      mechanics: [
        {
          id: 'drowned-anchor',
          iconId: 'dgn_bastion_anchor',
          nameKey: cast(OSSICK_ANCHOR),
          castId: OSSICK_ANCHOR,
          summaryKey: {
            normal: k('ossick.anchorSummary'),
            heroic: k('ossick.anchorHeroicSummary'),
          },
          responseKey: k('ossick.anchorResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            every: OS.anchorEvery,
            cast: OS.anchorCast,
            settle: OS.anchorSettle,
            reach: OS.postReach,
            run: OS.postRun,
            dark: OS.postDarkSeconds,
            stun: OS.keelhaulStun,
            crashRadius: OS.crashRadius,
          },
          difficultyValues: tiers(
            tierOf('hits', anchorHits),
            tierFixed({ pit: OS.pitShare }, { pit: OS.pitShareHeroic }),
            tierDamage(D, OSSICK_ID, OS.crashMin, OS.crashMax),
          ),
          percentValues: ['pit'],
        },
        {
          id: 'shackle-pair',
          iconId: 'dgn_bastion_shackle',
          nameKey: cast(OSSICK_SHACKLE),
          castId: OSSICK_SHACKLE,
          summaryKey: k('ossick.shackleSummary'),
          responseKey: k('ossick.shackleResponse'),
          roles: ['all'],
          flags: ['important'],
          values: { every: OS.shackleEvery, cast: OS.shackleCast, seconds: OS.shackleSeconds },
          difficultyValues: tiers(
            tierOf('range', shackleRange),
            tierDamage(D, OSSICK_ID, OS.strainMin, OS.strainMax),
          ),
          compare: true,
        },
        {
          id: 'gaolers-cudgel',
          iconId: 'dgn_bastion_cudgel',
          nameKey: cast(OSSICK_CUDGEL),
          castId: OSSICK_CUDGEL,
          summaryKey: k('ossick.cudgelSummary'),
          responseKey: k('ossick.cudgelResponse'),
          roles: ['tank', 'healer'],
          flags: ['important'],
          values: {
            every: OS.cudgelEvery,
            cast: OS.cudgelCast,
            mult: OS.cudgelMult,
            slow: 1 - OS.cudgelSlow,
            seconds: OS.cudgelSlowSeconds,
          },
          percentValues: ['slow'],
        },
      ],
    },
  ],
  tips: {
    tank: k('ossick.tipTank'),
    healer: k('ossick.tipHealer'),
    damage: k('ossick.tipDamage'),
  },
  choices: [
    {
      id: 'post-or-break',
      iconId: 'dgn_bastion_anchor',
      nameKey: k('ossick.choiceName'),
      gainKey: k('ossick.choiceGain'),
      riskKey: k('ossick.choiceRisk'),
      values: { run: OS.postRun, dark: OS.postDarkSeconds },
    },
  ],
  heroicNotes: [common('heroicHarder'), k('ossick.heroicCrash'), k('ossick.heroicChanges')],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, OSSICK_ID),
    crashRadius: OS.crashRadius,
    hits: anchorHits(true),
    range: shackleRange(true),
  },
};

const VAEL: JournalBossDef = {
  mobId: VAEL_ID,
  rank: 'final',
  overviewKey: k('vael.overview'),
  overviewValues: { first: V.veilAt[0], second: V.veilAt[1] },
  overviewPercentValues: ['first', 'second'],
  phases: [
    {
      id: 'crown',
      nameKey: k('vael.phaseCrownName'),
      summaryKey: k('vael.phaseCrownSummary'),
      values: {
        count: VAEL_ADDS?.count ?? 0,
        first: VAEL_ADDS?.atHpPct[0] ?? 0,
        second: VAEL_ADDS?.atHpPct[1] ?? 0,
      },
      percentValues: ['first', 'second'],
      mechanics: [
        {
          id: 'mist-surge',
          iconId: 'dgn_bastion_mist_surge',
          nameKey: cast(VAEL_MIST_SURGE),
          castId: VAEL_MIST_SURGE,
          summaryKey: k('vael.surgeSummary'),
          responseKey: k('vael.surgeResponse'),
          roles: ['all'],
          flags: ['important'],
          values: {
            cast: V.surgeCast,
            radius: V.surgeRadius,
            every: V.surgeEvery,
            lastEvery: V.lastHymnEvery,
            below: V.lastHymnBelow,
          },
          percentValues: ['below'],
          difficultyValues: tierDamage(D, VAEL_ID, V.surgeMin, V.surgeMax),
          compare: true,
        },
        {
          id: 'shadow-crossing',
          iconId: 'dgn_bastion_shadow_crossing',
          nameKey: cast(VAEL_SHADOWSTEP),
          castId: VAEL_SHADOWSTEP,
          summaryKey: k('vael.crossingSummary'),
          responseKey: k('vael.crossingResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            every: V.reapEvery,
            chain: V.reapChain,
            behind: V.behind,
            arc: V.sweepArcDeg,
            range: V.sweepRange,
          },
          difficultyValues: tierDamage(D, VAEL_ID, V.sweepMin, V.sweepMax),
          compare: true,
        },
        {
          id: 'grave-shadow',
          iconId: 'dgn_bastion_grave_shadow',
          nameKey: k('vael.graveName'),
          availability: 'heroic',
          summaryKey: k('vael.graveSummary'),
          responseKey: k('vael.graveResponse'),
          roles: ['all'],
          flags: [],
          values: { seconds: V.graveSeconds, radius: V.graveRadius },
          difficultyValues: perSecond(VAEL_ID, 'perSecond', V.gravePerSecond, V.gravePerSecond),
        },
      ],
    },
    {
      id: 'veil',
      nameKey: k('vael.phaseVeilName'),
      summaryKey: k('vael.phaseVeilSummary'),
      values: { first: V.veilAt[0], second: V.veilAt[1] },
      percentValues: ['first', 'second'],
      mechanics: [
        {
          id: 'fog-veil',
          iconId: 'dgn_bastion_fog_veil',
          nameKey: cast(VAEL_VEIL_GATHER),
          castId: VAEL_VEIL_GATHER,
          summaryKey: { normal: k('vael.veilSummary'), heroic: k('vael.veilHeroicSummary') },
          responseKey: k('vael.veilResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            seconds: V.hymnSeconds,
            base: V.hymnBase,
            step: V.hymnStep,
            stepEvery: V.hymnStepEvery,
            share: V.breakShare,
            stun: V.staggerSeconds,
            vuln: V.exposed,
            vulnSeconds: V.exposedSeconds,
            beam: V.beamPeriod,
            drift: V.driftEvery,
          },
          percentValues: ['share', 'vuln'],
        },
        {
          id: 'fogburst',
          iconId: 'dgn_bastion_fogburst',
          nameKey: k('vael.fogburstName'),
          summaryKey: {
            normal: k('vael.fogburstSummary'),
            heroic: k('vael.fogburstHeroicSummary'),
          },
          responseKey: k('vael.fogburstResponse'),
          roles: ['damage'],
          flags: ['important'],
          values: { radius: V.fogburstRadius, stun: V.fogburstStun },
          difficultyValues: tierDamage(D, VAEL_ID, V.fogburstMin, V.fogburstMax),
          compare: true,
        },
      ],
    },
  ],
  tips: {
    tank: k('vael.tipTank'),
    healer: k('vael.tipHealer'),
    damage: { normal: k('vael.tipDamage'), heroic: k('vael.tipDamageHeroic') },
  },
  tipValues: { radius: V.surgeRadius },
  choices: [
    {
      id: 'veil',
      iconId: 'dgn_bastion_fog_veil',
      nameKey: k('vael.choiceName'),
      gainKey: k('vael.choiceGain'),
      riskKey: { normal: k('vael.choiceRisk'), heroic: k('vael.choiceRiskHeroic') },
      values: { share: V.breakShare },
      percentValues: ['share'],
    },
  ],
  heroicNotes: [common('heroicHarder'), k('vael.heroicGrave'), k('vael.heroicVeil')],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, VAEL_ID),
    seconds: V.graveSeconds,
    drift: V.driftEvery,
  },
};

export const SUNKEN_BASTION_JOURNAL: DungeonJournalDef = {
  dungeonId: D,
  bosses: [CAPTAIN, OLEN, TURNKEY, OSSICK, VAEL],
};
