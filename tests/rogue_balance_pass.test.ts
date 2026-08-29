import { describe, expect, it } from 'vitest';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Rogue balance pass (maintainer sheet): Shadeslip keeps Duskveil, Redhanded
// is the scoped Craven Thrust crit mastery, False Face REMOVES the Duskveil
// slow outright (100% move speed while stealthed), Scrapper's Edge lost its
// damage penalty.

function stealthed(p: Entity): boolean {
  return p.auras.some((aura) => aura.kind === 'stealth');
}

describe('rogue balance pass', () => {
  it('Shadeslip does not break Duskveil', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: null, rows: { 5: 'rog_r5_shadeslip' } })).toBe(true);
    const p = sim.player;
    const mob = createMob(20_000, MOBS.forest_wolf, 10, {
      x: p.pos.x + 10,
      y: p.pos.y,
      z: p.pos.z,
    });
    mob.hostile = true;
    mob.aiState = 'idle';
    (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
    sim.targetEntity(mob.id);
    p.resource = p.maxResource;
    sim.castAbility('stealth');
    sim.tick();
    expect(stealthed(p)).toBe(true);
    p.gcdRemaining = 0;
    sim.castAbility('shadowstep');
    sim.tick();
    expect(stealthed(p)).toBe(true);
  });

  it('Redhanded resolves as +30% Craven Thrust crit and False Face removes the Duskveil slow', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('assassination');
    const anySim = sim as unknown as {
      players: Map<number, unknown>;
      playerMods(meta: unknown): {
        abilities: Record<string, { critPct: number } | undefined>;
      };
      playerId: number;
    };
    const mods = anySim.playerMods(anySim.players.get(anySim.playerId));
    expect(mods.abilities.backstab?.critPct).toBeCloseTo(0.3);

    sim.setSpec('subtlety');
    // Duskveil aura value 0.5 * (1 + 1 mastery buffPct at level 20) = 1.0, and
    // Smokestep's stealth rides the same mastery row.
    expect(sim.resolvedAbility('stealth')?.effects[0]).toMatchObject({
      kind: 'stealth',
      value: 1,
    });
    expect(sim.resolvedAbility('vanish')?.effects[0]).toMatchObject({
      kind: 'stealth',
      value: 1,
    });

    // The value is a MOVEMENT multiplier (player_motion.moveSpeedMult folds a
    // stealth aura in as a slow), so the mastered rogue really walks at full
    // speed while hidden. Without the mastery the same cast leaves 0.5.
    const p = sim.player;
    sim.castAbility('stealth');
    sim.tick();
    expect(stealthed(p)).toBe(true);
    expect(moveSpeedMult(p)).toBeCloseTo(1);

    const bare = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    bare.setPlayerLevel(20);
    bare.castAbility('stealth');
    bare.tick();
    expect(moveSpeedMult(bare.player)).toBeCloseTo(0.5);
  });

  it('Redhanded scales the poison coats and Thuggery rolls extra attacks', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('assassination');
    // Potent Poisons: the resolved weapon-coat riders carry the +10%.
    expect(sim.resolvedAbility('instant_poison')?.effects[0]).toMatchObject({
      type: 'imbue',
      bonus: 9, // 8 * 1.1 rounded
    });
    expect(sim.resolvedAbility('deadly_poison')?.effects[0]).toMatchObject({
      type: 'imbue',
      bonus: 15, // 14 * 1.1 rounded
    });

    // Thuggery: with the extra-attack roll forced to succeed, one auto cycle
    // lands two mainhand swings; without the mastery no roll is drawn at all.
    const swings = (spec: string | null, forceChance: boolean): number => {
      const rig = new Sim({ seed: 11, playerClass: 'rogue', autoEquip: true });
      rig.setPlayerLevel(20);
      if (spec) rig.setSpec(spec);
      const p = rig.player;
      const mob = createMob(21_000, MOBS.forest_wolf, 5, {
        x: p.pos.x + 1,
        y: p.pos.y,
        z: p.pos.z,
      });
      mob.hostile = true;
      mob.aiState = 'idle';
      mob.maxHp = 500_000;
      mob.hp = mob.maxHp;
      (rig as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
      rig.targetEntity(mob.id);
      p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
      p.dualWielding = false;
      p.offhandWeapon = null;
      const anyRig = rig as unknown as {
        ctx: { rng: { chance(pr: number): boolean } };
        emit(e: { type?: string; kind?: string; sourceId?: number }): void;
      };
      if (forceChance) {
        const orig = anyRig.ctx.rng.chance.bind(anyRig.ctx.rng);
        anyRig.ctx.rng.chance = (pr: number) => (pr === 0.05 ? true : orig(pr));
      }
      let hits = 0;
      const origEmit = anyRig.emit.bind(rig);
      anyRig.emit = (e: { type?: string; kind?: string; sourceId?: number }) => {
        if (e.type === 'damage' && e.kind === 'hit' && e.sourceId === p.id) hits++;
        return origEmit(e);
      };
      p.autoAttack = true;
      p.swingTimer = 0;
      updatePlayerAutoAttack(rig.ctx as never, p, rig.players.get(p.id) as never);
      return hits;
    };
    expect(swings('combat', true)).toBe(2); // the mastery swings again
    expect(swings(null, false)).toBe(1); // no mastery: single swing
  });
});
