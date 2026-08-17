// The operator-applied Cheater mark's LIFECYCLE, against a real Sim so the
// aura rides the actual death, respawn, and clean-slate paths rather than a
// hand-built array. The pure math and the aura's shape live in
// tests/cheater_mark.test.ts; this file answers one question: can a player get
// out of the sanction early?
//
// The answer must be no on every path a player can trigger. A sanction with an
// escape hatch is not a sanction, and the cheapest hatches are exactly the ones
// the sim already had: dying, queueing for arena, and dying in a Fiesta all wipe
// auras. Each is pinned here WITH a negative control (an ordinary aura that must
// still be wiped), so "the mark survived" can never pass by the wipe silently
// not happening at all.
//
// The three ways the mark legitimately ends are pinned too: its own countdown
// running out, an operator lift, and a re-apply replacing the budget.

import { describe, expect, it } from 'vitest';
import { CHEATER_MARK_AURA_ID } from '../src/sim/moderation';
import { Sim } from '../src/sim/sim';
import { readyArenaFighter } from '../src/sim/social/arena';
import { fiestaDownEntity } from '../src/sim/social/fiesta';
import type { Aura, Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Every Sim member this file drives is public (ctx, tick, setCheaterMark, the
// spirit verbs). The one cast in rig() wraps the public emit so this file can
// observe events without draining the queue the Sim's own consumers read.
type Ev = { type?: string; name?: string; gained?: boolean; abilityId?: string; refresh?: boolean };

const MARK_SECONDS = 3_600;
const CONTROL_AURA_ID = 'test_rejuvenation';

// An ordinary aura: the negative control on every wipe below. If this one is
// still standing, the wipe under test did not run and the mark's survival proves
// nothing.
function controlAura(sourceId: number): Aura {
  return {
    id: CONTROL_AURA_ID,
    name: 'Test Rejuvenation',
    kind: 'hot',
    remaining: 600,
    duration: 600,
    value: 5,
    sourceId,
    school: 'nature',
  };
}

function rig(): { sim: Sim; p: Entity; events: Ev[] } {
  const sim = new Sim({
    seed: 5,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const events: Ev[] = [];
  const emitter = sim as unknown as { emit(e: Ev): void };
  const original = emitter.emit.bind(sim);
  emitter.emit = (e: Ev) => {
    events.push(e);
    original(e);
  };
  return { sim, p, events };
}

/** A marked player also carrying the ordinary control aura. */
function marked(): { sim: Sim; p: Entity; events: Ev[] } {
  const r = rig();
  r.sim.setCheaterMark(MARK_SECONDS);
  r.p.auras.push(controlAura(r.p.id));
  expect(markAura(r.p)).toBeDefined();
  return r;
}

const markAura = (e: Entity): Aura | undefined =>
  e.auras.find((a) => a.id === CHEATER_MARK_AURA_ID);
const hasControl = (e: Entity): boolean => e.auras.some((a) => a.id === CONTROL_AURA_ID);

describe('Cheater mark: survives every wipe a player can trigger', () => {
  it('survives death, spirit release, and the corpse resurrection, partial budget intact', () => {
    const { sim, p } = marked();
    // Burn 2s alive first so the surviving value is a PARTIAL budget: a
    // regression that re-stamps a fresh full-duration mark on respawn would
    // pass a pristine-value comparison but not this one.
    for (let i = 0; i < 40; i++) sim.tick();
    const remaining = markAura(p)?.remaining ?? 0;
    expect(remaining).toBeCloseTo(MARK_SECONDS - 2, 5);

    sim.ctx.handleDeath(p, null);
    expect(p.dead).toBe(true);
    expect(hasControl(p)).toBe(false); // the control: the death wipe really ran
    expect(markAura(p)?.remaining).toBe(remaining);

    p.auras.push(controlAura(p.id)); // fresh control for the NEXT wipe stage
    sim.releaseSpirit();
    expect(p.ghost).toBe(true);
    expect(hasControl(p)).toBe(false); // the control: the release wipe really ran
    expect(markAura(p)?.remaining).toBe(remaining);

    // Walk the ghost onto its corpse and revive there (the penalty-free path).
    const corpse = { ...(p.corpsePos as { x: number; y: number; z: number }) };
    p.pos = { x: corpse.x, y: corpse.y, z: corpse.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    p.auras.push(controlAura(p.id)); // fresh control for the revive stage
    sim.resurrectAtCorpse();

    expect(p.dead).toBe(false);
    expect(hasControl(p)).toBe(false); // the control: the revive filter really ran
    expect(markAura(p)?.remaining).toBe(remaining);
    // The wire flag rides through untouched: nearby clients keep rendering the tag.
    expect(p.cheaterMark).toBe(true);
  });

  it('survives the Spirit Healer resurrection too', () => {
    const { sim, p } = marked();
    sim.ctx.handleDeath(p, null);
    sim.releaseSpirit();
    p.auras.push(controlAura(p.id)); // the control: the healer filter must wipe it
    expect(sim.resurrectAtSpiritHealer()).toBe(true);

    expect(p.dead).toBe(false);
    expect(hasControl(p)).toBe(false);
    expect(markAura(p)?.remaining).toBe(MARK_SECONDS);
    expect(p.cheaterMark).toBe(true);
  });

  it('survives arena entry, which strips even the recovery sicknesses', () => {
    const { sim, p } = marked();

    readyArenaFighter(sim.ctx, p, { clearPrep: true });

    expect(hasControl(p)).toBe(false); // the control: the clean slate really ran
    expect(markAura(p)?.remaining).toBe(MARK_SECONDS);
    expect(p.cheaterMark).toBe(true);
  });

  it('survives a Fiesta down', () => {
    const { sim, p } = marked();

    fiestaDownEntity(sim.ctx, p, null);

    expect(p.dead).toBe(true);
    expect(hasControl(p)).toBe(false); // the control: the clean slate really ran
    expect(markAura(p)?.remaining).toBe(MARK_SECONDS);
    expect(p.cheaterMark).toBe(true);
  });

  it('survives an arena entry taken while dead in the same match', () => {
    // Fiesta respawns route through readyArenaFighter, so the down-then-ready
    // pair is the real in-match sequence, not two independent events.
    const { sim, p } = marked();

    fiestaDownEntity(sim.ctx, p, null);
    p.auras.push(controlAura(p.id)); // the control: the ready wipe must strip it
    readyArenaFighter(sim.ctx, p, { clearPrep: true });

    expect(p.dead).toBe(false);
    expect(hasControl(p)).toBe(false);
    expect(markAura(p)?.remaining).toBe(MARK_SECONDS);
    expect(p.cheaterMark).toBe(true);
  });
});

describe('Cheater mark: the three ways it legitimately ends', () => {
  it('clears the wire flag when the budget burns to zero on its own', () => {
    // The aura IS the countdown, so natural expiry is the moment the sanction is
    // served. Before the expiry hook the aura faded but the flag stayed set, and
    // every nearby client kept rendering the tag forever.
    const { sim, p } = rig();
    sim.setCheaterMark(2);
    expect(p.cheaterMark).toBe(true);

    for (let i = 0; i < 45; i++) sim.tick(); // 2.25s of sim time at 20 Hz

    expect(markAura(p)).toBeUndefined();
    expect(p.cheaterMark).toBeUndefined();
  });

  it('pauses while dead, so a parked corpse serves no sanction time', () => {
    // updateAuras returns early for a dead entity, so no aura's remaining
    // decrements while the wearer is a corpse or a ghost. That is deliberate and
    // matches the recovery sicknesses: the point of the tag is being WORN in
    // front of other players, which a parked corpse is not doing. It also means
    // the aura clock is the ALIVE-in-world clock, not raw /played, which is what
    // src/sim/moderation/CLAUDE.md now says.
    const { sim, p } = rig();
    sim.setCheaterMark(600);
    sim.ctx.handleDeath(p, null);
    const atDeath = markAura(p)?.remaining;
    expect(atDeath).toBe(600);

    for (let i = 0; i < 40; i++) sim.tick(); // 2s of sim time spent dead

    expect(markAura(p)?.remaining).toBe(atDeath);
    expect(p.cheaterMark).toBe(true);
  });

  it('does not clear the flag early, while budget remains', () => {
    const { sim, p } = rig();
    sim.setCheaterMark(10);

    for (let i = 0; i < 40; i++) sim.tick(); // 2s of a 10s sanction

    expect(markAura(p)).toBeDefined();
    // Exactly 2 seconds burned: one alive second of sim time IS one second of
    // the sanction, the design claim the module docs stake out. A half-rate or
    // double-rate burn fails here, not just a wildly wrong one.
    expect(markAura(p)?.remaining).toBeCloseTo(8, 5);
    expect(p.cheaterMark).toBe(true);
  });

  it('an operator lift removes the aura AND emits the fade every removal emits', () => {
    // Without the fade the tag simply vanished from the client with no
    // combat-log trace, and no parse could tell a lift from a disconnect.
    const { sim, p, events } = marked();
    const wornName = markAura(p)?.name;
    events.length = 0;

    sim.setCheaterMark(0);

    expect(markAura(p)).toBeUndefined();
    expect(p.cheaterMark).toBeUndefined(); // absent-when-empty, never `false`
    const fade = events.find(
      (e) => e.type === 'aura' && e.gained === false && e.abilityId === CHEATER_MARK_AURA_ID,
    );
    expect(fade).toBeDefined();
    expect(fade?.name).toBe(wornName);
    // The control aura is untouched: a lift removes the mark, not the bar.
    expect(hasControl(p)).toBe(true);
  });

  it('a lift on an unmarked player is a silent no-op', () => {
    const { sim, p, events } = rig();
    // Positive control first: prove the capture rig is live, so the silence
    // assertion below cannot pass because the hook simply stopped recording.
    sim.setCheaterMark(MARK_SECONDS);
    expect(events.some((e) => e.type === 'aura' && e.gained === true)).toBe(true);
    sim.setCheaterMark(0);
    events.length = 0;

    sim.setCheaterMark(0);

    expect(p.cheaterMark).toBeUndefined();
    expect(events.some((e) => e.type === 'aura')).toBe(false);
  });
});

describe('Cheater mark: the wire flag tracks the aura, never the intent', () => {
  it('sets the flag only because the aura actually landed', () => {
    // setCheaterMark reads the flag back off e.auras rather than assuming the
    // apply succeeded. No applyAura guard can refuse this aura today, but a flag
    // set on intent would survive one of them widening, and a tag with no aura
    // has no countdown to expire: only an operator lift could ever clear it.
    const { sim, p } = rig();

    sim.setCheaterMark(MARK_SECONDS);

    expect(markAura(p)).toBeDefined();
    expect(p.cheaterMark).toBe(true);
  });

  it('leaves an absent flag absent on a garbage budget', () => {
    const { sim, p } = rig();

    sim.setCheaterMark(Number.NaN); // garbage budget: a no-op, never a lift

    expect(markAura(p)).toBeUndefined();
    expect(p.cheaterMark).toBeUndefined();
  });

  it('a garbage budget never lifts a LIVE mark', () => {
    // normalize collapses NaN to 0 and 0 is the lift arm, so without the
    // non-finite guard a corrupt operator form, wire payload, or null column
    // would silently end a live sanction. Only an explicit finite 0 lifts.
    const { sim, p } = marked();
    const remaining = markAura(p)?.remaining;

    sim.setCheaterMark(Number.NaN);

    expect(markAura(p)?.remaining).toBe(remaining);
    expect(p.cheaterMark).toBe(true);
  });
});

describe('Cheater mark: re-applying replaces the budget, never stacks', () => {
  it('a shortened sanction takes effect immediately', () => {
    const { sim, p } = marked();

    sim.setCheaterMark(600);

    const live = p.auras.filter((a) => a.id === CHEATER_MARK_AURA_ID);
    expect(live).toHaveLength(1);
    expect(live[0].remaining).toBe(600);
    expect(live[0].duration).toBe(600);
    expect(p.cheaterMark).toBe(true);
  });

  it('an extended sanction takes effect immediately', () => {
    const { sim, p } = marked();

    sim.setCheaterMark(MARK_SECONDS * 2);

    const live = p.auras.filter((a) => a.id === CHEATER_MARK_AURA_ID);
    expect(live).toHaveLength(1);
    expect(live[0].remaining).toBe(MARK_SECONDS * 2);
  });

  it('reports the re-apply as a refresh, the ordinary applyAura semantics', () => {
    // The re-apply arm used to splice the live aura out first, which hid the
    // refresh from applyAura and made every operator edit read as a fresh
    // application in a parse.
    const { sim, p, events } = marked();
    events.length = 0;

    sim.setCheaterMark(600);

    const gained = events.filter(
      (e) => e.type === 'aura' && e.gained === true && e.abilityId === CHEATER_MARK_AURA_ID,
    );
    expect(gained).toHaveLength(1);
    expect(gained[0].refresh).toBe(true);
    // A refresh displaces silently: no stray fade for the aura it replaced.
    expect(
      events.some(
        (e) => e.type === 'aura' && e.gained === false && e.abilityId === CHEATER_MARK_AURA_ID,
      ),
    ).toBe(false);
    expect(p.auras.filter((a) => a.id === CHEATER_MARK_AURA_ID)).toHaveLength(1);
  });

  it('a re-apply after several wipes still leaves exactly one mark', () => {
    const { sim, p } = marked();

    sim.ctx.handleDeath(p, null);
    readyArenaFighter(sim.ctx, p, { clearPrep: true });
    sim.setCheaterMark(900);

    expect(p.auras.filter((a) => a.id === CHEATER_MARK_AURA_ID)).toHaveLength(1);
    expect(markAura(p)?.remaining).toBe(900);
  });
});
