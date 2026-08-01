// The classic evade trigger, end to end: a mob whose target stands somewhere it
// cannot reach (the rift ledge exploit: past a wall the straight-line chase can
// never cross) must give up after CHASE_STALL_TIMEOUT seconds, evade home
// immune, and heal to full, instead of pinning against the wall and getting
// killed for free. Attacks against it while evading report an 'evade' damage
// event (zero amount) so the client can float the word and log the line.
import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { MOBS, riftInstanceOrigin } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { CHASE_STALL_TIMEOUT } from '../src/sim/mob/reachability';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, NYTHRAXIS_ADD_ID } from '../src/sim/types';

// A plain rectangular floor-0 room (no shell polygon) keeps the wall face at a
// known |x| = wallX so the pin geometry is exact, and a modest wallX keeps the
// outside spot within the rift collision region.
function rectSeed(): number {
  for (let s = 1; s < 800; s++) {
    const f = generateRiftFloor(s, 20, 0);
    if (!f.isBoss && !f.layout.shellPolygon && (f.layout.wallX ?? 99) <= 33) return s;
  }
  throw new Error('no rectangular floor-0 rift seed found');
}

function activeInstance(sim: Sim) {
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  if (!inst) throw new Error('no active rift instance');
  return inst;
}

// Enter a rift, keep exactly one melee trash mob alive, and stand the player on
// the far side of the room's side wall: in aggro range, out of melee reach,
// unreachable by the straight-line chase.
function pinnedSetup() {
  const seed = rectSeed();
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.enterRift(seed, 20, sim.player.id);
  const inst = activeInstance(sim);
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const floor = generateRiftFloor(seed, 20, 0);
  const wallX = floor.layout.wallX;
  if (wallX === undefined) throw new Error('rectangular layout without wallX');

  const mobs = inst.mobIds
    .map((id) => sim.entities.get(id))
    .filter((e): e is Entity => !!e && !e.dead);
  const mob = mobs.find(
    (e) => !MOBS[e.templateId]?.petSpell && !MOBS[e.templateId]?.channelHeal && e.scale <= 1.3,
  );
  if (!mob) throw new Error('no plain melee trash mob on the floor');
  for (const e of mobs) {
    if (e.id !== mob.id) {
      e.hp = 0;
      e.dead = true;
    }
  }
  sim.player.gm = true; // level-1 tester vs level-20 rift trash

  // A z where the inside spot is collider-clear (between tombs/pillars/stubs).
  let z: number | null = null;
  for (let cand = floor.layout.zMin + 20; cand <= floor.layout.zMax - 20; cand += 2) {
    const ix = origin.x + wallX - 2.5;
    const iz = origin.z + cand;
    const resolved = (sim as any).resolveMovePoint(ix, iz, 0.6, mob);
    if (Math.hypot(resolved.x - ix, resolved.z - iz) < 0.05) {
      z = cand;
      break;
    }
  }
  if (z === null) throw new Error('no collider-clear pin spot found along the wall');

  mob.pos = { x: origin.x + wallX - 2.5, y: 0, z: origin.z + z };
  mob.prevPos = { ...mob.pos };
  sim.grid.update(mob);

  const p = sim.player;
  p.pos = { x: origin.x + wallX + 5.5, y: 0, z: origin.z + z }; // 8yd apart, wall between
  p.prevPos = { ...p.pos };
  sim.grid.update(p);
  sim.playerGrid.update(p);

  // aggro the mob the natural way: one landed hit, one tick
  sim.ctx.dealDamage(p, mob, 1, false, 'physical', null, 'hit');
  sim.tick();
  expect(mob.aggroTargetId).toBe(p.id);
  sim.drainEvents();
  return { sim, mob, player: p };
}

function tickUntil(sim: Sim, pred: () => boolean, maxTicks: number): boolean {
  for (let i = 0; i < maxTicks; i++) {
    sim.tick();
    if (pred()) return true;
  }
  return false;
}

describe('a mob that cannot reach its target evades', () => {
  it('pins on the wall, evades after the stall window, walks home, and heals to full', () => {
    const { sim, mob, player } = pinnedSetup();
    mob.hp = Math.max(1, Math.floor(mob.maxHp / 2)); // half dead: the heal must be visible

    // 3x the stall window is plenty: a few ticks to reach the wall, 5s pinned
    const evaded = tickUntil(
      sim,
      () => mob.aiState === 'evade',
      Math.round((CHASE_STALL_TIMEOUT * 3) / (1 / 20)),
    );
    expect(evaded).toBe(true);
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.threat.size).toBe(0);

    // immune mid-evade, and the attack reports an 'evade' result event
    const hpMidEvade = mob.hp;
    sim.drainEvents();
    dealDamage(sim.ctx, player, mob, 500, false, 'physical', 'Heroic Strike', 'hit');
    const events = sim.drainEvents();
    const evadeEvents = events.filter((e) => e.type === 'damage' && e.kind === 'evade');
    expect(evadeEvents).toHaveLength(1);
    expect(evadeEvents[0]).toMatchObject({
      type: 'damage',
      sourceId: player.id,
      targetId: mob.id,
      amount: 0,
      crit: false,
      kind: 'evade',
    });
    expect(mob.hp).toBe(hpMidEvade);
    expect(mob.dead).toBe(false);

    // it walks home and resets to a full-health idle, ready to be pulled again
    const reset = tickUntil(sim, () => mob.aiState === 'idle', 600);
    expect(reset).toBe(true);
    expect(mob.hp).toBe(mob.maxHp);
    expect(dist2d(mob.pos, mob.spawnPos)).toBeLessThan(0.5);
  });

  it('never evades while fighting in melee contact', () => {
    const { sim, mob, player } = pinnedSetup();
    // move the player to open ground inside the room, right next to the mob
    player.pos = { x: mob.pos.x - 2, y: 0, z: mob.pos.z };
    player.prevPos = { ...player.pos };
    sim.grid.update(player);
    sim.playerGrid.update(player);

    let sawEvade = false;
    for (let i = 0; i < 200; i++) {
      sim.tick();
      if (mob.aiState === 'evade') sawEvade = true;
    }
    expect(sawEvade).toBe(false);
    expect(mob.chaseStall).toBe(0);
    expect(mob.aiState === 'attack' || mob.aiState === 'chase').toBe(true);
  });

  it('never accumulates while stunned against the wall (CC holds the clock)', () => {
    const { sim, mob } = pinnedSetup();
    // stun it for well past the stall window before it can pin up
    mob.auras.push({
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: CHASE_STALL_TIMEOUT + 3,
      duration: CHASE_STALL_TIMEOUT + 3,
      value: 0,
      sourceId: sim.player.id,
      school: 'physical',
    });

    let sawEvadeWhileStunned = false;
    for (let i = 0; i < (CHASE_STALL_TIMEOUT + 3) * 20; i++) {
      sim.tick();
      if (mob.aiState === 'evade') sawEvadeWhileStunned = true;
    }
    expect(sawEvadeWhileStunned).toBe(false);
    expect(mob.chaseStall).toBe(0);

    // once the stun expires the pin is real again: it evades within the window
    const evaded = tickUntil(
      sim,
      () => mob.aiState === 'evade',
      Math.round((CHASE_STALL_TIMEOUT * 3) / (1 / 20)),
    );
    expect(evaded).toBe(true);
  });

  it('a canLeash:false profile mob never evades off the stall detector', () => {
    const { sim, mob, player } = pinnedSetup();
    // swap the pinned trash mob for a Nythraxis add (the canLeash:false profile)
    const add = createMob(sim.nextId++, MOBS[NYTHRAXIS_ADD_ID], 25, { ...mob.pos });
    add.hostile = true;
    sim.addEntity(add);
    mob.hp = 0;
    mob.dead = true;
    sim.ctx.dealDamage(player, add, 1, false, 'physical', null, 'hit');

    let sawEvade = false;
    for (let i = 0; i < Math.round((CHASE_STALL_TIMEOUT * 3) / (1 / 20)); i++) {
      sim.tick();
      if (add.aiState === 'evade') sawEvade = true;
    }
    expect(sawEvade).toBe(false);
    expect(add.chaseStall).toBe(0);
  });
});

describe('ordinary combat never trips the stall detector', () => {
  it('an open-field chase that reaches melee keeps chaseStall at zero', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.player.gm = true;
    let wolf: Entity | null = null;
    let bestD = Infinity;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
      const d = dist2d(sim.player.pos, e.pos);
      if (d < bestD) {
        bestD = d;
        wolf = e;
      }
    }
    if (!wolf) throw new Error('no mob near spawn');
    sim.ctx.dealDamage(sim.player, wolf, 1, false, 'physical', null, 'hit');

    let sawEvade = false;
    for (let i = 0; i < 200; i++) {
      sim.tick();
      if (wolf.aiState === 'evade') sawEvade = true;
    }
    expect(sawEvade).toBe(false);
    expect(wolf.chaseStall).toBe(0);
  });

  it('a caster standing at spell range with a live target never accumulates', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.player.gm = true;
    const entry = Object.entries(MOBS).find(
      ([, t]) => t.petSpell !== undefined && t.channelHeal === undefined,
    );
    if (!entry) throw new Error('no petSpell caster template in content');
    const [key, template] = entry;
    const range = template.petSpell!.range;
    const caster = createMob(sim.nextId++, template, template.maxLevel, {
      x: sim.player.pos.x + Math.max(2, range - 2),
      y: sim.player.pos.y,
      z: sim.player.pos.z,
    });
    caster.hostile = true;
    sim.addEntity(caster);
    sim.ctx.dealDamage(sim.player, caster, 1, false, 'physical', null, 'hit');
    sim.tick();
    expect(caster.aggroTargetId).toBe(sim.player.id);

    let sawEvade = false;
    for (let i = 0; i < 200; i++) {
      sim.tick();
      if (caster.aiState === 'evade') sawEvade = true;
    }
    expect(sawEvade).toBe(false);
    expect(caster.chaseStall).toBe(0);
    expect(caster.aggroTargetId, `${key} should still be engaged on the player`).toBe(
      sim.player.id,
    );
  });
});
