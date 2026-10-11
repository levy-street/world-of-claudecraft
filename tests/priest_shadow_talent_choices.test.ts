import { describe, expect, it } from 'vitest';
import {
  recordGloomtitheGeneration,
  spiritBombProgress,
} from '../src/sim/combat/priest/spirit_bomb';
import { ownDirge, ownEffigy } from '../src/sim/combat/priest/vespers';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const CHOICES = ['twin_covenant', 'second_verse', 'incarnate_spirit'] as const;
type Choice = (typeof CHOICES)[number];

// A reproducible rotation, not an optimized parse: maintain Dirge and VT, bind
// the available Effigies, spend a full bank on the pet, then Mindfracture/Flay.
function damage(
  choice: Choice,
  targetsCount: number,
  seconds: number,
  ready = false,
  enemiesEscape = false,
) {
  const sim = new Sim({
    seed: 7781,
    playerClass: 'priest',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: 'shadow',
      rows: { 14: 'pri_r11_meditation', 20: `pri_r20_${choice}` },
    }),
  ).toBe(true);
  sim.tick();
  const p = sim.player;
  p.hitBonus = 1;
  p.resource = p.maxResource;
  sim.ctx.spellCrit = () => 0;
  sim.ctx.lineOfSightBlocked = () => false;
  if (ready) recordGloomtitheGeneration(sim.ctx, p, 20);
  const targets: Entity[] = [];
  for (let i = 0; i < targetsCount; i++) {
    const target = createMob(9900 + i, MOBS.training_dummy, 20, {
      ...p.pos,
      x: p.pos.x + i * 0.8,
      z: p.pos.z + 15,
    });
    target.hostile = true;
    target.hp = target.maxHp = 1000000;
    sim.ctx.addEntity(target);
    targets.push(target);
  }
  let total = 0;
  for (let tick = 0; tick < seconds * 20; tick++) {
    if (!p.castingAbility && p.gcdRemaining <= 0 && !p.channeling) {
      let target = targets[0];
      let id = 'mind_flay';
      const undotted = targets.find((enemy) => !ownDirge(enemy, p.id));
      const refresh = targets.some((enemy) => (ownDirge(enemy, p.id)?.remaining ?? 18) < 4);
      const boundTargets = targets.slice(0, choice === 'twin_covenant' ? 2 : 1);
      const unbound = boundTargets.find((enemy) => !ownEffigy(enemy, p.id));
      const untouched = boundTargets.find(
        (enemy) =>
          !enemy.auras.some((aura) => aura.id === 'vampiric_touch' && aura.sourceId === p.id),
      );
      if (spiritBombProgress(p) >= 20) id = 'spirit_bomb';
      else if (undotted) {
        id = 'shadow_word_pain';
        target = undotted;
      } else if (refresh) id = 'shadow_word_pain';
      else if (unbound && (p.cooldowns.get('mind_blast') ?? 0) <= 0) {
        id = 'mind_blast';
        target = unbound;
      } else if (untouched) {
        id = 'vampiric_touch';
        target = untouched;
      } else if (
        (p.auras.find((aura) => aura.kind === 'gloomtithe')?.stacks ?? 0) >= 5 &&
        (p.cooldowns.get('summon_tithefiend') ?? 0) <= 0
      )
        id = 'summon_tithefiend';
      else if ((p.cooldowns.get('mind_blast') ?? 0) <= 0) id = 'mind_blast';
      const resolved = sim.resolvedAbility(id);
      if (resolved && p.resource >= resolved.cost) {
        sim.targetEntity(target.id);
        sim.castAbility(id);
      }
    }
    if (enemiesEscape) {
      const zoneActive = sim.ctx.groundAoEs.some((zone) => zone.spiritBombResidual);
      for (let i = 0; i < targets.length; i++) {
        targets[i].pos.x = p.pos.x + i * 0.8 + (zoneActive ? 12 : 0);
        sim.ctx.rebucket(targets[i]);
      }
    }
    for (const event of sim.tick()) {
      if (event.type === 'damage' && event.sourceId === p.id) total += event.amount;
    }
  }
  for (const target of targets) {
    const dirge = ownDirge(target, p.id);
    const effigy = ownEffigy(target, p.id);
    if (dirge) expect(Number.isFinite(dirge.remaining)).toBe(true);
    if (effigy) expect(Number.isFinite(effigy.remaining)).toBe(true);
  }
  return total;
}

describe('Shadow capstones have encounter-dependent payoffs', () => {
  it.each([
    { name: 'one sustained target', targets: 1, seconds: 75, winner: 'second_verse' },
    { name: 'two sustained targets', targets: 2, seconds: 75, winner: 'twin_covenant' },
    { name: 'five stationary targets', targets: 5, seconds: 75, winner: 'incarnate_spirit' },
    {
      name: 'a short pack with a carried bomb',
      targets: 5,
      seconds: 20,
      winner: 'incarnate_spirit',
      ready: true,
    },
    {
      name: 'enemies leaving the bomb zone',
      targets: 5,
      seconds: 75,
      winner: 'second_verse',
      escape: true,
    },
  ])('$name rewards $winner with the same resource-limited rotation', (scenario) => {
    const results = CHOICES.map((choice) => ({
      choice,
      damage: damage(choice, scenario.targets, scenario.seconds, scenario.ready, scenario.escape),
    }));
    const expected = results.find((result) => result.choice === scenario.winner)!;
    for (const other of results) {
      if (other !== expected)
        expect(expected.damage, `${scenario.name}: ${other.choice}`).toBeGreaterThan(other.damage);
    }
  });
});
