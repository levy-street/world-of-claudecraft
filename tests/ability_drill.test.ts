// The ability drill (q_ps_hone_the_edge): the effigy yard's second lesson.
// Credit rides the damage the class's OWN taught attack deals, so an
// autoattack counts for nothing, and a warrior standing in the yard is
// loaned the rage their press bills so the button is never greyed out
// exactly when the coach is pointing at it.

import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { PROVING_SHORE_QUESTS } from '../src/sim/content/proving_shore';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import {
  ABILITY_DRILL_MOB_ID,
  ABILITY_DRILL_OBJECT_ITEM_ID,
  ABILITY_DRILL_QUEST_ID,
  ABILITY_DRILL_RING,
  creditAbilityDrill,
  updateAbilityDrill,
} from '../src/sim/tutorial/ability_drill';
import { startingAttackFor } from '../src/sim/tutorial/starting_attack';
import type { Entity, PlayerClass, QuestProgress } from '../src/sim/types';

function makeSim(playerClass: PlayerClass = 'mage', seed = 991): Sim {
  return new Sim({ seed, playerClass, autoEquip: true });
}

function seedActiveDrill(sim: Sim): QuestProgress {
  const meta = sim.players.get(sim.playerId)!;
  const qp: QuestProgress = { questId: ABILITY_DRILL_QUEST_ID, counts: [0], state: 'active' };
  meta.questLog.set(ABILITY_DRILL_QUEST_ID, qp);
  return qp;
}

/** A stand-in effigy: only the two fields the credit guard reads. */
function effigy(): Entity {
  return { templateId: ABILITY_DRILL_MOB_ID, kind: 'mob' } as unknown as Entity;
}

/** A REAL effigy entity in the world, for the live-damage wiring test. */
function spawnEffigy(sim: Sim, id: number, x: number, z: number): Entity {
  const mob = createMob(id, MOBS[ABILITY_DRILL_MOB_ID], 1, sim.groundPos(x, z));
  sim.entities.set(id, mob);
  return mob;
}

function standInRing(sim: Sim): Entity {
  const p = sim.entities.get(sim.playerId)!;
  const g = sim.groundPos(ABILITY_DRILL_RING.x, ABILITY_DRILL_RING.z);
  // Grounded, with prevPos matched: an ungrounded player never swings, which
  // would make the autoattack case below pass for the wrong reason.
  p.pos.x = g.x;
  p.pos.y = g.y;
  p.pos.z = g.z;
  p.prevPos = { ...p.pos };
  return p;
}

describe('the drill quest is authored the way the credit arm reads it', () => {
  it('carries the sentinel objective the credit keys on', () => {
    const quest = PROVING_SHORE_QUESTS[ABILITY_DRILL_QUEST_ID];
    expect(quest).toBeTruthy();
    const objective = quest.objectives[0];
    expect(objective.type).toBe('interact');
    expect(objective.type === 'interact' && objective.targetObjectItemId).toBe(
      ABILITY_DRILL_OBJECT_ITEM_ID,
    );
    expect(objective.count).toBeGreaterThan(1);
  });

  it('follows Strike True, so the swing is taught before the button', () => {
    expect(PROVING_SHORE_QUESTS[ABILITY_DRILL_QUEST_ID].requiresQuest).toBe('q_ps_strike_true');
  });
});

describe('creditAbilityDrill', () => {
  it('credits the class attack and readies the quest at the count', () => {
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    const taught = startingAttackFor('mage').abilityId!;
    const need = PROVING_SHORE_QUESTS[ABILITY_DRILL_QUEST_ID].objectives[0].count;
    for (let i = 0; i < need; i++) {
      creditAbilityDrill(sim.ctx, p, effigy(), taught);
    }
    expect(qp.counts[0]).toBe(need);
    expect(qp.state).toBe('ready');
  });

  it('never counts past the objective', () => {
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    const taught = startingAttackFor('mage').abilityId!;
    const need = PROVING_SHORE_QUESTS[ABILITY_DRILL_QUEST_ID].objectives[0].count;
    for (let i = 0; i < need + 5; i++) creditAbilityDrill(sim.ctx, p, effigy(), taught);
    expect(qp.counts[0]).toBe(need);
  });

  it('ignores an autoattack, which is the entire point of the drill', () => {
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    // An autoattack swing reaches dealDamage with a null abilityId.
    creditAbilityDrill(sim.ctx, p, effigy(), null);
    expect(qp.counts[0]).toBe(0);
  });

  it('accepts ANY attack, not just the one the coach happens to name', () => {
    // Deliberately wide. Keying on the taught id alone broke the warrior in
    // a real playthrough (onNextSwing lands elsewhere), and would break any
    // talent action-replacement or a player who dinged mid-drill.
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    creditAbilityDrill(sim.ctx, p, effigy(), 'heroic_strike');
    expect(qp.counts[0]).toBe(1);
  });

  it('still ignores a heal or a buff pressed at the effigy', () => {
    // The lesson is "use an ATTACK instead of a plain swing", so a paladin
    // healing themselves in the yard must not tick it along.
    const sim = makeSim('paladin');
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    creditAbilityDrill(sim.ctx, p, effigy(), 'holy_light');
    creditAbilityDrill(sim.ctx, p, effigy(), 'battle_shout');
    expect(qp.counts[0]).toBe(0);
  });

  it('ignores an unknown ability id rather than crediting it', () => {
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    creditAbilityDrill(sim.ctx, p, effigy(), 'no_such_ability');
    expect(qp.counts[0]).toBe(0);
  });

  it('ignores a hit on anything that is not an effigy', () => {
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const p = sim.entities.get(sim.playerId)!;
    const taught = startingAttackFor('mage').abilityId!;
    const scuttler = { templateId: 'shore_scuttler', kind: 'mob' } as unknown as Entity;
    creditAbilityDrill(sim.ctx, p, scuttler, taught);
    expect(qp.counts[0]).toBe(0);
  });

  it('credits nothing without the quest active', () => {
    const sim = makeSim('mage');
    const p = sim.entities.get(sim.playerId)!;
    const taught = startingAttackFor('mage').abilityId!;
    creditAbilityDrill(sim.ctx, p, effigy(), taught);
    expect(sim.players.get(sim.playerId)!.questLog.get(ABILITY_DRILL_QUEST_ID)).toBeUndefined();
  });

  it('credits the right ability for every class, not just the mage', () => {
    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const sim = makeSim(cls);
      const qp = seedActiveDrill(sim);
      const p = sim.entities.get(sim.playerId)!;
      creditAbilityDrill(sim.ctx, p, effigy(), startingAttackFor(cls).abilityId!);
      expect(qp.counts[0], cls).toBe(1);
    }
  });
});

describe('the yard rage loan', () => {
  it('tops a warrior up to the cost of the press the coach is naming', () => {
    const sim = makeSim('warrior');
    seedActiveDrill(sim);
    const p = standInRing(sim);
    p.resource = 0;
    updateAbilityDrill(sim.ctx);
    expect(p.resource).toBe(startingAttackFor('warrior').resourceCost);
  });

  it('is a FLOOR, never a grant: rage already above the cost is untouched', () => {
    const sim = makeSim('warrior');
    seedActiveDrill(sim);
    const p = standInRing(sim);
    const cost = startingAttackFor('warrior').resourceCost;
    p.resource = cost + 40;
    updateAbilityDrill(sim.ctx);
    expect(p.resource).toBe(cost + 40);
  });

  it('does not follow the player out of the yard', () => {
    const sim = makeSim('warrior');
    seedActiveDrill(sim);
    const p = standInRing(sim);
    p.pos.x = ABILITY_DRILL_RING.x + ABILITY_DRILL_RING.radius + 5;
    p.resource = 0;
    updateAbilityDrill(sim.ctx);
    expect(p.resource).toBe(0);
  });

  it('ends with the quest: no loan once it is no longer active', () => {
    const sim = makeSim('warrior');
    const qp = seedActiveDrill(sim);
    const p = standInRing(sim);
    qp.state = 'ready';
    p.resource = 0;
    updateAbilityDrill(sim.ctx);
    expect(p.resource).toBe(0);
  });

  it('leaves a class whose bar starts full alone', () => {
    const sim = makeSim('mage');
    seedActiveDrill(sim);
    const p = standInRing(sim);
    p.resource = 0;
    updateAbilityDrill(sim.ctx);
    expect(p.resource).toBe(0);
  });

  it('never loans to a dead or ghosted player', () => {
    const sim = makeSim('warrior');
    seedActiveDrill(sim);
    const p = standInRing(sim);
    p.resource = 0;
    p.dead = true;
    updateAbilityDrill(sim.ctx);
    expect(p.resource).toBe(0);
  });
});

describe('the drill ring', () => {
  it('covers the whole effigy cluster and the drillmaster who watches it', () => {
    // The ring is a hand-tuned constant; these are the authored positions it
    // has to contain, so moving an effigy or Rook without widening it fails
    // here rather than in a playtest.
    const inRing = (x: number, z: number) =>
      Math.hypot(x - ABILITY_DRILL_RING.x, z - ABILITY_DRILL_RING.z) <= ABILITY_DRILL_RING.radius;
    for (const camp of [
      { x: -336, z: -14 },
      { x: -341, z: -17 },
      { x: -331, z: -11 },
      { x: -334, z: -20 },
      { x: -339, z: -9 },
      { x: -345, z: -11 }, // Drillmaster Rook's shoulder
    ]) {
      expect(inRing(camp.x, camp.z), `${camp.x},${camp.z}`).toBe(true);
    }
    // ...and does NOT reach the next station down the strand.
    expect(inRing(-380, -42)).toBe(false);
  });
});

describe('the live damage path credits the drill', () => {
  // The unit tests above drive creditAbilityDrill directly. This one proves
  // the WIRING: dealDamage carries a display label AND a separate stable
  // abilityId, and only the latter matches a content id, so a hook reading
  // the wrong one would pass every test above and credit nothing in game.
  it('a real cast at a real effigy moves the count', () => {
    const sim = makeSim('mage');
    const qp = seedActiveDrill(sim);
    const p = standInRing(sim);
    const target = spawnEffigy(sim, 90101, p.pos.x + 3, p.pos.z);
    sim.targetEntity(target.id);
    const taught = startingAttackFor('mage').abilityId!;
    // Cast, then tick until the cast completes and the bolt lands.
    sim.castAbility(taught);
    for (let i = 0; i < 200 && qp.counts[0] === 0; i++) sim.tick();
    expect(qp.counts[0]).toBeGreaterThan(0);
  });

  it('the same swing WITHOUT an ability credits nothing', () => {
    const sim = makeSim('warrior');
    const qp = seedActiveDrill(sim);
    const p = standInRing(sim);
    const target = spawnEffigy(sim, 90102, p.pos.x + 1, p.pos.z);
    sim.targetEntity(target.id);
    sim.startAutoAttack();
    let swings = 0;
    for (let i = 0; i < 200; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === p.id && ev.targetId === target.id) swings++;
      }
    }
    // Decisive only if the swings actually landed. Effigies are dummies that
    // stand back up, so their hp is NOT the probe: count the hits.
    expect(swings, 'the autoattack never landed a swing').toBeGreaterThan(0);
    // It has been swinging the whole time; the drill wants the OTHER button,
    // so the count is still zero.
    expect(qp.counts[0]).toBe(0);
  });
});

describe('the on-next-swing path credits too', () => {
  // The bug this suite missed the first time. A warrior's Reaver Strike is
  // onNextSwing: it QUEUES, and its damage lands through the auto-attack
  // swing (combat/auto_attack.ts), never through runEffects where the other
  // credit site lives. The mage test above passed the whole time while the
  // warrior's drill sat at 0/3 in a real playthrough.
  it('a warrior queueing Reaver Strike moves the count when the swing lands', () => {
    const sim = makeSim('warrior');
    const qp = seedActiveDrill(sim);
    const p = standInRing(sim);
    const target = spawnEffigy(sim, 90201, p.pos.x + 1, p.pos.z);
    sim.targetEntity(target.id);
    const taught = startingAttackFor('warrior').abilityId!;
    expect(ABILITIES[taught].onNextSwing, 'the premise: it queues').toBe(true);

    // The yard's rage loan runs on the tick sweep, so the queue can afford it.
    for (let i = 0; i < 400 && qp.counts[0] === 0; i++) {
      if (!p.queuedOnSwing) sim.castAbility(taught);
      sim.tick();
    }
    expect(qp.counts[0]).toBeGreaterThan(0);
  });

  it('a plain warrior swing still credits nothing', () => {
    const sim = makeSim('warrior');
    const qp = seedActiveDrill(sim);
    const p = standInRing(sim);
    const target = spawnEffigy(sim, 90202, p.pos.x + 1, p.pos.z);
    sim.targetEntity(target.id);
    sim.startAutoAttack();
    let swings = 0;
    for (let i = 0; i < 200; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === p.id && ev.targetId === target.id) swings++;
      }
    }
    expect(swings, 'the autoattack never landed').toBeGreaterThan(0);
    expect(qp.counts[0]).toBe(0);
  });
});
