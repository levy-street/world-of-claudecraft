import { GLOOMTITHE_MAX_STACKS } from '../../../sim/combat/priest/presentation';
import {
  SPIRIT_BOMB_PROGRESS_ID,
  SPIRIT_BOMB_REQUIRED_GENERATION,
} from '../../../sim/combat/priest/spirit_bomb';
import { PRIEST_ABILITIES } from '../../../sim/content/priest';
import type { Entity } from '../../../sim/types';

export const GLOOMTITHE_MAX = GLOOMTITHE_MAX_STACKS;
const GLOOMTITHE_LEARN_LEVEL = PRIEST_ABILITIES.summon_tithefiend.learnLevel;
const BOMB_LEARN_LEVEL = PRIEST_ABILITIES.spirit_bomb.learnLevel;

export type ShadowChargePlayer = Pick<Entity, 'id' | 'templateId' | 'level' | 'auras'>;

export interface ShadowChargeState {
  visible: boolean;
  bombVisible: boolean;
  gloomtithe: number;
  bombProgress: number;
  bombFill: number;
  ready: boolean;
  gloomCount: string;
  bombCount: string;
  gloomStatus: string;
  bombStatus: string;
}

export interface ShadowChargeFormatters {
  count(value: number, max: number): string;
  gloomStatus(value: number, max: number): string;
  bombStatus(value: number, max: number): string;
}

function boundedCount(value: number | undefined, max: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.trunc(value)))
    : 0;
}

export function createShadowChargeView(formatters: ShadowChargeFormatters): {
  tick(player: ShadowChargePlayer, spec: string | null): ShadowChargeState;
  invalidateLabels(): void;
} {
  const state: ShadowChargeState = {
    visible: false,
    bombVisible: false,
    gloomtithe: 0,
    bombProgress: 0,
    bombFill: 0,
    ready: false,
    gloomCount: '',
    bombCount: '',
    gloomStatus: '',
    bombStatus: '',
  };
  let lastGloom = -1;
  let lastBomb = -1;
  return {
    tick(player, spec) {
      state.visible =
        player.templateId === 'priest' &&
        spec === 'shadow' &&
        player.level >= GLOOMTITHE_LEARN_LEVEL;
      state.bombVisible = state.visible && player.level >= BOMB_LEARN_LEVEL;
      if (!state.visible) {
        state.gloomtithe = 0;
        state.bombProgress = 0;
        state.bombFill = 0;
        state.ready = false;
        state.gloomCount = '';
        state.bombCount = '';
        state.gloomStatus = '';
        state.bombStatus = '';
        lastGloom = -1;
        lastBomb = -1;
        return state;
      }
      let gloomtithe = 0;
      let bombProgress = 0;
      for (const aura of player.auras) {
        if (aura.sourceId !== player.id) continue;
        if (aura.kind === 'gloomtithe') gloomtithe = boundedCount(aura.stacks, GLOOMTITHE_MAX);
        if (aura.id === SPIRIT_BOMB_PROGRESS_ID) {
          bombProgress = boundedCount(aura.stacks, SPIRIT_BOMB_REQUIRED_GENERATION);
        }
      }
      state.gloomtithe = gloomtithe;
      state.bombProgress = bombProgress;
      state.bombFill = bombProgress / SPIRIT_BOMB_REQUIRED_GENERATION;
      state.ready = state.bombVisible && bombProgress === SPIRIT_BOMB_REQUIRED_GENERATION;
      if (gloomtithe !== lastGloom) {
        state.gloomCount = formatters.count(gloomtithe, GLOOMTITHE_MAX);
        state.gloomStatus = formatters.gloomStatus(gloomtithe, GLOOMTITHE_MAX);
        lastGloom = gloomtithe;
      }
      if (!state.bombVisible) {
        state.bombCount = '';
        state.bombStatus = '';
        lastBomb = -1;
      } else if (bombProgress !== lastBomb) {
        state.bombCount = formatters.count(bombProgress, SPIRIT_BOMB_REQUIRED_GENERATION);
        state.bombStatus = formatters.bombStatus(bombProgress, SPIRIT_BOMB_REQUIRED_GENERATION);
        lastBomb = bombProgress;
      }
      return state;
    },
    invalidateLabels() {
      lastGloom = -1;
      lastBomb = -1;
    },
  };
}
