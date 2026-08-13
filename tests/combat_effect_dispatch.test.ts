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

  // The three tests below pinned the PR #2447 model, where BOTH bleeds carried a
  // flat `perCombo` term on the dot effect. The v0.31 rogue and druid overhauls
  // replaced it (owner ruling 2026-07-29): Bleed Out buys MORE TICKS at a fixed
  // value (baseDuration/perComboDuration), Bloodrift buys BIGGER ticks over a
  // fixed window (baseTotal/perComboTotal). The dispatch-level promise is
  // unchanged and still pinned here: a finisher's payload must reward the points
  // it consumes, and a damage modifier must scale the WHOLE payload.
  it('rogue rupture: combo points buy more ticks at a fixed tick value', () => {
    const bleedAt = (combo: number): Aura => {
      const { sim, p, meta } = makeSim('rogue', 20);
      const mob = spawnTarget(sim, p);
      p.comboPoints = combo;
      const res = resolve(sim, 'rupture', p.id);
      runEffects(sim.ctx, p, meta, mob, res);
      const dot = mob.auras.find((a: Aura) => a.kind === 'dot' && a.sourceId === p.id);
      if (!dot) throw new Error('rupture dot did not land');
      return dot;
    };

    const at1 = bleedAt(1);
    const at5 = bleedAt(5);

    // Bleed Out's record is { total: 96, duration: 16, interval: 2,
    // baseDuration: 6, perComboDuration: 2 }: the window is 6 + 2 x points, and
    // the tick value is total / (duration / interval) = 96 / 8 = 12, INDEPENDENT
    // of the spend (attack-power scaling is identical at both, same character).
    expect(at1.duration).toBe(8);
    expect(at5.duration).toBe(16);
    expect(at5.value).toBe(at1.value);
    expect(at5.tickInterval).toBe(2);
    // More ticks at the same value = a strictly larger payload for more points.
    expect(at5.value * (at5.duration / 2)).toBeGreaterThan(at1.value * (at1.duration / 2));
  });

  it('garrote: the direct hit carries abilityId, the bleed ticks never do (no per-tick cue replay)', () => {
    const { sim, p, meta } = makeSim('rogue', 20);
    const mob = spawnTarget(sim, p);
    sim.events.length = 0;
    runEffects(sim.ctx, p, meta, mob, resolve(sim, 'garrote', p.id));

    // The direct hit is the one damage event allowed to carry the stable id.
    const direct = sim.events.filter((ev) => ev.type === 'damage' && ev.amount > 0);
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ abilityId: 'garrote' });

    // The bleed shares the ability id as its aura id, so an id-carrying tick
    // would replay the garrote recording every 3s for 18s
    // (IMPACT_ABILITY_CUES); combat/auras.ts must emit ticks without it.
    sim.events.length = 0;
    const ticks: { abilityId?: string | null }[] = [];
    for (let i = 0; i < 20 * 7; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.ability === 'Throat Wire' && ev.amount > 0) ticks.push(ev);
      }
    }
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) expect(tick.abilityId ?? null).toBeNull();
  });

  it('fearImpact is gated to the Harrow ability id, not to landing an incapacitate', () => {
    // Harrow (ability id 'fear'): the landed fear sounds once at the target.
    const harrow = makeSim('warlock', 20);
    const harrowTarget = spawnTarget(harrow.sim, harrow.p);
    harrow.sim.events.length = 0;
    runEffects(
      harrow.sim.ctx,
      harrow.p,
      harrow.meta,
      harrowTarget,
      resolve(harrow.sim, 'fear', harrow.p.id),
    );
    const fearImpacts = harrow.sim.events.filter(
      (ev) => ev.type === 'spellfx' && ev.fx === 'fearImpact',
    );
    expect(fearImpacts).toHaveLength(1);
    expect(fearImpacts[0]).toMatchObject({ targetId: harrowTarget.id, ability: 'fear' });

    // A plain incapacitate (Gouge) lands its aura but must emit no
    // fearImpact: the emit stays gated to Harrow's ability id. (Morrowlash,
    // the historical fearDr-without-fear-audio counterexample, retired with
    // the warlock three-spec overhaul; its def survives hidden for persisted
    // action bars only.)
    const toss = makeSim('rogue', 20);
    const tossTarget = spawnTarget(toss.sim, toss.p);
    toss.sim.events.length = 0;
    runEffects(toss.sim.ctx, toss.p, toss.meta, tossTarget, resolve(toss.sim, 'gouge', toss.p.id));
    expect(tossTarget.auras.some((a: Aura) => a.kind === 'incapacitate')).toBe(true);
    expect(toss.sim.events.some((ev) => ev.type === 'spellfx' && ev.fx === 'fearImpact')).toBe(
      false,
    );

    // The AoE fear shouts emit fearImpact from the separate aoeFear case
    // (once per creature actually feared), which the Harrow id gate above
    // must not touch. psychic_scream (Terror Canticle) is priest base kit
    // since the overhaul; the old row-8 grant became a cooldown talent.
    const shout = makeSim('priest', 20);
    const shoutTarget = spawnTarget(shout.sim, shout.p);
    shout.sim.events.length = 0;
    runEffects(
      shout.sim.ctx,
      shout.p,
      shout.meta,
      shoutTarget,
      resolve(shout.sim, 'psychic_scream', shout.p.id),
    );
    const shoutImpacts = shout.sim.events.filter(
      (ev) => ev.type === 'spellfx' && ev.fx === 'fearImpact',
    );
    expect(shoutImpacts).toHaveLength(1);
    expect(shoutImpacts[0]).toMatchObject({ targetId: shoutTarget.id, ability: 'psychic_scream' });
  });

  it('druid rip: combo points buy bigger ticks over a fixed window', () => {
    const bleedAt = (combo: number): Aura => {
      const { sim, p, meta } = makeSim('druid', 20);
      const mob = spawnTarget(sim, p);
      p.comboPoints = combo;
      const res = resolve(sim, 'rip', p.id);
      runEffects(sim.ctx, p, meta, mob, res);
      const dot = mob.auras.find((a: Aura) => a.kind === 'dot' && a.sourceId === p.id);
      if (!dot) throw new Error('rip dot did not land');
      return dot;
    };

    const at1 = bleedAt(1);
    const at5 = bleedAt(5);

    // Bloodrift's record is { total: 156, duration: 24, interval: 2,
    // baseTotal: 36, perComboTotal: 24 }: a fixed 24 sec / 12 tick window whose
    // total is 36 + 24 x points, so dotBase(1) = round(60/12) = 5 and
    // dotBase(5) = round(156/12) = 13, an exact +8 delta (attack-power scaling
    // is identical at both spends and cancels out of the delta).
    expect(at1.duration).toBe(24);
    expect(at5.duration).toBe(24);
    expect(at5.value - at1.value).toBe(8);
  });

  it('rupture and rip: the five-point payload matches the authored content totals', () => {
    // The shape pins above do not lock absolute magnitude: a retune that kept the
    // same 1-to-5 relationship would slip past them. Pin the unmodified content
    // coefficients at a five-point spend to literals.
    const rupture = ABILITIES.rupture.effects.find((e) => e.type === 'dot');
    if (rupture?.type !== 'dot') throw new Error('rupture has no dot effect');
    const rip = ABILITIES.rip.effects.find((e) => e.type === 'dot');
    if (rip?.type !== 'dot') throw new Error('rip has no dot effect');

    // Bleed Out: 96 over the full 16 sec window (8 ticks of 12).
    expect({
      window: (rupture.baseDuration ?? 0) + (rupture.perComboDuration ?? 0) * 5,
      total: rupture.total,
      perTick: Math.round(rupture.total / (rupture.duration / rupture.interval)),
    }).toEqual({ window: 16, total: 96, perTick: 12 });

    // Bloodrift: 36 + 24 x 5 = 156 over a fixed 24 sec window (12 ticks of 13).
    expect({
      window: rip.duration,
      total: (rip.baseTotal ?? 0) + (rip.perComboTotal ?? 0) * 5,
      perTick: Math.round(rip.total / (rip.duration / rip.interval)),
    }).toEqual({ window: 24, total: 156, perTick: 13 });
  });

  it('a melee damage-percent modifier scales the WHOLE bleed payload, not just `total`', () => {
    // Regression test for the scaleEffect gap the reviewer found on PR #2447: the
    // 'dot' case in scaleEffect (src/sim/content/classes.ts) scaled only `total`.
    // Under the retuned model that gap is worse for Bloodrift, whose tick value
    // derives from baseTotal + perComboTotal x points and IGNORES `total`, so a
    // total-only scale left the whole ability inert against damage modifiers.
    // Assassination and Feral both grant global.meleeDmgPct in their spec
    // baseline (src/sim/content/spec_baselines.ts), a physical-school modifier
    // that must reach every damage term through applyTalentMods -> scaleEffect.
    const bleedValueAt = (
      cls: 'rogue' | 'druid',
      abilityId: 'rupture' | 'rip',
      combo: number,
      spec: string | null,
    ): number => {
      const { sim, p, meta } = makeSim(cls, 20);
      if (spec) sim.setSpec(spec, p.id);
      const mob = spawnTarget(sim, p);
      p.comboPoints = combo;
      const res = resolve(sim, abilityId, p.id);
      runEffects(sim.ctx, p, meta, mob, res);
      const dot = mob.auras.find((a: Aura) => a.kind === 'dot' && a.sourceId === p.id);
      if (!dot) throw new Error(`${abilityId} dot did not land`);
      return dot.value;
    };

    // Bleed Out carries its whole payload in `total`, so the fixed tick value
    // must rise under the modifier.
    expect(bleedValueAt('rogue', 'rupture', 5, 'assassination')).toBeGreaterThan(
      bleedValueAt('rogue', 'rupture', 5, null),
    );

    // Bloodrift's payload lives entirely in baseTotal + perComboTotal. Both terms
    // must scale: check the one-point spend (baseTotal-dominated) AND the
    // five-point spend (perComboTotal-dominated), so a fix to only one term still
    // fails this.
    expect(bleedValueAt('druid', 'rip', 1, 'feral')).toBeGreaterThan(
      bleedValueAt('druid', 'rip', 1, null),
    );
    const baseSpread =
      bleedValueAt('druid', 'rip', 5, null) - bleedValueAt('druid', 'rip', 1, null);
    const modSpread =
      bleedValueAt('druid', 'rip', 5, 'feral') - bleedValueAt('druid', 'rip', 1, 'feral');
    expect(modSpread).toBeGreaterThan(baseSpread);
  });

  it('paladin consecration: the groundAoE case pushes a ground effect and fires the on-cast pulse', () => {
    const { sim, p, meta } = makeSim('paladin', 20);
    expect(sim.setSpec('protection')).toBe(true);
    const mob = spawnTarget(sim, p, 8, 2); // within the 6 m Consecration radius
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

  it('cleanseMovement preserves encounter-authored unbreakable roots and slows', () => {
    const { sim, p, meta } = makeSim('druid', 20);
    const protectedRoot = {
      id: 'scripted_root',
      name: 'Scripted Root',
      kind: 'root' as const,
      remaining: 30,
      duration: 30,
      value: 0,
      sourceId: 424242,
      school: 'shadow' as const,
      unbreakableControl: true as const,
    };
    const ordinarySlow: Aura = {
      id: 'ordinary_slow',
      name: 'Ordinary Slow',
      kind: 'slow' as const,
      remaining: 30,
      duration: 30,
      value: 0.2,
      sourceId: 424242,
      school: 'shadow',
    };
    p.auras.push(protectedRoot, ordinarySlow);
    const base = resolve(sim, 'rejuvenation', p.id);
    const res: ResolvedAbility = {
      ...base,
      effects: [{ type: 'cleanseMovement' }],
    };

    runEffects(sim.ctx, p, meta, p, res);

    expect(p.auras.some((aura) => aura.id === protectedRoot.id)).toBe(true);
    expect(p.auras.some((aura) => aura.id === ordinarySlow.id)).toBe(false);
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
