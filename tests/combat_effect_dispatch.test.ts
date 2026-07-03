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
import { MOBS } from '../src/sim/data';
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
