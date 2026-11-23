// Hollow Crypt journal (data-as-code): the Ossuary Drake, Sexton Marrow, the
// Lady of the Bonechill, Cantor Ilvane, Morthen the Gravecaller and the
// Knellwyrm, in route order. Every number is read from the encounter tuning
// (src/sim/encounters/hollow_crypt/*_ids.ts, ids.ts) or the mob templates
// (src/sim/content/hollow_crypt*.ts), and heroic damage comes from the sim's
// difficulty stamp (../journal_tuning.ts). The fight rules each line states are
// the encounter modules (marrow.ts, lady*.ts, ilvane*.ts, morthen*.ts,
// knellwyrm*.ts).

import { HOLLOW_CRYPT_MOBS } from '../../../sim/content/hollow_crypt';
import { HOLLOW_CRYPT_TRASH_MOBS } from '../../../sim/content/hollow_crypt_trash';
import {
  KNELL_TUNING,
  KNELLWYRM_DREAD_BELLOW,
  KNELLWYRM_ID,
  KNELLWYRM_KNELL_RISE,
  KNELLWYRM_PYRE_STRAFE,
  KNELLWYRM_TUNING,
  MORTHEN_ID,
} from '../../../sim/encounters/hollow_crypt/ids';
import {
  ILVANE_BONE_ORGAN,
  ILVANE_DIRGE,
  ILVANE_ID,
  ILVANE_TUNING,
  ILVANE_UNBROKEN_DIRGE,
} from '../../../sim/encounters/hollow_crypt/ilvane_ids';
import {
  embraceBreakShare,
  LADY_BRIDAL_FREEZE,
  LADY_BRIDES_LAMENT,
  LADY_FROZEN_EMBRACE,
  LADY_ID,
  LADY_TUNING,
} from '../../../sim/encounters/hollow_crypt/lady_ids';
import {
  MARROW_BURIAL_TOLL,
  MARROW_GRAVEDIGGERS_BLOW,
  MARROW_ID,
  MARROW_MEASURE,
  MARROW_SHOVELFUL,
  MARROW_TUNING,
  tollDamageRange,
} from '../../../sim/encounters/hollow_crypt/marrow_ids';
import {
  MORTHEN_REAP,
  MORTHEN_RITE,
  MORTHEN_SHADOW_PULSE,
  MORTHEN_TUNING,
  RITE_CANDLE_SPOTS,
} from '../../../sim/encounters/hollow_crypt/morthen_ids';
import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../../../sim/mob/trash_kit/cast_ids';
import type { TranslationKey } from '../../i18n';
import {
  heroicMechanicScale,
  mechanicFactor,
  tierDamage,
  tierFixed,
  tierScaled,
} from '../journal_tuning';
import type {
  DungeonJournalDef,
  JournalBossDef,
  JournalDifficulty,
  JournalMechanicDef,
  JournalValues,
} from '../journal_view';

const k = (suffix: string): TranslationKey => `bossJournal.crypt.${suffix}` as TranslationKey;
const common = (suffix: string): TranslationKey => `bossJournal.common.${suffix}` as TranslationKey;
const cast = (id: string): TranslationKey => `abilityUi.cast.${id}` as TranslationKey;

const D = 'hollow_crypt';
const DRAKE_ID = 'crypt_ossuary_drake';
const M = MARROW_TUNING;
const L = LADY_TUNING;
const I = ILVANE_TUNING;
const MO = MORTHEN_TUNING;
const KW = KNELLWYRM_TUNING;
const KN = KNELL_TUNING;

/** A drake-family kit (the Ossuary Drake and the Knellwyrm share it): its
 *  breath cone, tail lash and wing gust, read off the template. */
function drakeKit(mobId: string, template: (typeof HOLLOW_CRYPT_MOBS)[string] | undefined) {
  const breath = template?.breathCone;
  const tail = template?.trashKit?.tailLash;
  const gust = template?.trashKit?.wingGust;
  const mechanics: JournalMechanicDef[] = [
    {
      id: 'barrowflame-breath',
      iconId: 'dgn_crypt_barrowflame',
      nameKey: cast(CRYPT_BARROWFLAME_BREATH),
      castId: CRYPT_BARROWFLAME_BREATH,
      summaryKey: k('drake.breathSummary'),
      responseKey: k('drake.breathResponse'),
      roles: ['tank', 'all'],
      flags: ['important'],
      values: {
        every: breath?.every ?? 0,
        cast: breath?.castTime ?? 0,
        range: breath?.range ?? 0,
        arc: breath?.arcDeg ?? 0,
      },
      difficultyValues: tierDamage(D, mobId, breath?.min ?? 0, breath?.max ?? 0),
      compare: true,
    },
    {
      id: 'tail-lash',
      iconId: 'dgn_crypt_tail_lash',
      nameKey: cast(CRYPT_TAIL_LASH),
      castId: CRYPT_TAIL_LASH,
      summaryKey: k('drake.tailSummary'),
      responseKey: k('drake.tailResponse'),
      roles: ['damage'],
      flags: [],
      values: {
        every: tail?.every ?? 0,
        cast: tail?.castTime ?? 0,
        range: tail?.range ?? 0,
        arc: tail?.arcDeg ?? 0,
      },
      difficultyValues: tierDamage(D, mobId, tail?.min ?? 0, tail?.max ?? 0),
      compare: true,
    },
    {
      id: 'wing-gust',
      iconId: 'dgn_crypt_wing_gust',
      nameKey: cast(CRYPT_WING_GUST),
      castId: CRYPT_WING_GUST,
      summaryKey: k('drake.gustSummary'),
      responseKey: k('drake.gustResponse'),
      roles: ['all'],
      flags: [],
      values: {
        every: gust?.every ?? 0,
        cast: gust?.castTime ?? 0,
        radius: gust?.radius ?? 0,
        push: gust?.knockback ?? 0,
      },
      difficultyValues: tierDamage(D, mobId, gust?.min ?? 0, gust?.max ?? 0),
      compare: true,
    },
  ];
  return mechanics;
}

const DRAKE_TEMPLATE = HOLLOW_CRYPT_TRASH_MOBS[DRAKE_ID];
const EMBERS = DRAKE_TEMPLATE?.trashKit?.scorch;

const OSSUARY_DRAKE: JournalBossDef = {
  mobId: DRAKE_ID,
  rank: 'miniboss',
  overviewKey: k('drake.overview'),
  phases: [
    {
      id: 'processional',
      nameKey: k('drake.phaseName'),
      summaryKey: k('drake.phaseSummary'),
      mechanics: [
        ...drakeKit(DRAKE_ID, DRAKE_TEMPLATE),
        {
          id: 'barrow-embers',
          iconId: 'dgn_crypt_embers',
          nameKey: k('drake.embersName'),
          availability: 'heroic',
          summaryKey: k('drake.embersSummary'),
          responseKey: k('drake.embersResponse'),
          roles: ['tank', 'all'],
          flags: [],
          values: { seconds: EMBERS?.seconds ?? 0 },
          difficultyValues: tierDamage(D, DRAKE_ID, EMBERS?.min ?? 0, EMBERS?.max ?? 0),
        },
      ],
    },
  ],
  tips: {
    tank: k('drake.tipTank'),
    healer: k('drake.tipHealer'),
    damage: k('drake.tipDamage'),
  },
  heroicNotes: [common('heroicHarder'), k('drake.heroicEmbers')],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, DRAKE_ID),
    seconds: EMBERS?.seconds ?? 0,
  },
};

/** The Toll's range per tier: the base roll (with its own heroic factor),
 *  then the mechanic stamp every Marrow mechanic rides. */
function tollTiers(): Readonly<Record<JournalDifficulty, JournalValues>> {
  const at = (difficulty: JournalDifficulty) => {
    const base = tollDamageRange(difficulty === 'heroic');
    const f = mechanicFactor(D, MARROW_ID, difficulty);
    return { min: Math.round(base.min * f), max: Math.round(base.max * f) };
  };
  return { normal: at('normal'), heroic: at('heroic') };
}

const SEXTON_MARROW: JournalBossDef = {
  mobId: MARROW_ID,
  rank: 'boss',
  overviewKey: k('marrow.overview'),
  phases: [
    {
      id: 'yard',
      nameKey: k('marrow.phaseYardName'),
      summaryKey: k('marrow.phaseYardSummary'),
      mechanics: [
        {
          id: 'shovelful',
          iconId: 'dgn_crypt_shovelful',
          nameKey: cast(MARROW_SHOVELFUL),
          castId: MARROW_SHOVELFUL,
          summaryKey: k('marrow.shovelSummary'),
          responseKey: k('marrow.shovelResponse'),
          roles: ['tank', 'all'],
          flags: ['important'],
          values: {
            every: M.shovelEvery,
            cast: M.shovelCast,
            range: M.shovelRange,
            arc: M.shovelArcDeg,
            mult: M.shovelMult,
            slow: 1 - M.shovelSlow,
            seconds: M.shovelSlowSeconds,
          },
          percentValues: ['slow'],
        },
        {
          id: 'measured-for-the-grave',
          iconId: 'dgn_crypt_measured',
          nameKey: cast(MARROW_MEASURE),
          castId: MARROW_MEASURE,
          summaryKey: k('marrow.measureSummary'),
          responseKey: k('marrow.measureResponse'),
          roles: ['all'],
          flags: ['important'],
          values: {
            every: M.measureEvery,
            cast: M.measureCast,
            mark: M.markSeconds,
            radius: M.graveRadius,
            slow: 1 - M.graveSlow,
            cap: M.graveCap,
          },
          percentValues: ['slow'],
          difficultyValues: tierDamage(D, MARROW_ID, M.graveOpenMin, M.graveOpenMax, {
            normal: { dirt: M.graveDirtPerSecond },
            heroic: {
              dirt: tierScaled(D, MARROW_ID, 'dirt', M.graveDirtPerSecond).heroic.dirt,
            },
          }),
          compare: true,
        },
        {
          id: 'gravediggers-blow',
          iconId: 'dgn_crypt_blow',
          nameKey: cast(MARROW_GRAVEDIGGERS_BLOW),
          castId: MARROW_GRAVEDIGGERS_BLOW,
          availability: 'heroic',
          summaryKey: k('marrow.blowSummary'),
          responseKey: k('marrow.blowResponse'),
          roles: ['tank', 'healer'],
          flags: ['important'],
          values: {
            every: M.blowEvery,
            cast: M.blowCast,
            vuln: M.blowVulnPerStack,
            stacks: M.blowMaxStacks,
            max: M.blowVulnPerStack * M.blowMaxStacks,
            seconds: M.blowSeconds,
          },
          percentValues: ['vuln', 'max'],
        },
        {
          id: 'grave-vigor',
          iconId: 'dgn_crypt_grave_vigor',
          nameKey: k('marrow.vigorName'),
          availability: 'heroic',
          summaryKey: k('marrow.vigorSummary'),
          responseKey: k('marrow.vigorResponse'),
          roles: ['tank'],
          flags: [],
          values: { haste: M.graveVigorHaste - 1 },
          percentValues: ['haste'],
        },
        {
          id: 'unquiet-earth',
          iconId: 'dgn_crypt_unquiet_earth',
          nameKey: k('marrow.unquietName'),
          availability: 'heroic',
          summaryKey: k('marrow.unquietSummary'),
          responseKey: k('marrow.unquietResponse'),
          roles: ['all'],
          flags: [],
          values: { linger: M.unquietLinger, rest: M.unquietRest },
        },
      ],
    },
    {
      id: 'toll',
      nameKey: k('marrow.phaseTollName'),
      summaryKey: k('marrow.phaseTollSummary'),
      values: { first: M.tollAt[0], second: M.tollAt[1] },
      percentValues: ['first', 'second'],
      mechanics: [
        {
          id: 'burial-toll',
          iconId: 'dgn_crypt_burial_toll',
          nameKey: cast(MARROW_BURIAL_TOLL),
          castId: MARROW_BURIAL_TOLL,
          summaryKey: k('marrow.tollSummary'),
          responseKey: k('marrow.tollResponse'),
          roles: ['healer', 'tank', 'damage'],
          flags: ['important'],
          values: { first: M.tollAt[0], second: M.tollAt[1], ring: M.tollRing },
          percentValues: ['first', 'second'],
          difficultyValues: tollTiers(),
          compare: true,
        },
      ],
    },
  ],
  tips: {
    tank: { normal: k('marrow.tipTank'), heroic: k('marrow.tipTankHeroic') },
    healer: k('marrow.tipHealer'),
    damage: k('marrow.tipDamage'),
  },
  choices: [
    {
      id: 'graves',
      iconId: 'dgn_crypt_measured',
      nameKey: k('marrow.choiceName'),
      gainKey: k('marrow.choiceGain'),
      riskKey: { normal: k('marrow.choiceRisk'), heroic: k('marrow.choiceRiskHeroic') },
      values: { cap: M.graveCap },
    },
  ],
  heroicNotes: [
    common('heroicHarder'),
    k('marrow.heroicBlow'),
    k('marrow.heroicVigor'),
    k('marrow.heroicUnquiet'),
  ],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, MARROW_ID),
    vuln: M.blowVulnPerStack,
    haste: M.graveVigorHaste - 1,
    linger: M.unquietLinger,
  },
  heroicNotePercentValues: ['vuln', 'haste'],
};

const LADY: JournalBossDef = {
  mobId: LADY_ID,
  rank: 'boss',
  overviewKey: k('lady.overview'),
  phases: [
    {
      id: 'ravine',
      nameKey: k('lady.phaseRavineName'),
      summaryKey: k('lady.phaseRavineSummary'),
      mechanics: [
        {
          id: 'brides-lament',
          iconId: 'dgn_crypt_lament',
          nameKey: cast(LADY_BRIDES_LAMENT),
          castId: LADY_BRIDES_LAMENT,
          summaryKey: k('lady.lamentSummary'),
          responseKey: k('lady.lamentResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            every: L.lamentEvery,
            cast: L.lamentCast,
            perStack: L.lingerPerStack,
            seconds: L.lingerSeconds,
            stacks: L.lingerMaxStacks,
          },
          percentValues: ['perStack'],
          difficultyValues: tierDamage(D, LADY_ID, L.lamentMin, L.lamentMax),
          compare: true,
        },
        {
          id: 'grave-lanterns',
          iconId: 'dgn_crypt_lantern',
          nameKey: k('lady.lanternName'),
          summaryKey: {
            normal: k('lady.lanternSummary'),
            heroic: k('lady.lanternHeroicSummary'),
          },
          responseKey: k('lady.lanternResponse'),
          roles: ['all'],
          flags: ['important'],
          values: {
            radius: L.lanternRadius,
            cap: L.lanternCap,
            dark: L.lanternDark,
            lit: L.lanternLitHeroic,
            gutter: L.lanternGutter,
          },
        },
        {
          id: 'frozen-embrace',
          iconId: 'dgn_crypt_embrace',
          nameKey: cast(LADY_FROZEN_EMBRACE),
          castId: LADY_FROZEN_EMBRACE,
          summaryKey: { normal: k('lady.embraceSummary'), heroic: k('lady.embraceHeroicSummary') },
          responseKey: k('lady.embraceResponse'),
          roles: ['damage', 'healer'],
          flags: ['deadly', 'important'],
          values: {
            every: L.embraceEvery,
            hold: L.embraceRise + L.embraceHold,
          },
          difficultyValues: tierDamage(D, LADY_ID, L.dropMin, L.dropMax, {
            normal: { victims: L.embraceVictims, share: embraceBreakShare(false) },
            heroic: { victims: L.embraceVictimsHeroic, share: embraceBreakShare(true) },
          }),
          percentValues: ['share'],
          compare: true,
        },
        {
          id: 'rime-path',
          iconId: 'dgn_crypt_rime_path',
          nameKey: k('lady.rimeName'),
          summaryKey: k('lady.rimeSummary'),
          responseKey: k('lady.rimeResponse'),
          roles: ['all'],
          flags: [],
          values: { seconds: L.rimeSeconds },
        },
      ],
    },
    {
      id: 'freeze',
      nameKey: k('lady.phaseFreezeName'),
      summaryKey: k('lady.phaseFreezeSummary'),
      values: { health: L.freezeAt },
      percentValues: ['health'],
      mechanics: [
        {
          id: 'bridal-freeze',
          iconId: 'dgn_crypt_bridal_freeze',
          nameKey: cast(LADY_BRIDAL_FREEZE),
          castId: LADY_BRIDAL_FREEZE,
          summaryKey: k('lady.freezeSummary'),
          responseKey: k('lady.freezeResponse'),
          roles: ['all'],
          flags: ['important'],
          values: { health: L.freezeAt, cast: L.freezeCast },
          percentValues: ['health'],
        },
      ],
    },
  ],
  tips: {
    tank: k('lady.tipTank'),
    healer: k('lady.tipHealer'),
    damage: k('lady.tipDamage'),
  },
  choices: [
    {
      id: 'lanterns',
      iconId: 'dgn_crypt_lantern',
      nameKey: k('lady.choiceName'),
      gainKey: k('lady.choiceGain'),
      riskKey: k('lady.choiceRisk'),
      values: { cap: L.lanternCap, perStack: L.lingerPerStack },
      percentValues: ['perStack'],
    },
  ],
  heroicNotes: [common('heroicHarder'), k('lady.heroicEmbrace'), k('lady.heroicLanterns')],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, LADY_ID),
    victims: L.embraceVictimsHeroic,
    lit: L.lanternLitHeroic,
    gutter: L.lanternGutter,
  },
};

const ILVANE: JournalBossDef = {
  mobId: ILVANE_ID,
  rank: 'boss',
  overviewKey: k('ilvane.overview'),
  phases: [
    {
      id: 'loft',
      nameKey: k('ilvane.phaseLoftName'),
      summaryKey: k('ilvane.phaseLoftSummary'),
      mechanics: [
        {
          id: 'harmony',
          iconId: 'dgn_crypt_harmony',
          nameKey: k('ilvane.harmonyName'),
          summaryKey: k('ilvane.harmonySummary'),
          responseKey: k('ilvane.harmonyResponse'),
          roles: ['damage'],
          flags: ['important'],
          values: { per: I.harmonyPer, both: I.harmonyPer * 2 },
          percentValues: ['per', 'both'],
        },
        {
          id: 'dirge-of-the-hollow',
          iconId: 'dgn_crypt_dirge',
          nameKey: cast(ILVANE_DIRGE),
          castId: ILVANE_DIRGE,
          summaryKey: k('ilvane.dirgeSummary'),
          responseKey: k('ilvane.dirgeResponse'),
          roles: ['all'],
          flags: ['interruptible', 'important'],
          values: {
            every: I.dirgeEvery,
            cast: I.dirgeCast,
            silence: I.dirgeSilence,
            quiet: I.kickQuiet,
          },
          difficultyValues: tierDamage(D, ILVANE_ID, I.dirgeMin, I.dirgeMax),
          compare: true,
        },
        {
          id: 'bone-organ',
          iconId: 'dgn_crypt_bone_organ',
          nameKey: cast(ILVANE_BONE_ORGAN),
          castId: ILVANE_BONE_ORGAN,
          summaryKey: k('ilvane.organSummary'),
          responseKey: k('ilvane.organResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: { every: I.organEvery, gather: I.organGather, waves: I.organWaveAt.length },
          difficultyValues: tierDamage(D, ILVANE_ID, I.noteMin, I.noteMax),
          compare: true,
        },
        {
          id: 'encore',
          iconId: 'dgn_crypt_encore',
          nameKey: k('ilvane.encoreName'),
          availability: 'heroic',
          summaryKey: k('ilvane.encoreSummary'),
          responseKey: k('ilvane.encoreResponse'),
          roles: ['damage'],
          flags: ['important'],
          values: { seconds: I.encoreSeconds },
        },
        {
          id: 'unbroken-verse',
          iconId: 'dgn_crypt_unbroken_verse',
          nameKey: cast(ILVANE_UNBROKEN_DIRGE),
          castId: ILVANE_UNBROKEN_DIRGE,
          availability: 'heroic',
          summaryKey: k('ilvane.unbrokenSummary'),
          responseKey: k('ilvane.unbrokenResponse'),
          roles: ['all'],
          flags: ['deadly'],
          values: { nth: I.unbrokenEvery },
        },
      ],
    },
    {
      id: 'crescendo',
      nameKey: k('ilvane.phaseCrescendoName'),
      summaryKey: k('ilvane.phaseCrescendoSummary'),
      values: { health: I.crescendoAt },
      percentValues: ['health'],
      mechanics: [
        {
          id: 'crescendo',
          iconId: 'dgn_crypt_crescendo',
          nameKey: k('ilvane.crescendoName'),
          summaryKey: k('ilvane.crescendoSummary'),
          responseKey: k('ilvane.crescendoResponse'),
          roles: ['all'],
          flags: ['important'],
          values: {
            health: I.crescendoAt,
            cast: I.dirgeCastCrescendo,
            every: I.dirgeEveryCrescendo,
            waves: I.organWaveAtCrescendo.length,
          },
          percentValues: ['health'],
        },
      ],
    },
  ],
  tips: {
    tank: k('ilvane.tipTank'),
    healer: k('ilvane.tipHealer'),
    damage: { normal: k('ilvane.tipDamage'), heroic: k('ilvane.tipDamageHeroic') },
  },
  tipValues: { seconds: I.encoreSeconds },
  choices: [
    {
      id: 'kick-or-hide',
      iconId: 'dgn_crypt_dirge',
      nameKey: k('ilvane.choiceName'),
      gainKey: k('ilvane.choiceGain'),
      riskKey: k('ilvane.choiceRisk'),
      values: { quiet: I.kickQuiet },
    },
  ],
  heroicNotes: [common('heroicHarder'), k('ilvane.heroicEncore'), k('ilvane.heroicUnbroken')],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, ILVANE_ID),
    seconds: I.encoreSeconds,
    nth: I.unbrokenEvery,
  },
};

const MORTHEN: JournalBossDef = {
  mobId: MORTHEN_ID,
  rank: 'final',
  overviewKey: k('morthen.overview'),
  overviewValues: { rite: MO.riteAt, last: MO.lastRitesAt },
  overviewPercentValues: ['rite', 'last'],
  phases: [
    {
      id: 'calling',
      nameKey: k('morthen.phaseCallingName'),
      summaryKey: k('morthen.phaseCallingSummary'),
      mechanics: [
        {
          id: 'shadow-pulse',
          iconId: 'dgn_crypt_shadow_pulse',
          nameKey: cast(MORTHEN_SHADOW_PULSE),
          castId: MORTHEN_SHADOW_PULSE,
          summaryKey: k('morthen.pulseSummary'),
          responseKey: k('morthen.pulseResponse'),
          roles: ['all'],
          flags: ['important'],
          values: {
            every: MO.pulseEvery,
            everyLast: MO.pulseEveryLastRites,
            cast: MO.pulseCast,
            radius: MO.pulseRadius,
          },
          difficultyValues: tierDamage(D, MORTHEN_ID, MO.pulseMin, MO.pulseMax),
          compare: true,
        },
        {
          id: 'gravecall',
          iconId: 'dgn_crypt_gravecall',
          nameKey: k('morthen.gravecallName'),
          summaryKey: k('morthen.gravecallSummary'),
          responseKey: k('morthen.gravecallResponse'),
          roles: ['damage'],
          flags: ['important'],
          values: {
            every: MO.soulEvery,
            seconds: MO.soulSeconds,
            per: MO.gorgedPct,
            stacks: MO.gorgedMaxStacks,
            heal: MO.gorgedHeal,
          },
          percentValues: ['per', 'heal'],
          difficultyValues: tierDamage(D, MORTHEN_ID, MO.soulInterceptMin, MO.soulInterceptMax),
          compare: true,
        },
        {
          id: 'grasp-of-the-grave',
          iconId: 'dgn_crypt_grasp',
          nameKey: k('morthen.graspName'),
          availability: 'heroic',
          summaryKey: k('morthen.graspSummary'),
          responseKey: k('morthen.graspResponse'),
          roles: ['all'],
          flags: [],
          values: {
            every: MO.graspEvery,
            count: MO.graspTargets,
            radius: MO.graspRadius,
            fuse: MO.graspFuse,
            root: MO.graspRootSeconds,
          },
          difficultyValues: tierDamage(D, MORTHEN_ID, MO.graspMin, MO.graspMax),
        },
      ],
    },
    {
      id: 'rite',
      nameKey: k('morthen.phaseRiteName'),
      summaryKey: k('morthen.phaseRiteSummary'),
      values: { health: MO.riteAt },
      percentValues: ['health'],
      mechanics: [
        {
          id: 'rite-of-the-unquiet',
          iconId: 'dgn_crypt_rite',
          nameKey: cast(MORTHEN_RITE),
          castId: MORTHEN_RITE,
          summaryKey: k('morthen.riteSummary'),
          responseKey: k('morthen.riteResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            candles: RITE_CANDLE_SPOTS.length,
            bones: MO.riteBones,
            base: MO.chillBase,
            step: MO.chillStep,
            chillEvery: MO.chillEvery,
          },
        },
        {
          id: 'relight',
          iconId: 'dgn_crypt_candle',
          nameKey: k('morthen.relightName'),
          summaryKey: k('morthen.relightSummary'),
          responseKey: k('morthen.relightResponse'),
          roles: ['all'],
          flags: ['important'],
          values: {
            channel: MO.relightChannel,
            range: MO.relightRange,
            stun: MO.brokenSeconds,
            vuln: MO.brokenVuln,
          },
          difficultyValues: tierFixed(
            { drain: MO.relightDrainPct * MO.relightChannel },
            { drain: MO.relightDrainPctHeroic * MO.relightChannel },
          ),
          percentValues: ['drain', 'vuln'],
        },
        {
          id: 'name-the-dead',
          iconId: 'dgn_crypt_name_dead',
          nameKey: k('morthen.nameDeadName'),
          availability: 'heroic',
          summaryKey: k('morthen.nameDeadSummary'),
          responseKey: k('morthen.nameDeadResponse'),
          roles: ['all'],
          flags: ['important'],
          difficultyValues: tierDamage(D, MORTHEN_ID, MO.wrongCandleMin, MO.wrongCandleMax),
        },
      ],
    },
    {
      id: 'last-rites',
      nameKey: k('morthen.phaseLastName'),
      summaryKey: k('morthen.phaseLastSummary'),
      values: { health: MO.lastRitesAt },
      percentValues: ['health'],
      mechanics: [
        {
          id: 'reap-the-unquiet',
          iconId: 'dgn_crypt_reap',
          nameKey: cast(MORTHEN_REAP),
          castId: MORTHEN_REAP,
          summaryKey: k('morthen.reapSummary'),
          responseKey: k('morthen.reapResponse'),
          roles: ['tank', 'all'],
          flags: ['important'],
          values: {
            every: MO.reapEvery,
            cast: MO.reapCast,
            arc: MO.reapArcDeg,
            range: MO.reapRange,
          },
          difficultyValues: tierDamage(D, MORTHEN_ID, MO.reapMin, MO.reapMax),
          compare: true,
        },
      ],
    },
  ],
  tips: {
    tank: k('morthen.tipTank'),
    healer: k('morthen.tipHealer'),
    damage: { normal: k('morthen.tipDamage'), heroic: k('morthen.tipDamageHeroic') },
  },
  choices: [
    {
      id: 'lighters',
      iconId: 'dgn_crypt_candle',
      nameKey: k('morthen.choiceCandleName'),
      gainKey: k('morthen.choiceCandleGain'),
      riskKey: k('morthen.choiceCandleRisk'),
      values: { normal: MO.relightDrainPct * MO.relightChannel },
      percentValues: ['normal'],
    },
    {
      id: 'souls',
      iconId: 'dgn_crypt_gravecall',
      nameKey: k('morthen.choiceSoulName'),
      gainKey: k('morthen.choiceSoulGain'),
      riskKey: k('morthen.choiceSoulRisk'),
      values: { per: MO.gorgedPct, heal: MO.gorgedHeal },
      percentValues: ['per', 'heal'],
    },
  ],
  heroicNotes: [
    common('heroicHarder'),
    k('morthen.heroicNameDead'),
    k('morthen.heroicGrasp'),
    k('morthen.heroicDrain'),
  ],
  heroicNoteValues: {
    scale: heroicMechanicScale(D, MORTHEN_ID),
    drain: MO.relightDrainPctHeroic * MO.relightChannel,
  },
  heroicNotePercentValues: ['drain'],
};

const KNELLWYRM_TEMPLATE = HOLLOW_CRYPT_MOBS[KNELLWYRM_ID];

const KNELLWYRM: JournalBossDef = {
  mobId: KNELLWYRM_ID,
  rank: 'miniboss',
  overviewKey: k('wyrm.overview'),
  phases: [
    {
      id: 'pyre',
      nameKey: k('wyrm.phaseName'),
      summaryKey: k('wyrm.phaseSummary'),
      mechanics: [
        {
          id: 'pyre-strafe',
          iconId: 'dgn_crypt_pyre_strafe',
          nameKey: cast(KNELLWYRM_PYRE_STRAFE),
          castId: KNELLWYRM_PYRE_STRAFE,
          summaryKey: k('wyrm.strafeSummary'),
          responseKey: k('wyrm.strafeResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: {
            every: KW.strafeEvery,
            mark: KW.strafeMark,
            width: KW.laneHalf * 2,
            seconds: KW.laneSeconds,
          },
          difficultyValues: tierDamage(D, KNELLWYRM_ID, KW.strafeMin, KW.strafeMax, {
            normal: { burn: KW.lanePerSecond },
            heroic: {
              burn: tierScaled(D, KNELLWYRM_ID, 'burn', KW.lanePerSecond).heroic.burn,
            },
          }),
          compare: true,
        },
        {
          id: 'dread-bellow',
          iconId: 'dgn_crypt_dread_bellow',
          nameKey: cast(KNELLWYRM_DREAD_BELLOW),
          castId: KNELLWYRM_DREAD_BELLOW,
          summaryKey: k('wyrm.bellowSummary'),
          responseKey: k('wyrm.bellowResponse'),
          roles: ['damage', 'all'],
          flags: ['important'],
          values: {
            every: KW.bellowEvery,
            cast: KW.bellowCast,
            radius: KW.bellowRadius,
            push: KW.bellowKnockback,
            vuln: KW.baredVuln,
            seconds: KW.baredSeconds,
          },
          percentValues: ['vuln'],
          difficultyValues: tierDamage(D, KNELLWYRM_ID, KW.bellowMin, KW.bellowMax),
          compare: true,
        },
        ...drakeKit(KNELLWYRM_ID, KNELLWYRM_TEMPLATE),
        {
          id: 'burning-knell',
          iconId: 'dgn_crypt_burning_knell',
          nameKey: cast(KNELLWYRM_KNELL_RISE),
          castId: KNELLWYRM_KNELL_RISE,
          availability: 'heroic',
          summaryKey: k('wyrm.knellSummary'),
          responseKey: k('wyrm.knellResponse'),
          roles: ['all'],
          flags: ['deadly', 'important'],
          values: { every: KN.every, breaths: KN.breaths, mark: KN.markSeconds },
          difficultyValues: tierDamage(D, KNELLWYRM_ID, KN.fireMin, KN.fireMax),
        },
      ],
    },
  ],
  tips: {
    tank: k('wyrm.tipTank'),
    healer: k('wyrm.tipHealer'),
    damage: { normal: k('wyrm.tipDamage'), heroic: k('wyrm.tipDamageHeroic') },
  },
  heroicNotes: [common('heroicHarder'), k('wyrm.heroicKnell')],
  heroicNoteValues: { scale: heroicMechanicScale(D, KNELLWYRM_ID), breaths: KN.breaths },
};

export const HOLLOW_CRYPT_JOURNAL: DungeonJournalDef = {
  dungeonId: D,
  bosses: [OSSUARY_DRAKE, SEXTON_MARROW, LADY, ILVANE, MORTHEN, KNELLWYRM],
};
