import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Chain Heal (shaman): implementation adopted from Blaine1705's #1434. Heals the friendly target, then arcs to the most injured
// allies within jump range of the previous hop (players and player pets only),
// never repeating a target, each hop healing half the previous amount. Every
// hop emits a spellfx beam so the green arc renders on every client.

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: unknown): void }).rebucket(e);
}

type BeamEv = Extract<SimEvent, { type: 'spellfx' }>;
type HealEv = Extract<SimEvent, { type: 'heal2' }>;

function castAndCollect(sim: Sim, casterPid: number, targetId: number | null) {
  const caster = sim.entities.get(casterPid);
  if (!caster) throw new Error('missing caster');
  caster.resource = caster.maxResource;
  if (targetId !== null) sim.targetEntity(targetId, casterPid);
  sim.castAbility('chain_heal', casterPid);
  const beams: BeamEv[] = [];
  const heals: HealEv[] = [];
  for (let i = 0; i < 20 * 4; i++) {
    for (const ev of sim.tick()) {
      if (ev.type === 'spellfx' && ev.fx === 'chainHeal') beams.push(ev);
      if (ev.type === 'heal2') heals.push(ev);
    }
  }
  return { beams, heals };
}

function chainSetup() {
  const sim = new Sim({ seed: 42, playerClass: 'shaman', noPlayer: true });
  const caster = sim.addPlayer('shaman', 'Chainer');
  const near = sim.addPlayer('warrior', 'Nearhurt');
  const mid = sim.addPlayer('priest', 'Midhurt');
  const far = sim.addPlayer('mage', 'Faraway');
  // Everyone at 18: the allies' health pools comfortably exceed each hop's heal,
  // so heal2 amounts show the raw falloff instead of the missing-hp clamp.
  sim.setPlayerLevel(18, caster);
  // Chain Heal is the Restoration (Spiritmend) signature: granted on spec pick.
  sim.setSpec('restoration', caster);
  sim.setPlayerLevel(18, near);
  sim.setPlayerLevel(18, mid);
  sim.setPlayerLevel(18, far);
  // Caster at the origin edge of town, allies strung out: near within cast range,
  // mid within one jump of near, far well past any jump.
  teleport(sim, caster, 0, -40);
  teleport(sim, near, 4, -40);
  teleport(sim, mid, 12, -40);
  teleport(sim, far, 60, -40);
  const hurt = (pid: number, frac: number) => {
    const e = sim.entities.get(pid);
    if (!e) throw new Error(`missing ${pid}`);
    e.hp = Math.max(1, Math.round(e.maxHp * frac));
  };
  hurt(near, 0.5);
  hurt(mid, 0.3);
  hurt(far, 0.2);
  return { sim, caster, near, mid, far };
}

describe('chain heal', () => {
  it('arcs caster -> target -> most injured allies, one beam per hop, no repeats', () => {
    const { sim, caster, near, mid, far } = chainSetup();
    const { beams, heals } = castAndCollect(sim, caster, near);

    // Three hops: the cast target, then the injured ally in jump range, then the
    // caster (the only remaining ally near the second hop). The far mage is out
    // of every jump's range and never joins the chain.
    expect(beams.map((b) => [b.sourceId, b.targetId])).toEqual([
      [caster, near],
      [near, mid],
      [mid, caster],
    ]);
    expect(beams.every((b) => b.school === 'nature')).toBe(true);
    expect(heals.map((h) => h.targetId)).toEqual([near, mid, caster]);
    expect(heals.some((h) => h.targetId === far)).toBe(false);

    // Falloff: each hop heals no more than the one before (equality only under a
    // crit multiplier catching a halved base back up); the caster hop is pure
    // overheal (full hp), so its effective amount clamps at 0.
    expect(heals[0].amount).toBeGreaterThan(0);
    expect(heals[1].amount).toBeGreaterThan(0);
    expect(heals[1].amount).toBeLessThanOrEqual(heals[0].amount);
    expect(heals[2].amount).toBeLessThan(heals[0].amount);

    // Exact falloff: both the near (hop 0) and mid (hop 1) hops land raw (hurt enough
    // to avoid the missing-hp clamp), and every hop scales one shared baseAmount by
    // `falloff ** i`, so the crit is common to both and hop 1 is exactly HALF of hop 0
    // (0.5 falloff), never the tooltip's mistaken 40% (a 0.6 ratio) or any other value.
    // Rounding-tolerant to +/-1 since each hop rounds independently.
    expect(Math.abs(heals[1].amount - heals[0].amount / 2)).toBeLessThanOrEqual(1);

    // (The far mage's exact hp is not asserted: out-of-combat regen ticks during
    // the collection window; its exclusion is proven by the beam/heal target lists.)
    const nearEnt = sim.entities.get(near);
    const midEnt = sim.entities.get(mid);
    expect(nearEnt && nearEnt.hp > nearEnt.maxHp * 0.5).toBe(true);
    expect(midEnt && midEnt.hp > midEnt.maxHp * 0.3).toBe(true);
  });

  it('with no ally in range it heals only the target (a single beam)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'shaman' });
    sim.setPlayerLevel(18);
    sim.setSpec('restoration');
    teleport(sim, sim.playerId, 0, -40);
    sim.player.hp = Math.round(sim.player.maxHp * 0.4);
    const before = sim.player.hp;
    // No target selected: a friendly-target cast falls back to the caster.
    const { beams, heals } = castAndCollect(sim, sim.playerId, null);
    expect(beams).toHaveLength(1);
    expect(beams[0]).toMatchObject({
      sourceId: sim.playerId,
      targetId: sim.playerId,
      fx: 'chainHeal',
    });
    expect(heals).toHaveLength(1);
    expect(sim.player.hp).toBeGreaterThan(before);
  });

  it('is replay-deterministic for a fixed seed', () => {
    const run = () => {
      const { sim, caster, near } = chainSetup();
      const { beams, heals } = castAndCollect(sim, caster, near);
      return { beams, heals };
    };
    expect(run()).toEqual(run());
  });
});
