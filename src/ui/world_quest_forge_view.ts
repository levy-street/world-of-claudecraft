/** Owner-only workshop readouts; consumes authoritative sim seconds, never wall time. */
import {
  FORGE_GOLD_SECONDS,
  FORGE_HEAT_FLOOR,
  FORGE_SILVER_SECONDS,
  FORGE_STRIKES,
  FORGE_WRONG_PENALTY,
  forgeHeatAt,
  forgeNeedleAt,
  forgeNeedleInBand,
} from '../sim/minigames/forge_workshop';
import type { WorldQuestForgeResult, WorldQuestForgeState, WorldQuestProgress } from '../sim/types';
import { type ActionBarState, makeSlotState } from './hud/action_bar/action_bar_view';
import { formatNumber, t } from './i18n';

const number = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

export function forgeObjectLabel(objectItemId: string): string | null {
  switch (objectItemId) {
    case 'forge_fuel':
      return t('questUi.worldQuest.forge.fuel');
    case 'forge_metal':
      return t('questUi.worldQuest.forge.metal');
    case 'forge_water':
      return t('questUi.worldQuest.forge.water');
    case 'forge_tools':
      return t('questUi.worldQuest.forge.tools');
    default:
      return null;
  }
}

export function forgeResultText(result: WorldQuestForgeResult): string {
  return t('questUi.worldQuest.forge.result', {
    rating: t(`questUi.worldQuest.forge.medals.${result.rating}`),
    seconds: number(Math.ceil(result.adjustedTime)),
    mistakes: number(result.mistakes),
  });
}

/** Mara's speech carries the coaching line, with no score or tracker bookkeeping. */
export function forgeSpeechText(progress: WorldQuestProgress): string | null {
  const session = progress.forging;
  if (!session) return null;
  if (session.phase === 'success') return t('questUi.worldQuest.forge.finished');
  if (session.phase === 'failed') return t('questUi.worldQuest.forge.failed');
  const now = session.observedAt;
  if (session.phase === 'countdown' || now < session.readyAt) {
    return t('questUi.worldQuest.forge.countdown', {
      seconds: number(Math.max(0, Math.ceil(session.readyAt - now))),
    });
  }
  if (forgeHeatAt(session, now) < FORGE_HEAT_FLOOR) return t('questUi.worldQuest.forge.hintStoke');
  switch (session.feedback) {
    case 'hit':
      return t('questUi.worldQuest.forge.hit');
    case 'miss':
      return t('questUi.worldQuest.forge.miss', { penalty: number(FORGE_WRONG_PENALTY) });
    case 'cold':
      return t('questUi.worldQuest.forge.cold', { penalty: number(FORGE_WRONG_PENALTY) });
    default:
      return t('questUi.worldQuest.forge.hintStrike');
  }
}

/** Progress stays in the tracker; medal thresholds appear only after a finish. */
export function forgeInstructionLines(progress: WorldQuestProgress): string[] {
  const session = progress.forging;
  const result =
    session?.phase === 'success' ? session.result : !session ? progress.forgeResult : null;
  if (result) {
    return [
      forgeResultText(result),
      t('questUi.worldQuest.forge.thresholds', {
        gold: number(FORGE_GOLD_SECONDS),
        silver: number(FORGE_SILVER_SECONDS),
      }),
      t('questUi.worldQuest.forge.replay'),
    ];
  }
  if (!session) return [t('questUi.worldQuest.forge.ready')];
  if (session.phase === 'failed')
    return [t('questUi.worldQuest.forge.failed'), t('questUi.worldQuest.forge.ready')];
  if (session.phase === 'countdown') return [t('questUi.worldQuest.forge.starting')];
  const lines = [
    t('questUi.worldQuest.forge.strikes', {
      count: number(session.strikes),
      total: number(FORGE_STRIKES),
    }),
    t('questUi.worldQuest.forge.heat', {
      value: formatNumber(forgeHeatAt(session, session.observedAt) / 100, { style: 'percent' }),
      floor: formatNumber(FORGE_HEAT_FLOOR / 100, { style: 'percent' }),
    }),
  ];
  if (session.mistakes > 0)
    lines.push(t('questUi.worldQuest.forge.mistakes', { count: number(session.mistakes) }));
  return lines;
}

/** What the bar paints for one frame: needle, band, heat, at authoritative time `now`. */
export interface ForgeMeterView {
  needle: number;
  bandStart: number;
  bandEnd: number;
  inBand: boolean;
  heat: number;
  warm: boolean;
  working: boolean;
}

export function forgeMeterView(session: WorldQuestForgeState, now: number): ForgeMeterView {
  const working = session.phase === 'working' && now >= session.readyAt;
  const needle = working ? forgeNeedleAt(session, now) : 0;
  const heat = forgeHeatAt(session, Math.max(now, session.readyAt));
  return {
    needle,
    bandStart: Math.max(0, session.band - session.bandHalf),
    bandEnd: Math.min(1, session.band + session.bandHalf),
    inBand: working && forgeNeedleInBand(session, needle),
    heat,
    warm: heat >= FORGE_HEAT_FLOOR,
    working,
  };
}

export function createForgeActionBarView() {
  const state: ActionBarState = { slots: [makeSlotState(), makeSlotState()], manySpells: false };
  return {
    tick(session: WorldQuestForgeState, now: number, keyLabel: (slot: number) => string) {
      const working = session.phase === 'working' && now >= session.readyAt;
      const strike = state.slots[0];
      strike.kind = 'ability';
      strike.abilityId = 'forge_strike';
      strike.iconKey = 'heroic_strike';
      strike.ariaLabel = t('questUi.worldQuest.forge.strike');
      strike.ariaDescription = t('questUi.worldQuest.forge.strikeTip');
      strike.keybindLabel = keyLabel(0);
      strike.cooldownRemaining = working ? Math.max(0, session.lockUntil - now) : 0;
      strike.cooldownTotal = Math.max(1, strike.cooldownRemaining);
      strike.cooldownPercent = strike.cooldownRemaining > 0 ? 100 : 0;
      strike.cdText = '';
      strike.usable = working && strike.cooldownRemaining <= 0;
      const stoke = state.slots[1];
      stoke.kind = 'ability';
      stoke.abilityId = 'forge_stoke';
      stoke.iconKey = 'flamestrike';
      stoke.ariaLabel = t('questUi.worldQuest.forge.stoke');
      stoke.ariaDescription = t('questUi.worldQuest.forge.stokeTip', {
        floor: formatNumber(FORGE_HEAT_FLOOR / 100, { style: 'percent' }),
      });
      stoke.keybindLabel = keyLabel(1);
      stoke.cooldownRemaining = working ? Math.max(0, session.stokeReadyAt - now) : 0;
      stoke.cooldownTotal = Math.max(1, stoke.cooldownRemaining);
      stoke.cooldownPercent = stoke.cooldownRemaining > 0 ? 100 : 0;
      stoke.cdText =
        stoke.cooldownRemaining > 0 ? formatNumber(Math.ceil(stoke.cooldownRemaining)) : '';
      stoke.usable = working && stoke.cooldownRemaining <= 0;
      return state;
    },
  };
}
