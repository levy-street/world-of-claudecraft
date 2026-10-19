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
import { GOURDLIGHT_PUMPKINS, HAUNTED_PUMPKIN_EDITION } from '../content/gourdlight_pumpkins';
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
  /** The /dev pick of the day's rotating daily (gourdlight_dailies.ts): null follows
   *  the reset day. Never persisted. */
  devDaily: string | null;
  /** Each standing Gurglegreen Cauldron by its maker's entity id (toy_cauldron.ts): one
   *  per maker. Process-local and never persisted, like the cauldrons themselves. */
  toyCauldrons: Map<number, number>;
}

export function freshSeasonalWorldState(): SeasonalWorldState {
  return {
    hostEventId: null,
    devOverride: undefined,
    lastActive: null,
    scarecrow: freshScarecrowState(),
    boundSwept: new WeakMap(),
    boundTick: 0,
    devDaily: null,
    toyCauldrons: new Map(),
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
  hauntedPumpkins: Set<string>;
}

export function freshSeasonalPlayerState(): SeasonalPlayerState {
  return {
    seasonalDay: '',
    seasonalKnocked: new Set(),
    pumpkinHeadWorn: false,
    hauntedPumpkins: new Set(),
  };
}

/** The persisted shape (CharacterState.seasonal). Written only when non-empty, so
 *  a character the feature never touched saves byte-identically. */
export interface SavedSeasonalState {
  day?: string;
  knocked?: string[];
  head?: true;
  pumpkins?: { edition: string; found: string[] };
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
  meta.hauntedPumpkins = fresh.hauntedPumpkins;
  if (!saved || typeof saved !== 'object') return;
  if (typeof saved.day === 'string' && saved.day.length <= 32) meta.seasonalDay = saved.day;
  if (Array.isArray(saved.knocked)) {
    for (const id of saved.knocked.slice(0, MAX_KNOCKED)) {
      if (typeof id === 'string' && id.length > 0 && id.length <= 64) meta.seasonalKnocked.add(id);
    }
  }
  if (saved.pumpkins?.edition === HAUNTED_PUMPKIN_EDITION && Array.isArray(saved.pumpkins.found)) {
    const allowed = new Set(GOURDLIGHT_PUMPKINS.map((p) => p.id));
    for (const id of saved.pumpkins.found.slice(0, GOURDLIGHT_PUMPKINS.length)) {
      if (allowed.has(id)) meta.hauntedPumpkins.add(id);
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
  const found = hauntedPumpkinsFoundView(meta);
  if (found.length) out.pumpkins = { edition: HAUNTED_PUMPKIN_EDITION, found: [...found] };
  return Object.keys(out).length > 0 ? { seasonal: out } : {};
}

// Derived read-only projection only. Writers add discoveries, clear the ledger,
// or replace its Set on restore; never replace members at the same cardinality.
const EMPTY_PUMPKINS: readonly string[] = Object.freeze([]);
const pumpkinViews = new WeakMap<
  SeasonalPlayerState,
  { set: Set<string>; size: number; view: readonly string[] }
>();
export function hauntedPumpkinsFoundView(meta: SeasonalPlayerState): readonly string[] {
  const set = meta.hauntedPumpkins;
  if (set.size === 0) return EMPTY_PUMPKINS;
  const cached = pumpkinViews.get(meta);
  if (cached?.set === set && cached.size === set.size) return cached.view;
  const view = Object.freeze(
    GOURDLIGHT_PUMPKINS.filter((p) => set.has(p.id))
      .map((p) => p.id)
      .sort(),
  );
  pumpkinViews.set(meta, { set, size: set.size, view });
  return view;
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
