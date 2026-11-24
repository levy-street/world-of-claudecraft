import {
  MOONRISE_ID,
  SUNRISE_ID,
  SUNTIDE_STAGES,
  TIDEWHEEL_WINDOW_SECONDS,
} from '../../../sim/combat/druid_tidewheel';
import type { Entity } from '../../../sim/types';

/** Both Tidewheel banks hold three stages (Suntide and Moontide). */
export const TIDE_BANK_MAX = SUNTIDE_STAGES;

export type TideOrbsPlayer = Pick<Entity, 'id' | 'templateId' | 'auras'>;
export type TideWindow = 'none' | 'sun' | 'moon';

export interface TideOrbsState {
  visible: boolean;
  suntide: number;
  moontide: number;
  window: TideWindow;
  /** Share of the open window left, 0..1 (0 with no window). */
  windowLeft: number;
  sunStatus: string;
  moonStatus: string;
  windowStatus: string;
}

export interface TideOrbsFormatters {
  sunStatus(value: number, max: number): string;
  moonStatus(value: number, max: number): string;
  windowStatus(window: TideWindow): string;
}

function boundedCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.min(TIDE_BANK_MAX, Math.trunc(value)))
    : 0;
}

/** The Moonwing Tidewheel banks: shown for a Moongrove druid in Moonwing Form,
 *  the only state in which the sim runs the two banks. */
export function createTideOrbsView(formatters: TideOrbsFormatters): {
  tick(player: TideOrbsPlayer, spec: string | null): TideOrbsState;
  invalidateLabels(): void;
} {
  const state: TideOrbsState = {
    visible: false,
    suntide: 0,
    moontide: 0,
    window: 'none',
    windowLeft: 0,
    sunStatus: '',
    moonStatus: '',
    windowStatus: '',
  };
  let lastSun = -1;
  let lastMoon = -1;
  let lastWindow: TideWindow | null = null;
  return {
    tick(player, spec) {
      let form = false;
      let suntide = 0;
      let moontide = 0;
      let window: TideWindow = 'none';
      let windowLeft = 0;
      if (player.templateId === 'druid' && spec === 'balance') {
        for (const aura of player.auras) {
          if (aura.kind === 'form_moonkin') form = true;
          if (aura.sourceId !== player.id) continue;
          if (aura.kind === 'suntide') suntide = boundedCount(aura.stacks);
          else if (aura.kind === 'moontide') moontide = boundedCount(aura.stacks);
          else if (aura.id === SUNRISE_ID || aura.id === MOONRISE_ID) {
            window = aura.id === SUNRISE_ID ? 'sun' : 'moon';
            const duration = aura.duration || TIDEWHEEL_WINDOW_SECONDS;
            windowLeft = duration > 0 ? Math.max(0, Math.min(1, aura.remaining / duration)) : 0;
          }
        }
      }
      state.visible = form;
      state.suntide = form ? suntide : 0;
      state.moontide = form ? moontide : 0;
      state.window = form ? window : 'none';
      state.windowLeft = form ? windowLeft : 0;
      if (state.suntide !== lastSun) {
        state.sunStatus = formatters.sunStatus(state.suntide, TIDE_BANK_MAX);
        lastSun = state.suntide;
      }
      if (state.moontide !== lastMoon) {
        state.moonStatus = formatters.moonStatus(state.moontide, TIDE_BANK_MAX);
        lastMoon = state.moontide;
      }
      if (state.window !== lastWindow) {
        state.windowStatus = formatters.windowStatus(state.window);
        lastWindow = state.window;
      }
      return state;
    },
    invalidateLabels() {
      lastSun = -1;
      lastMoon = -1;
      lastWindow = null;
    },
  };
}
