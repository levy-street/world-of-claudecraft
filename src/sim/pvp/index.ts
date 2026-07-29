export {
  ARENA_DAILY_TAPER_FLOOR_START,
  ARENA_DAILY_TAPER_START,
  ARENA_REPEAT_DR,
  arenaRepeatHonorMultiplier,
  awardBattlegroundAssistHonor,
  awardBattlegroundHonor,
  awardBattlegroundKillHonor,
  awardFiestaCompletionHonor,
  awardFiestaKillHonor,
  awardRankedArenaWinHonor,
  BATTLEGROUND_ASSIST_HONOR,
  BATTLEGROUND_FIRST_WIN_BONUS_HONOR,
  BATTLEGROUND_KILL_HONOR,
  BATTLEGROUND_LOSS_HONOR,
  BATTLEGROUND_RESULT_DR,
  BATTLEGROUND_WIN_HONOR,
  type BattlegroundHonorAward,
  battlegroundResultMultiplier,
  bgFirstWinBonusAvailable,
  FIESTA_COMPLETION_HONOR,
  FIESTA_KILL_HONOR,
  FIESTA_WIN_BONUS_HONOR,
  grantHonor,
  HONOR_REPEAT_DR,
  honorTeamIdentity,
  normalizeHonorCounter,
  normalizeHonorDailyState,
  RANKED_ARENA_WIN_HONOR,
  repeatHonorMultiplier,
} from './honor';
export {
  PVP_DEFENSE_CAP,
  PVP_OFFENSE_CAP,
  PVP_RATING_PER_PCT,
  type PvpCaps,
  pvpDamageMultiplier,
  pvpFractionsFromRatings,
} from './power';
// warfare_quartermaster.ts is DELIBERATELY not re-exported here. It needs
// createNpc from '../entity' at runtime, and entity.ts imports this barrel for
// pvpFractionsFromRatings, so re-exporting it would close a value-level ESM
// cycle (entity -> pvp/index -> warfare_quartermaster -> entity). That happens
// to work today only because createNpc is called function-scoped; the day
// anything in the directory reaches for it at module scope it breaks at import
// time with an unhelpful error. Every other pvp import was type-only, so this
// is the one module that would make a leaf directory cycle-fragile.
//
// Its single consumer is the Sim coordinator during world init, so it is not
// public API in any meaningful sense: import it by path.
