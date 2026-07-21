import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

const SEED = 41099;

// Deepfen Snapper is the seeded carrier of the warcry (ally-haste) mechanic.
const inner = (sim: Sim) => sim as unknown as {
  addEntity(e: Entity): void;
  updateBossMechanics(m: Entity): void;
  resetEvadingMob(m: Entity): void;
};

function spawn(sim: Sim, id: number, tmpl: typeof MOBS[string]) {
  const mob = createMob(id, tmpl, 9, { x: 0, y: 0, z: 0 });
  mob.inCombat = true;
  inner(sim).addEntity(mob);
  return mob;
}

const HASTE = (e: Entity) => e.auras.find((a) => a.id === 'warcry_deepfen_murloc');

describe('mob ally-haste (warcry)', () => {
  it('seeds the mechanic on the Deepfen Snapper', () => {
    expect(MOBS.deepfen_murloc.warcry).toEqual({
      radius: 12, every: 10, hasteMult: 1.25, duration: 6, name: 'Tide Cadence', school: 'frost',
    });
  });

  it('hastens a nearby ally once the pulse timer elapses', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const caller = spawn(sim, 9001, MOBS.deepfen_murloc);
    const ally = spawn(sim, 9002, MOBS.deepfen_murloc);
    ally.pos = { x: 5, y: 0, z: 0 };
    // Telegraphed: createMob seeds warcryTimer to a full interval, so it takes
    // `every` seconds (20 ticks/s) of in-combat updates before the first pulse.
    for (let i = 0; i < 20 * 10 + 1; i++) inner(sim).updateBossMechanics(caller);
    const aura = HASTE(ally);
    expect(aura).toBeDefined();
    expect(aura!.kind).toBe('buff_haste');
    expect(aura!.value).toBe(1.25);
  });

  it('does not pulse before the telegraphed first interval', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const caller = spawn(sim, 9011, MOBS.deepfen_murloc);
    const ally = spawn(sim, 9012, MOBS.deepfen_murloc);
    for (let i = 0; i < 20 * 9; i++) inner(sim).updateBossMechanics(caller); // 9s < 10s
    expect(HASTE(ally)).toBeUndefined();
  });

  it('hastens every ally in range plus the caster (AoE), without stacking', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const caller = spawn(sim, 9021, MOBS.deepfen_murloc);
    const a = spawn(sim, 9022, MOBS.deepfen_murloc);
    a.pos = { x: 4, y: 0, z: 0 };
    const b = spawn(sim, 9023, MOBS.deepfen_murloc);
    b.pos = { x: 0, y: 0, z: 6 };
    for (let i = 0; i < 20 * 10 + 1; i++) inner(sim).updateBossMechanics(caller);
    expect(HASTE(a)).toBeDefined();
    expect(HASTE(b)).toBeDefined();
    expect(HASTE(caller)).toBeDefined(); // the caller drums up itself too
    // a second pulse only refreshes the single aura — never a second copy
    for (let i = 0; i < 20 * 10 + 1; i++) inner(sim).updateBossMechanics(caller);
    expect(a.auras.filter((x) => x.id === 'warcry_deepfen_murloc')).toHaveLength(1);
  });

  it('ignores allies outside the radius', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const caller = spawn(sim, 9031, MOBS.deepfen_murloc);
    const far = spawn(sim, 9032, MOBS.deepfen_murloc);
    far.pos = { x: 100, y: 0, z: 0 }; // well beyond radius 12
    for (let i = 0; i < 20 * 10 + 1; i++) inner(sim).updateBossMechanics(caller);
    expect(HASTE(far)).toBeUndefined();
  });

  it('does not buff mobs of the opposing faction (players/pets excluded by faction)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const caller = spawn(sim, 9041, MOBS.deepfen_murloc);
    const friendlyMob = spawn(sim, 9042, MOBS.deepfen_murloc);
    friendlyMob.hostile = false; // flip faction
    for (let i = 0; i < 20 * 10 + 1; i++) inner(sim).updateBossMechanics(caller);
    expect(HASTE(friendlyMob)).toBeUndefined();
  });

  it('re-arms the telegraph after the caller evades and resets', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const caller = spawn(sim, 9051, MOBS.deepfen_murloc);
    inner(sim).resetEvadingMob(caller);
    expect(caller.warcryTimer).toBe(MOBS.deepfen_murloc.warcry!.every);
  });

  it('leaves mobs without the mechanic untouched', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const cultist = spawn(sim, 9061, MOBS.gravecaller_cultist);
    const ally = spawn(sim, 9062, MOBS.deepfen_murloc);
    for (let i = 0; i < 20 * 10 + 1; i++) inner(sim).updateBossMechanics(cultist);
    expect(ally.auras.some((a) => a.kind === 'buff_haste')).toBe(false);
  });
});
