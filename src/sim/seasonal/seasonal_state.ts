// The seasonal-event core's state: which event the world is running and each
// character's per-day event ledger. Pure leaf (no SimContext, no clock, no rng).
//
// WHICH event runs is never decided here from a date. The authoritative server
// owns the calendar (server/seasonal_calendar.ts) and writes `hostEventId` every
// tick through the realm-calendar feed; a world with no host calendar (the
// offline browser, the headless RL env, tests) leaves it null, so the event is
// off there unless `/dev season` sets the dev override. That keeps all three
// hosts on one rule: the sim reads one field, it never reads the wall clock.
//
// Reused for every seasonal event (the autumn Gourdlight Eve first, winter next):
// nothing in this file names a particular event.
import { freshScarecrowState, type ScarecrowState } from './scarecrow_state';

/** The world-wide seasonal state. Lives on Sim, reached by modules through the
 *  `ctx.seasonal` live view. */
export interface SeasonalWorldState {
  /** The event the host calendar says is running (null = none, or no calendar). */
  hostEventId: string | null;
  /** The /dev override: undefined follows the host, null forces off, an id forces on. */
  devOverride: string | null | undefined;
  /** The event the last seasonal tick saw active: the edge detector for open/close. */
  lastActive: string | null;
  /** Gourdlight Eve's field boss (scarecrow.ts): who stands in the field, and when next. */
  scarecrow: ScarecrowState;
  /** Characters whose event-bound items were checked since the running event last
   *  changed, each with the sweep tick it was checked at (seasonal_bound_items.ts).
   *  Identity-keyed, never iterated, never persisted. */
  boundSwept: WeakMap<object, number>;
  /** The bound-item sweep's own tick counter (re-checks are counted in it). */
  boundTick: number;
}

export function freshSeasonalWorldState(): SeasonalWorldState {
  return {
    hostEventId: null,
    devOverride: undefined,
    lastActive: null,
    scarecrow: freshScarecrowState(),
    boundSwept: new WeakMap(),
    boundTick: 0,
  };
}

/** The event running right now: the dev override when one is set, else the host's. */
export function activeSeasonalEventOf(
  state: Pick<SeasonalWorldState, 'hostEventId' | 'devOverride'>,
): string | null {
  return state.devOverride !== undefined ? state.devOverride : state.hostEventId;
}

/** Each character's seasonal ledger (folded into PlayerMeta). */
export interface SeasonalPlayerState {
  /** The reset-day key the knock ledger belongs to ('' = no calendar known). */
  seasonalDay: string;
  /** NPC template ids this character already trick-or-treated in `seasonalDay`. */
  seasonalKnocked: Set<string>;
  /** The worn pumpkin head: the character's choice, re-applied as an aura while
   *  its event runs (and after a death), dropped from the body when it closes. */
  pumpkinHeadWorn: boolean;
}

export function freshSeasonalPlayerState(): SeasonalPlayerState {
  return { seasonalDay: '', seasonalKnocked: new Set(), pumpkinHeadWorn: false };
}

/** The persisted shape (CharacterState.seasonal). Written only when non-empty, so
 *  a character the feature never touched saves byte-identically. */
export interface SavedSeasonalState {
  day?: string;
  knocked?: string[];
  head?: true;
}

/** Bounded so a hostile or corrupt save can never balloon the ledger. */
const MAX_KNOCKED = 64;

export function restoreSeasonalState(
  meta: SeasonalPlayerState,
  saved: SavedSeasonalState | undefined,
): void {
  const fresh = freshSeasonalPlayerState();
  meta.seasonalDay = fresh.seasonalDay;
  meta.seasonalKnocked = fresh.seasonalKnocked;
  meta.pumpkinHeadWorn = fresh.pumpkinHeadWorn;
  if (!saved || typeof saved !== 'object') return;
  if (typeof saved.day === 'string' && saved.day.length <= 32) meta.seasonalDay = saved.day;
  if (Array.isArray(saved.knocked)) {
    for (const id of saved.knocked.slice(0, MAX_KNOCKED)) {
      if (typeof id === 'string' && id.length > 0 && id.length <= 64) meta.seasonalKnocked.add(id);
    }
  }
  if (saved.head === true) meta.pumpkinHeadWorn = true;
}

export function seasonalSaveFragment(meta: SeasonalPlayerState): {
  seasonal?: SavedSeasonalState;
} {
  const out: SavedSeasonalState = {};
  if (meta.seasonalDay !== '') out.day = meta.seasonalDay;
  if (meta.seasonalKnocked.size > 0) out.knocked = [...meta.seasonalKnocked].sort();
  if (meta.pumpkinHeadWorn) out.head = true;
  return Object.keys(out).length > 0 ? { seasonal: out } : {};
}

/** Roll the knock ledger onto `resetDay`. An empty key (no calendar) never rolls,
 *  so a headless run's ledger is one-shot per save, the same contract every other
 *  daily gate keeps. Returns the live set for the current day. */
export function knockedToday(meta: SeasonalPlayerState, resetDay: string): Set<string> {
  if (resetDay !== '' && meta.seasonalDay !== resetDay) {
    meta.seasonalDay = resetDay;
    meta.seasonalKnocked.clear();
  }
  return meta.seasonalKnocked;
}

/** The read-only, sorted view of today's knocks (the IWorld readout and the wire). */
const NO_KNOCKS: readonly string[] = Object.freeze([]);

export function knockedTodayView(meta: SeasonalPlayerState, resetDay: string): readonly string[] {
  if (meta.seasonalKnocked.size === 0) return NO_KNOCKS;
  if (resetDay !== '' && meta.seasonalDay !== resetDay) return NO_KNOCKS;
  return [...meta.seasonalKnocked].sort();
}
