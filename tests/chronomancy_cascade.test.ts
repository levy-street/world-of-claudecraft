// Chronomancy Phase 4: Cascada temporal (Temporal Cascade), the GROUP version of
// Temporal Echo. docs/prd/mage-chronomancy.md Phase 4. Deterministic coverage of:
//   - target selection: caster + LIVING group/raid members only, primary always in,
//     nearest-four-to-the-primary within 15 yd, ties by stable id, cap of five,
//   - the group echo's stored origin + reduced coefficient (13% single / 6% area),
//   - the individual-overlap rule (keep 35%, extend-to-8 not refresh-to-15, count in five),
//   - the group->individual upgrade then move (ally left bare, no group rebuild in v1),
//   - conversion: each marked ally converts its OWN coefficient from one hit (no shared
//     budget), area reduction, non-crit, no recursion, never heals a dead ally,
//   - two chronomancers keep independent marks by sourceId,
//   - UI visibility: the local player sees ONLY their own echoes (party strip + target frame).
import { describe, expect, it } from 'vitest';
import {
  chronomancyConvertArcaneDamage,
  ECHO_CONVERT_AOE,
  ECHO_CONVERT_SINGLE,
  ECHO_GROUP_CONVERT_AOE,
  ECHO_GROUP_CONVERT_SINGLE,
  placeGroupEcho,
  placeTemporalEcho,
  selectCascadeTargets,
  TEMPORAL_ECHO_ID,
} from '../src/sim/combat/chronomancy';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity } from '../src/sim/types';
import { type AuraInput, type AurasDeps, createAurasView } from '../src/ui/auras_view';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function chronoMage(level = 20) {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

// Form a RAID (leader + members). A 5-cap party would drop the sixth body, so
// Cascada's five-ally reach needs a raid to exercise fully.
function makeRaid(sim: Sim, leader: number, members: number[]): void {
  const invite = (m: number) => {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  };
  for (const m of members.slice(0, 4)) invite(m);
  (sim as unknown as { party: { convertPartyToRaid(pid: number): void } }).party.convertPartyToRaid(
    leader,
  );
  for (const m of members.slice(4)) invite(m);
}

// Add a player ally at a fixed spot with a huge health pool (so conversion heals
// never clamp) and, by default, a big chunk of missing health to receive them.
function addAlly(sim: Sim, x: number, z: number, name: string): Entity {
  const id = sim.addPlayer('warrior', name);
  const e = sim.entities.get(id)!;
  e.pos.x = x;
  e.pos.z = z;
  e.maxHp = 1_000_000;
  e.hp = 1_000; // far below max, so a converted heal lands in full
  return e;
}

function marked(e: Entity, sourceId: number): boolean {
  return e.auras.some((a) => a.id === TEMPORAL_ECHO_ID && a.sourceId === sourceId);
}

function echoAura(e: Entity, sourceId: number) {
  return e.auras.find((a) => a.id === TEMPORAL_ECHO_ID && a.sourceId === sourceId);
}

describe('Cascada target selection', () => {
  it('takes the primary plus the four nearest members within radius, ties by id, cap five', () => {
    const { sim, p } = chronoMage();
    const bx = p.pos.x;
    const bz = p.pos.z;
    // A primary with five candidate allies. a4 and a5 sit at the SAME distance to
    // contest the LAST slot, proving the tie resolves to the lower id (a4 was added
    // first). a5 is the tie loser and must be dropped.
    const primary = addAlly(sim, bx, bz, 'Primary');
    const a1 = addAlly(sim, bx, bz + 1, 'A1'); // 1 yd
    const a2 = addAlly(sim, bx, bz + 2, 'A2'); // 2 yd
    const a3 = addAlly(sim, bx, bz + 3, 'A3'); // 3 yd
    const a4 = addAlly(sim, bx + 4, bz, 'A4'); // 4 yd (lower id)
    const a5 = addAlly(sim, bx - 4, bz, 'A5'); // 4 yd (higher id, tie loser)
    makeRaid(sim, p.id, [primary.id, a1.id, a2.id, a3.id, a4.id, a5.id]);
    // Move the mage out of the 15 yd radius so its own self-candidacy does not take a
    // slot; here we are exercising the pure ally ordering.
    p.pos.x = bx - 40;

    const chosen = selectCascadeTargets(ctxOf(sim), p, primary, 15, 5);
    expect(chosen.map((e) => e.id)).toEqual([primary.id, a1.id, a2.id, a3.id, a4.id]);
    expect(chosen).toHaveLength(5);
    // a4 (lower id) wins the contested last slot; a5 (tie loser) is dropped.
    expect(chosen).not.toContain(a5);
  });

  it('always includes the primary even when it is the outlier of the group', () => {
    const { sim, p } = chronoMage();
    // The primary is off on its own; the other four cluster together but each stays
    // within 15 yd of the primary.
    const primary = addAlly(sim, p.pos.x, p.pos.z, 'Primary');
    const others = [1, 2, 3, 4].map((i) => addAlly(sim, p.pos.x + 12, p.pos.z + i * 0.3, `O${i}`));
    makeRaid(sim, p.id, [primary.id, ...others.map((e) => e.id)]);

    const chosen = selectCascadeTargets(ctxOf(sim), p, primary, 15, 5);
    expect(chosen[0]).toBe(primary); // primary is always first
    expect(chosen).toHaveLength(5);
  });

  it('excludes members beyond the radius, the dead, and non-members', () => {
    const { sim, p } = chronoMage();
    const primary = addAlly(sim, p.pos.x, p.pos.z + 1, 'Primary');
    const near = addAlly(sim, p.pos.x, p.pos.z + 2, 'Near');
    const far = addAlly(sim, p.pos.x, p.pos.z + 40, 'Far'); // beyond 15 yd
    const deadAlly = addAlly(sim, p.pos.x, p.pos.z + 3, 'Dead');
    deadAlly.dead = true;
    const outsider = addAlly(sim, p.pos.x, p.pos.z + 2.5, 'Outsider'); // NOT in the raid
    makeRaid(sim, p.id, [primary.id, near.id, far.id, deadAlly.id]);

    const chosen = selectCascadeTargets(ctxOf(sim), p, primary, 15, 5);
    const ids = chosen.map((e) => e.id);
    expect(ids).toContain(primary.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(far.id); // out of radius
    expect(ids).not.toContain(deadAlly.id); // dead
    expect(ids).not.toContain(outsider.id); // not a raid member
  });

  it('refuses when the primary is not the caster or a living group/raid member', () => {
    const { sim, p } = chronoMage();
    const stranger = addAlly(sim, p.pos.x, p.pos.z + 2, 'Stranger'); // no party
    expect(selectCascadeTargets(ctxOf(sim), p, stranger, 15, 5)).toEqual([]);
    // A solo caster can still target itself.
    expect(selectCascadeTargets(ctxOf(sim), p, p, 15, 5)).toEqual([p]);
  });
});

describe('Cascada group echo + individual overlap', () => {
  it('stores the group origin and the reduced 13% coefficient', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, p.pos.x, p.pos.z + 2, 'Ally');
    placeGroupEcho(ctxOf(sim), p, ally, 8);
    const a = echoAura(ally, p.id)!;
    expect(a.echoGroup).toBe(true);
    expect(a.echoConvertRate).toBe(ECHO_GROUP_CONVERT_SINGLE);
    expect(a.remaining).toBe(8);
  });

  it('keeps a pre-existing individual echo at 35%, extending up to 8s but never to 15s', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, p.pos.x, p.pos.z + 2, 'Ally');
    placeTemporalEcho(ctxOf(sim), p, ally, 15);
    const indiv = echoAura(ally, p.id)!;
    expect(indiv.echoGroup).toBe(false);

    // Less than 8s left: the group cast extends it up to 8, still individual/35%.
    indiv.remaining = 3;
    placeGroupEcho(ctxOf(sim), p, ally, 8);
    const after = echoAura(ally, p.id)!;
    expect(after.echoGroup).toBe(false); // NOT downgraded to a group echo
    expect(after.echoConvertRate).toBe(ECHO_CONVERT_SINGLE);
    expect(after.remaining).toBe(8); // extended up to 8

    // More than 8s left: the group cast never shortens it and never refreshes to 15.
    after.remaining = 12;
    placeGroupEcho(ctxOf(sim), p, ally, 8);
    expect(echoAura(ally, p.id)!.remaining).toBe(12);
  });

  it('upgrades a group echo to individual on a single cast, then leaves the ally bare when it moves', () => {
    const { sim, p } = chronoMage();
    const allyA = addAlly(sim, p.pos.x, p.pos.z + 2, 'A');
    const allyB = addAlly(sim, p.pos.x, p.pos.z + 3, 'B');
    placeGroupEcho(ctxOf(sim), p, allyA, 8);
    expect(echoAura(allyA, p.id)!.echoGroup).toBe(true);

    // Single Temporal Echo onto the group-marked ally UPGRADES it to 35%.
    placeTemporalEcho(ctxOf(sim), p, allyA, 15);
    expect(echoAura(allyA, p.id)!.echoGroup).toBe(false);

    // Moving the individual echo to another ally leaves A bare (no group rebuild in v1).
    placeTemporalEcho(ctxOf(sim), p, allyB, 15);
    expect(marked(allyA, p.id)).toBe(false);
    expect(echoAura(allyB, p.id)!.echoGroup).toBe(false);
  });
});

describe('Cascada conversion', () => {
  it('heals each marked ally at its OWN stored coefficient from one hit (no shared budget)', () => {
    const { sim, p } = chronoMage();
    const single = addAlly(sim, p.pos.x, p.pos.z + 2, 'Single');
    const group = addAlly(sim, p.pos.x, p.pos.z + 3, 'Group');
    placeTemporalEcho(ctxOf(sim), p, single, 15); // 35%
    placeGroupEcho(ctxOf(sim), p, group, 8); // 13%
    const s0 = single.hp;
    const g0 = group.hp;
    chronomancyConvertArcaneDamage(ctxOf(sim), p, 100, 'arcane', false);
    expect(single.hp - s0).toBe(Math.round(100 * ECHO_CONVERT_SINGLE)); // 35
    expect(group.hp - g0).toBe(Math.round(100 * ECHO_GROUP_CONVERT_SINGLE)); // 13
  });

  it('applies the reduced area rate to a group echo and the normal area rate to an individual', () => {
    const { sim, p } = chronoMage();
    const single = addAlly(sim, p.pos.x, p.pos.z + 2, 'Single');
    const group = addAlly(sim, p.pos.x, p.pos.z + 3, 'Group');
    placeTemporalEcho(ctxOf(sim), p, single, 15);
    placeGroupEcho(ctxOf(sim), p, group, 8);
    const s0 = single.hp;
    const g0 = group.hp;
    chronomancyConvertArcaneDamage(ctxOf(sim), p, 100, 'arcane', true);
    expect(single.hp - s0).toBe(Math.round(100 * ECHO_CONVERT_AOE)); // 15
    expect(group.hp - g0).toBe(Math.round(100 * ECHO_GROUP_CONVERT_AOE)); // 6
  });

  it('never heals a dead ally and never crits (exact coefficient, no doubling)', () => {
    const { sim, p } = chronoMage();
    const live = addAlly(sim, p.pos.x, p.pos.z + 2, 'Live');
    const dead = addAlly(sim, p.pos.x, p.pos.z + 3, 'Dead');
    placeGroupEcho(ctxOf(sim), p, live, 8);
    placeGroupEcho(ctxOf(sim), p, dead, 8);
    dead.dead = true;
    const d0 = dead.hp;
    const l0 = live.hp;
    chronomancyConvertArcaneDamage(ctxOf(sim), p, 200, 'arcane', false);
    expect(dead.hp).toBe(d0); // dead ally untouched
    // Exactly the coefficient, never a crit-doubled amount.
    expect(live.hp - l0).toBe(Math.round(200 * ECHO_GROUP_CONVERT_SINGLE));
  });

  it('ignores non-arcane damage', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, p.pos.x, p.pos.z + 2, 'Ally');
    placeGroupEcho(ctxOf(sim), p, ally, 8);
    const h0 = ally.hp;
    chronomancyConvertArcaneDamage(ctxOf(sim), p, 100, 'fire', false);
    expect(ally.hp).toBe(h0);
  });
});

describe('two chronomancers keep independent marks by sourceId', () => {
  it('each mage heals only through its own mark at its own coefficient', () => {
    const { sim, p } = chronoMage();
    const mage2Id = sim.addPlayer('mage', 'Mage2');
    const mage2 = sim.entities.get(mage2Id)!;
    // The second mage must be a Chronomancer for a mark, but conversion only reads
    // the source id + the mark's stored rate, so we can place marks directly.
    const ally = addAlly(sim, p.pos.x, p.pos.z + 2, 'Ally');
    placeGroupEcho(ctxOf(sim), p, ally, 8); // mage1: 13%
    placeTemporalEcho(ctxOf(sim), mage2, ally, 15); // mage2: 35%
    expect(marked(ally, p.id)).toBe(true);
    expect(marked(ally, mage2.id)).toBe(true);

    // Mage1's arcane damage heals via the 13% group mark only.
    let h = ally.hp;
    chronomancyConvertArcaneDamage(ctxOf(sim), p, 100, 'arcane', false);
    expect(ally.hp - h).toBe(Math.round(100 * ECHO_GROUP_CONVERT_SINGLE));

    // Mage2's arcane damage heals via its own 35% mark, independently.
    h = ally.hp;
    chronomancyConvertArcaneDamage(ctxOf(sim), mage2, 100, 'arcane', false);
    expect(ally.hp - h).toBe(Math.round(100 * ECHO_CONVERT_SINGLE));
  });
});

describe('Cascada cast gating (group/raid-only target)', () => {
  it('refuses to cast on a friendly outside the group, burning no cost or cooldown', () => {
    const { sim, p } = chronoMage();
    const outsider = addAlly(sim, p.pos.x + 2, p.pos.z, 'Outsider'); // friendly, NOT in party
    const mana0 = p.resource;
    sim.targetEntity(outsider.id);
    sim.castAbility('temporal_cascade');
    // Refused before cost/cooldown: no mana spent, no mark placed, not mid-cast.
    expect(p.resource).toBe(mana0);
    expect(marked(outsider, p.id)).toBe(false);
    expect((p as unknown as { castingAbility: string | null }).castingAbility).toBeNull();
  });

  it('casts on a party member (cost paid, the group is marked)', () => {
    const { sim, p } = chronoMage();
    const member = addAlly(sim, p.pos.x + 2, p.pos.z, 'Member');
    sim.partyInvite(member.id, p.id);
    sim.partyAccept(member.id);
    const mana0 = p.resource;
    sim.targetEntity(member.id);
    sim.castAbility('temporal_cascade');
    for (let i = 0; i < 60; i++) sim.tick(); // let the 2s cast complete
    expect(p.resource).toBeLessThan(mana0); // cost was paid
    expect(marked(member, p.id)).toBe(true);
  });

  it('casts on the caster itself even with no party', () => {
    const { sim, p } = chronoMage();
    const mana0 = p.resource;
    sim.targetEntity(p.id);
    sim.castAbility('temporal_cascade');
    for (let i = 0; i < 60; i++) sim.tick();
    expect(p.resource).toBeLessThan(mana0);
    expect(marked(p, p.id)).toBe(true);
  });
});

describe('UI visibility: only the local player sees its own echoes', () => {
  it('Sim.partyInfo hides a foreign chronomancer echo but keeps the local player own', () => {
    const { sim, p } = chronoMage();
    const mage2Id = sim.addPlayer('mage', 'Mage2');
    const mage2 = sim.entities.get(mage2Id)!;
    mage2.pos.x = p.pos.x + 1; // near, so the party invite is accepted
    mage2.pos.z = p.pos.z;
    const ally = addAlly(sim, p.pos.x + 1, p.pos.z, 'Ally');
    // A simple party (leader + ally + mage2) is enough; partyInfo is read from the
    // local player's (p's) perspective.
    for (const m of [ally.id, mage2.id]) {
      sim.partyInvite(m, p.id);
      sim.partyAccept(m);
    }
    placeTemporalEcho(ctxOf(sim), p, ally, 15); // local player's own echo (shown)
    placeGroupEcho(ctxOf(sim), mage2, ally, 8); // foreign echo (hidden)

    const info = sim.partyInfo!;
    const row = info.members.find((m) => m.pid === ally.id)!;
    const echoAuras = (row.auras ?? []).filter((a) => a.id === TEMPORAL_ECHO_ID);
    // The strip carries no sourceId, but the foreign mark was filtered out at the
    // source, so exactly ONE Temporal Echo icon (the local player's) remains.
    expect(echoAuras).toHaveLength(1);
  });

  it('prioritizes a later HoT before maintenance buffs at the party aura cap', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, p.pos.x + 1, p.pos.z, 'AuraCapAlly');
    sim.partyInvite(ally.id, p.id);
    sim.partyAccept(ally.id);
    const maintenance: Aura[] = Array.from({ length: 8 }, (_, index) => ({
      id: `maintenance_${index}`,
      name: `Maintenance ${index}`,
      kind: 'buff_int',
      remaining: 1800,
      duration: 1800,
      value: 10,
      sourceId: ally.id,
      school: 'arcane',
    }));
    ally.auras = [
      ...maintenance,
      {
        id: 'renew',
        name: 'Renew',
        kind: 'hot',
        remaining: 12,
        duration: 12,
        value: 20,
        sourceId: p.id,
        school: 'holy',
      },
    ];

    const row = sim.partyInfo?.members.find((member) => member.pid === ally.id);
    // This line's party rows also carry the remaining seconds (party_frame_info.ts).
    expect(row?.auras?.[0]).toEqual({ id: 'renew', kind: 'hot', remaining: 12 });
  });

  it('keeps debuffs and the own echo mark ahead of other relevant auras at the cap', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, p.pos.x + 1, p.pos.z, 'CapPriorityAlly');
    sim.partyInvite(ally.id, p.id);
    sim.partyAccept(ally.id);
    const hots: Aura[] = Array.from({ length: 8 }, (_, index) => ({
      id: `hot_${index}`,
      name: `Hot ${index}`,
      kind: 'hot',
      remaining: 12,
      duration: 12,
      value: 20,
      sourceId: ally.id,
      school: 'holy',
    }));
    ally.auras = [
      ...hots,
      {
        id: 'rend',
        name: 'Rend',
        kind: 'dot',
        remaining: 9,
        duration: 9,
        value: -5,
        sourceId: 9999,
        school: 'physical',
      },
      {
        id: 'temporal_echo',
        name: 'Temporal Echo',
        kind: 'temporal_echo',
        remaining: 15,
        duration: 15,
        value: 0,
        sourceId: p.id,
        school: 'arcane',
      },
    ];

    const row = sim.partyInfo?.members.find((member) => member.pid === ally.id);
    const ids = (row?.auras ?? []).map((aura) => aura.id);
    // Debuff first, the viewer's own echo mark second, then the HoTs in natural
    // order until the cap; hot_6 and hot_7 are the ones squeezed out.
    expect(ids).toEqual([
      'rend',
      'temporal_echo',
      'hot_0',
      'hot_1',
      'hot_2',
      'hot_3',
      'hot_4',
      'hot_5',
    ]);
  });

  it('auras_view drops a foreign temporal_echo but renders an own one and other auras', () => {
    const OWN = 7;
    const deps: AurasDeps = {
      iconId: (a) => a.id,
      auraName: (a) => a.name,
      formatStacks: (n) => String(n),
      isOwn: (a) => a.sourceId === OWN,
      durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
      auraEffectHtml: () => '',
    };
    const mk = (over: Partial<AuraInput> & { id: string }): AuraInput => ({
      name: over.id,
      kind: 'buff_ap',
      remaining: 10,
      value: 1,
      sourceId: OWN,
      ...over,
    });
    const view = createAurasView('buffs', deps, { ownFirst: true });
    const state = view.tick({
      auras: [
        mk({ id: 'buff', kind: 'buff_ap', sourceId: 99 }), // a normal buff (always shown)
        mk({ id: TEMPORAL_ECHO_ID, kind: 'temporal_echo', sourceId: OWN }), // own echo (shown)
        mk({ id: TEMPORAL_ECHO_ID, kind: 'temporal_echo', sourceId: 99 }), // foreign echo (hidden)
      ],
    });
    const keys = state.slots.slice(0, state.count).map((s) => s.key);
    expect(keys.filter((k) => k === TEMPORAL_ECHO_ID)).toHaveLength(1); // only the own echo
    expect(keys).toContain('buff'); // unrelated auras are unaffected
    expect(state.count).toBe(2);
  });

  it('does NOT filter echoes in a non-ownFirst view (party/raid mini-strip)', () => {
    // The party mini-strip renders through the same view with isOwn:()=>false (its
    // PartyMemberAura carries no sourceId) and its foreign echoes are already dropped
    // upstream by Sim.partyInfo / partyWire. The view must NOT re-filter here, or the
    // viewer's OWN echoes (the only ones left) would wrongly vanish.
    const deps: AurasDeps = {
      iconId: (a) => a.id,
      auraName: (a) => a.name,
      formatStacks: (n) => String(n),
      isOwn: () => false, // the party-strip deps, mirroring hud.ts
      durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
      auraEffectHtml: () => '',
    };
    const view = createAurasView('buffs', deps); // NOT ownFirst
    const state = view.tick({
      auras: [
        { id: TEMPORAL_ECHO_ID, name: 'echo', kind: 'temporal_echo', remaining: 8, value: 1 },
      ],
    });
    expect(state.count).toBe(1); // the (already-upstream-filtered) echo still renders
  });
});
