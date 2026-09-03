// Pure encounter-journal model for the raid guide reached from party frames.
// Room context selects the suggested boss, while the window may browse either
// encounter and choose Normal or Heroic without consulting mutable world state.

import {
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
} from '../sim/encounters/ignivar';
import {
  NYTHRAXIS_DEATHLESS_CAST,
  NYTHRAXIS_DEATHLESS_CHANNEL,
  NYTHRAXIS_DEATHLESS_EVERY,
  NYTHRAXIS_DEATHLESS_PCT,
  NYTHRAXIS_DEATHLESS_PCT_HEROIC,
  NYTHRAXIS_DEATHLESS_STUN,
  NYTHRAXIS_FINAL_STAND_HP,
  NYTHRAXIS_GRAVEBREAKER_EVERY,
  NYTHRAXIS_GRAVEBREAKER_HALF_ARC,
  NYTHRAXIS_GRAVEBREAKER_RANGE,
  NYTHRAXIS_GRAVEBREAKER_SPLASH_MULT,
  NYTHRAXIS_PHASE_TWO_HP,
  NYTHRAXIS_RAISE_FALLEN_EVERY,
  NYTHRAXIS_SOUL_REND_DURATION,
  NYTHRAXIS_SOUL_REND_HEROIC_MULT,
  NYTHRAXIS_SOUL_REND_MARKS,
  NYTHRAXIS_SOUL_REND_MARKS_HEROIC,
  NYTHRAXIS_SOUL_REND_STACK_RANGE,
} from '../sim/encounters/nythraxis';
import {
  VARKHUL_FORGESTORM_WAVES,
  VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS,
  VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD,
  VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD,
} from '../sim/encounters/varkhul';
import { IGNIVAR_JUDGMENT_HP_THRESHOLD } from '../sim/ignivar_forge_judgment';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../sim/ignivar_raid_ids';
import {
  NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC,
  NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL,
  NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC,
  NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL,
  NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC,
  NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL,
} from '../sim/nythraxis_bone_spike';
import {
  NYTHRAXIS_DREAD_CURSE_DURATION,
  NYTHRAXIS_DREAD_CURSE_EVERY,
  NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP,
  NYTHRAXIS_DREAD_CURSE_MAX_STACKS,
  NYTHRAXIS_DREAD_CURSE_PER_STACK_HEROIC,
  NYTHRAXIS_DREAD_CURSE_PER_STACK_NORMAL,
  NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS,
} from '../sim/nythraxis_dread_curse';
import {
  NYTHRAXIS_GRAVE_ERUPTION_COUNT_HEROIC,
  NYTHRAXIS_GRAVE_ERUPTION_COUNT_NORMAL,
  NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_HEROIC,
  NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_NORMAL,
  NYTHRAXIS_GRAVE_ERUPTION_EVERY_HEROIC,
  NYTHRAXIS_GRAVE_ERUPTION_EVERY_NORMAL,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  NYTHRAXIS_GRAVE_FLAME_SECONDS_HEROIC,
  NYTHRAXIS_GRAVE_FLAME_SECONDS_NORMAL,
  NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_HEROIC,
  NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_NORMAL,
} from '../sim/nythraxis_grave_eruption';
import { IGNIVAR_BOSS_ID, NYTHRAXIS_BOSS_ID } from '../sim/types';
import { VARKHUL_ANVILS_DECREE_STRIKES } from '../sim/varkhul_anvils_decree';
import {
  VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
  VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
} from '../sim/varkhul_shared_pyre';
import { targetPortraitUrl } from './target_portrait_view';

export type RaidBossGuideBoss = 'ignivar' | 'varkhul' | 'nythraxis';

// The Abandoned Crypt raid room (content/dungeons.ts). The sim exports no id
// constant for it (the arena is addressed by its literal in instances/dungeons.ts
// too), so the journal pins the same literal here.
export const NYTHRAXIS_BOSS_ARENA_ID = 'nythraxis_boss_arena';

// Gravebreaker's cone is authored as a half-angle in radians; the journal reads
// the full arc in degrees, derived here rather than retyped.
const NYTHRAXIS_GRAVEBREAKER_ARC_DEGREES = Math.round(
  (NYTHRAXIS_GRAVEBREAKER_HALF_ARC * 2 * 180) / Math.PI,
);
export type RaidBossGuideDifficulty = 'normal' | 'heroic';
export type RaidBossGuideRole = 'tank' | 'healer' | 'damage' | 'all';
export type RaidBossGuideFlag = 'deadly' | 'interruptible' | 'important' | 'cleansable';
export type RaidBossGuideTextKey = `hudChrome.raidBossGuide.${string}`;

export interface RaidBossGuideMechanic {
  id: string;
  iconId: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey: RaidBossGuideTextKey;
  responseKey: RaidBossGuideTextKey;
  roles: readonly RaidBossGuideRole[];
  flags: readonly RaidBossGuideFlag[];
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
}

export interface RaidBossGuidePhase {
  id: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey: RaidBossGuideTextKey;
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
  mechanics: readonly RaidBossGuideMechanic[];
}

export interface RaidBossGuideView {
  boss: RaidBossGuideBoss;
  bossId: typeof IGNIVAR_BOSS_ID | typeof VARKHUL_BOSS_ID | typeof NYTHRAXIS_BOSS_ID;
  difficulty: RaidBossGuideDifficulty;
  portraitUrl: string;
  overviewKey: RaidBossGuideTextKey;
  phases: readonly RaidBossGuidePhase[];
}

interface MechanicDefinition {
  id: string;
  iconId: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey:
    | RaidBossGuideTextKey
    | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>;
  responseKey:
    | RaidBossGuideTextKey
    | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>;
  roles: readonly RaidBossGuideRole[];
  flags?: readonly RaidBossGuideFlag[];
  availability?: RaidBossGuideDifficulty;
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
}

interface PhaseDefinition {
  id: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey:
    | RaidBossGuideTextKey
    | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>;
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
  mechanics: readonly MechanicDefinition[];
}

const key = (suffix: string): RaidBossGuideTextKey => `hudChrome.raidBossGuide.${suffix}`;

const IGNIVAR_PHASES: readonly PhaseDefinition[] = [
  {
    id: 'opening',
    nameKey: key('ignivar.phaseOpeningName'),
    summaryKey: key('ignivar.phaseOpeningSummary'),
    mechanics: [
      {
        id: 'forge-strike',
        iconId: 'raid_ignivar_forge_strike',
        nameKey: key('ignivar.forgeStrikeName'),
        summaryKey: key('ignivar.forgeStrikeSummary'),
        responseKey: key('ignivar.forgeStrikeResponse'),
        roles: ['tank', 'healer'],
        flags: ['important'],
        values: { stacks: 2 },
      },
      {
        id: 'brand-of-the-pyre',
        iconId: 'raid_ignivar_brand',
        nameKey: key('ignivar.brandName'),
        summaryKey: key('ignivar.brandSummary'),
        responseKey: {
          normal: key('ignivar.brandResponse'),
          heroic: key('ignivar.brandHeroicResponse'),
        },
        roles: ['healer', 'damage'],
        flags: ['cleansable', 'important'],
      },
      {
        id: 'searing-torrent',
        iconId: 'raid_ignivar_searing_torrent',
        nameKey: key('ignivar.searingTorrentName'),
        summaryKey: {
          normal: key('ignivar.searingTorrentSummary'),
          heroic: key('ignivar.searingTorrentHeroicSummary'),
        },
        responseKey: key('ignivar.searingTorrentResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'rain-of-cinders',
        iconId: 'raid_ignivar_rain_of_cinders',
        nameKey: key('ignivar.rainName'),
        summaryKey: {
          normal: key('ignivar.rainSummary'),
          heroic: key('ignivar.rainHeroicSummary'),
        },
        responseKey: key('ignivar.rainResponse'),
        roles: ['all'],
        flags: ['deadly'],
      },
      {
        id: 'revolving-inferno',
        iconId: 'raid_ignivar_revolving_inferno',
        nameKey: key('ignivar.raysName'),
        summaryKey: {
          normal: key('ignivar.raysSummary'),
          heroic: key('ignivar.raysHeroicSummary'),
        },
        responseKey: key('ignivar.raysResponse'),
        roles: ['all'],
        flags: ['deadly'],
      },
      {
        id: 'forge-wave',
        iconId: 'raid_ignivar_forge_wave',
        nameKey: key('ignivar.forgeWaveName'),
        summaryKey: {
          normal: key('ignivar.forgeWaveSummary'),
          heroic: key('ignivar.forgeWaveHeroicSummary'),
        },
        responseKey: key('ignivar.forgeWaveResponse'),
        roles: ['all'],
        flags: ['important'],
      },
    ],
  },
  {
    id: 'apocalypse',
    nameKey: key('ignivar.phaseApocalypseName'),
    summaryKey: key('ignivar.phaseApocalypseSummary'),
    values: { health: IGNIVAR_APOCALYPSE_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'apocalypse',
        iconId: 'raid_ignivar_apocalypse',
        nameKey: key('ignivar.apocalypseName'),
        summaryKey: key('ignivar.apocalypseSummary'),
        responseKey: key('ignivar.apocalypseResponse'),
        roles: ['damage'],
        flags: ['deadly', 'important'],
      },
    ],
  },
  {
    id: 'judgment',
    nameKey: key('ignivar.phaseJudgmentName'),
    summaryKey: {
      normal: key('ignivar.phaseJudgmentSummary'),
      heroic: key('ignivar.phaseJudgmentHeroicSummary'),
    },
    values: { health: IGNIVAR_JUDGMENT_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'judgment-of-the-forge',
        iconId: 'raid_ignivar_judgment',
        nameKey: key('ignivar.judgmentName'),
        summaryKey: {
          normal: key('ignivar.judgmentSummary'),
          heroic: key('ignivar.judgmentHeroicSummary'),
        },
        responseKey: key('ignivar.judgmentResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'chains-of-the-forge',
        iconId: 'raid_ignivar_chains',
        nameKey: key('ignivar.chainsName'),
        summaryKey: key('ignivar.chainsSummary'),
        responseKey: key('ignivar.chainsResponse'),
        roles: ['all'],
        flags: ['important'],
        availability: 'heroic',
      },
    ],
  },
  {
    id: 'finale',
    nameKey: key('ignivar.phaseFinaleName'),
    summaryKey: key('ignivar.phaseFinaleSummary'),
    values: { health: IGNIVAR_LAST_INFERNO_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'last-inferno',
        iconId: 'raid_ignivar_last_inferno',
        nameKey: key('ignivar.lastInfernoName'),
        summaryKey: key('ignivar.lastInfernoSummary'),
        responseKey: key('ignivar.lastInfernoResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
    ],
  },
];

const VARKHUL_PHASES: readonly PhaseDefinition[] = [
  {
    id: 'opening',
    nameKey: key('varkhul.phaseOpeningName'),
    summaryKey: key('varkhul.phaseOpeningSummary'),
    mechanics: [
      {
        id: 'makers-brand',
        iconId: 'raid_varkhul_makers_brand',
        nameKey: key('varkhul.makersBrandName'),
        summaryKey: key('varkhul.makersBrandSummary'),
        responseKey: key('varkhul.makersBrandResponse'),
        roles: ['tank', 'healer'],
        flags: ['important'],
        values: { stacks: VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS },
      },
      {
        id: 'forgefather-frontal',
        iconId: 'raid_varkhul_frontal',
        nameKey: key('varkhul.frontalName'),
        summaryKey: {
          normal: key('varkhul.frontalSummary'),
          heroic: key('varkhul.frontalHeroicSummary'),
        },
        responseKey: key('varkhul.frontalResponse'),
        roles: ['all'],
        flags: ['deadly'],
      },
      {
        id: 'cinder-orbs',
        iconId: 'raid_varkhul_cinder_orbs',
        nameKey: key('varkhul.orbsName'),
        summaryKey: {
          normal: key('varkhul.orbsSummary'),
          heroic: key('varkhul.orbsHeroicSummary'),
        },
        responseKey: key('varkhul.orbsResponse'),
        roles: ['healer', 'damage'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'shared-pyre',
        iconId: 'raid_varkhul_shared_pyre',
        nameKey: key('varkhul.pyreName'),
        summaryKey: {
          normal: key('varkhul.pyreSummary'),
          heroic: key('varkhul.pyreHeroicSummary'),
        },
        responseKey: key('varkhul.pyreResponse'),
        roles: ['all'],
        flags: ['important'],
        values: {
          players: VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
          missingPenalty: VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
        },
        percentValues: ['missingPenalty'],
      },
      {
        id: 'forgestorm',
        iconId: 'raid_varkhul_forgestorm',
        nameKey: key('varkhul.forgestormName'),
        summaryKey: {
          normal: key('varkhul.forgestormSummary'),
          heroic: key('varkhul.forgestormHeroicSummary'),
        },
        responseKey: key('varkhul.forgestormResponse'),
        roles: ['all'],
        flags: ['deadly'],
        values: { waves: VARKHUL_FORGESTORM_WAVES },
      },
      {
        id: 'tempering-ray',
        iconId: 'raid_varkhul_tempering_ray',
        nameKey: key('varkhul.rayName'),
        summaryKey: key('varkhul.raySummary'),
        responseKey: key('varkhul.rayResponse'),
        roles: ['tank', 'healer'],
        flags: ['important'],
      },
      {
        id: 'anvils-decree',
        iconId: 'raid_varkhul_anvils_decree',
        nameKey: key('varkhul.anvilName'),
        summaryKey: {
          normal: key('varkhul.anvilSummary'),
          heroic: key('varkhul.anvilHeroicSummary'),
        },
        responseKey: {
          normal: key('varkhul.anvilResponse'),
          heroic: key('varkhul.anvilHeroicResponse'),
        },
        roles: ['all'],
        flags: ['deadly', 'important'],
        values: { strikes: VARKHUL_ANVILS_DECREE_STRIKES },
      },
    ],
  },
  {
    id: 'assembly',
    nameKey: key('varkhul.phaseAssemblyName'),
    summaryKey: key('varkhul.phaseAssemblySummary'),
    values: { health: VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'masters-assembly',
        iconId: 'raid_varkhul_masters_assembly',
        nameKey: key('varkhul.assemblyName'),
        summaryKey: key('varkhul.assemblySummary'),
        responseKey: key('varkhul.assemblyResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'crucible-beam',
        iconId: 'raid_varkhul_crucible_beam',
        nameKey: key('varkhul.beamName'),
        summaryKey: {
          normal: key('varkhul.beamSummary'),
          heroic: key('varkhul.beamHeroicSummary'),
        },
        responseKey: key('varkhul.beamResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'forge-legion',
        iconId: 'raid_varkhul_forge_legion',
        nameKey: key('varkhul.legionName'),
        summaryKey: key('varkhul.legionSummary'),
        responseKey: key('varkhul.legionResponse'),
        roles: ['damage'],
        flags: ['interruptible', 'important'],
      },
    ],
  },
  {
    id: 'finale',
    nameKey: key('varkhul.phaseFinaleName'),
    summaryKey: {
      normal: key('varkhul.phaseFinaleSummary'),
      heroic: key('varkhul.phaseFinaleHeroicSummary'),
    },
    values: { health: VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'masterpiece-unbound',
        iconId: 'raid_varkhul_masterpiece_unbound',
        nameKey: key('varkhul.masterpieceName'),
        summaryKey: {
          normal: key('varkhul.masterpieceSummary'),
          heroic: key('varkhul.masterpieceHeroicSummary'),
        },
        responseKey: key('varkhul.masterpieceResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'worldfire',
        iconId: 'raid_varkhul_worldfire',
        nameKey: key('varkhul.worldfireName'),
        summaryKey: key('varkhul.worldfireSummary'),
        responseKey: key('varkhul.worldfireResponse'),
        roles: ['all'],
        flags: ['deadly'],
        availability: 'heroic',
      },
    ],
  },
];

// Nythraxis runs every mechanic on both difficulties; heroic raises counts and
// damage. A mechanic's `values` bag is shared by its Normal and Heroic copy, so
// the difficulty-specific numbers ride as separate tokens and each summary key
// names the ones it spells.
const NYTHRAXIS_PHASES: readonly PhaseDefinition[] = [
  {
    id: 'throne',
    nameKey: key('nythraxis.phaseThroneName'),
    summaryKey: key('nythraxis.phaseThroneSummary'),
    mechanics: [
      {
        id: 'gravebreaker',
        iconId: 'raid_nythraxis_gravebreaker',
        nameKey: key('nythraxis.gravebreakerName'),
        summaryKey: key('nythraxis.gravebreakerSummary'),
        responseKey: key('nythraxis.gravebreakerResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
        values: {
          seconds: NYTHRAXIS_GRAVEBREAKER_EVERY,
          range: NYTHRAXIS_GRAVEBREAKER_RANGE,
          arc: NYTHRAXIS_GRAVEBREAKER_ARC_DEGREES,
          splash: NYTHRAXIS_GRAVEBREAKER_SPLASH_MULT,
        },
        percentValues: ['splash'],
      },
      {
        id: 'dread-curse',
        iconId: 'raid_nythraxis_dread_curse',
        nameKey: key('nythraxis.dreadCurseName'),
        summaryKey: {
          normal: key('nythraxis.dreadCurseSummary'),
          heroic: key('nythraxis.dreadCurseHeroicSummary'),
        },
        responseKey: key('nythraxis.dreadCurseResponse'),
        roles: ['tank', 'healer'],
        flags: ['important'],
        values: {
          stacks: NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS,
          every: NYTHRAXIS_DREAD_CURSE_EVERY,
          hit: NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP,
          perStackNormal: NYTHRAXIS_DREAD_CURSE_PER_STACK_NORMAL,
          perStackHeroic: NYTHRAXIS_DREAD_CURSE_PER_STACK_HEROIC,
          duration: NYTHRAXIS_DREAD_CURSE_DURATION,
          max: NYTHRAXIS_DREAD_CURSE_MAX_STACKS,
        },
        percentValues: ['hit', 'perStackNormal', 'perStackHeroic'],
      },
      {
        id: 'bone-spike',
        iconId: 'raid_nythraxis_bone_spike',
        nameKey: key('nythraxis.boneSpikeName'),
        summaryKey: {
          normal: key('nythraxis.boneSpikeSummary'),
          heroic: key('nythraxis.boneSpikeHeroicSummary'),
        },
        responseKey: key('nythraxis.boneSpikeResponse'),
        roles: ['damage', 'healer'],
        flags: ['deadly', 'important'],
        values: {
          everyNormal: NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL,
          everyHeroic: NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC,
          victimsNormal: NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL,
          victimsHeroic: NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC,
          drainNormal: NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL,
          drainHeroic: NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC,
        },
        percentValues: ['drainNormal', 'drainHeroic'],
      },
      {
        id: 'grave-eruption',
        iconId: 'raid_nythraxis_grave_eruption',
        nameKey: key('nythraxis.graveEruptionName'),
        summaryKey: {
          normal: key('nythraxis.graveEruptionSummary'),
          heroic: key('nythraxis.graveEruptionHeroicSummary'),
        },
        responseKey: key('nythraxis.graveEruptionResponse'),
        roles: ['all'],
        flags: ['deadly'],
        values: {
          everyNormal: NYTHRAXIS_GRAVE_ERUPTION_EVERY_NORMAL,
          everyHeroic: NYTHRAXIS_GRAVE_ERUPTION_EVERY_HEROIC,
          countNormal: NYTHRAXIS_GRAVE_ERUPTION_COUNT_NORMAL,
          countHeroic: NYTHRAXIS_GRAVE_ERUPTION_COUNT_HEROIC,
          radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
          warning: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
          burstNormal: NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_NORMAL,
          burstHeroic: NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_HEROIC,
          flameNormal: NYTHRAXIS_GRAVE_FLAME_SECONDS_NORMAL,
          flameHeroic: NYTHRAXIS_GRAVE_FLAME_SECONDS_HEROIC,
          tickNormal: NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_NORMAL,
          tickHeroic: NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_HEROIC,
        },
        percentValues: ['burstNormal', 'burstHeroic', 'tickNormal', 'tickHeroic'],
      },
      {
        id: 'raise-fallen',
        iconId: 'raid_nythraxis_raise_fallen',
        nameKey: key('nythraxis.raiseFallenName'),
        summaryKey: key('nythraxis.raiseFallenSummary'),
        responseKey: key('nythraxis.raiseFallenResponse'),
        roles: ['tank', 'damage'],
        flags: ['important'],
        values: { every: NYTHRAXIS_RAISE_FALLEN_EVERY },
      },
    ],
  },
  {
    id: 'wardstones',
    nameKey: key('nythraxis.phaseWardstonesName'),
    summaryKey: key('nythraxis.phaseWardstonesSummary'),
    values: { health: NYTHRAXIS_PHASE_TWO_HP },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'soul-rend',
        iconId: 'raid_nythraxis_soul_rend',
        nameKey: key('nythraxis.soulRendName'),
        summaryKey: {
          normal: key('nythraxis.soulRendSummary'),
          heroic: key('nythraxis.soulRendHeroicSummary'),
        },
        responseKey: key('nythraxis.soulRendResponse'),
        roles: ['healer', 'damage'],
        flags: ['deadly', 'important'],
        values: {
          marksNormal: NYTHRAXIS_SOUL_REND_MARKS,
          marksHeroic: NYTHRAXIS_SOUL_REND_MARKS_HEROIC,
          fuse: NYTHRAXIS_SOUL_REND_DURATION,
          range: NYTHRAXIS_SOUL_REND_STACK_RANGE,
          damageHeroic: NYTHRAXIS_SOUL_REND_HEROIC_MULT,
        },
        percentValues: ['damageHeroic'],
      },
      {
        id: 'deathless-rage',
        iconId: 'raid_nythraxis_deathless_rage',
        nameKey: key('nythraxis.deathlessRageName'),
        summaryKey: {
          normal: key('nythraxis.deathlessRageSummary'),
          heroic: key('nythraxis.deathlessRageHeroicSummary'),
        },
        responseKey: key('nythraxis.deathlessRageResponse'),
        roles: ['all'],
        flags: ['deadly', 'interruptible', 'important'],
        values: {
          every: NYTHRAXIS_DEATHLESS_EVERY,
          cast: NYTHRAXIS_DEATHLESS_CAST,
          channel: NYTHRAXIS_DEATHLESS_CHANNEL,
          stun: NYTHRAXIS_DEATHLESS_STUN,
          damageNormal: NYTHRAXIS_DEATHLESS_PCT,
          damageHeroic: NYTHRAXIS_DEATHLESS_PCT_HEROIC,
        },
        percentValues: ['damageNormal', 'damageHeroic'],
      },
      {
        id: 'deathless-court',
        iconId: 'raid_nythraxis_deathless_court',
        nameKey: key('nythraxis.courtName'),
        summaryKey: key('nythraxis.courtSummary'),
        responseKey: key('nythraxis.courtResponse'),
        roles: ['tank', 'damage'],
        flags: ['interruptible', 'important'],
        availability: 'heroic',
      },
    ],
  },
  {
    id: 'final-stand',
    nameKey: key('nythraxis.phaseFinalStandName'),
    summaryKey: key('nythraxis.phaseFinalStandSummary'),
    values: { health: NYTHRAXIS_FINAL_STAND_HP },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'final-stand',
        iconId: 'raid_nythraxis_final_stand',
        nameKey: key('nythraxis.finalStandName'),
        summaryKey: key('nythraxis.finalStandSummary'),
        responseKey: key('nythraxis.finalStandResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
    ],
  },
];

const BOSS_PHASES: Readonly<Record<RaidBossGuideBoss, readonly PhaseDefinition[]>> = {
  ignivar: IGNIVAR_PHASES,
  varkhul: VARKHUL_PHASES,
  nythraxis: NYTHRAXIS_PHASES,
};

const BOSS_IDS: Readonly<Record<RaidBossGuideBoss, RaidBossGuideView['bossId']>> = {
  ignivar: IGNIVAR_BOSS_ID,
  varkhul: VARKHUL_BOSS_ID,
  nythraxis: NYTHRAXIS_BOSS_ID,
};

function localizedKey(
  value: RaidBossGuideTextKey | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>,
  difficulty: RaidBossGuideDifficulty,
): RaidBossGuideTextKey {
  return typeof value === 'string' ? value : value[difficulty];
}

function buildPhases(
  definitions: readonly PhaseDefinition[],
  difficulty: RaidBossGuideDifficulty,
): RaidBossGuidePhase[] {
  return definitions.map((phase) => ({
    id: phase.id,
    nameKey: phase.nameKey,
    summaryKey: localizedKey(phase.summaryKey, difficulty),
    ...(phase.values ? { values: phase.values } : {}),
    ...(phase.percentValues ? { percentValues: phase.percentValues } : {}),
    mechanics: phase.mechanics
      .filter((mechanic) => !mechanic.availability || mechanic.availability === difficulty)
      .map((mechanic) => ({
        id: mechanic.id,
        iconId: mechanic.iconId,
        nameKey: mechanic.nameKey,
        summaryKey: localizedKey(mechanic.summaryKey, difficulty),
        responseKey: localizedKey(mechanic.responseKey, difficulty),
        roles: mechanic.roles,
        flags: mechanic.flags ?? [],
        ...(mechanic.values ? { values: mechanic.values } : {}),
        ...(mechanic.percentValues ? { percentValues: mechanic.percentValues } : {}),
      })),
  }));
}

export function raidBossGuideBossForDungeon(dungeonId: string | null): RaidBossGuideBoss | null {
  if (dungeonId === IGNIVAR_FORGE_APPROACH_ID || dungeonId === IGNIVAR_RAID_ARENA_ID) {
    return 'ignivar';
  }
  if (dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID || dungeonId === IGNIVAR_SECOND_WING_ID) {
    return 'varkhul';
  }
  if (dungeonId === NYTHRAXIS_BOSS_ARENA_ID) return 'nythraxis';
  return null;
}

export function raidBossGuideView(
  boss: RaidBossGuideBoss,
  difficulty: RaidBossGuideDifficulty = 'normal',
): RaidBossGuideView {
  const bossId = BOSS_IDS[boss];
  return {
    boss,
    bossId,
    difficulty,
    portraitUrl: targetPortraitUrl(bossId, true) ?? '',
    overviewKey: key(`${boss}.overview`),
    phases: buildPhases(BOSS_PHASES[boss], difficulty),
  };
}
