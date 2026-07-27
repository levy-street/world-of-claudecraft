import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed. Only the command-dispatch hop is
// under test here (the #2511 wire pin at the bottom of this file); everything
// else drives a bare Sim.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { GameServer } from '../server/game';
import { MOBS, ZONES } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { FOCUS_POINT_BUDGET, POINTS_PER_TIER_BONUS } from '../src/sim/professions/focus';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { stepTownFocus } from '../src/ui/town_focus_view';

// #1143: persistent, town-set focus allocation, applied on top of the #1142
// per-corpse harvest roll. Two properties matter end-to-end:
//   1. setTownFocus is gated on the player standing in their zone's town hub.
//   2. A focused component's harvest yield is measurably higher than the same
//      component unfocused, while an unfocused component is entirely
//      unaffected by however much focus is spent elsewhere.

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
};

const ZONE1 = ZONES[0];

function setup() {
  const sim = new Sim({ seed: 21, playerClass: 'warrior', noPlayer: true });
  const internals = sim as unknown as SimInternals;
  const a = sim.addPlayer('warrior', 'Alpha');
  sim.tick();
  const e = internals.entities.get(a)!;
  // The zone1 town hub (Eastbrook), per ZONE1.hub.
  e.pos = { x: ZONE1.hub.x, y: 0, z: ZONE1.hub.z };
  e.prevPos = { ...e.pos };
  return { sim, internals, a };
}

function spawnHideWolf(internals: SimInternals, id: number, pos: { x: number; z: number }) {
  const template = MOBS.forest_wolf;
  const mob = createMob(id, template, template.maxLevel, { x: pos.x, y: 0, z: pos.z });
  mob.dead = true;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.respawnTimer = 9999;
  internals.entities.set(mob.id, mob);
  return mob;
}

describe('setTownFocus: gated on standing in the town hub', () => {
  it('is accepted while in town', () => {
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({ hide: POINTS_PER_TIER_BONUS });
  });

  it('is rejected far outside the town hub, leaving the prior allocation unchanged', () => {
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, a);
    const e = internals.entities.get(a)!;
    e.pos = { x: ZONE1.hub.x + ZONE1.hub.radius * 20, y: 0, z: ZONE1.hub.z };
    sim.setTownFocus({ fang: POINTS_PER_TIER_BONUS }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({ hide: POINTS_PER_TIER_BONUS });
  });

  it('rejects an over-budget allocation', () => {
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: 999 }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({});
  });
});

// #2511, the persistence half: the pure validator now refuses an unknown key
// (tests/focus.test.ts owns that rule), and the load arm drops one an older
// save already carries. These drive the real Sim end to end, because the whole
// harm of the issue was in what reached PlayerMeta.townFocus and survived a
// save/load round trip.
describe('an unknown allocation key never reaches the character save (#2511)', () => {
  function errorsOf(sim: Sim): string[] {
    return sim
      .drainEvents()
      .filter((e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error')
      .map((e) => e.text);
  }

  it('refuses the issue frame in town, leaving the stored allocation untouched', () => {
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: 4 }, a);
    sim.drainEvents();
    sim.setTownFocus({ not_a_real_tag: 5 }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({ hide: 4 });
    expect(errorsOf(sim)).toEqual(['Invalid focus allocation.']);
  });

  it('survives the save/load round trip as the rejection, not as stored junk', () => {
    // Seeded with a real allocation FIRST so the round trip carries a value:
    // an all-empty version of this would be {} equalling {} at all three
    // checkpoints, which the unfixed load arm satisfies just as well.
    const { sim, internals, a } = setup();
    sim.setTownFocus({ hide: 4 }, a);
    sim.setTownFocus({ hide: 4, not_a_real_tag: 5 }, a);
    expect(internals.players.get(a)?.townFocus).toEqual({ hide: 4 });
    const state = sim.serializeCharacter(a);
    expect(state?.townFocus).toEqual({ hide: 4 });

    const reloaded = new Sim({ seed: 21, playerClass: 'warrior', noPlayer: true });
    const b = reloaded.addPlayer('warrior', 'Alpha', { state: state ?? undefined });
    expect((reloaded as unknown as SimInternals).players.get(b)?.townFocus).toEqual({ hide: 4 });
  });

  it('drops an unknown key an OLDER save already carries, and re-saves without it', () => {
    // Back-compat, the leg the command boundary cannot reach. The junk here is
    // the exact shape shipped in tests/fixtures/v025_warrior_character.json.
    const { sim, a } = setup();
    const state = sim.serializeCharacter(a);
    expect(state).not.toBeNull();
    const junked = { ...state!, townFocus: { hide: 3, eastbrook: 4, gills: 1 } };

    const reloaded = new Sim({ seed: 21, playerClass: 'warrior', noPlayer: true });
    const b = reloaded.addPlayer('warrior', 'Alpha', { state: junked });
    const meta = (reloaded as unknown as SimInternals).players.get(b);
    expect(meta?.townFocus).toEqual({ hide: 3 });
    // The legitimate points are kept, and the junk does not come back out of
    // the next serialize either.
    expect(reloaded.serializeCharacter(b)?.townFocus).toEqual({ hide: 3 });
  });

  it('unlocks the panel a junked save would otherwise have jammed shut', () => {
    // Why the load arm is load-bearing rather than tidy-up. A client seeds its
    // draft from the stored allocation and carries that whole draft forward on
    // every +/-, so without the drop the unknown key rides back into the next
    // Save and is refused, with no control anywhere that could delete it: the
    // character could never change focus again.
    //
    // Posts a RAW spread of the stored allocation on purpose, NOT stepTownFocus.
    // The shipped view core now projects its output onto TOWN_FOCUS_COMPONENTS,
    // which would strip the junk client-side and make this test pass with the
    // load arm deleted. This drives the sim's own guarantee instead, which is
    // the one that has to hold for any client, including a cached older bundle
    // that still spreads.
    const { sim, a } = setup();
    const junked = { ...sim.serializeCharacter(a)!, townFocus: { hide: 3, eastbrook: 4 } };
    const reloaded = new Sim({ seed: 21, playerClass: 'warrior', noPlayer: true });
    const b = reloaded.addPlayer('warrior', 'Alpha', { state: junked });
    const internals = reloaded as unknown as SimInternals;
    const e = internals.entities.get(b)!;
    e.pos = { x: ZONE1.hub.x, y: 0, z: ZONE1.hub.z };
    e.prevPos = { ...e.pos };
    reloaded.tick();
    reloaded.drainEvents();

    reloaded.setTownFocus({ ...reloaded.townFocusFor(b), hide: 4 }, b);
    expect(internals.players.get(b)?.townFocus).toEqual({ hide: 4 });
    expect(errorsOf(reloaded)).toEqual([]);
  });

  it('has the panel post only rows it renders, so a stale draft cannot jam it either', () => {
    // The client half of the same guarantee (stepTownFocus projects onto
    // TOWN_FOCUS_COMPONENTS instead of spreading its input), driven against the
    // real Sim rather than as a view-core unit: a draft carrying a key the
    // panel never drew still commits.
    const { sim, internals, a } = setup();
    const stale = { hide: 2, eastbrook: 4, constructor: 1 };
    const draft = stepTownFocus(stale, 'hide', 1, FOCUS_POINT_BUDGET);
    expect(draft).toEqual({ hide: 3 });
    sim.setTownFocus(draft, a);
    expect(internals.players.get(a)?.townFocus).toEqual({ hide: 3 });
    expect(errorsOf(sim)).toEqual([]);
    // A decrement to zero still removes the row, and still emits nothing junk.
    expect(stepTownFocus(stale, 'hide', -1, FOCUS_POINT_BUDGET)).toEqual({ hide: 1 });
    expect(stepTownFocus({ hide: 1, eastbrook: 4 }, 'hide', -1, FOCUS_POINT_BUDGET)).toEqual({});
    // Stepping a component that is not a real family is a no-op, in both
    // directions. Without this the named key would be the one way back around
    // the projection, since it is written after the carried-forward rows.
    expect(stepTownFocus({ hide: 2 }, 'eastbrook', 1, FOCUS_POINT_BUDGET)).toEqual({ hide: 2 });
    expect(stepTownFocus({ hide: 2 }, 'constructor', 1, FOCUS_POINT_BUDGET)).toEqual({ hide: 2 });
    expect(stepTownFocus({}, 'not_a_real_tag', 1, FOCUS_POINT_BUDGET)).toEqual({});
    expect(stepTownFocus({ hide: 2, gills: 3 }, 'gills', -1, FOCUS_POINT_BUDGET)).toEqual({
      hide: 2,
    });
  });

  it('stops a junk-only save from paying out the first-focus-point deed', () => {
    // townFocusPoints sums the allocation blind, so before the drop a single
    // fabricated key earned soc_civic_duty with no real focus allocated.
    const { sim, a } = setup();
    const junked = { ...sim.serializeCharacter(a)!, townFocus: { eastbrook: 4 } };
    const reloaded = new Sim({ seed: 21, playerClass: 'warrior', noPlayer: true });
    const b = reloaded.addPlayer('warrior', 'Alpha', { state: junked });
    for (let i = 0; i < 5; i++) reloaded.tick();
    const earned = () =>
      (reloaded as unknown as SimInternals).players.get(b)!.deedsEarned.has('soc_civic_duty');
    expect(earned()).toBe(false);

    // Not vacuous: one real point in town earns it on the same rig.
    const e = (reloaded as unknown as SimInternals).entities.get(b)!;
    e.pos = { x: ZONE1.hub.x, y: 0, z: ZONE1.hub.z };
    e.prevPos = { ...e.pos };
    reloaded.setTownFocus({ hide: 1 }, b);
    for (let i = 0; i < 5; i++) reloaded.tick();
    expect(earned()).toBe(true);
  });
});

describe('harvestCorpse + town focus: additive bonus, baseline never lowered', () => {
  it('a focused component yields at-least-as-much as unfocused across many corpses, with a measurable edge', () => {
    const trials = 300;

    function harvestTotal(focused: boolean) {
      const { sim, internals, a } = setup();
      if (focused) sim.setTownFocus({ hide: POINTS_PER_TIER_BONUS }, a);
      let total = 0;
      for (let i = 0; i < trials; i++) {
        const mob = spawnHideWolf(internals, 10000 + i, ZONE1.hub);
        // Explicit [] = spread on both arms: this test isolates the focus
        // yield bonus (an omitted pick would ALSO narrow the selection to
        // the focused tags via the town-focus default).
        sim.harvestCorpse(mob.id, [], a);
        total = sim.countItem('rough_hide', a);
      }
      return total;
    }

    const unfocusedTotal = harvestTotal(false);
    const focusedTotal = harvestTotal(true);
    expect(focusedTotal).toBeGreaterThan(unfocusedTotal);
  });

  it('below the 5-point tier-shift threshold, the per-point yield bonus still raises the total', () => {
    // Below POINTS_PER_TIER_BONUS (5) applyFocusTierBonus is a no-op, so this
    // is decisive for applyFocusBonus actually being wired into the granted
    // quantity (regression for it being computed but never applied to the
    // harvest path).
    const trials = 300;
    const belowTierThreshold = POINTS_PER_TIER_BONUS - 1;

    function harvestTotal(points: number) {
      const { sim, internals, a } = setup();
      if (points > 0) sim.setTownFocus({ hide: points }, a);
      let total = 0;
      for (let i = 0; i < trials; i++) {
        const mob = spawnHideWolf(internals, 30000 + i, ZONE1.hub);
        // Explicit [] = spread, keeping the pick identical on both arms so
        // only applyFocusBonus can produce the edge (see the test above).
        sim.harvestCorpse(mob.id, [], a);
        total = sim.countItem('rough_hide', a);
      }
      return total;
    }

    const unfocusedTotal = harvestTotal(0);
    const focusedTotal = harvestTotal(belowTierThreshold);
    expect(focusedTotal).toBeGreaterThan(unfocusedTotal);
  });

  it("an unfocused component's yield is unaffected by heavy focus spent on another component", () => {
    const { sim, internals, a } = setup();
    // spend the whole budget on 'fang'; 'hide' stays unfocused throughout.
    // Explicit [] = spread on both arms: an omitted pick would narrow the
    // focused run to fang alone (the town-focus default) and
    // never harvest hide at all.
    sim.setTownFocus({ fang: 10 }, a);
    const mob = spawnHideWolf(internals, 20000, ZONE1.hub);
    sim.harvestCorpse(mob.id, [], a);
    const withOtherFocused = sim.countItem('rough_hide', a);

    const { sim: sim2, internals: internals2, a: a2 } = setup();
    const mob2 = spawnHideWolf(internals2, 20001, ZONE1.hub);
    sim2.harvestCorpse(mob2.id, [], a2);
    const baseline = sim2.countItem('rough_hide', a2);

    // Both draw the same rng stream from a freshly-seeded Sim (seed 21), so the
    // unfocused 'hide' component's tier roll is identical either way.
    expect(withOtherFocused).toBe(baseline);
  });
});

// An OMITTED components argument derives the pick from the caller's
// persistent town focus (the corpse tags holding points); an EXPLICIT array,
// empty or not, keeps its #1142 meaning untouched. Each equivalence below runs
// the counterpart pick on a fresh same-seed world so the rng stream and the
// focus bonuses are identical; only the selection semantics differ.
describe('harvestCorpse omitted-components town-focus default', () => {
  function harvestWith(
    focus: Record<string, number> | null,
    components: string[] | undefined,
  ): { hide: number; fang: number } {
    const { sim, internals, a } = setup();
    if (focus) sim.setTownFocus(focus, a);
    const mob = spawnHideWolf(internals, 40000, ZONE1.hub);
    sim.harvestCorpse(mob.id, components, a);
    return { hide: sim.countItem('rough_hide', a), fang: sim.countItem('wolf_fang', a) };
  }

  it('omitted with hide focused narrows to hide, exactly like an explicit [hide] pick', () => {
    const omitted = harvestWith({ hide: POINTS_PER_TIER_BONUS }, undefined);
    const explicit = harvestWith({ hide: POINTS_PER_TIER_BONUS }, ['hide']);
    expect(omitted).toEqual(explicit);
    expect(omitted.hide).toBeGreaterThanOrEqual(1);
    expect(omitted.fang).toBe(0); // the unfocused tag was not harvested
  });

  it('omitted with zero focus spreads, exactly like an explicit empty pick', () => {
    const omitted = harvestWith(null, undefined);
    const explicit = harvestWith(null, []);
    expect(omitted).toEqual(explicit);
    // Spread proof: both of the wolf's tags yielded.
    expect(omitted.hide).toBeGreaterThanOrEqual(1);
    expect(omitted.fang).toBeGreaterThanOrEqual(1);
  });

  it('an explicit empty pick still spreads even with focus set (explicit beats derived)', () => {
    const explicitEmpty = harvestWith({ hide: POINTS_PER_TIER_BONUS }, []);
    expect(explicitEmpty.hide).toBeGreaterThanOrEqual(1);
    expect(explicitEmpty.fang).toBeGreaterThanOrEqual(1);
  });

  it('an explicit pick is respected over the focused allocation', () => {
    const explicitFang = harvestWith({ hide: POINTS_PER_TIER_BONUS }, ['fang']);
    expect(explicitFang.fang).toBeGreaterThanOrEqual(1);
    expect(explicitFang.hide).toBe(0);
  });
});

// The #2511 fix sits at the SIM boundary, not in server/game.ts, and this is
// the pin that says so on purpose: the offline browser Sim reaches
// setTownFocus through IWorld without ever passing the server's dispatch
// switch, so validating keys there would have left that host open. (The
// headless RL env is NOT a second reason: it exposes no town-focus action at
// all, and never loads a CharacterState.) If a future change starts filtering
// on the server too, this test is the one to re-argue rather than delete.
describe('the server forwards a set_town_focus allocation key verbatim (#2511)', () => {
  it('passes the unknown key straight through, unfiltered', () => {
    const server = new GameServer();
    const session = server.join(
      { readyState: 1, send: () => {} } as never,
      97,
      97,
      'Alpha',
      'warrior',
      null,
    );
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const raw = JSON.stringify({
      t: 'cmd',
      cmd: 'set_town_focus',
      allocation: { hide: 4, not_a_real_tag: 5 },
    });
    const spy = vi.spyOn(server.sim, 'setTownFocus').mockImplementation(() => {});
    (server as unknown as { dispatchMessage: (...a: unknown[]) => void }).dispatchMessage(
      session,
      JSON.parse(raw),
      raw,
      0,
    );
    expect(spy).toHaveBeenCalledWith({ hide: 4, not_a_real_tag: 5 }, session.pid);

    // "Verbatim" is true of the KEY channel only, which is the channel #2511 is
    // about. The dispatch does pre-filter VALUES on `typeof v === 'number'`, so
    // a non-numeric value arrives at the sim as an absent entry rather than as
    // a rejection: a silent partial accept the key rule deliberately does not
    // have. Pinned rather than left implicit, because the source comment in
    // professions/focus.ts scopes its whole-request rule against exactly this,
    // and closing it means moving a decision into the dispatch, which is the
    // opposite of what this describe argues.
    spy.mockClear();
    const stringValued = JSON.stringify({
      t: 'cmd',
      cmd: 'set_town_focus',
      allocation: { hide: 4, fang: 'x' },
    });
    (server as unknown as { dispatchMessage: (...a: unknown[]) => void }).dispatchMessage(
      session,
      JSON.parse(stringValued),
      stringValued,
      0,
    );
    expect(spy).toHaveBeenCalledWith({ hide: 4 }, session.pid);
  });
});
