import { describe, expect, it, vi } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { GLOAM_ID, VEILED_EDGE_ID, VEILSTRIKE_ID } from '../src/sim/combat/rogue_engines';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura } from '../src/sim/types';

function setup(spec: string, stealth: boolean, edge = false) {
  const sim = new Sim({
    seed: 42042,
    playerClass: 'rogue',
    autoEquip: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...p.pos, z: p.pos.z + 2 });
  mob.maxHp = mob.hp = 100000;
  sim.addEntity(mob);
  p.auras = [];
  const aura = (id: string, kind: Aura['kind'], value: number): Aura => ({
    id,
    kind,
    value,
    name: id,
    sourceId: p.id,
    school: 'physical',
    duration: 30,
    remaining: 30,
  });
  if (stealth) p.auras.push(aura('stealth', 'stealth', 0));
  if (edge) p.auras.push(aura(VEILED_EDGE_ID, 'internal_cd', 0.5));
  const meta = sim.players.get(p.id);
  const resolved = sim.resolvedAbility('ambush');
  if (!meta || !resolved) throw new Error('missing rogue fixture');
  return { sim, p, mob, meta, resolved, aura };
}
describe('Skulduggery complete opener integration', () => {
  // The sixth column is whether the armed Veiled Edge must SURVIVE this cast.
  // A genuine stealth opener (stealth=true, edge=true) wins the multiplier on
  // its own 2x true-stealth reward and must never spend the Edge for a
  // discarded return value: "cannot stack" means the Edge stays armed for
  // the next eligible strike, not that it gets silently eaten here.
  it.each([
    ['subtlety', true, false, 2, 2, false],
    ['subtlety', true, true, 2, 2, true],
    ['subtlety', false, true, 1.5, 1, false],
    ['assassination', true, false, 1, 1, false],
  ] as const)(
    '%s stealth=%s edge=%s delivers the correct weapon and flat factors',
    (spec, stealth, edge, weaponFactor, flatFactor, edgeSurvives) => {
      const { sim, p, mob, meta, resolved } = setup(spec, stealth, edge);
      const hit = vi.spyOn(sim.ctx, 'meleeSwing').mockReturnValue(true);
      runEffects(sim.ctx, p, meta, mob, {
        ...resolved,
        effects: [{ type: 'weaponStrike', bonus: 100, weaponMult: 1.6 }],
      });
      expect(hit.mock.calls[0]?.[2]).toBe(100 * flatFactor);
      expect(hit.mock.calls[0]?.[4]?.weaponMult).toBeCloseTo(1.6 * weaponFactor);
      expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
      expect(p.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(edgeSurvives);
    },
  );

  it('a true-stealth opener preserves the Edge; the next eligible strike spends it', () => {
    const { sim, p, mob, meta, resolved } = setup('subtlety', true, true);
    const hit = vi.spyOn(sim.ctx, 'meleeSwing').mockReturnValue(true);
    const strike = { type: 'weaponStrike' as const, bonus: 100, weaponMult: 1.6 };

    // First strike: genuinely stealthed (Smokestep) with an Edge already
    // armed from an earlier Shadow Veil detonation. The true-stealth
    // opener must win the multiplier here and leave the Edge standing.
    runEffects(sim.ctx, p, meta, mob, { ...resolved, effects: [strike] });
    expect(hit.mock.calls[0]?.[4]?.weaponMult).toBeCloseTo(3.2); // 1.6 * true-stealth 2x, not stacked with the Edge
    expect(p.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(true);

    // Stealth breaks after the opener lands (the real casting_lifecycle
    // path calls ctx.breakStealth before this point); a second Lurker's
    // Strike a moment later, still inside the veil window, is no longer a
    // genuine stealth opener and is the strike the preserved Edge is for.
    p.auras = p.auras.filter((a) => a.kind !== 'stealth');
    runEffects(sim.ctx, p, meta, mob, { ...resolved, effects: [strike] });
    expect(hit.mock.calls[1]?.[4]?.weaponMult).toBeCloseTo(2.4); // 1.6 * the armed Edge's 1.5x
    expect(p.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(false);
  });

  it('does not let a full Gloam bank waive the true-stealth behind requirement', () => {
    const { sim, p, mob, aura } = setup('subtlety', true);
    p.weapon = { ...p.weapon, dagger: true };
    p.facing = 0;
    mob.facing = Math.PI; // mob faces the priest-side player
    p.auras.push({ ...aura(GLOAM_ID, 'gloam', 0), stacks: 3 });
    sim.targetEntity(mob.id);
    const hit = vi.spyOn(sim.ctx, 'meleeSwing');
    sim.castAbility('ambush');
    expect(hit).not.toHaveBeenCalled();
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    expect(
      sim.drainEvents().some((event) => event.type === 'error' && event.text.includes('behind')),
    ).toBe(true);
  });

  it('the real cast chain preserves the Edge through a true-stealth opener too', () => {
    // Armed Gloam -> Gut Punch detonates Shadow Veil (no weaponStrike, so it
    // never touches the Edge) -> Smokestep -> a behind-target Lurker's Strike
    // from genuine stealth -> a second Lurker's Strike spends the Edge.
    const sim = new Sim({
      seed: 42044,
      playerClass: 'rogue',
      autoEquip: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('subtlety')).toBe(true);
    const p = sim.player;
    p.weapon = { ...p.weapon, dagger: true }; // Lurker's Strike requires a dagger
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...p.pos, z: p.pos.z + 2 });
    mob.maxHp = mob.hp = 1_000_000;
    sim.addEntity(mob);
    sim.targetEntity(mob.id);
    const faceMobFromBehind = (): void => {
      p.pos.x = mob.pos.x;
      p.pos.z = mob.pos.z - 2;
      p.facing = 0;
      mob.facing = 0; // facing away from the player standing south of it
    };
    faceMobFromBehind();

    sim.ctx.applyAura(p, {
      id: GLOAM_ID,
      name: 'Gloam',
      kind: 'gloam',
      remaining: 60,
      duration: 60,
      value: 0,
      stacks: 3,
      sourceId: p.id,
      school: 'physical',
    });

    p.resource = p.maxResource;
    sim.castAbility('cheap_shot'); // detonates: raises Shadow Veil, arms the Edge
    for (let i = 0; i < 40; i++) sim.tick(); // clear the gcd
    expect(p.auras.some((a) => a.id === VEILSTRIKE_ID)).toBe(true);
    expect(p.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(true);

    sim.castAbility('vanish'); // Smokestep: real stealth even in combat
    for (let i = 0; i < 10; i++) sim.tick();
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    // Vanish's own combat-drop (dropSelfFromHostileFocus, effect_dispatch.ts)
    // clears p.targetId along with combat/threat: real Smokestep escapes
    // whatever you were fighting too, so the next opener needs a fresh
    // target pick, same as a player would re-select the mob by hand.
    sim.targetEntity(mob.id);

    faceMobFromBehind();
    p.resource = p.maxResource;
    sim.castAbility('ambush'); // genuine stealth opener, behind the target
    for (let i = 0; i < 10; i++) sim.tick();
    // breakStealth runs unconditionally once a non-preserving cast reaches
    // runEffects, so stealth dropping proves this cast cleared every gate
    // and resolved, independent of whether the swing itself then lands or a
    // mob dodge roll eats it (dodge/miss are drawn AFTER the Edge decision).
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(p.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(true); // preserved, not spent
    for (let i = 0; i < 40; i++) sim.tick(); // clear the gcd, still inside the 6 sec veil

    faceMobFromBehind();
    sim.targetEntity(mob.id); // defensive: nothing here should have dropped it, but stay explicit
    p.resource = p.maxResource;
    sim.castAbility('ambush'); // no longer genuinely stealthed; the veil still waives it
    for (let i = 0; i < 10; i++) sim.tick();
    expect(p.auras.some((a) => a.id === VEILED_EDGE_ID)).toBe(false); // now spent
  });
});
