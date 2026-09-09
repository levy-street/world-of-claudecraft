// The shared aura-track selection core (src/ui/hud/aura_tracks/aura_track_view.ts).
//
// One core drives all six frames, so a bug here is six bugs. It is DOM-free and
// takes its ownership and toggle predicates as deps, which is what lets this file
// drive the real module over hand-built units instead of standing up a Sim.
//
// The core reuses its state, its row array and every row record across ticks
// (the allocation-light contract), so every assertion here snapshots plain
// numbers and strings out of a row before the next tick. Holding a row record
// across ticks and comparing it to itself is the constant-self-comparison trap
// this repo has been bitten by; a test written that way passes on any code.

import { describe, expect, it } from 'vitest';
import { AURA_TRACKS } from '../src/ui/hud/aura_tracks/aura_track_descriptors';
import {
  AURA_TRACK_DECIMAL_BELOW_SEC,
  AURA_TRACK_ROW_CAP,
  type AuraTrackAuraInput,
  type AuraTrackDeps,
  type AuraTrackEntityInput,
  type AuraTrackInput,
  createAuraTrackView,
} from '../src/ui/hud/aura_tracks/aura_track_view';

const PLAYER_ID = 7;

const deps = (over: Partial<AuraTrackDeps> = {}): AuraTrackDeps => ({
  isOwn: (a) => a.sourceId === PLAYER_ID,
  isMode: () => false,
  auraName: (a) => `name:${a.id}`,
  unitName: (e) => `unit:${e.id}`,
  iconKey: (a) => `icon:${a.id}`,
  ...over,
});

const aura = (id: string, over: Partial<AuraTrackAuraInput> = {}): AuraTrackAuraInput => ({
  id,
  name: id,
  remaining: 12,
  duration: 20,
  sourceId: PLAYER_ID,
  ...over,
});

const unit = (id: number, auras: AuraTrackAuraInput[]): AuraTrackEntityInput => ({
  id,
  name: `u${id}`,
  dead: false,
  auras,
});

const input = (over: Partial<AuraTrackInput> = {}): AuraTrackInput<AuraTrackEntityInput> => ({
  player: null,
  allies: [],
  enabled: true,
  includeModes: true,
  ...over,
});

const track = (id: string) => {
  const found = AURA_TRACKS.find((t) => t.id === id);
  if (!found) throw new Error(`no such track: ${id}`);
  return found;
};

/** Row keys of a tick, snapshotted so the next tick cannot rewrite them. */
function keys(state: { rows: Array<{ key: string }>; count: number }): string[] {
  return state.rows.slice(0, state.count).map((r) => r.key);
}

describe('aura track view: what it selects', () => {
  it('takes only auras the local player cast', () => {
    const view = createAuraTrackView(track('self'), deps());
    const state = view.tick(
      input({
        player: unit(PLAYER_ID, [
          aura('rejuvenation'),
          aura('renew', { sourceId: 99 }),
          aura('regrowth', { sourceId: undefined }),
        ]),
      }),
    );
    expect(keys(state)).toEqual([`${PLAYER_ID}:rejuvenation`]);
  });

  it('takes only auras the catalog knows, and only ones this track accepts', () => {
    // `frostbolt` is a real ability that leaves no helpful aura, so the catalog
    // has no entry for it; `sprint` has one but belongs to the Utility track.
    const view = createAuraTrackView(track('self'), deps());
    const state = view.tick(
      input({ player: unit(PLAYER_ID, [aura('rejuvenation'), aura('frostbolt'), aura('sprint')]) }),
    );
    expect(keys(state)).toEqual([`${PLAYER_ID}:rejuvenation`]);
  });

  it('answers empty while the track is switched off, without scanning', () => {
    // The Hud drives all six unconditionally and lets the core decide, so this
    // is the one place the setting is honoured.
    let scanned = 0;
    const view = createAuraTrackView(
      track('self'),
      deps({
        isOwn: (a) => {
          scanned++;
          return a.sourceId === PLAYER_ID;
        },
      }),
    );
    const state = view.tick(
      input({ enabled: false, player: unit(PLAYER_ID, [aura('rejuvenation')]) }),
    );
    expect(state.count).toBe(0);
    expect(state.overflow).toBe(0);
    expect(scanned).toBe(0);
  });

  it('skips a dead unit and an expired aura, but keeps a permanent one', () => {
    const view = createAuraTrackView(track('friendly'), deps());
    const dead = { ...unit(2, [aura('rejuvenation')]), dead: true };
    const state = view.tick(
      input({
        player: unit(PLAYER_ID, []),
        allies: [
          dead,
          unit(3, [aura('renew', { remaining: 0 })]),
          unit(4, [aura('regrowth', { remaining: 0, permanent: true })]),
        ],
      }),
    );
    expect(keys(state)).toEqual(['4:regrowth']);
  });

  it('puts the player first, then allies, and never re-sorts by remaining time', () => {
    // A tracker that re-sorts as timers tick moves the row you are reaching for.
    // The two ticks below reverse which aura has less time left; the order must
    // not move.
    const view = createAuraTrackView(track('power'), deps());
    const first = keys(
      view.tick(
        input({
          player: unit(PLAYER_ID, [aura('icy_veins', { remaining: 2 })]),
          allies: [unit(3, [aura('power_infusion', { remaining: 18 })])],
        }),
      ),
    );
    const second = keys(
      view.tick(
        input({
          player: unit(PLAYER_ID, [aura('icy_veins', { remaining: 19 })]),
          allies: [unit(3, [aura('power_infusion', { remaining: 1 })])],
        }),
      ),
    );
    expect(first).toEqual([`${PLAYER_ID}:icy_veins`, '3:power_infusion']);
    expect(second).toEqual(first);
  });

  it('orders the rows of one unit by aura id, not by insertion', () => {
    const view = createAuraTrackView(track('power'), deps());
    const state = view.tick(
      input({
        player: unit(PLAYER_ID, [aura('icy_veins'), aura('arcane_power'), aura('berserk')]),
      }),
    );
    expect(keys(state)).toEqual([
      `${PLAYER_ID}:arcane_power`,
      `${PLAYER_ID}:berserk`,
      `${PLAYER_ID}:icy_veins`,
    ]);
  });

  it('does not scan the player twice when they also appear among the allies', () => {
    const view = createAuraTrackView(track('power'), deps());
    const player = unit(PLAYER_ID, [aura('icy_veins')]);
    const state = view.tick(input({ player, allies: [player, unit(3, [aura('berserk')])] }));
    expect(keys(state)).toEqual([`${PLAYER_ID}:icy_veins`, '3:berserk']);
  });

  it('gives a repeated aura id on one unit a distinct key', () => {
    // Two rows sharing a key would make the painter's pool recycle one onto the
    // other every frame, so the icon and label would flicker between them.
    const view = createAuraTrackView(track('power'), deps());
    const state = view.tick(input({ player: unit(PLAYER_ID, [aura('berserk'), aura('berserk')]) }));
    expect(keys(state)).toEqual([`${PLAYER_ID}:berserk`, `${PLAYER_ID}:berserk#1`]);
  });
});

describe('aura track view: what a row carries', () => {
  it('fills a timer row by time left and drops the unit name on a self row', () => {
    const view = createAuraTrackView(track('power'), deps());
    const state = view.tick(
      input({ player: unit(PLAYER_ID, [aura('berserk', { remaining: 5, duration: 20 })]) }),
    );
    const row = state.rows[0];
    expect(row.fraction).toBeCloseTo(0.25);
    expect(row.auraName).toBe('name:berserk');
    expect(row.unitName).toBe('');
    expect(row.iconKey).toBe('icon:berserk');
    expect(row.points).toBe(0);
    expect(row.mode).toBe(false);
  });

  it('names the unit on an ally row', () => {
    const view = createAuraTrackView(track('friendly'), deps());
    const state = view.tick(
      input({ player: unit(PLAYER_ID, []), allies: [unit(3, [aura('renew')])] }),
    );
    expect(state.rows[0].unitName).toBe('unit:3');
  });

  it('reads a permanent or duration-less aura as full rather than empty', () => {
    const view = createAuraTrackView(track('power'), deps());
    const permanent = view.tick(
      input({
        player: unit(PLAYER_ID, [aura('berserk', { remaining: 1, permanent: true })]),
      }),
    ).rows[0].fraction;
    const noDuration = view.tick(
      input({ player: unit(PLAYER_ID, [aura('berserk', { remaining: 4, duration: 0 })]) }),
    ).rows[0].fraction;
    expect(permanent).toBe(1);
    expect(noDuration).toBe(1);
  });

  it('gains a decimal only in the last few seconds', () => {
    const view = createAuraTrackView(track('power'), deps());
    const below = view.tick(
      input({
        player: unit(PLAYER_ID, [
          aura('berserk', { remaining: AURA_TRACK_DECIMAL_BELOW_SEC - 0.1, duration: 30 }),
        ]),
      }),
    ).rows[0].decimals;
    const at = view.tick(
      input({
        player: unit(PLAYER_ID, [
          aura('berserk', { remaining: AURA_TRACK_DECIMAL_BELOW_SEC, duration: 30 }),
        ]),
      }),
    ).rows[0].decimals;
    expect(below).toBe(1);
    expect(at).toBe(0);
  });

  it('marks the final seconds through the classifier the aura strips share', () => {
    const view = createAuraTrackView(track('power'), deps());
    const late = view.tick(
      input({ player: unit(PLAYER_ID, [aura('berserk', { remaining: 1, duration: 30 })]) }),
    ).rows[0].expiring;
    const early = view.tick(
      input({ player: unit(PLAYER_ID, [aura('berserk', { remaining: 25, duration: 30 })]) }),
    ).rows[0].expiring;
    expect(late).toBe(true);
    expect(early).toBe(false);
  });

  it('carries stacks only above one', () => {
    const view = createAuraTrackView(track('power'), deps());
    const one = view.tick(input({ player: unit(PLAYER_ID, [aura('berserk', { stacks: 1 })]) }))
      .rows[0].stacks;
    const three = view.tick(input({ player: unit(PLAYER_ID, [aura('berserk', { stacks: 3 })]) }))
      .rows[0].stacks;
    expect(one).toBe(0);
    expect(three).toBe(3);
  });
});

describe('aura track view: the points (shield) shape', () => {
  it('fills against the highest value seen, because the sim stores only what is left', () => {
    // An absorb's stored `value` IS its remaining shield, so the value alone
    // cannot say how full the shield is. The core remembers the peak per row.
    const view = createAuraTrackView(track('shields'), deps());
    const cast = view.tick(
      input({ player: unit(PLAYER_ID, [aura('power_word_shield', { value: 800 })]) }),
    );
    expect(cast.rows[0].fraction).toBe(1);
    expect(cast.rows[0].points).toBe(800);

    const spent = view.tick(
      input({ player: unit(PLAYER_ID, [aura('power_word_shield', { value: 200 })]) }),
    );
    expect(spent.rows[0].points).toBe(200);
    expect(spent.rows[0].fraction).toBeCloseTo(0.25);
  });

  it('raises the denominator when a bigger shield is recast, never lowering it mid-life', () => {
    const view = createAuraTrackView(track('shields'), deps());
    view.tick(input({ player: unit(PLAYER_ID, [aura('power_word_shield', { value: 400 })]) }));
    view.tick(input({ player: unit(PLAYER_ID, [aura('power_word_shield', { value: 100 })]) }));
    const bigger = view.tick(
      input({ player: unit(PLAYER_ID, [aura('power_word_shield', { value: 1000 })]) }),
    );
    expect(bigger.rows[0].fraction).toBe(1);
    const half = view.tick(
      input({ player: unit(PLAYER_ID, [aura('power_word_shield', { value: 500 })]) }),
    );
    expect(half.rows[0].fraction).toBeCloseTo(0.5);
  });

  it('keeps points at zero on a timer row, so no bar prints a shield number', () => {
    const view = createAuraTrackView(track('power'), deps());
    const state = view.tick(input({ player: unit(PLAYER_ID, [aura('berserk', { value: 999 })]) }));
    expect(state.rows[0].points).toBe(0);
  });

  it('forgets the peak the tick its row disappears, so a smaller recast reads full', () => {
    // The review case: cast 800, let it lapse, recast 600. A prune that waited
    // for the map to outgrow some size never ran for a solo player's own shield,
    // so the fresh shield filled against the dead one's peak and sat at 75%.
    const view = createAuraTrackView(track('shields'), deps());
    const cast = (value: number | null) =>
      view.tick(
        input({
          player: unit(PLAYER_ID, value === null ? [] : [aura('power_word_shield', { value })]),
        }),
      );
    cast(800);
    expect(cast(null).count).toBe(0);
    const fresh = cast(600);
    expect(fresh.rows[0].points).toBe(600);
    expect(fresh.rows[0].fraction).toBe(1);
  });

  it('forgets the peaks of many rows that are gone, so the map cannot grow across a session', () => {
    // Without a prune a session-long fight would keep every shield ever cast on
    // every ally.
    const view = createAuraTrackView(track('shields'), deps());
    for (let i = 0; i < AURA_TRACK_ROW_CAP * 5; i++) {
      view.tick(
        input({
          player: unit(PLAYER_ID, []),
          allies: [unit(100 + i, [aura('power_word_shield', { value: 900 })])],
        }),
      );
    }
    // The very first ally is long gone; a fresh, smaller shield on them must
    // read full rather than against the 900 it once had.
    const back = view.tick(
      input({
        player: unit(PLAYER_ID, []),
        allies: [unit(100, [aura('power_word_shield', { value: 300 })])],
      }),
    );
    expect(back.rows[0].fraction).toBe(1);
  });
});

describe('aura track view: modes, the cap and reuse', () => {
  it('draws a mode without a countdown and full, whatever its remaining time', () => {
    const view = createAuraTrackView(track('utility'), deps({ isMode: (a) => a.id === 'stealth' }));
    const state = view.tick(
      input({
        player: unit(PLAYER_ID, [aura('stealth', { remaining: 1, duration: 3600 })]),
      }),
    );
    expect(state.rows[0].mode).toBe(true);
    expect(state.rows[0].fraction).toBe(1);
    // A mode is never "expiring": the long duration is anti-expiry, not a timer,
    // and a blinking stealth row would read as "this is about to leave me".
    expect(state.rows[0].expiring).toBe(false);
  });

  it('drops mode rows when the sub-option is off, keeping the timed ones', () => {
    const view = createAuraTrackView(track('utility'), deps({ isMode: (a) => a.id === 'stealth' }));
    const on = keys(
      view.tick(input({ player: unit(PLAYER_ID, [aura('sprint'), aura('stealth')]) })),
    );
    const off = keys(
      view.tick(
        input({
          includeModes: false,
          player: unit(PLAYER_ID, [aura('sprint'), aura('stealth')]),
        }),
      ),
    );
    expect(on).toEqual([`${PLAYER_ID}:sprint`, `${PLAYER_ID}:stealth`]);
    expect(off).toEqual([`${PLAYER_ID}:sprint`]);
  });

  it('does not count a dropped mode row as overflow', () => {
    // Overflow means "there was more than would fit"; a row the player asked not
    // to see is not that, and counting it would print a permanent "1 more".
    const view = createAuraTrackView(track('utility'), deps({ isMode: (a) => a.id === 'stealth' }));
    const state = view.tick(
      input({
        includeModes: false,
        player: unit(PLAYER_ID, [aura('sprint'), aura('stealth')]),
      }),
    );
    expect(state.overflow).toBe(0);
  });

  it('caps the rows and counts the rest as overflow', () => {
    const many = ['arcane_power', 'berserk', 'blade_flurry', 'evocation', 'icy_veins'];
    const view = createAuraTrackView(track('power'), deps());
    const state = view.tick(
      input({
        cap: 3,
        player: unit(
          PLAYER_ID,
          many.map((id) => aura(id)),
        ),
      }),
    );
    expect(state.count).toBe(3);
    expect(state.overflow).toBe(2);
    expect(keys(state)).toEqual(
      many
        .slice()
        .sort()
        .slice(0, 3)
        .map((id) => `${PLAYER_ID}:${id}`),
    );
  });

  it('defaults the cap to AURA_TRACK_ROW_CAP', () => {
    const view = createAuraTrackView(track('friendly'), deps());
    const allies = Array.from({ length: AURA_TRACK_ROW_CAP + 4 }, (_, i) =>
      unit(20 + i, [aura('renew')]),
    );
    const state = view.tick(input({ player: unit(PLAYER_ID, []), allies }));
    expect(state.count).toBe(AURA_TRACK_ROW_CAP);
    expect(state.overflow).toBe(4);
  });

  it('rewrites a reused row record rather than leaving the previous aura on it', () => {
    // The rows are pooled and reused across ticks. A field the core forgets to
    // reset is the pooled-node staleness trap, and it shows as one aura wearing
    // another's icon.
    const view = createAuraTrackView(track('power'), deps());
    const before = view.tick(
      input({ player: unit(PLAYER_ID, [aura('icy_veins', { remaining: 3, stacks: 4 })]) }),
    );
    const beforeSnapshot = { ...before.rows[0] };
    const after = view.tick(
      input({ player: unit(PLAYER_ID, [aura('berserk', { remaining: 18, stacks: 1 })]) }),
    );
    expect(beforeSnapshot.key).toBe(`${PLAYER_ID}:icy_veins`);
    expect(after.rows[0].key).toBe(`${PLAYER_ID}:berserk`);
    expect(after.rows[0].iconKey).toBe('icon:berserk');
    expect(after.rows[0].auraName).toBe('name:berserk');
    expect(after.rows[0].stacks).toBe(0);
    expect(after.rows[0].expiring).toBe(false);
    expect(after.rows[0].remaining).toBe(18);
  });

  it('returns the SAME state object each tick, so callers must read before the next', () => {
    // Pinned because the allocation-light contract is what every caller and
    // every test above depends on; if it ever stops holding, the snapshotting
    // discipline in this file stops being necessary and its absence elsewhere
    // stops being a bug.
    const view = createAuraTrackView(track('power'), deps());
    const first = view.tick(input({ player: unit(PLAYER_ID, [aura('berserk')]) }));
    const second = view.tick(input({ player: unit(PLAYER_ID, [aura('berserk')]) }));
    expect(second).toBe(first);
  });
});
