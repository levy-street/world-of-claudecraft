// Direct unit tests for src/sim/combat/effect_dispatch.ts (C4b). These drive the
// EXPORTED runEffects against a real Sim's SimContext (sim.ctx), resolving an
// ability the same way the cast lifecycle does (ctx.resolvedAbility) and calling the
// effect switch directly, independent of the parity golden: a multi-effect cast that
// fans into BOTH a direct hit and a dot in one call, a finisher that consumes combo
// (combo-spend reset after the loop), a ground-AoE on-cast pulse, and a
// determinism/replay assertion. Proves the extracted module is callable and the move
// preserved behavior.

import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

function harness(sim: Sim): TestSim {
  return sim as unknown as TestSim;
}

function makeSim(cls: PlayerClass, level: number): { sim: TestSim; p: Entity; meta: PlayerMeta } {
  const sim = harness(new Sim({ seed: 4242, playerClass: cls, autoEquip: true }));
  sim.setPlayerLevel(level);
  const p = sim.player;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error(`missing player meta for ${p.id}`);
  p.resource = p.maxResource;
  return { sim, p, meta };
}

// An idle hostile target in range + faced, so an offensive ability resolves + lands.
function spawnTarget(sim: TestSim, p: Entity, level = 1, dz = 4): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = 50000;
  mob.hp = 50000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

// Resolve an ability the way the cast lifecycle does; throw (narrowing null away) so
// a content change that stops the ability resolving fails loudly instead of silently.
function resolve(sim: TestSim, abilityId: string, pid: number): ResolvedAbility {
  const res = sim.ctx.resolvedAbility(abilityId, pid) as ResolvedAbility | null;
  if (!res) throw new Error(`${abilityId} did not resolve`);
  return res;
}

describe('effect_dispatch: a single cast fans into every listed effect', () => {
  it('moonfire applies BOTH a direct hit and a dot aura in one runEffects call', () => {
    const { sim, p, meta } = makeSim('druid', 20);
    const mob = spawnTarget(sim, p);
    const hp0 = mob.hp;
    const res = resolve(sim, 'moonfire', p.id);

    runEffects(sim.ctx, p, meta, mob, res);

    // directDamage effect: the mob took a hit.
    expect(mob.hp).toBeLessThan(hp0);
    // dot effect (same cast): a damage-over-time aura sourced by the druid landed.
    expect(mob.auras.some((a: Aura) => a.kind === 'dot' && a.sourceId === p.id)).toBe(true);
  });

  it('rogue eviscerate: finisherDamage lands AND the combo-spend reset fires after the loop', () => {
    const { sim, p, meta } = makeSim('rogue', 20);
    const mob = spawnTarget(sim, p);
    p.comboPoints = 5; // character-bound: no target anchor needed
    const hp0 = mob.hp;
    const res = resolve(sim, 'eviscerate', p.id);

    runEffects(sim.ctx, p, meta, mob, res);

    expect(mob.hp).toBeLessThan(hp0); // finisherDamage (spentCombo > 0) dealt damage
    expect(p.comboPoints).toBe(0); // spendsCombo reset, AFTER the effect loop
  });

  it('rogue rupture: dot damage scales with combo points spent (bleed finisher, not flat)', () => {
    const dotValueAt = (combo: number): number => {
      const { sim, p, meta } = makeSim('rogue', 20);
      const mob = spawnTarget(sim, p);
      p.comboPoints = combo;
      const res = resolve(sim, 'rupture', p.id);
      runEffects(sim.ctx, p, meta, mob, res);
      const dot = mob.auras.find((a: Aura) => a.kind === 'dot' && a.sourceId === p.id);
      if (!dot) throw new Error('rupture dot did not land');
      return dot.value;
    };

    const at1 = dotValueAt(1);
    const at5 = dotValueAt(5);

    // Rupture is a combo-point finisher (spendsCombo: true); banking to 5 combo
    // points must deal more per-tick damage than spending it at 1, mirroring the
    // repo's other finishers (eviscerate/ferocious_bite finisherDamage,
    // slice_and_dice finisherHaste, kidney_shot finisherStun) that all scale with
    // spentCombo. Before the fix, the 'dot' effect had no perCombo term, so this
    // was flat regardless of combo points banked.
    //
    // Pin the exact tick-value delta rather than a loose greater-than: Rupture's
    // content record is { total: 16, perCombo: 16, duration: 16, interval: 2 },
    // so the DoT coefficient is total + perCombo*spentCombo, spread across
    // duration/interval = 8 ticks. Attack-power scaling (dotSp) is identical at
    // both combo counts (same character, same gear), so it cancels out of the
    // delta: dotBase(1) = round((16+16*1)/8) = 4, dotBase(5) = round((16+16*5)/8)
    // = 12, an exact +8 delta this pin locks in.
    expect(at5 - at1).toBe(8);
  });

  it('druid rip: dot damage scales with combo points spent (bleed finisher, not flat)', () => {
    const dotValueAt = (combo: number): number => {
      const { sim, p, meta } = makeSim('druid', 20);
      const mob = spawnTarget(sim, p);
      p.comboPoints = combo;
      const res = resolve(sim, 'rip', p.id);
      runEffects(sim.ctx, p, meta, mob, res);
      const dot = mob.auras.find((a: Aura) => a.kind === 'dot' && a.sourceId === p.id);
      if (!dot) throw new Error('rip dot did not land');
      return dot.value;
    };

    const at1 = dotValueAt(1);
    const at5 = dotValueAt(5);

    // Rip's content record is { total: 10, perCombo: 10, duration: 12, interval: 2 },
    // 6 ticks. dotBase(1) = round((10+10*1)/6) = 3, dotBase(5) = round((10+10*5)/6)
    // = 10, an exact +7 delta (attack-power scaling cancels out of the delta the
    // same way it does for Rupture above).
    expect(at5 - at1).toBe(7);
  });

  it('rupture and rip: the 5-combo-point payload is UNCHANGED from the old flat totals', () => {
    // The delta pins above lock the SHAPE of the combo scaling but not its
    // absolute magnitude: a retune of total/perCombo that keeps the same 1-to-5
    // delta would slip past them. This is the PR's actual behavioral promise
    // (adding scaling must not change the ability's power at max combo points),
    // so pin the unmodified content coefficients at 5 combo points to literals.
    const dotAt5 = (id: 'rupture' | 'rip') => {
      const eff = ABILITIES[id].effects.find((e) => e.type === 'dot');
      if (!eff || eff.type !== 'dot') throw new Error(`${id} has no dot effect`);
      if (eff.perCombo === undefined) throw new Error(`${id} lost its perCombo term`);
      const total = eff.total + eff.perCombo * 5;
      return { total, perTick: Math.round(total / (eff.duration / eff.interval)) };
    };

    // Rupture was a flat 96 over 16 sec at a 2 sec interval (8 ticks) before the
    // combo term existed; Rip was a flat 60 over 12 sec (6 ticks).
    expect(dotAt5('rupture')).toEqual({ total: 96, perTick: 12 });
    expect(dotAt5('rip')).toEqual({ total: 60, perTick: 10 });
  });

  it('rogue rupture: a melee damage-percent modifier scales BOTH the base total and the perCombo term of the dot', () => {
    // Regression test for the scaleEffect gap the reviewer found on PR #2447: the
    // 'dot' case in scaleEffect (src/sim/content/classes.ts) only scaled `total`,
    // leaving `perCombo` (which carries most of Rupture's damage at high combo
    // points) almost inert against damage modifiers. Assassination's spec
    // baseline (src/sim/content/spec_baselines.ts) grants global.meleeDmgPct:
    // 0.08, a physical-school modifier that must now multiply BOTH total and
    // perCombo through applyTalentMods -> scaleEffect.
    const dotValueAt = (combo: number, spec: string | null): number => {
      const { sim, p, meta } = makeSim('rogue', 20);
      if (spec) sim.setSpec(spec, p.id);
      const mob = spawnTarget(sim, p);
      p.comboPoints = combo;
      const res = resolve(sim, 'rupture', p.id);
      runEffects(sim.ctx, p, meta, mob, res);
      const dot = mob.auras.find((a: Aura) => a.kind === 'dot' && a.sourceId === p.id);
      if (!dot) throw new Error('rupture dot did not land');
      return dot.value;
    };

    const baseAt1 = dotValueAt(1, null);
    const baseAt5 = dotValueAt(5, null);
    const modAt1 = dotValueAt(1, 'assassination');
    const modAt5 = dotValueAt(5, 'assassination');

    // The 5-combo-point payload (where perCombo dominates the total) must be
    // strictly higher under the +8% melee damage modifier.
    expect(modAt5).toBeGreaterThan(baseAt5);
    // The whole payload scales: the delta attributable to perCombo (4 combo
    // points' worth) must ALSO grow under the modifier, not stay flat. Before
    // the fix, scaleEffect's 'dot' case scaled only `total`, so this delta
    // (driven entirely by perCombo) was IDENTICAL with or without meleeDmgPct;
    // this assertion is the direct regression check for that gap.
    expect(modAt5 - modAt1).toBeGreaterThan(baseAt5 - baseAt1);
  });

  it('paladin consecration: the groundAoE case pushes a ground effect and fires the on-cast pulse', () => {
    const { sim, p, meta } = makeSim('paladin', 20);
    const mob = spawnTarget(sim, p, 8, 2); // within the 8yd consecration radius
    const before = sim.ctx.groundAoEs.length;
    mob.aiState = 'chase';
    mob.aggroTargetId = p.id;
    mob.inCombat = true;
    p.inCombat = true;
    mob.leashAnchor = { ...mob.pos, x: mob.pos.x - 10 };
    const anchorBefore = { ...mob.leashAnchor };
    const res = resolve(sim, 'consecration', p.id);

    runEffects(sim.ctx, p, meta, null, res); // consecration is self-centered (no target)

    expect(sim.ctx.groundAoEs.length).toBe(before + 1); // groundAoEs.push happened
    // the immediate on-cast pulse (pulseGroundAoE) hit the in-radius mob.
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(mob.leashAnchor).not.toEqual(anchorBefore);
    expect(mob.leashAnchor.x).toBeCloseTo(mob.pos.x);
    expect(mob.leashAnchor.z).toBeCloseTo(mob.pos.z);

    const anchorAfterCast = { ...mob.leashAnchor };
    mob.pos = { x: mob.pos.x + 3, y: mob.pos.y, z: mob.pos.z };
    sim.ctx.pulseGroundAoE(sim.ctx.groundAoEs[0]);
    expect(mob.leashAnchor.x).toBeCloseTo(anchorAfterCast.x);
    expect(mob.leashAnchor.z).toBeCloseTo(anchorAfterCast.z);
  });
});

describe('effect_dispatch: determinism / replay', () => {
  it('same seed + same multi-effect cast => byte-identical outcome and draw count', () => {
    const run = (): { hp: number; auras: number; draws: number } => {
      const { sim, p, meta } = makeSim('druid', 20);
      const mob = spawnTarget(sim, p);
      const res = resolve(sim, 'moonfire', p.id);
      let draws = 0;
      sim.rng.setObserver(() => {
        draws++;
      });
      runEffects(sim.ctx, p, meta, mob, res);
      sim.rng.setObserver(null);
      return { hp: mob.hp, auras: mob.auras.length, draws };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b); // identical damage, aura state, and rng draw count
    expect(a.draws).toBeGreaterThan(0); // the directDamage range+crit draws actually fired
  });
});
