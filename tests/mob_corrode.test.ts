import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const SEED = 42;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });

// Spawn a Deepfen Snapper next to the player, force its Acid Spit to always land,
// and swing until a hit connects (a swing can miss/dodge).
const setup = () => {
  const sim = makeSim();
  const player = sim.player;
  const mob = createMob(990500, MOBS.deepfen_murloc, 9, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return { sim, player, mob };
};

const swingUntilHit = (sim: Sim, mob: any, target: any, max = 200) => {
  for (let i = 0; i < max; i++) {
    target.hp = target.maxHp; // top up so a bite never kills (death would clear auras)
    const before =
      target.auras.length + (target.auras.find((a: any) => a.kind === 'corrode')?.stacks ?? 0);
    (sim as any).mobSwing(mob, target);
    const after =
      target.auras.length + (target.auras.find((a: any) => a.kind === 'corrode')?.stacks ?? 0);
    if (after > before) return true;
  }
  return false;
};

describe('mob corrosive armor shred (Acid Spit)', () => {
  it('Deepfen Snapper template carries the corrode mechanic', () => {
    expect(MOBS.deepfen_murloc.corrode).toBeDefined();
    expect(MOBS.deepfen_murloc.corrode!.name).toBe('Acid Spit');
  });

  it('a landed hit applies a corrode aura with the template values', () => {
    const { sim, player, mob } = setup();
    const corrode = MOBS.deepfen_murloc.corrode!;
    const old = corrode.chance;
    corrode.chance = 1;
    try {
      expect(swingUntilHit(sim, mob, player)).toBe(true);
    } finally {
      corrode.chance = old;
    }
    const aura = player.auras.find((a) => a.kind === 'corrode');
    expect(aura).toBeDefined();
    expect(aura!.name).toBe('Acid Spit');
    expect(aura!.value).toBe(corrode.armor);
    expect(aura!.stacks).toBe(1);
    expect(aura!.sourceId).toBe(mob.id);
  });

  it('repeated hits stack the debuff up to maxStacks and no further', () => {
    const { sim, player, mob } = setup();
    const corrode = MOBS.deepfen_murloc.corrode!;
    const old = corrode.chance;
    corrode.chance = 1;
    try {
      for (let i = 0; i < corrode.maxStacks + 5; i++) swingUntilHit(sim, mob, player);
    } finally {
      corrode.chance = old;
    }
    const aura = player.auras.find((a) => a.kind === 'corrode');
    expect(aura!.stacks).toBe(corrode.maxStacks);
  });

  it('corrosion lowers the victim effective armor (so they take more damage)', () => {
    const { sim, player, mob } = setup();
    const corrode = MOBS.deepfen_murloc.corrode!;
    const baseArmor = (sim as any).effectiveArmor(player);
    const old = corrode.chance;
    corrode.chance = 1;
    try {
      swingUntilHit(sim, mob, player);
    } finally {
      corrode.chance = old;
    }
    const shredded = (sim as any).effectiveArmor(player);
    expect(shredded).toBe(Math.max(0, baseArmor - corrode.armor));
  });

  it('a friendly pet never corrodes its target (hostile guard)', () => {
    const { sim, player, mob } = setup();
    mob.hostile = false; // emulate a tamed pet swinging
    const corrode = MOBS.deepfen_murloc.corrode!;
    const old = corrode.chance;
    corrode.chance = 1;
    try {
      for (let i = 0; i < 50; i++) {
        player.hp = player.maxHp;
        (sim as any).mobSwing(mob, player);
      }
    } finally {
      corrode.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'corrode')).toBe(false);
  });
});
