// Well Fed buff dishes (farming Phase 11): the completion-time mint in
// src/sim/wellfed.ts, hooked from the eat/drink loop in updateRegen
// (src/sim/combat/auras.ts). A real Sim is driven through real ticks (the
// elixir.test.ts construction and use-item idiom): the buff lands only when
// the 18s sit-restore COMPLETES, an interrupted meal forfeits it, the
// wellfed_<kind> namespace coexists with elixir_<kind> in both orders, all
// dishes share one aura id (last eaten wins, no self-stacking), the mint
// draws zero rng, and the aura is transient across save/load.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { applyWellfedOnConsumeComplete } from '../src/sim/wellfed';

function playerWorld(seed = 42) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Aleph');
  sim.tick();
  const p = sim.entities.get(pid)! as Entity;
  return { sim, pid, p };
}

function consume(sim: Sim, pid: number, itemId: string): void {
  sim.addItem(itemId, 1, pid);
  sim.useItem(itemId, pid);
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) sim.tick();
}

function wellfedAuras(p: Entity): Aura[] {
  return p.auras.filter((a) => a.id.startsWith('wellfed_'));
}

// Eat a dish and ride out the full sit-restore: 18s of meal plus regen-tick
// alignment slack (the 2s classic tick fires on tickCount % 40 === 0).
function eatToCompletion(sim: Sim, pid: number, p: Entity, itemId: string): void {
  consume(sim, pid, itemId);
  tickSeconds(sim, 22);
  expect(p.eating, `${itemId} meal completed`).toBeNull();
}

describe('well fed: completion timing', () => {
  it('mints the aura only when the 18s sit-restore completes, never mid-meal', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');

    tickSeconds(sim, 5);
    expect(p.eating, 'still mid-meal at 5s').toBeTruthy();
    expect(wellfedAuras(p), 'no buff on the first bite').toEqual([]);

    tickSeconds(sim, 17); // 22s total: past 18s plus regen-tick alignment
    expect(p.eating, 'meal finished').toBeNull();
    const wf = wellfedAuras(p);
    expect(wf.length).toBe(1);
    expect(wf[0].id).toBe('wellfed_buff_sta');
    expect(wf[0].name).toBe('Well Fed');
    expect(wf[0].kind).toBe('buff_sta');
    expect(wf[0].value).toBe(3);
    expect(wf[0].duration).toBe(600);
  });

  it('the 18s boundary: still no mint at 17s in, minted by 19s', () => {
    // playerWorld ticks once, so the consume starts at tickCount 1 and the
    // 2s regen boundaries land at ticks 40, 80, ... 360: eight boundaries
    // have fired by 17s (remaining 2, meal in flight, no aura) and the
    // ninth (18s) is the completion. Pins the CONSUME_DURATION scale the
    // 5s/22s arms cannot see: a meal that completed early would mint here.
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');
    tickSeconds(sim, 17);
    expect(p.eating, 'still eating at 17s').toBeTruthy();
    expect(wellfedAuras(p), 'no aura at 17s').toEqual([]);
    tickSeconds(sim, 2);
    expect(p.eating, 'meal ended at the 18s boundary').toBeNull();
    expect(wellfedAuras(p)).toHaveLength(1);
  });

  it('a plain dish (no wellfed field) completes with no aura minted', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'vale_hearth_loaf');
    expect(wellfedAuras(p)).toEqual([]);
  });

  it('the food-kind guard: a drink-slot completion never mints, even for a wellfed item', () => {
    // No shipped drink carries a wellfed field, so the guard is exercised by
    // calling the completion hook directly with a synthetic drink-kind slot
    // pointing at a REAL wellfed dish: the D15 food-only contract, pinned.
    const { sim, p } = playerWorld();
    applyWellfedOnConsumeComplete(sim.ctx, p, {
      itemId: 'eastbrook_glazed_carrots',
      kind: 'drink',
      hpPer2s: 0,
      manaPer2s: 10,
      remaining: 0,
      ticksElapsed: 9,
    });
    expect(wellfedAuras(p), 'the drink slot must not mint').toEqual([]);
    // The same slot as food DOES mint: the guard is the only difference.
    applyWellfedOnConsumeComplete(sim.ctx, p, {
      itemId: 'eastbrook_glazed_carrots',
      kind: 'food',
      hpPer2s: 10,
      manaPer2s: 0,
      remaining: 0,
      ticksElapsed: 9,
    });
    expect(wellfedAuras(p)).toHaveLength(1);
  });

  it('content rule: every wellfed carrier in the merged catalog is kind food', () => {
    // The type allows wellfed on any BaseItemDef; the D15 contract keeps it
    // on food. This sweep makes a future non-food carrier a deliberate,
    // visible decision instead of a silent gulp-completion mint.
    const carriers = Object.values(ITEMS).filter((def) => def.wellfed !== undefined);
    expect(carriers.length, 'the four Phase 11 buff dishes').toBeGreaterThanOrEqual(4);
    for (const def of carriers) {
      expect(def.kind, `${def.id} carries wellfed but is not food`).toBe('food');
    }
  });
});

describe('well fed: interruption forfeits the buff', () => {
  it('damage mid-meal cancels eating and no aura ever appears', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');
    tickSeconds(sim, 5);
    expect(p.eating, 'mid-meal before the hit').toBeTruthy();

    sim.ctx.dealDamage(null, p, 5, false, 'physical', null, 'hit');
    expect(p.eating, 'the hit cancels the meal').toBeNull();

    tickSeconds(sim, 20); // well past where 18s would have landed
    expect(wellfedAuras(p), 'the forfeited meal never pays out').toEqual([]);
  });

  it('the killing blow clears the meal and the buff is forfeited for good', () => {
    // SCOPE, stated honestly (the joint-coverage rule): lethal damage
    // routes through the shared consuming-interrupt clear in
    // src/sim/combat/damage.ts BEFORE the death-reset block's own
    // belt-and-braces clear, so this arm pins the joint OUTCOME (no meal
    // survives the killing blow, and nothing mints through 30s of
    // dead-state ticks), not the death-reset site specifically: a
    // diagnostic mutant deleting the death block's eating clear survives
    // this suite because the interrupt site already covers it. The
    // posthumous-quiet window below is the coverage the alive-interrupt
    // arm above cannot give.
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots');
    tickSeconds(sim, 5);
    expect(p.eating, 'mid-meal before the killing blow').toBeTruthy();

    sim.ctx.dealDamage(null, p, 1_000_000, false, 'physical', null, 'hit');
    expect(p.dead, 'the hit was lethal').toBe(true);
    expect(p.eating, 'the killing blow cleared the meal').toBeNull();

    // Far past every boundary the meal could have reached, through death
    // and any respawn handling: the mint must never land posthumously.
    tickSeconds(sim, 30);
    expect(wellfedAuras(p), 'no posthumous mint').toEqual([]);
  });

  it('a second dish mid-meal is refused outright, never a restart', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'eastbrook_glazed_carrots'); // dish A
    tickSeconds(sim, 5);
    expect(p.eating?.itemId).toBe('eastbrook_glazed_carrots');
    const remainingBefore = p.eating?.remaining;

    sim.addItem('fenbridge_rice_pudding', 1, pid); // dish B
    sim.useItem('fenbridge_rice_pudding', pid);
    // The already-eating guard (src/sim/items.ts, #2565) refuses B before
    // anything is spent: the slot keeps A (same item, timer untouched) and
    // B stays in the bag.
    expect(p.eating?.itemId).toBe('eastbrook_glazed_carrots');
    expect(p.eating?.remaining).toBe(remainingBefore);
    expect(sim.countItem('fenbridge_rice_pudding', pid)).toBe(1);

    // A's meal completes on A's own clock and mints A's aura, exactly one.
    tickSeconds(sim, 17);
    expect(p.eating).toBeNull();
    const wf = wellfedAuras(p);
    expect(wf).toHaveLength(1);
    expect(wf[0].value).toBe(3); // A's value, never B's 6
  });
});

describe('well fed: namespace isolation from elixirs (both orders)', () => {
  it('eat then quaff: wellfed_buff_sta and elixir_buff_sta coexist untouched', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    consume(sim, pid, 'elixir_of_the_boar');

    const wf = p.auras.find((a) => a.id === 'wellfed_buff_sta');
    const elx = p.auras.find((a) => a.id === 'elixir_buff_sta');
    expect(wf, 'food buff survives the quaff').toBeTruthy();
    expect(wf!.value).toBe(3);
    expect(elx, 'elixir landed beside it').toBeTruthy();
    expect(elx!.value).toBe(6);
  });

  it('quaff then eat: the elixir survives the meal completing', () => {
    const { sim, pid, p } = playerWorld();
    consume(sim, pid, 'elixir_of_the_boar');
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');

    const wf = p.auras.find((a) => a.id === 'wellfed_buff_sta');
    const elx = p.auras.find((a) => a.id === 'elixir_buff_sta');
    expect(wf, 'food buff landed').toBeTruthy();
    expect(wf!.value).toBe(3);
    expect(elx, 'elixir intact after the meal').toBeTruthy();
    expect(elx!.value).toBe(6);
  });
});

describe('well fed: last eaten wins (one shared aura id)', () => {
  it('a better dish overwrites: exactly one wellfed aura, the new value', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    expect(wellfedAuras(p).length).toBe(1);
    expect(wellfedAuras(p)[0].value).toBe(3);

    eatToCompletion(sim, pid, p, 'fenbridge_rice_pudding');
    const wf = wellfedAuras(p);
    expect(wf.length, 'food buffs never stack with each other').toBe(1);
    expect(wf[0].value).toBe(6);
  });

  it('re-eating the same dish refreshes remaining to full duration', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'fenbridge_rice_pudding');
    tickSeconds(sim, 30);
    const before = wellfedAuras(p)[0].remaining;
    expect(before).toBeLessThan(880); // decayed well below full (900)

    eatToCompletion(sim, pid, p, 'fenbridge_rice_pudding');
    const wf = wellfedAuras(p);
    expect(wf.length, 'still exactly one wellfed aura').toBe(1);
    expect(wf[0].remaining).toBeGreaterThan(before);
    expect(wf[0].remaining).toBeGreaterThan(890); // fresh 900 minus tick slack
  });
});

describe('well fed: duration ticks down and the aura expires', () => {
  it('remaining decreases with real ticks and the expiry path removes it', () => {
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    const first = wellfedAuras(p)[0].remaining;

    tickSeconds(sim, 10);
    const later = wellfedAuras(p)[0].remaining;
    expect(later).toBeLessThan(first);
    expect(first - later).toBeGreaterThan(8); // roughly the 10s that passed

    // Riding out the full 600s is thousands of ticks; the generic expiry walk
    // in updateAuras is what removes it, so drop remaining to the brink and
    // let real ticks finish the job.
    wellfedAuras(p)[0].remaining = 0.5;
    tickSeconds(sim, 2);
    expect(wellfedAuras(p), 'expired aura removed').toEqual([]);
  });
});

describe('well fed: transient across save and load', () => {
  it('a live aura does not survive the serializeCharacter round trip', () => {
    // Auras are transient by design: no persistence path serializes entity
    // auras (serializeCharacter carries no auras key, only the two dedicated
    // sickness timers), so a relog drops the buff like any temporary aura.
    const { sim, pid, p } = playerWorld();
    eatToCompletion(sim, pid, p, 'eastbrook_glazed_carrots');
    expect(wellfedAuras(p).length).toBe(1);

    const state = sim.serializeCharacter(pid)!;
    expect(state).toBeTruthy();
    expect('auras' in (state as unknown as Record<string, unknown>)).toBe(false);

    const sim2 = new Sim({ seed: 43, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Restored', { state });
    sim2.tick();
    const p2 = sim2.entities.get(pid2)! as Entity;
    expect(wellfedAuras(p2), 'buff gone after the round trip').toEqual([]);
  });
});

describe('well fed: the mint draws zero rng', () => {
  // The professions_farming.test.ts draw-observer idiom, twinned: two sims
  // from one seed run the identical eat sequence, one with the buff dish and
  // one with a plain dish of the SAME foodHp (90). If the wellfed mint drew
  // even one rng value, the recorded draw streams would diverge in count or
  // value; identical streams prove the mint adds zero draws.
  function recordEatSequence(itemId: string): { draws: number[]; p: Entity } {
    const { sim, pid, p } = playerWorld(4242);
    const draws: number[] = [];
    sim.rng.setObserver((value: number) => {
      draws.push(value);
    });
    try {
      consume(sim, pid, itemId);
      tickSeconds(sim, 22);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(p.eating).toBeNull();
    return { draws, p };
  }

  it('the eat-plus-completion draw stream matches a plain meal exactly', () => {
    const buffed = recordEatSequence('eastbrook_glazed_carrots');
    const plain = recordEatSequence('vale_hearth_loaf');

    // Non-vacuity: the buffed run really minted, the plain run really did not.
    expect(wellfedAuras(buffed.p).length).toBe(1);
    expect(wellfedAuras(plain.p)).toEqual([]);
    // Non-vacuity of the RIG: the observer really recorded a stream (an
    // unwired observer would leave both runs empty-equal and prove nothing),
    // and the twin premise holds: same foodHp, so the two meals differ ONLY
    // in the wellfed field.
    expect(buffed.draws.length).toBeGreaterThan(0);
    expect(ITEMS.vale_hearth_loaf.foodHp).toBe(ITEMS.eastbrook_glazed_carrots.foodHp);

    expect(buffed.draws.length).toBe(plain.draws.length);
    expect(buffed.draws).toEqual(plain.draws);
  });
});
