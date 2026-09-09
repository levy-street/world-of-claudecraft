import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

// Eye Jab (gouge) is a direct-damage incapacitate: instant, no cast time, used at
// melee range while the rogue is already auto-attacking. Its own damage cannot
// break the incapacitate it has not applied yet, but the caster's OWN queued
// auto-attack swing lands on the very next tick and, being a direct hit, breaks
// the incapacitate it just landed (classic WoW's Gouge resets the caster's swing
// timer on use for exactly this reason; see docs/design/tooltip-writing.md
// trigger #7 for why the tooltip must say so).

function rig(): { sim: Sim; p: Entity; mob: Entity } {
  const sim = new Sim({ seed: 11, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  placePlayerInOpenField(sim);
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  p.resource = p.maxResource;
  return { sim, p, mob };
}

describe('Eye Jab resets the caster swing timer', () => {
  it('does not let the queued auto-attack swing break the incapacitate it just applied', () => {
    const { sim, p, mob } = rig();
    p.autoAttack = true;
    // A swing about to land: less than one tick remains, exactly the race the
    // caster's own follow-up auto-attack wins without a reset.
    p.swingTimer = 0.01;
    if (p.dualWielding && p.offhandWeapon) p.offhandSwingTimer = 0.01;

    sim.castAbility('gouge');
    expect(mob.auras.some((a) => a.kind === 'incapacitate')).toBe(true);

    sim.tick();
    expect(mob.auras.some((a) => a.kind === 'incapacitate')).toBe(true);
  });

  it('leaves the swing timer alone when the incapacitate does not land (no live target)', () => {
    const { sim, p, mob } = rig();
    mob.dead = true;
    p.autoAttack = true;
    p.swingTimer = 0.01;
    sim.castAbility('gouge');
    // A dead target refuses the cast outright, so the caster's own swing timer
    // is untouched: still primed to fire on the next tick.
    expect(p.swingTimer).toBeLessThanOrEqual(0.01);
  });
});
