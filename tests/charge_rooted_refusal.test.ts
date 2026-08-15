// A charge is refused while the caster cannot move, BEFORE the bill is paid.
//
// Reported in play: a druid roots a warrior, the warrior presses Onrush, and
// the charge is consumed without moving them. Reproduced exactly. The old
// behavior, same fixture and same seed, differing only by an ordinary root:
//
//   free    moved 14.7yd   cooldown 12s spent   rage +14.8
//   rooted  moved  0.0yd   cooldown 12s spent   rage  +9.9   (silent)
//
// Three things were wrong at once, which is why the fix is a pre-cast refusal
// rather than a patch to the effect:
//
//  1. `castAbility` arms the cooldown and spends the cost BEFORE `runEffects`,
//     so anything the effect declines to do is already paid for.
//  2. The charge effect's own guard is `hasUnbreakableMovementLock`, which only
//     matches auras flagged `unbreakableControl`. An ordinary druid root is
//     breakable and carries no such flag, so it sailed straight past the guard
//     and set the charge up.
//  3. `updateChargeMovement` then killed it on the very next tick through its
//     own `isRooted` check, so the charge ended having moved nobody.
//
// Note the two checks disagreed about what "cannot move" means, and that is the
// actual defect: the effect asked "unbreakable?" while the mover asked
// "rooted?". The gate added here asks the mover's question, at cast time.
//
// Scoped by EFFECT, never by ability id, so it holds for every charge in the
// game: warrior Onrush, the druid Bruin-Form charge, and Intervene (the
// friendly charge this branch adds). A fourth charge added later inherits it.

import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { teleportTo } from './sim_shared';

function chargeSetup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const wolf = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && !e.dead,
  );
  if (!wolf) throw new Error('no forest_wolf fixture');
  // Survive the swing that lands on arrival, so the run is what is measured.
  wolf.maxHp = 10000;
  wolf.hp = 10000;
  teleportTo(sim, wolf.pos.x - 18, wolf.pos.z);
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  sim.targetEntity(wolf.id);
  return { sim, p, wolf };
}

/** An ORDINARY root: breakable, and carrying no `unbreakableControl` flag. That
 *  is the case the effect-side guard misses, so it is the case worth pinning. */
function rootPlayer(p: Entity): void {
  p.auras.push({ kind: 'root', name: 'Entangling Roots', timeLeft: 8 } as never);
}

function runCharge(rooted: boolean) {
  const { sim, p } = chargeSetup();
  if (rooted) rootPlayer(p);
  const start = { x: p.pos.x, z: p.pos.z };
  const rageBefore = p.resource;
  // `error` lands on the sim's event queue rather than on a castAbility return,
  // so the refusal is read where a real client reads it: the tick drain.
  sim.castAbility('charge');
  const drained: SimEvent[] = [];
  for (let i = 0; i < 20 * 3; i++) drained.push(...sim.tick());
  return {
    moved: Math.hypot(p.pos.x - start.x, p.pos.z - start.z),
    cooldownLeft: p.cooldowns.get('charge') ?? 0,
    rageGained: p.resource - rageBefore,
    errors: drained
      .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
      .map((e) => e.text),
  };
}

describe('a charge is refused, not consumed, while the caster is rooted', () => {
  it('spends no cooldown, grants no rage, and says why', () => {
    const rooted = runCharge(true);
    expect(rooted.moved, 'a rooted charge moves nobody').toBeLessThan(1);
    // The three halves of "refused, not consumed". The cooldown is the one the
    // player actually complained about; the rage is the tell that the effect
    // ran at all, and a silent refusal is its own bug (nothing told the player
    // why the button did nothing).
    expect(rooted.cooldownLeft, 'the cooldown must not be spent').toBe(0);
    expect(rooted.rageGained, 'no rage for a charge that never happened').toBe(0);
    expect(rooted.errors).toContain("Can't move!");
  });

  it('still charges normally when not rooted, so the gate is not a blanket refusal', () => {
    // The control. Without it every assertion above passes on an ability that
    // simply stopped working.
    const free = runCharge(false);
    expect(free.moved, 'an unrooted charge covers real ground').toBeGreaterThan(10);
    expect(free.cooldownLeft, 'an unrooted charge does bill the cooldown').toBeGreaterThan(0);
    expect(free.rageGained).toBeGreaterThan(0);
    expect(free.errors).toEqual([]);
  });

  it('gates every charge ability in the game, by effect rather than by id', () => {
    // The scope claim. If a later ability gains a charge effect it is covered
    // automatically, and this fails if the set is ever narrowed to one id.
    const chargers = Object.values(ABILITIES).filter((a) =>
      a.effects?.some((e) => e.type === 'charge'),
    );
    expect(chargers.length, 'expected more than the one warrior charge').toBeGreaterThan(1);
    expect(chargers.map((a) => a.id)).toContain('charge');
    expect(chargers.map((a) => a.id)).toContain('intervene');
  });
});
