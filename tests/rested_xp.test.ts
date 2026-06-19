// Classic Rested XP (#308): inn-rested pool that doubles kill XP until spent.
//
// Covers accrual while resting in an inn (and only there, out of combat), the
// 1.5-level cap, kill-XP consumption (2x, kills only — not quests), the xp-bar
// rested overlay fraction, and CharacterState persistence round-trip.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { DT, xpForLevel } from '../src/sim/types';
import { PROPS } from '../src/sim/data';
import { xpBarView } from '../src/ui/xp_bar';
import { terrainHeight } from '../src/sim/world';

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

function teleport(sim: Sim, e: any, x: number, z: number) {
  e.pos.x = x; e.pos.z = z; e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

const inn = PROPS.buildings.find((b) => b.kind === 'inn')!;

describe('rested XP — accrual', () => {
  it('accrues while resting inside an inn footprint', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    teleport(sim, sim.player, inn.x, inn.z);
    expect(sim.restedXp).toBe(0);
    for (let i = 0; i < 100; i++) sim.tick();
    // 5% of the level's XP per 8 in-game hours (= 8*60 sim seconds) for 100 ticks.
    const perSecond = (0.05 * xpForLevel(sim.player.level)) / (8 * 60);
    const expected = perSecond * DT * 100;
    expect(sim.restedXp).toBeCloseTo(expected, 4);
    expect(meta.restedXp).toBeGreaterThan(0);
  });

  it('does NOT accrue while standing away from any inn', () => {
    const sim = makeSim();
    teleport(sim, sim.player, -300, 0); // verified clear of inns
    for (let i = 0; i < 100; i++) sim.tick();
    expect(sim.restedXp).toBe(0);
  });

  it('clamps the pool to 1.5 levels of XP', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    teleport(sim, sim.player, inn.x, inn.z);
    meta.restedXp = 999_999_999;
    sim.tick();
    expect(sim.restedXp).toBe(1.5 * xpForLevel(sim.player.level));
  });
});

describe('rested XP — consumption', () => {
  it('doubles kill XP and draws the pool down', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 1000;
    const before = sim.xp;
    sim.grantXp(100, meta, { fromKill: true });
    expect(sim.xp).toBe(before + 200); // 100 base + 100 rested bonus
    expect(meta.restedXp).toBe(900);
  });

  it('caps the bonus at the awarded amount (never more than 2x)', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 30; // less than the award
    const before = sim.xp;
    sim.grantXp(100, meta, { fromKill: true });
    expect(sim.xp).toBe(before + 130);
    expect(meta.restedXp).toBe(0);
  });

  it('keeps lifetime XP integral when consuming fractional rested XP', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 48.00625;

    sim.grantXp(100, meta, { fromKill: true });
    const state = sim.serializeCharacter(sim.playerId)!;

    expect(state.lifetimeXp).toBe(148);
    expect(Number.isInteger(state.lifetimeXp)).toBe(true);
    expect(() => BigInt(String(state.lifetimeXp))).not.toThrow();
    expect(meta.restedXp).toBeCloseTo(0.00625, 5);
  });

  it('does NOT consume rested XP for non-kill awards (e.g. quests)', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 1000;
    const before = sim.xp;
    sim.grantXp(100, meta); // no fromKill → quest-style award
    expect(sim.xp).toBe(before + 100);
    expect(meta.restedXp).toBe(1000);
  });

  it('emits the rested bonus on the xp event', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 1000;
    const events = sim.tick(); // drain any boot events first
    sim.grantXp(100, meta, { fromKill: true });
    const drained = sim.tick();
    const xpEv = [...events, ...drained].find((e) => e.type === 'xp');
    expect(xpEv).toBeTruthy();
    expect((xpEv as any).rested).toBe(100);
  });
});

describe('rested XP — xp-bar overlay', () => {
  it('reports a rested overlay fraction ahead of the fill', () => {
    const need = xpForLevel(1);
    const view = xpBarView({ level: 1, xp: need * 0.2, lifetimeXp: 0, restedXp: need * 0.3, showOverflow: false });
    expect(view.fillFrac).toBeCloseTo(0.2, 5);
    expect(view.restedFrac).toBeCloseTo(0.3, 5);
  });

  it('clamps the overlay to the end of the bar', () => {
    const need = xpForLevel(1);
    const view = xpBarView({ level: 1, xp: need * 0.8, lifetimeXp: 0, restedXp: need * 0.9, showOverflow: false });
    expect(view.restedFrac).toBeCloseTo(0.2, 5); // 0.8 + 0.9 clamps to 1.0
  });

  it('is zero with no rested pool', () => {
    const view = xpBarView({ level: 1, xp: 10, lifetimeXp: 0, showOverflow: false });
    expect(view.restedFrac).toBe(0);
  });
});

describe('rested XP — persistence', () => {
  it('round-trips restedXp through CharacterState', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    meta.restedXp = 4242;
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.restedXp).toBe(4242);

    const sim2 = new Sim({ seed: 1, playerClass: 'warrior' });
    const pid = sim2.addPlayer('warrior', 'Reloaded', { state });
    expect(sim2.meta(pid)!.restedXp).toBe(4242);
  });
});
