// Blast splash onto bystanding creatures (src/sim/mob/boss_collateral.ts).
//
// Two failure modes are worth the whole file. The first is the opt-in leaking: this hooks
// the SHARED detonation path (`fireAoePulse`, `fireWarStomp`) that every rift boss and elite
// in the game already runs, so a splash that fires without the template field would quietly
// change the damage and the rng draw order of encounters nobody touched. The second is the
// reverse, and is the one that ships silently: a splash wired into four of the five slams
// reads as working in every screenshot, because you cannot tell from a crater which mechanic
// made it.
//
// Godmode is banned here for the same reason it is banned in boss_slams.test.ts: dealDamage
// returns SILENTLY for a `gm` target, so a godded bystander would make every "he did not hit
// this" assertion pass for the wrong reason.
import { beforeEach, describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { splashNearbyMobs } from '../src/sim/mob/boss_collateral';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';
/** A mirefen local: something that actually spawns in the zone he rampages through. */
const BYSTANDER = 'bogtoad';

describe('the opt-in', () => {
  it('is declared by the world boss and by nobody else', () => {
    expect(MOBS[BALGATH]?.collateral?.mult).toBeGreaterThan(0);
    const others = Object.entries(MOBS).filter(([id, m]) => id !== BALGATH && m.collateral);
    // If a second boss ever wants this, that is fine, but it must be a deliberate edit here:
    // the shared detonation path means a stray opt-in changes a shipped encounter's numbers.
    expect(others.map(([id]) => id)).toEqual([]);
  });

  it('scales the hit down far enough that zone wildlife survives being nearby', () => {
    // A raid mechanic at full strength one-shots every non-elite in the zone, and a world
    // boss who empties his own zone on the first pull has griefed everyone not in the raid.
    const mult = MOBS[BALGATH]?.collateral?.mult ?? 1;
    expect(mult).toBeLessThan(0.5);
    expect(mult, 'a splash nobody notices is not a splash').toBeGreaterThan(0.1);
  });
});

describe('splashNearbyMobs', () => {
  let sim: Sim;
  let boss: Entity;
  let ctx: SimContext;

  const place = (e: Entity, x: number, z: number) => {
    e.pos.x = x;
    e.pos.z = z;
    e.pos.y = groundHeight(x, z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
  };

  /** A live bystander at (x, z), full health, mortal. */
  const spawnBystander = (x: number, z: number, template = BYSTANDER): Entity => {
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(template, x, z);
    const e = sim.entities.get(id);
    if (!e) throw new Error(`no ${template}`);
    place(e, x, z);
    e.hp = e.maxHp;
    return e;
  };

  beforeEach(() => {
    sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, 0, 390);
    const e = sim.entities.get(id);
    if (!e) throw new Error('no boss');
    boss = e;
    ctx = (sim as unknown as { ctx: SimContext }).ctx;
    // Well clear of the boss so his ordinary melee never becomes the thing under test.
    place(sim.player, 80, 390);
  });

  it('hurts a creature standing in the blast', () => {
    const toad = spawnBystander(3, 390);
    const before = toad.hp;
    expect(splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall')).toBe(1);
    expect(toad.hp).toBeLessThan(before);
  });

  it('leaves a creature outside the blast alone', () => {
    const near = spawnBystander(3, 390);
    const far = spawnBystander(40, 390);
    const farHp = far.hp;
    expect(splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall')).toBe(1);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(farHp);
  });

  it('never hits the boss with his own fist', () => {
    const before = boss.hp;
    splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall');
    expect(boss.hp).toBe(before);
  });

  it('does nothing at all for a mob that has not opted in', () => {
    // The shared detonation path runs for every rift boss in the game; this is the assertion
    // that stops one of them silently gaining a mechanic.
    const plain = spawnBystander(0, 420, BYSTANDER);
    const victim = spawnBystander(2, 420, BYSTANDER);
    const before = victim.hp;
    expect(splashNearbyMobs(ctx, plain, plain.pos, 16, 62, 86, 'physical', 'x')).toBe(0);
    expect(victim.hp).toBe(before);
  });

  it('draws no rng, so a crowd of bystanders cannot fork the world', () => {
    // The whole reason the splash takes the authored midpoint instead of rolling: the number
    // of toads that wandered into a crater must not shift the shared stream.
    const rng = (sim as unknown as { rng: { s: number } }).rng;
    for (let i = 0; i < 6; i++) spawnBystander(1 + i * 0.4, 390);
    const stateBefore = JSON.stringify(rng);
    const hits = splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall');
    expect(hits).toBe(6);
    expect(JSON.stringify(rng)).toBe(stateBefore);
  });

  it('honours an arc filter, so the cleave cannot reach behind him', () => {
    boss.facing = 0; // +Z
    const ahead = spawnBystander(0, 398);
    const behind = spawnBystander(0, 382);
    const behindHp = behind.hp;
    const half = Math.PI / 3;
    const hits = splashNearbyMobs(
      ctx,
      boss,
      boss.pos,
      20,
      78,
      104,
      'physical',
      'Barrow Cleave',
      (e) => Math.abs(Math.atan2(e.pos.x - boss.pos.x, e.pos.z - boss.pos.z)) <= half,
    );
    expect(hits).toBe(1);
    expect(ahead.hp).toBeLessThan(ahead.maxHp);
    expect(behind.hp).toBe(behindHp);
  });

  it('can actually kill what it hits, rather than stopping at a sliver', () => {
    // A splash that never finishes anything is set dressing. The zone should be visibly
    // emptier where he has been.
    const toad = spawnBystander(3, 390);
    for (let i = 0; i < 30 && !toad.dead; i++)
      splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall');
    expect(toad.dead).toBe(true);
  });
});

describe('the wildlife fights back', () => {
  let sim: Sim;
  let boss: Entity;
  let ctx: SimContext;

  const place = (e: Entity, x: number, z: number) => {
    e.pos.x = x;
    e.pos.z = z;
    e.pos.y = groundHeight(x, z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
  };

  const spawn = (template: string, x: number, z: number): Entity => {
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(template, x, z);
    const e = sim.entities.get(id);
    if (!e) throw new Error(`no ${template}`);
    place(e, x, z);
    e.hp = e.maxHp;
    return e;
  };

  beforeEach(() => {
    sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    boss = spawn(BALGATH, 0, 390);
    ctx = (sim as unknown as { ctx: SimContext }).ctx;
    place(sim.player, 200, 390);
  });

  it('a splashed creature aggros the boss and actually lands hits on him', () => {
    // The end-to-end claim, through the real tick: threat seeded here must survive
    // updateMobTarget's walk and the combat profile runner, or the enrage is a field that
    // reads well and does nothing. The boss fights back (he cannot be made passive per
    // entity), which changes nothing about the assertion: only the toad can LOWER his hp,
    // and his warpath regen never runs while the toad keeps harrying him.
    const toad = spawn(BYSTANDER, 4, 390);
    splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall');
    expect(toad.aggroTargetId).toBe(boss.id);
    expect(toad.threat.get(boss.id)).toBeGreaterThan(0);
    const bossHp = boss.hp;
    for (let i = 0; i < 20 * 20 && boss.hp === bossHp; i++) sim.tick();
    expect(boss.hp).toBeLessThan(bossHp);
  });

  it('does not steal a creature already fighting a player', () => {
    // The splash seeds hate but must not override the classic 110%/130% switch rules: a
    // skirmish in progress belongs to whoever earned it.
    const toad = spawn(BYSTANDER, 4, 390);
    toad.aggroTargetId = sim.player.id;
    toad.aiState = 'attack';
    toad.inCombat = true;
    toad.threat.set(sim.player.id, 100000);
    splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall');
    expect(toad.aggroTargetId).toBe(sim.player.id);
    // ...but the boss is now ON the table, so if the player's lead collapses he takes over.
    expect(toad.threat.get(boss.id)).toBeGreaterThan(0);
  });

  it('never re-targets a player-owned pet under its owner', () => {
    const toad = spawn(BYSTANDER, 3, 390);
    toad.ownerId = sim.player.id;
    const before = toad.aggroTargetId;
    splashNearbyMobs(ctx, boss, boss.pos, 16, 62, 86, 'physical', 'Barrowfall');
    expect(toad.aggroTargetId).toBe(before);
    expect(toad.threat.get(boss.id)).toBeUndefined();
  });
});

describe('wired into every one of his slams', () => {
  // The reason this describe exists: a splash wired into four of five mechanics is invisible
  // in play and in every screenshot. Reading the source is the only way to see the gap.
  const sources = [
    ['src/sim/mob/locomotion.ts', 2],
    ['src/sim/mob/warpath.ts', 1],
    ['src/sim/mob/boss_slams.ts', 2],
  ] as const;

  it.each(sources)('%s calls the splash on each of its detonations', async (file, count) => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(file, 'utf8'));
    // The import names it without a paren, so only real call sites count.
    expect(src.split('splashNearbyMobs(').length - 1).toBe(count);
  });
});
