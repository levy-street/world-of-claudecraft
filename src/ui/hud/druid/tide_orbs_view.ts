import {
  MOONRISE_ID,
  SUNRISE_ID,
  SUNTIDE_STAGES,
  TIDE_PAYOFF_MIN_STACKS,
  TIDEWHEEL_WINDOW_SECONDS,
} from '../../../sim/combat/druid_tidewheel';
import type { Entity } from '../../../sim/types';

/** Both Tidewheel banks hold five points (Suntide and Moontide); the payoffs
 *  are usable from TIDE_PAYOFF_MIN_STACKS. */
export const TIDE_BANK_MAX = SUNTIDE_STAGES;

export type TideOrbsPlayer = Pick<Entity, 'id' | 'templateId' | 'auras'>;
export type TideWindow = 'none' | 'sun' | 'moon';
/** Where a bank's orbs sit in the Eclipse layout around the gem, always
 *  horizontal:
 *  - top: the bank being charged, five full-size orbs in an arc above the gem;
 *  - below: the other bank, five small orbs in an arc below the gem. */
export type TidePlace = 'top' | 'below';
export type TideBank = 'sun' | 'moon';

/** The window's last seconds, over which the screen-edge glow fades out. */
export const TIDE_EDGE_FADE_SECONDS = 2;

export interface TideOrbsState {
  visible: boolean;
  suntide: number;
  moontide: number;
  window: TideWindow;
  /** Share of the open window left, 0..1 (0 with no window). */
  windowLeft: number;
  /** The school of the spell the open window favors, which is the OTHER
   *  school's color: Sunrise favors Skyfall (moon), Moonrise favors Wildbolt
   *  (sun). The gem and the screen-edge glow paint in this color. */
  next: TideWindow;
  /** Screen-edge glow strength, 0..1: full while the window runs, fading
   *  over its last TIDE_EDGE_FADE_SECONDS. */
  edgeStrength: number;
  sunPlace: TidePlace;
  moonPlace: TidePlace;
  /** The bank on top: the one being charged (`next`), or with no window
   *  open the one charged last (before any window, the fuller one, Sun on a
   *  tie). */
  top: TideBank;
  /** The bank holds enough for its payoff (TIDE_PAYOFF_MIN_STACKS). */
  sunReady: boolean;
  moonReady: boolean;
  /** The bank is at its cap (TIDE_BANK_MAX): the screen edge's strong flash. */
  sunMax: boolean;
  moonMax: boolean;
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

/** The bank on top is shown full size above the gem; the other sits small
 *  below it. */
export function tidePlace(bank: TideBank, top: TideBank): TidePlace {
  return bank === top ? 'top' : 'below';
}

/** Which bank goes on top: the one being charged while a window is open;
 *  with none open, the one charged last, or before any window the fuller
 *  one (Sun on a tie). */
export function tideTopBank(
  next: TideWindow,
  lastCharged: TideBank | null,
  suntide: number,
  moontide: number,
): TideBank {
  if (next !== 'none') return next;
  if (lastCharged) return lastCharged;
  return moontide > suntide ? 'moon' : 'sun';
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
    next: 'none',
    edgeStrength: 0,
    sunPlace: 'top',
    moonPlace: 'below',
    top: 'sun',
    sunReady: false,
    moonReady: false,
    sunMax: false,
    moonMax: false,
    sunStatus: '',
    moonStatus: '',
    windowStatus: '',
  };
  let lastSun = -1;
  let lastMoon = -1;
  let lastWindow: TideWindow | null = null;
  // The bank charged in the last open window; it stays on top after the
  // window ends. Forgotten when the strip hides (form or spec left).
  let lastCharged: TideBank | null = null;
  return {
    tick(player, spec) {
      let form = false;
      let suntide = 0;
      let moontide = 0;
      let window: TideWindow = 'none';
      let windowLeft = 0;
      let windowRemaining = 0;
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
            windowRemaining = Math.max(0, aura.remaining);
          }
        }
      }
      state.visible = form;
      state.suntide = form ? suntide : 0;
      state.moontide = form ? moontide : 0;
      state.window = form ? window : 'none';
      state.windowLeft = form ? windowLeft : 0;
      state.next = state.window === 'sun' ? 'moon' : state.window === 'moon' ? 'sun' : 'none';
      state.edgeStrength =
        state.window === 'none' ? 0 : Math.min(1, windowRemaining / TIDE_EDGE_FADE_SECONDS);
      if (!form) lastCharged = null;
      else if (state.next !== 'none') lastCharged = state.next;
      state.top = tideTopBank(state.next, lastCharged, state.suntide, state.moontide);
      state.sunReady = state.suntide >= TIDE_PAYOFF_MIN_STACKS;
      state.moonReady = state.moontide >= TIDE_PAYOFF_MIN_STACKS;
      state.sunMax = state.suntide >= TIDE_BANK_MAX;
      state.moonMax = state.moontide >= TIDE_BANK_MAX;
      state.sunPlace = tidePlace('sun', state.top);
      state.moonPlace = tidePlace('moon', state.top);
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
