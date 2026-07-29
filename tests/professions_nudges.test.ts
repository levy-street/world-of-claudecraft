import { describe, expect, it } from 'vitest';
import { NUDGE_CADENCE_TICKS } from '../src/sim/professions/cadence';
import { maybeEmitTierTutorial, maybeEmitTrendNudge } from '../src/sim/professions/prof_nudges';
import { classifyCraftTrend } from '../src/sim/professions/trend';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { SimEvent } from '../src/sim/types';

const TREND_PAIR = 'weaponcrafting+armorcrafting';

function makeSim(seed = 3120): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

/** A mock ctx exposing only what the nudge helpers read: a mutable tickCount and
 *  an emit recorder. */
function nudgeCtx() {
  const emitted: SimEvent[] = [];
  const raw = { tickCount: 0, emit: (e: SimEvent) => emitted.push(e) };
  return { ctx: raw as unknown as SimContext, emitted, raw };
}

describe('trend nudge (Professions 2.0)', () => {
  it('emits at most once per NUDGE_CADENCE_TICKS across a tick loop', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.craftSkills.weaponcrafting = 10; // a leaning trend BELOW the crossing threshold
    const { ctx, emitted, raw } = nudgeCtx();

    let emits = 0;
    for (let t = 0; t <= NUDGE_CADENCE_TICKS; t++) {
      raw.tickCount = t;
      if (maybeEmitTrendNudge(meta, ctx)) emits++;
    }
    // One at t=0 (window opens), one at t=NUDGE_CADENCE_TICKS (window reopens).
    expect(emits).toBe(2);
    expect(emitted[0]).toEqual({ type: 'profTrendNudge', pid: sim.playerId, pairId: TREND_PAIR });
  });

  it('reopens exactly AT the expiry tick, never one tick before', () => {
    // The boundary the window turns on: armed at t=0 to 0 + NUDGE_CADENCE_TICKS,
    // so it is still blocked at expiry-1 and reopens exactly AT expiry. Ticks are
    // driven directly TO the boundary (not merely swept past it), so an off-by-one
    // in isCadenceBlocked's strict comparison reds this.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.craftSkills.weaponcrafting = 10;
    const { ctx, raw } = nudgeCtx();
    raw.tickCount = 0;
    expect(maybeEmitTrendNudge(meta, ctx)).toBe(true); // window opens
    raw.tickCount = NUDGE_CADENCE_TICKS - 1; // one tick before expiry
    expect(maybeEmitTrendNudge(meta, ctx)).toBe(false); // still blocked
    raw.tickCount = NUDGE_CADENCE_TICKS; // AT expiry
    expect(maybeEmitTrendNudge(meta, ctx)).toBe(true); // reopens
  });

  it('fires below the Guild letter crossing threshold (it is the lighter hint)', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.craftSkills.weaponcrafting = 10; // score 10 < 25, so trend.crossed is false
    const { ctx, emitted } = nudgeCtx();
    expect(maybeEmitTrendNudge(meta, ctx)).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it('also fires ABOVE the Guild letter crossing threshold (deliberate lower-bar semantics)', () => {
    // The nudge fires for ANY non-null classifyCraftTrend, crossed or not: it is
    // a hint below AND above the letter threshold, while the Guild letter keeps
    // its own one-shot crossing semantics. A future !crossed guard here must be
    // a deliberate re-pin of this contract, not a drive-by tightening.
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.craftSkills.weaponcrafting = 60; // score 60 >= 25: the letter threshold is crossed
    expect(classifyCraftTrend(meta.craftSkills)?.crossed).toBe(true);
    const { ctx, emitted } = nudgeCtx();
    expect(maybeEmitTrendNudge(meta, ctx)).toBe(true);
    expect(emitted).toEqual([{ type: 'profTrendNudge', pid: sim.playerId, pairId: TREND_PAIR }]);
  });

  it('does not fire for an attuned character, an amends-history character, or a fresh one', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    meta.craftSkills.weaponcrafting = 10;

    // Attuned: activeArchetype set.
    meta.archetype.activeArchetype = 'weaponcrafting';
    meta.archetype.pairedMajor = 'armorcrafting';
    const attuned = nudgeCtx();
    expect(maybeEmitTrendNudge(meta, attuned.ctx)).toBe(false);

    // Attunement history but no active pair (an amends-state character).
    meta.archetype.activeArchetype = null;
    meta.archetype.pairedMajor = null;
    meta.archetype.attunedPairs = [TREND_PAIR];
    const history = nudgeCtx();
    expect(maybeEmitTrendNudge(meta, history.ctx)).toBe(false);

    // Fresh crafter with no craft skill at all: classifyCraftTrend is null.
    meta.archetype.attunedPairs = [];
    for (const craft of Object.keys(meta.craftSkills)) meta.craftSkills[craft] = 0;
    const fresh = nudgeCtx();
    expect(maybeEmitTrendNudge(meta, fresh.ctx)).toBe(false);
  });
});

describe('first-tier tutorial one-shot (Professions 2.0)', () => {
  it('emits exactly once ever, the first time a craft crosses tier 1', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    const below = nudgeCtx();
    meta.craftSkills.engineering = 24; // still tier 0
    expect(maybeEmitTierTutorial(meta, below.ctx)).toBe(false);
    expect(below.emitted).toEqual([]);

    meta.craftSkills.engineering = 25; // tier 1
    const first = nudgeCtx();
    expect(maybeEmitTierTutorial(meta, first.ctx)).toBe(true);
    expect(first.emitted).toEqual([{ type: 'profTierTutorial', pid: sim.playerId }]);
    expect(meta.profTierTutorialSent).toBe(true);

    // Never again, even at a much higher tier.
    meta.craftSkills.engineering = 100;
    const second = nudgeCtx();
    expect(maybeEmitTierTutorial(meta, second.ctx)).toBe(false);
    expect(second.emitted).toEqual([]);
  });

  it('does not re-fire across save/load, and omits the flag while unset', () => {
    const sim = makeSim();
    const meta = sim.players.get(sim.playerId)!;
    // Unset: serialized shape omits the flag entirely (zero-default omission).
    const bare = sim.serializeCharacter(sim.playerId);
    expect(bare && 'profTierTutorialSent' in bare).toBe(false);

    meta.craftSkills.tailoring = 25;
    maybeEmitTierTutorial(meta, nudgeCtx().ctx); // fires, flips the flag
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.profTierTutorialSent).toBe(true);

    const reloaded = makeSim(3121);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });
    const reloadedMeta = reloaded.players.get(pid)!;
    expect(reloadedMeta.profTierTutorialSent).toBe(true);
    const afterLoad = nudgeCtx();
    expect(maybeEmitTierTutorial(reloadedMeta, afterLoad.ctx)).toBe(false);
    expect(afterLoad.emitted).toEqual([]);
  });
});

describe('nudge sweep determinism (Professions 2.0)', () => {
  it('two same-seed sims run the sweep identically', () => {
    const run = () => {
      const sim = makeSim(9001);
      const meta = sim.players.get(sim.playerId)!;
      meta.craftSkills.weaponcrafting = 30; // tier 1: fires BOTH the tutorial and a nudge
      const events: SimEvent[] = [];
      for (let i = 0; i < 20; i++) {
        for (const ev of sim.tick()) {
          if (ev.type === 'profTrendNudge' || ev.type === 'profTierTutorial') events.push(ev);
        }
      }
      return { events, save: sim.serializeCharacter(sim.playerId) };
    };
    const first = run();
    // Decisive anchor: the sweep actually fired both nudge events this window.
    expect(first.events.map((e) => e.type).sort()).toEqual(['profTierTutorial', 'profTrendNudge']);
    expect(run()).toEqual(first);
  });
});
