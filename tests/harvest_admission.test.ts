import { describe, expect, it } from 'vitest';
import {
  admitCorpseHarvest,
  HARVEST_CAST_SECONDS,
  HARVEST_PRIORITY_SECONDS,
  type HarvestActorFacts,
  type HarvestAdmissionInput,
  type HarvestCorpseFacts,
  harvestPriorityKeyFor,
} from '../src/sim/professions/harvest_admission';
import {
  HARVEST_PREFERENCE_ALL,
  type HarvestPreference,
} from '../src/sim/professions/harvest_preference';
import { UNMAPPED_FAMILY, UNMAPPED_FAMILY_2 } from './helpers/unmapped_family';

const ACTOR_ID = 11;
const RIVAL_ID = 12;
const CORPSE_ID = 5001;
const ACTOR_KEY = `entity:${ACTOR_ID}`;
const RIVAL_KEY = `entity:${RIVAL_ID}`;

function material(itemId: string): HarvestPreference {
  return { kind: 'material', itemId };
}

/** An actor who passes every actor-side gate. */
function actor(overrides: Partial<HarvestActorFacts> = {}): HarvestActorFacts {
  return {
    entityId: ACTOR_ID,
    priorityKey: ACTOR_KEY,
    alive: true,
    inCombat: false,
    alreadyCasting: false,
    hasFieldKit: true,
    inRange: true,
    sameWorld: true,
    ordinaryYieldFits: true,
    ...overrides,
  };
}

/** A fresh corpse whose priority window is still open to its own killers. */
function corpse(overrides: Partial<HarvestCorpseFacts> = {}): HarvestCorpseFacts {
  return {
    entityId: CORPSE_ID,
    valid: true,
    claimed: false,
    remainingSeconds: 60,
    priorityRemainingSeconds: HARVEST_PRIORITY_SECONDS,
    priorityMemberKeys: [ACTOR_KEY],
    reservationOwnerId: null,
    componentTags: ['hide', 'fang'],
    ...overrides,
  };
}

function input(overrides: Partial<HarvestAdmissionInput> = {}): HarvestAdmissionInput {
  return { actor: actor(), corpse: corpse(), preference: HARVEST_PREFERENCE_ALL, ...overrides };
}

describe('the frozen harvest admission constants', () => {
  it('states the cast length and the priority window', () => {
    expect(HARVEST_CAST_SECONDS).toBe(1.5);
    expect(HARVEST_PRIORITY_SECONDS).toBe(10);
  });
});

describe('kill-credit priority', () => {
  it('takes its members from the death snapshot, with no current-party input to read', () => {
    // The input carries priorityMemberKeys and nothing else about grouping, so a
    // player who joins the killer's party AFTER the kill cannot gain priority:
    // there is no field through which that fact could arrive. Pinned as the
    // exact key set, because the absence is the rule.
    expect(Object.keys(corpse()).sort()).toEqual([
      'claimed',
      'componentTags',
      'entityId',
      'priorityMemberKeys',
      'priorityRemainingSeconds',
      'remainingSeconds',
      'reservationOwnerId',
      'valid',
    ]);
    const snapshotMember = admitCorpseHarvest(input());
    expect(snapshotMember.ok).toBe(true);
    const latecomer = admitCorpseHarvest(
      input({
        actor: actor({ entityId: RIVAL_ID, priorityKey: RIVAL_KEY }),
        corpse: corpse({ priorityMemberKeys: ['entity:99'] }),
      }),
    );
    expect(latecomer).toEqual({ ok: false, reason: 'priority_protected' });
  });

  it('holds a nonmember out at 9.95 seconds and opens to everyone at exactly 0', () => {
    const outsider = actor({ entityId: RIVAL_ID, priorityKey: RIVAL_KEY });
    const held = admitCorpseHarvest(
      input({ actor: outsider, corpse: corpse({ priorityRemainingSeconds: 9.95 }) }),
    );
    expect(held).toEqual({ ok: false, reason: 'priority_protected' });
    const stillHeld = admitCorpseHarvest(
      input({ actor: outsider, corpse: corpse({ priorityRemainingSeconds: 0.0001 }) }),
    );
    expect(stillHeld.ok).toBe(false);
    const opened = admitCorpseHarvest(
      input({ actor: outsider, corpse: corpse({ priorityRemainingSeconds: 0 }) }),
    );
    expect(opened.ok).toBe(true);
    const longOpen = admitCorpseHarvest(
      input({ actor: outsider, corpse: corpse({ priorityRemainingSeconds: -5 }) }),
    );
    expect(longOpen.ok).toBe(true);
  });

  it('is public immediately when the death snapshot named nobody', () => {
    // No tapper (or a corpse whose killers are all gone from the snapshot): the
    // window protects nobody, so it is never applied at all.
    const held = corpse({
      priorityMemberKeys: [],
      priorityRemainingSeconds: HARVEST_PRIORITY_SECONDS,
    });
    const noTapper = admitCorpseHarvest(
      input({ actor: actor({ entityId: RIVAL_ID, priorityKey: RIVAL_KEY }), corpse: held }),
    );
    expect(noTapper.ok).toBe(true);
  });

  it('admits a snapshot member for the whole window', () => {
    const member = admitCorpseHarvest(
      input({ corpse: corpse({ priorityMemberKeys: [RIVAL_KEY, ACTOR_KEY] }) }),
    );
    expect(member.ok).toBe(true);
  });
});

describe('harvestPriorityKeyFor', () => {
  it('is domain-prefixed from a trusted gathererIdentity, never a name', () => {
    expect(
      harvestPriorityKeyFor({ entityId: 5, gathererIdentity: { kind: 'character', id: 42 } }),
    ).toBe('character:42');
    expect(
      harvestPriorityKeyFor({ entityId: 5, gathererIdentity: { kind: 'offline', id: 'abc' } }),
    ).toBe('offline:abc');
    expect(
      harvestPriorityKeyFor({ entityId: 5, gathererIdentity: { kind: 'headless', id: 'xyz' } }),
    ).toBe('headless:xyz');
  });

  it('falls back to entity:<id> with no persisted identity', () => {
    expect(harvestPriorityKeyFor({ entityId: 7 })).toBe('entity:7');
  });

  it('two distinct characters sharing a display name never share a key', () => {
    // The key is derived from entityId/gathererIdentity alone; a caller that fed
    // a name in here would collide two "Alpha"s onto one priority slot.
    const a = harvestPriorityKeyFor({ entityId: 1 });
    const b = harvestPriorityKeyFor({ entityId: 2 });
    expect(a).not.toBe(b);
  });
});

describe('the single reservation', () => {
  it('refuses a rival reservation and the actor own live one alike', () => {
    // Refusing the holder too is deliberate: a second admitted attempt would be
    // a duplicate cast against one reservation, and this leaf cannot see which
    // cast is live. The session owner re-entering is its own problem to solve.
    const rival = input({ corpse: corpse({ reservationOwnerId: RIVAL_ID }) });
    expect(admitCorpseHarvest(rival)).toEqual({ ok: false, reason: 'reserved' });
    const own = input({ corpse: corpse({ reservationOwnerId: ACTOR_ID }) });
    expect(admitCorpseHarvest(own)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('admits when no reservation is held', () => {
    expect(admitCorpseHarvest(input({ corpse: corpse({ reservationOwnerId: null }) })).ok).toBe(
      true,
    );
  });
});

describe('corpse lifetime', () => {
  it('admits at exactly the cast length and refuses below it', () => {
    const exact = admitCorpseHarvest(
      input({ corpse: corpse({ remainingSeconds: HARVEST_CAST_SECONDS }) }),
    );
    expect(exact.ok).toBe(true);
    expect(admitCorpseHarvest(input({ corpse: corpse({ remainingSeconds: 1.49 }) }))).toEqual({
      ok: false,
      reason: 'corpse_expiring',
    });
  });

  it('treats a spent lifetime as no corpse at all', () => {
    for (const remainingSeconds of [0, -1]) {
      expect(admitCorpseHarvest(input({ corpse: corpse({ remainingSeconds }) }))).toEqual({
        ok: false,
        reason: 'corpse_invalid',
      });
    }
  });
});

describe('the refusal categories', () => {
  it('names one reason per failing fact', () => {
    const cases: ReadonlyArray<readonly [string, HarvestAdmissionInput]> = [
      ['actor_dead', input({ actor: actor({ alive: false }) })],
      ['actor_in_combat', input({ actor: actor({ inCombat: true }) })],
      ['actor_busy', input({ actor: actor({ alreadyCasting: true }) })],
      ['corpse_invalid', input({ corpse: corpse({ valid: false }) })],
      ['wrong_world', input({ actor: actor({ sameWorld: false }) })],
      ['out_of_range', input({ actor: actor({ inRange: false }) })],
      ['no_field_kit', input({ actor: actor({ hasFieldKit: false }) })],
      ['already_harvested', input({ corpse: corpse({ claimed: true }) })],
      ['reserved', input({ corpse: corpse({ reservationOwnerId: RIVAL_ID }) })],
      ['corpse_expiring', input({ corpse: corpse({ remainingSeconds: 1 }) })],
      ['preference_malformed', input({ preference: null })],
      ['nothing_to_harvest', input({ corpse: corpse({ componentTags: [UNMAPPED_FAMILY] }) })],
      ['bags_full', input({ actor: actor({ ordinaryYieldFits: false }) })],
    ];
    for (const [reason, one] of cases) {
      expect(admitCorpseHarvest(one), reason).toEqual({ ok: false, reason });
    }
  });

  it('refuses a malformed identity or timing fact before reading anything else', () => {
    const malformed: ReadonlyArray<HarvestAdmissionInput> = [
      input({ actor: actor({ entityId: 0 }) }),
      input({ actor: actor({ entityId: -3 }) }),
      input({ actor: actor({ entityId: 1.5 }) }),
      input({ actor: actor({ entityId: Number.NaN }) }),
      input({ actor: actor({ priorityKey: '' }) }),
      input({ actor: actor({ priorityKey: 'x'.repeat(129) }) }),
      input({ corpse: corpse({ entityId: 0 }) }),
      input({ corpse: corpse({ entityId: Number.MAX_SAFE_INTEGER + 2 }) }),
      input({ corpse: corpse({ remainingSeconds: Number.NaN }) }),
      input({ corpse: corpse({ remainingSeconds: Number.POSITIVE_INFINITY }) }),
      input({ corpse: corpse({ priorityRemainingSeconds: Number.NaN }) }),
      input({ corpse: corpse({ priorityRemainingSeconds: Number.NEGATIVE_INFINITY }) }),
      input({ corpse: corpse({ reservationOwnerId: 0 }) }),
      input({ corpse: corpse({ reservationOwnerId: -1 }) }),
      input({ corpse: corpse({ priorityMemberKeys: [ACTOR_KEY, ''] }) }),
      input({ corpse: corpse({ priorityMemberKeys: ['x'.repeat(129)] }) }),
    ];
    for (const one of malformed) {
      expect(admitCorpseHarvest(one)).toEqual({ ok: false, reason: 'malformed_input' });
    }
    // Structure outranks every gameplay refusal: a dead actor with a bad id
    // still reports the structural fault, so a caller never acts on a reason
    // derived from a field it could not trust.
    const both = input({ actor: actor({ alive: false, entityId: 0 }) });
    expect(admitCorpseHarvest(both)).toEqual({ ok: false, reason: 'malformed_input' });
  });

  it('keeps a stable precedence when several facts fail at once', () => {
    // The documented order: structure, actor, corpse existence, reachability,
    // kit, exclusivity, rights, time, preference, capacity.
    const stacked = input({
      actor: actor({ alive: false, inRange: false, hasFieldKit: false, ordinaryYieldFits: false }),
      corpse: corpse({ claimed: true, reservationOwnerId: RIVAL_ID, remainingSeconds: 1 }),
      preference: null,
    });
    expect(admitCorpseHarvest(stacked)).toEqual({ ok: false, reason: 'actor_dead' });
    const claimedAndReserved = input({
      corpse: corpse({ claimed: true, reservationOwnerId: RIVAL_ID }),
    });
    expect(admitCorpseHarvest(claimedAndReserved)).toEqual({
      ok: false,
      reason: 'already_harvested',
    });
    // A body that supports nothing is answered as such, ahead of the pick-level
    // question, so the widest true cause is the one reported.
    const nothingAndUnavailable = input({
      corpse: corpse({ componentTags: [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2] }),
      preference: material('rough_hide'),
    });
    expect(admitCorpseHarvest(nothingAndUnavailable)).toEqual({
      ok: false,
      reason: 'nothing_to_harvest',
    });
  });
});

describe('the preference the admission freezes', () => {
  it('refuses a malformed persisted preference instead of harvesting everything', () => {
    // null is the load-side refusal from harvest_preference.ts: no active
    // choice exists, so nothing may be gathered until the player makes one.
    expect(admitCorpseHarvest(input({ preference: null }))).toEqual({
      ok: false,
      reason: 'preference_malformed',
    });
  });

  it('refuses a retired or absent material and reports what the body offers', () => {
    const retired = admitCorpseHarvest(input({ preference: material('retired_material') }));
    expect(retired).toEqual({
      ok: false,
      reason: 'material_unavailable',
      available: [
        { itemId: 'rough_hide', components: ['hide'] },
        { itemId: 'wolf_fang', components: ['fang'] },
      ],
    });
    const absent = admitCorpseHarvest(
      input({ corpse: corpse({ componentTags: ['cloth'] }), preference: material('rough_hide') }),
    );
    expect(absent).toEqual({
      ok: false,
      reason: 'material_unavailable',
      available: [{ itemId: 'homespun_cloth', components: ['cloth'] }],
    });
  });

  it('keeps All as the canonical empty pick and resolves one material to all its tags', () => {
    const all = admitCorpseHarvest(input());
    expect(all).toEqual({
      ok: true,
      admitted: {
        actorEntityId: ACTOR_ID,
        corpseEntityId: CORPSE_ID,
        preference: { kind: 'all' },
        chosenComponents: [],
      },
    });
    // horn and tusk are one displayed choice, so choosing it takes both tags;
    // no yield math is invented here, only the tag set the canonical path takes.
    const deduped = admitCorpseHarvest(
      input({
        corpse: corpse({ componentTags: ['horn', 'hide', 'tusk'] }),
        preference: material('curved_tusk'),
      }),
    );
    expect(deduped).toEqual({
      ok: true,
      admitted: {
        actorEntityId: ACTOR_ID,
        corpseEntityId: CORPSE_ID,
        preference: { kind: 'material', itemId: 'curved_tusk' },
        chosenComponents: ['horn', 'tusk'],
      },
    });
  });

  it('admits an all preference on a body whose only mapped family is one of many tags', () => {
    const mixed = admitCorpseHarvest(
      input({ corpse: corpse({ componentTags: ['hide', UNMAPPED_FAMILY] }) }),
    );
    expect(mixed.ok).toBe(true);
  });
});

describe('purity of the answer', () => {
  it('shares no structure with its input and cannot be mutated into the next answer', () => {
    const tags = ['horn', 'tusk'];
    const memberKeys = [ACTOR_KEY];
    const one = input({
      corpse: corpse({ componentTags: tags, priorityMemberKeys: memberKeys }),
      preference: material('curved_tusk'),
    });
    const first = admitCorpseHarvest(one);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.admitted.chosenComponents).not.toBe(tags);
    expect(first.admitted.preference).not.toBe(one.preference);
    // Mutating the returned pick, then the caller's own arrays, changes nothing
    // about a repeat call: the leaf reads its input fresh and copies out.
    (first.admitted.chosenComponents as string[]).push('hide');
    const second = admitCorpseHarvest(one);
    expect(second.ok && second.admitted.chosenComponents).toEqual(['horn', 'tusk']);
    expect(tags).toEqual(['horn', 'tusk']);
    expect(memberKeys).toEqual([ACTOR_KEY]);
  });

  it('answers identically for identical input', () => {
    const one = input({ corpse: corpse({ componentTags: ['hide', 'fang', 'claw'] }) });
    expect(admitCorpseHarvest(one)).toEqual(admitCorpseHarvest(one));
    const refused = input({ actor: actor({ ordinaryYieldFits: false }) });
    expect(admitCorpseHarvest(refused)).toEqual(admitCorpseHarvest(refused));
  });
});
