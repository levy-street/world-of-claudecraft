// The quest-marker classifier (src/sim/quests/quest_marker_kind.ts): the ONE
// rule the four indicator surfaces consume. Pure Node suite, no DOM. The
// per-surface rendering of each kind is pinned in the surface suites
// (nameplate, minimap, map, gossip); THIS file owns the classification rule
// itself, the fold order, and the lifecycle of a real work order driven
// through the real computeQuestState on both cadence-set shapes.

import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { WORK_ORDER_CADENCE_TICKS } from '../src/sim/professions/cadence';
import { computeQuestState } from '../src/sim/quests/quest_commands';
import {
  npcQuestMarkerKind,
  type QuestMarkerKind,
  questMarkerKind,
  questMarkerRank,
  strongerQuestMarker,
} from '../src/sim/quests/quest_marker_kind';
import type { QuestDef, QuestProgress } from '../src/sim/types';

const NONE = new Set<string>();

function quest(overrides: Partial<QuestDef> = {}): QuestDef {
  return {
    id: 'q_marker_fixture',
    name: 'Marker Fixture',
    giverNpcId: 'npc_giver',
    turnInNpcId: 'npc_turnin',
    text: 't',
    completionText: 'c',
    objectives: [],
    xpReward: 0,
    copperReward: 0,
    itemRewards: {},
    ...overrides,
  };
}

describe('questMarkerKind: the giver role', () => {
  it('classifies a plain available quest as available (gold), repeatable or not', () => {
    // The Q30 rule's first half: a repeatable quest NEVER completed keeps the
    // gold first-offer mark, because the first turn-in genuinely pays quest
    // XP and gold. Only history flips it blue.
    expect(questMarkerKind(quest(), 'available', NONE, 'giver')).toBe('available');
    expect(questMarkerKind(quest({ repeatable: true }), 'available', NONE, 'giver')).toBe(
      'available',
    );
  });

  it('classifies a completed repeatable as repeat, and history alone never does', () => {
    const done = new Set(['q_marker_fixture']);
    expect(questMarkerKind(quest({ repeatable: true }), 'available', done, 'giver')).toBe('repeat');
    // A non-repeatable id in questsDone must NOT go blue even if a stale
    // caller hands an 'available' state for it: the flag gates, not history.
    expect(questMarkerKind(quest(), 'available', done, 'giver')).toBe('available');
  });

  it('classifies the cadence window as cooldown, and only the cadence window', () => {
    const done = new Set(['q_marker_fixture']);
    const blocked = new Set(['q_marker_fixture']);
    expect(
      questMarkerKind(quest({ repeatable: true }), 'unavailable', done, 'giver', blocked),
    ).toBe('cooldown');
    // Plain unavailability (prereq, level, retirement, the identity gate) is
    // NOT a cooldown: without the set, or with the id absent from it, the
    // giver shows nothing, exactly today's behavior.
    expect(questMarkerKind(quest({ repeatable: true }), 'unavailable', done, 'giver')).toBe('none');
    expect(
      questMarkerKind(
        quest({ repeatable: true }),
        'unavailable',
        done,
        'giver',
        new Set(['other']),
      ),
    ).toBe('none');
    // Defense in depth: a NON-repeatable id in the blocked set (impossible
    // today, only armCadence writes the store and only under the
    // repeatable-only repeatCadenceTicks) must not dress as a work-order
    // cooldown.
    expect(questMarkerKind(quest(), 'unavailable', done, 'giver', blocked)).toBe('none');
  });

  it('shows nothing at the giver for ready, active, and done states', () => {
    // Ready and active belong to the turn-in role; done is finished history.
    expect(questMarkerKind(quest(), 'ready', NONE, 'giver')).toBe('none');
    expect(questMarkerKind(quest(), 'active', NONE, 'giver')).toBe('none');
    expect(questMarkerKind(quest(), 'done', new Set(['q_marker_fixture']), 'giver')).toBe('none');
  });
});

describe('questMarkerKind: the turn-in role', () => {
  it('classifies ready as ready and active as the gray in-progress marker', () => {
    expect(questMarkerKind(quest(), 'ready', NONE, 'turnIn')).toBe('ready');
    expect(questMarkerKind(quest(), 'active', NONE, 'turnIn')).toBe('active');
  });

  it('never answers repeat or cooldown for the turn-in role', () => {
    // The blue mark and the dimmed mark are giver-side statements ("this NPC
    // will offer it"); a turn-in with nothing to receive shows nothing.
    const done = new Set(['q_marker_fixture']);
    const blocked = new Set(['q_marker_fixture']);
    expect(questMarkerKind(quest({ repeatable: true }), 'available', done, 'turnIn')).toBe('none');
    expect(
      questMarkerKind(quest({ repeatable: true }), 'unavailable', done, 'turnIn', blocked),
    ).toBe('none');
  });
});

describe('the fold order', () => {
  // Record<QuestMarkerKind, number> forces this table to name every variant:
  // adding a kind without ranking it here is a compile error, so the sweep
  // below cannot silently skip one (the union-sweep trap). DELIBERATELY a
  // hand-written literal mirror, never derived from questMarkerRank: this
  // table is the load-bearing ordering pin (the mutation round proved a
  // priority swap survives every derived comparison), so "DRYing" it onto
  // the production table would evaporate all ordering protection.
  const RANK: Record<QuestMarkerKind, number> = {
    ready: 5,
    available: 4,
    repeat: 3,
    active: 2,
    cooldown: 1,
    none: 0,
  };
  const KINDS = Object.keys(RANK) as QuestMarkerKind[];

  it('orders ready > available > repeat > active > cooldown > none, totally', () => {
    for (const a of KINDS) {
      for (const b of KINDS) {
        const expected = RANK[b] > RANK[a] ? b : a;
        expect(strongerQuestMarker(a, b), `${a} vs ${b}`).toBe(expected);
      }
    }
  });

  it('keeps the left value on ties, so a left fold is order-stable', () => {
    for (const k of KINDS) expect(strongerQuestMarker(k, k)).toBe(k);
  });

  it('ready is the maximum, through the fold itself: two surfaces short-circuit on it', () => {
    // The nameplate and minimap loops break as soon as the fold reaches
    // 'ready'. That is only sound while nothing outranks it, and this pin
    // asks the production fold directly (not the mirrored RANK table above),
    // so ranking a hypothetical new kind above 'ready' reddens here even if
    // the mirror is updated in lockstep.
    for (const k of KINDS) {
      expect(strongerQuestMarker('ready', k)).toBe('ready');
      expect(strongerQuestMarker(k, 'ready')).toBe('ready');
    }
  });

  it('exposes the fold rank the list-producing consumers sort by', () => {
    // Pins rank/fold AGREEMENT only (both read the production table, so this
    // cannot catch a reordering; the literal RANK mirror above does that).
    // What it does catch is the two exports drifting apart, the exact
    // divergence the map's sort-by-rank refactor made possible.
    for (const a of KINDS) {
      for (const b of KINDS) {
        const stronger = strongerQuestMarker(a, b);
        const byRank = questMarkerRank(b) > questMarkerRank(a) ? b : a;
        expect(stronger, `${a} vs ${b}`).toBe(byRank);
      }
    }
  });
});

describe('npcQuestMarkerKind: the per-template fold', () => {
  it('ready keeps priority over repeat on a giver-and-turn-in NPC', () => {
    // Acceptance (c): the work-order shape, one NPC holding both roles. A
    // ready turn-in must win the glyph even though the giver arm would say
    // repeat for the same quest id on the next cycle.
    const q = quest({ repeatable: true, giverNpcId: 'npc_both', turnInNpcId: 'npc_both' });
    const done = new Set(['q_marker_fixture']);
    expect(npcQuestMarkerKind(q, 'npc_both', 'ready', done)).toBe('ready');
    expect(npcQuestMarkerKind(q, 'npc_both', 'available', done)).toBe('repeat');
  });

  it('resolves each role only for the template that holds it', () => {
    const q = quest({ repeatable: true });
    const done = new Set(['q_marker_fixture']);
    // The giver template never renders ready/active; the turn-in template
    // never renders the blue or dimmed giver-side marks.
    expect(npcQuestMarkerKind(q, 'npc_giver', 'ready', done)).toBe('none');
    expect(npcQuestMarkerKind(q, 'npc_turnin', 'available', done)).toBe('none');
    expect(npcQuestMarkerKind(q, 'npc_turnin', 'ready', done)).toBe('ready');
    expect(npcQuestMarkerKind(q, 'npc_giver', 'available', done)).toBe('repeat');
    // A template unrelated to the quest shows nothing whatever the state.
    expect(npcQuestMarkerKind(q, 'npc_stranger', 'ready', done)).toBe('none');
  });

  it('honors turnInNpcIds when it widens the turn-in set', () => {
    const q = quest({ turnInNpcIds: ['npc_turnin', 'npc_alt'] });
    expect(npcQuestMarkerKind(q, 'npc_alt', 'ready', NONE)).toBe('ready');
  });
});

describe('the real work-order lifecycle through computeQuestState', () => {
  // The eleven repeatable quests in content are the phase's subjects; this
  // arm drives ONE real work order through the shared state machine both
  // worlds call, so the classifier's inputs are the real ones, not fixtures.
  const WORK_ORDER_ID = 'q_prof_workorder_forge';
  const workOrder = QUESTS[WORK_ORDER_ID];

  it('the fixture quest exists, is repeatable, and carries the cadence window', () => {
    expect(workOrder).toBeDefined();
    expect(workOrder.repeatable).toBe(true);
    expect(workOrder.repeatCadenceTicks).toBe(WORK_ORDER_CADENCE_TICKS);
    // The content assigns the field FROM the constant, so the line above is
    // structural only; the literal pins the 30-minute window itself.
    expect(WORK_ORDER_CADENCE_TICKS).toBe(36000);
  });

  it('a cadence-blocked quest shows cooldown even while another gate also blocks it (deliberate)', () => {
    // q_prof_hobby_switch is repeatable, cadenced, AND an identity-transition
    // quest: with another transition active, computeQuestState blocks it at
    // the identity gate before ever reaching the cadence check, while the
    // armed window still lists it in the blocked set. The marker still says
    // cooldown, DELIBERATELY: the window claim is true, and the set drops
    // the id the moment the window lapses, so the dim mark cannot outlive
    // the cadence it reports (the leaf header records the reasoning).
    const hobby = QUESTS.q_prof_hobby_switch;
    expect(hobby.repeatable).toBe(true);
    expect(hobby.repeatCadenceTicks).toBe(WORK_ORDER_CADENCE_TICKS);
    expect(hobby.completionEffect?.type).toBe('switchHobby');
    const done = new Set([hobby.id]);
    const blocked = new Set([hobby.id]);
    expect(questMarkerKind(hobby, 'unavailable', done, 'giver', blocked)).toBe('cooldown');
  });

  const doneWithPrereqs = (extra: string[] = []): Set<string> => {
    const done = new Set<string>(extra);
    if (workOrder.requiresQuest) done.add(workOrder.requiresQuest);
    return done;
  };
  const emptyLog = new Map<string, QuestProgress>();

  it('never completed: available, and the marker stays gold everywhere', () => {
    const state = computeQuestState(WORK_ORDER_ID, emptyLog, doneWithPrereqs(), 60);
    expect(state).toBe('available');
    expect(questMarkerKind(workOrder, state, doneWithPrereqs(), 'giver')).toBe('available');
  });

  it('completed and inside the window: cooldown on the giver, from either cadence-set shape', () => {
    const done = doneWithPrereqs([WORK_ORDER_ID]);
    // Offline, the Sim re-derives the blocked set from questCadence in ARMING
    // order; online, the server's cprof mirror arrives SORTED. Membership is
    // all the classifier may read, so the two constructions are driven with
    // genuinely different insertion orders (a second blocked order ahead of
    // and behind the subject) and must classify identically. This arm cannot
    // prove more than membership-only reads, and does not claim to; the real
    // both-worlds proofs live in the minimap and map surface suites.
    const otherOrder = Object.values(QUESTS).find(
      (q) => q.repeatable && q.repeatCadenceTicks && q.id !== WORK_ORDER_ID,
    );
    if (!otherOrder) throw new Error('expected a second cadenced work order');
    const sortedIds = [WORK_ORDER_ID, otherOrder.id].sort();
    const armingOrder = new Set([sortedIds[1], sortedIds[0]]); // reversed by construction
    const sortedMirror = new Set(sortedIds);
    expect([...armingOrder]).not.toEqual([...sortedMirror]); // the shapes really differ
    for (const withinCadence of [armingOrder, sortedMirror]) {
      const state = computeQuestState(WORK_ORDER_ID, emptyLog, done, 60, undefined, withinCadence);
      expect(state).toBe('unavailable');
      expect(questMarkerKind(workOrder, state, done, 'giver', withinCadence)).toBe('cooldown');
    }
  });

  it('completed and lapsed: available again, and the marker turns blue', () => {
    const done = doneWithPrereqs([WORK_ORDER_ID]);
    const state = computeQuestState(WORK_ORDER_ID, emptyLog, done, 60);
    expect(state).toBe('available');
    expect(questMarkerKind(workOrder, state, done, 'giver')).toBe('repeat');
  });

  it('every one of the eleven repeatable quests classifies repeat once completed and offered', () => {
    const repeatables = Object.values(QUESTS).filter((q) => q.repeatable);
    expect(repeatables).toHaveLength(11);
    for (const q of repeatables) {
      expect(questMarkerKind(q, 'available', new Set([q.id]), 'giver'), q.id).toBe('repeat');
    }
  });
});
