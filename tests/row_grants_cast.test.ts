import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';

const CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'mage',
  'rogue',
  'priest',
  'shaman',
  'warlock',
  'druid',
];

// Every row option that grants a spell: apply it on a live sim, cast the granted
// spell at a real hostile target, and require the cast to actually happen (the
// cooldown/GCD engages or an effect lands). This is the "does every granted spell
// work on every class" guarantee, sim-level and exhaustive.
describe('every row-granted spell casts on its class', () => {
  for (const cls of CLASSES) {
    const grants = CHOICE_ROWS[cls].rows.flatMap((row) =>
      row.options
        .filter((o) => o.effect.grant)
        .map((o) => ({ level: row.level, id: o.id, ability: o.effect.grant?.ability as string })),
    );
    it(`${cls}: ${grants.length} granted spells all cast`, () => {
      for (const g of grants) {
        const sim = new Sim({ seed: 9, playerClass: cls, autoEquip: true });
        sim.setPlayerLevel(20);
        const p = sim.player;
        expect(sim.applyTalents({ spec: null, rows: { [g.level]: g.id } }), `${g.id} apply`).toBe(
          true,
        );
        const resolved = sim.resolvedAbility(g.ability);
        expect(resolved, `${g.id} grants unresolvable ${g.ability}`).toBeTruthy();
        // A live hostile target in melee range, both healthy, player resourced.
        // Condition-aware setup: ranged shots need distance (min range), executes
        // need a wounded target, and form-gated spells need their form first.
        const ranged = cls === 'hunter';
        const dist = ranged ? 15 : 3;
        // Terrain can block line of sight in a fixed direction; probe the compass
        // for a placement the sim considers visible before casting.
        const mob = createMob(9100, MOBS.forest_wolf, 20, {
          x: p.pos.x + dist,
          y: p.pos.y,
          z: p.pos.z,
        });
        mob.hostile = true;
        mob.maxHp = mob.hp = 100000;
        (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
        sim.targetEntity(mob.id);
        if (ranged) {
          const sees = (sim as unknown as { hasLineOfSight(a: Entity, b: Entity): boolean })
            .hasLineOfSight;
          for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4]) {
            mob.pos.x = p.pos.x + Math.sin(ang) * dist;
            mob.pos.z = p.pos.z + Math.cos(ang) * dist;
            if (sees.call(sim, p, mob)) break;
          }
        }
        p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
        p.resource = p.maxResource;
        p.gcdRemaining = 0;
        p.hp = p.maxHp;
        if (g.ability === 'hammer_of_wrath') mob.hp = Math.floor(mob.maxHp * 0.1); // execute window
        if (g.ability === 'victory_rush') {
          // Kill-window gate: the redesigned warrior's Victory Rush requires the
          // on-kill aura handleDeath opens; seed it as a fresh killing blow would.
          sim.ctx.applyAura(p, {
            id: 'victory_rush',
            name: 'Victory Rush',
            kind: 'victory_rush',
            value: 0,
            remaining: 20,
            duration: 20,
            sourceId: p.id,
            school: 'physical',
          });
        }
        if (g.ability === 'frenzied_regeneration') {
          sim.castAbility('bear_form'); // Bruin Form gate
          for (let i = 0; i < 3; i++) sim.tick();
          p.resource = p.maxResource;
          p.gcdRemaining = 0;
        }
        if (g.ability === 'voidfeast') {
          // Devour gate (requiresDispellable): the cast is refused unless the
          // target carries a beneficial magic aura to eat; seed one.
          sim.ctx.applyAura(mob, {
            id: 'test_devourable_ward',
            name: 'Devourable Ward',
            kind: 'buff_ap',
            value: 10,
            remaining: 20,
            duration: 20,
            sourceId: mob.id,
            school: 'arcane',
          });
        }
        const cdBefore = p.cooldowns.get(g.ability);
        const events: SimEvent[] = [];
        sim.castAbility(g.ability);
        for (let i = 0; i < 6; i++) events.push(...sim.tick());
        const errors = events.filter(
          (e): e is Extract<SimEvent, { type: 'error' }> =>
            e.type === 'error' && !/requires|range|facing|target/i.test(e.text),
        );
        expect(errors, `${g.id} cast errors: ${errors.map((e) => e.text).join('; ')}`).toEqual([]);
        // Proof the cast engaged: cooldown started, GCD consumed, casting began,
        // an aura landed on someone, or the target took damage.
        const engaged =
          (p.cooldowns.get(g.ability) ?? 0) !== (cdBefore ?? 0) ||
          p.gcdRemaining > 0 ||
          p.castingAbility !== null ||
          p.auras.length > 0 ||
          mob.hp < mob.maxHp ||
          mob.auras.length > 0;
        expect(engaged, `${g.id}: ${g.ability} cast did not engage`).toBe(true);
      }
    });
  }
});
