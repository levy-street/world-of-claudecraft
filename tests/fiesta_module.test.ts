// Direct unit tests for the moved Fiesta modules (session A3). The pure match
// helpers in src/sim/social/fiesta.ts (fiestaRespawnTime / fiestaPickOffers /
// mergeAugmentMods / createFiestaState seeding) are tested in isolation; the
// ctx-dependent augment + standardize paths are driven DIRECTLY through a real
// Sim's SimContext, proving the slice resolves behind the seam without Sim's thin
// delegates. The offline harness in src/sim/social/fiesta_bots.ts is smoke-tested
// through its own module entry (it also rides the fiesta.test.ts bot suite via the
// Sim delegates).

import { describe, expect, it } from 'vitest';
import { AUGMENTS, AUGMENTS_BY_ID } from '../src/sim/content/augments';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import * as fiesta from '../src/sim/social/fiesta';
import * as fiestaBots from '../src/sim/social/fiesta_bots';

type AnySim = Sim & Record<string, any>;

function makeWorld(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

describe('fiesta module: respawn-time growth', () => {
  it('grows with deaths and bout length, capped at 14s', () => {
    const t1 = fiesta.fiestaRespawnTime(1, 0);
    const t2 = fiesta.fiestaRespawnTime(2, 0);
    const tLate = fiesta.fiestaRespawnTime(2, 120);
    expect(t2).toBeGreaterThan(t1);
    expect(tLate).toBeGreaterThan(t2);
    expect(t1).toBeLessThanOrEqual(14);
    expect(fiesta.fiestaRespawnTime(99, 9999)).toBe(14); // capped
  });
});

describe('fiesta module: deterministic offer draw', () => {
  it('is a stable Fisher-Yates: same seed -> same cards, capped at n, ids from the pool', () => {
    const draw = () => fiesta.fiestaPickOffers(new Rng(123), AUGMENTS, 3);
    expect(draw()).toEqual(draw());
    expect(draw().length).toBe(3);
    expect(fiesta.fiestaPickOffers(new Rng(1), [], 3)).toEqual([]);
    for (const id of draw()) expect(AUGMENTS_BY_ID[id]).toBeTruthy();
  });
});

describe('fiesta module: mergeAugmentMods', () => {
  it('folds an augment effect into a deep clone, never mutating the base', () => {
    const aug = AUGMENTS.find((a) => (a.effect.stats?.crit ?? 0) > 0)!;
    expect(aug).toBeTruthy();
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'A');
    const base = sim.players.get(pid)!.talentMods;
    const baseCrit = base.stats.crit;
    const merged = fiesta.mergeAugmentMods(base, [aug.id]);
    expect(merged.stats.crit).toBeCloseTo(baseCrit + (aug.effect.stats!.crit ?? 0), 6);
    expect(base.stats.crit).toBe(baseCrit); // base untouched (deep clone)
    expect(merged).not.toBe(base);
  });
});

describe('fiesta module: createFiestaState', () => {
  it('seeds a fresh state with the per-match rng deterministic off the sim clock', () => {
    const sim = makeWorld();
    const a = fiesta.createFiestaState(sim.ctx);
    const b = fiesta.createFiestaState(sim.ctx);
    expect(a.scoreA).toBe(0);
    expect(a.scoreLimit).toBe(15);
    expect(a.wave).toBe(0);
    expect(a.ringRadius).toBe(22);
    expect(a.powerupTimer).toBe(12);
    // same tickCount + nextArenaMatchId -> identical per-match draw sequence
    expect([a.rng.next(), a.rng.next()]).toEqual([b.rng.next(), b.rng.next()]);
  });
});

describe('fiesta module: augment application preserves hp fraction', () => {
  it('a +maxHp augment grows the bar instead of healing to full; clear restores', () => {
    const hpAug = AUGMENTS.find((a) => (a.effect.stats?.maxHpPct ?? 0) > 0)!;
    expect(hpAug).toBeTruthy();
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'A');
    const meta = sim.players.get(pid)!;
    const e = sim.entities.get(pid)!;
    e.hp = Math.round(e.maxHp * 0.5);
    const maxBefore = e.maxHp;
    meta.fiestaAugments.push(hpAug.id);
    fiesta.fiestaApplyAugments(meta, e);
    expect(e.maxHp).toBeGreaterThan(maxBefore);
    expect(e.hp / e.maxHp).toBeCloseTo(0.5, 1); // fraction preserved, not a full heal
    expect(meta.fiestaMods).toBeTruthy();
    fiesta.clearFiestaAugments(meta, e);
    expect(meta.fiestaMods).toBeNull();
    expect(meta.fiestaAugments).toEqual([]);
  });
});

describe('fiesta module: standardize / restore round-trip', () => {
  it('forces level 20 then restores the real level/xp/talents', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('mage', 'A');
    sim.setPlayerLevel(8, pid);
    const meta = sim.players.get(pid)!;
    const e = sim.entities.get(pid)!;
    const lvlBefore = e.level;
    const xpBefore = meta.xp;
    fiesta.fiestaStandardize(sim.ctx, meta, e);
    expect(e.level).toBe(20);
    expect(meta.fiestaRestore).toBeTruthy();
    fiesta.fiestaRestoreChar(meta, e);
    expect(e.level).toBe(lvlBefore);
    expect(meta.xp).toBe(xpBefore);
    expect(meta.fiestaRestore).toBeNull();
  });
});

describe('fiesta_bots module: offline harness entry', () => {
  it('spawns three bots through the module entry and tears them down', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' }) as AnySim;
    expect(fiestaBots.startFiestaPractice(sim)).toBe(true);
    expect(sim.fiestaBotPids.length).toBe(3);
    expect(fiestaBots.fiestaPracticeActive(sim)).toBe(true);
    // a per-tick drive does not throw and keeps the set intact
    fiestaBots.updateFiestaBots(sim);
    expect(sim.fiestaBotPids.length).toBe(3);
    fiestaBots.stopFiestaPractice(sim);
    expect(sim.fiestaBotPids.length).toBe(0);
    expect(fiestaBots.fiestaPracticeActive(sim)).toBe(false);
  });
});
