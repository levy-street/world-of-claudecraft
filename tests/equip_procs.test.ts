// Unit tests for the legendary weapon-proc system (src/sim/combat/equip_procs.ts).
// Driven with a minimal fake SimContext so the proc roll is deterministic (no Sim,
// no real rng), against the REAL item proc data from the content tables.

import { describe, expect, it } from 'vitest';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import { ITEMS } from '../src/sim/data';
import type { WeaponProcTrigger } from '../src/sim/types';

type Call = { fn: string; args: any[] };

function fakeCtx(rollResult: boolean, nearby: any[] = []) {
  const calls: Call[] = [];
  let chanceRolls = 0;
  const ctx = {
    rng: {
      chance: (_p: number) => {
        chanceRolls++;
        return rollResult;
      },
    },
    emit: (e: any) => calls.push({ fn: 'emit', args: [e] }),
    dealDamage: (...args: any[]) => calls.push({ fn: 'dealDamage', args }),
    applyAura: (...args: any[]) => calls.push({ fn: 'applyAura', args }),
    hostilesInRadius: (_src: any, _pos: any, _r: number) => nearby,
  };
  return { ctx: ctx as any, calls, rolls: () => chanceRolls };
}

function ent(id: number, mainhandItemId: string | null, level = 20): any {
  return { id, dead: false, mainhandItemId, level, pos: { x: 0, y: 0, z: 0 } };
}

const fire = (ctx: any, wielder: any, target: any, trigger: WeaponProcTrigger) =>
  runWeaponProcs(ctx, wielder, target, trigger);

describe('runWeaponProcs: determinism / parity safety', () => {
  it('draws NO rng for a wielder holding a weapon with no procs', () => {
    const { ctx, rolls } = fakeCtx(true);
    // rusty_hatchet is a plain weapon with no weaponProcs
    fire(ctx, ent(1, 'rusty_hatchet'), ent(2, null), 'meleeHit');
    expect(rolls()).toBe(0);
  });

  it('draws NO rng for a wielder with an empty mainhand', () => {
    const { ctx, rolls } = fakeCtx(true);
    fire(ctx, ent(1, null), ent(2, null), 'meleeHit');
    expect(rolls()).toBe(0);
  });

  it('draws NO rng when the target is already dead', () => {
    const { ctx, rolls } = fakeCtx(true);
    const target = ent(2, null);
    target.dead = true;
    fire(ctx, ent(1, 'kingsbane_last_oath'), target, 'meleeHit');
    expect(rolls()).toBe(0);
  });

  it('does NOT roll a proc whose trigger does not match the action', () => {
    // Thronebane only has a meleeHit proc; a heal action must not roll it.
    const { ctx, rolls } = fakeCtx(true);
    fire(ctx, ent(1, 'kingsbane_last_oath'), ent(2, null), 'heal');
    expect(rolls()).toBe(0);
  });

  it('draws NO rng for an under-level wielder (an inert over-level weapon)', () => {
    // recalcPlayerStats keeps an over-level mainhand worn but inert; its procs
    // must be inert too, and the gate short-circuits before any rng draw.
    const { ctx, rolls, calls } = fakeCtx(true);
    fire(ctx, ent(1, 'kingsbane_last_oath', 10), ent(2, null), 'meleeHit');
    expect(rolls()).toBe(0);
    expect(calls.length).toBe(0);
  });
});

describe('Thronebane Chain Arc (meleeHit)', () => {
  it('on proc: arcs the primary target, chains to nearby foes, and slows the primary', () => {
    const nearby = [ent(2, null), ent(3, null), ent(4, null)];
    const target = nearby[0];
    const { ctx, calls } = fakeCtx(true, nearby);
    fire(ctx, ent(1, 'kingsbane_last_oath'), target, 'meleeHit');

    const dmg = calls.filter((c) => c.fn === 'dealDamage');
    // primary + up to `jumps` (3) other foes; here 2 others (id 3 and 4)
    expect(dmg.length).toBe(3);
    // dealDamage(source, target, amount, crit, school, ability, kind, ...)
    // primary takes the full Chain Arc damage (42), labelled + nature school
    expect(dmg[0].args[2]).toBe(42); // amount
    expect(dmg[0].args[4]).toBe('nature'); // school
    expect(dmg[0].args[5]).toBe('Chain Arc'); // ability label
    // jumps decay by falloff (0.6): 42 -> 25 -> 15
    expect(dmg[1].args[2]).toBe(25);
    expect(dmg[2].args[2]).toBe(15);
    // and the attack-speed slow lands on the primary
    const slow = calls.find((c) => c.fn === 'applyAura' && c.args[1].kind === 'attackspeed');
    expect(slow).toBeTruthy();
    expect(slow?.args[1].value).toBe(1.2);
    expect(slow?.args[1].name).toBe('Thunderclap');
  });

  it('on no proc: nothing fires', () => {
    const { ctx, calls } = fakeCtx(false, [ent(2, null)]);
    fire(ctx, ent(1, 'kingsbane_last_oath'), ent(2, null), 'meleeHit');
    expect(calls.length).toBe(0);
  });

  it('caps the number of chain jumps', () => {
    const nearby = [ent(2, null), ent(3, null), ent(4, null), ent(5, null), ent(6, null)];
    const { ctx, calls } = fakeCtx(true, nearby);
    fire(ctx, ent(1, 'kingsbane_last_oath'), nearby[0], 'meleeHit');
    // primary + 3 jumps max = 4 dealDamage, not 5
    expect(calls.filter((c) => c.fn === 'dealDamage').length).toBe(4);
  });
});

describe('Deathless Heartwood procs (staff)', () => {
  it('spellDamage proc applies the Deathbloom DoT', () => {
    const { ctx, calls } = fakeCtx(true);
    fire(ctx, ent(1, 'deathless_heartwood'), ent(2, null), 'spellDamage');
    const dot = calls.find((c) => c.fn === 'applyAura' && c.args[1].kind === 'dot');
    expect(dot?.args[1].name).toBe('Deathbloom');
    expect(dot?.args[1].school).toBe('nature');
  });

  it('heal proc applies the Lifebloom HoT', () => {
    const { ctx, calls } = fakeCtx(true);
    fire(ctx, ent(1, 'deathless_heartwood'), ent(2, null), 'heal');
    const hot = calls.find((c) => c.fn === 'applyAura' && c.args[1].kind === 'hot');
    expect(hot?.args[1].name).toBe('Lifebloom');
  });

  it('a healing action does not roll the staff spellDamage proc', () => {
    const { ctx, calls } = fakeCtx(true);
    fire(ctx, ent(1, 'deathless_heartwood'), ent(2, null), 'heal');
    // only the hot fires, not the dot
    expect(calls.some((c) => c.fn === 'applyAura' && c.args[1].kind === 'dot')).toBe(false);
  });
});

describe('proc data sanity', () => {
  it('both legendaries carry procs within a sane power band', () => {
    const throne = ITEMS.kingsbane_last_oath;
    const staff = ITEMS.deathless_heartwood;
    expect(throne.kind === 'weapon' && throne.weaponProcs?.length).toBeTruthy();
    expect(staff.kind === 'weapon' && staff.weaponProcs?.length).toBe(2);
  });
});
