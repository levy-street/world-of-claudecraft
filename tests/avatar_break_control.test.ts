// Avatar (warrior, level 17) control break, owner 2026-07-22: the tooltip says
// "breaking all control on you", but the cast gate blocked Avatar while the
// warrior was feared/stunned (every fear applies an incapacitate aura), so the
// one-time breakControl at cast was unreachable exactly when it mattered.
// Product ruling: Avatar is castable while controlled (usableWhileControlled)
// and its break removes HOSTILE PvP and trash control only, never boss-sourced
// or self-sourced control, and never encounter-authored unbreakable control.
import { describe, expect, it } from 'vitest';
import { CLASSES, MOBS } from '../src/sim/data';
import { createMob, createPlayer } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function rigWarrior() {
  const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.selectTalentRow(17, 'war_row_avatar')).toBe(true); // Avatar is a tier-5 row grant
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  p.gcdRemaining = 0;
  return { sim, p };
}

function addEntity(sim: Sim, e: Entity): void {
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(e);
}

function addTrashMob(sim: Sim, id = 9100): Entity {
  const p = sim.player;
  expect(MOBS.forest_wolf.boss).toBeFalsy(); // the fixture must stay trash for the break arms
  const mob = createMob(id, MOBS.forest_wolf, 20, { x: p.pos.x + 8, y: p.pos.y, z: p.pos.z });
  mob.hostile = true;
  addEntity(sim, mob);
  return mob;
}

function addBossMob(sim: Sim, id = 9200): Entity {
  const p = sim.player;
  expect(MOBS.morthen.boss).toBe(true); // the pin the whole boss-scope arm rests on
  const boss = createMob(id, MOBS.morthen, 20, { x: p.pos.x + 10, y: p.pos.y, z: p.pos.z });
  boss.hostile = true;
  addEntity(sim, boss);
  return boss;
}

function addHostilePlayer(sim: Sim, id = 9300): Entity {
  const p = sim.player;
  // A player's templateId is its class id; if a mob template ever collided
  // with any class id, MOBS[templateId] could boss-protect PvP control.
  for (const classId of Object.keys(CLASSES)) expect(MOBS[classId]).toBeUndefined();
  const enemy = createPlayer(id, 'warlock', { x: p.pos.x + 6, y: p.pos.y, z: p.pos.z }, 'Enemy');
  addEntity(sim, enemy);
  return enemy;
}

function control(id: string, kind: Aura['kind'], sourceId: number, value = 0): Aura {
  return { id, name: id, kind, value, remaining: 30, duration: 30, sourceId, school: 'shadow' };
}

const hasAura = (p: Entity, id: string) => p.auras.some((a) => a.id === id);
const hasAvatarBuff = (p: Entity) => p.auras.some((a) => a.kind === 'buff_avatar');

describe('Avatar breaks enemy control (usableWhileControlled + source-scoped break)', () => {
  it('breaks a trash-mob fear (incapacitate) when cast while feared', () => {
    const { sim, p } = rigWarrior();
    const mob = addTrashMob(sim);
    p.auras.push(control('trash_fear', 'incapacitate', mob.id));

    // Pre-fix this cast is rejected by the stun gate ("You are stunned!"),
    // so the fear survives and no buff lands: the reported bug.
    sim.castAbility('avatar');

    expect(hasAura(p, 'trash_fear')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('breaks a trash-mob stun and root in the same cast', () => {
    const { sim, p } = rigWarrior();
    const mob = addTrashMob(sim);
    p.auras.push(control('trash_stun', 'stun', mob.id));
    p.auras.push(control('trash_root', 'root', mob.id));

    sim.castAbility('avatar');

    expect(hasAura(p, 'trash_stun')).toBe(false);
    expect(hasAura(p, 'trash_root')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('does NOT break boss-sourced control, but the cast still fires', () => {
    const { sim, p } = rigWarrior();
    const boss = addBossMob(sim);
    p.auras.push(control('boss_fear', 'incapacitate', boss.id));
    p.auras.push(control('boss_stun', 'stun', boss.id));

    sim.castAbility('avatar');

    // Avatar goes off (usableWhileControlled) and buffs, yet the boss
    // mechanics stay: the break skips boss-sourced auras.
    expect(hasAvatarBuff(p)).toBe(true);
    expect(hasAura(p, 'boss_fear')).toBe(true);
    expect(hasAura(p, 'boss_stun')).toBe(true);
  });

  it('breaks trash control while leaving boss control from the same fight', () => {
    const { sim, p } = rigWarrior();
    const mob = addTrashMob(sim);
    const boss = addBossMob(sim);
    p.auras.push(control('boss_stun', 'stun', boss.id));
    p.auras.push(control('add_root', 'root', mob.id));

    sim.castAbility('avatar');

    expect(hasAura(p, 'boss_stun')).toBe(true);
    expect(hasAura(p, 'add_root')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('breaks control from a mob without the template boss flag: only boss: true protects', () => {
    const { sim, p } = rigWarrior();
    // Deliberate product boundary: the rule keys on the boss: true template
    // flag (final-boss templates), so an encounter mob without it, like this
    // dungeon-finder encounter, is breakable.
    expect(MOBS.korgath_the_bound.elite).toBe(true);
    expect(MOBS.korgath_the_bound.boss).toBeFalsy();
    const elite = createMob(9400, MOBS.korgath_the_bound, 20, {
      x: p.pos.x + 8,
      y: p.pos.y,
      z: p.pos.z,
    });
    elite.hostile = true;
    addEntity(sim, elite);
    p.auras.push(control('elite_stun', 'stun', elite.id));

    sim.castAbility('avatar');

    expect(hasAura(p, 'elite_stun')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('breaks hostile PLAYER (PvP) control', () => {
    const { sim, p } = rigWarrior();
    const enemy = addHostilePlayer(sim);
    p.auras.push(control('pvp_fear', 'incapacitate', enemy.id));
    p.auras.push(control('pvp_slow', 'slow', enemy.id, 0.5));

    sim.castAbility('avatar');

    expect(hasAura(p, 'pvp_fear')).toBe(false);
    expect(hasAura(p, 'pvp_slow')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('leaves self-sourced control alone', () => {
    const { sim, p } = rigWarrior();
    const mob = addTrashMob(sim);
    p.auras.push(control('own_slow', 'slow', p.id, 0.3));
    p.auras.push(control('trash_stun', 'stun', mob.id));

    sim.castAbility('avatar');

    expect(hasAura(p, 'own_slow')).toBe(true); // self-sourced: skipped
    expect(hasAura(p, 'trash_stun')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('still respects encounter-authored unbreakable control from a non-boss source', () => {
    const { sim, p } = rigWarrior();
    const mob = addTrashMob(sim);
    p.auras.push({ ...control('scripted_stun', 'stun', mob.id), unbreakableControl: true });

    sim.castAbility('avatar');

    expect(hasAura(p, 'scripted_stun')).toBe(true);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('keeps an unbreakable aura even when its source is unresolvable', () => {
    const { sim, p } = rigWarrior();
    // The unbreakable check must stay ahead of the default-breakable arm:
    // a gone source never downgrades encounter-authored control to breakable.
    p.auras.push({ ...control('gone_scripted', 'stun', 424242), unbreakableControl: true });

    sim.castAbility('avatar');

    expect(hasAura(p, 'gone_scripted')).toBe(true);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('breaks control whose source has left interest scope (unresolvable source)', () => {
    const { sim, p } = rigWarrior();
    // No entity with this id exists: the common hostile case defaults to breakable.
    p.auras.push(control('gone_source_root', 'root', 424242));

    sim.castAbility('avatar');

    expect(hasAura(p, 'gone_source_root')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('regression: a free warrior still clears pre-existing hostile control and gets the buff', () => {
    const { sim, p } = rigWarrior();
    const mob = addTrashMob(sim);
    // slow/silence do not gate the cast, so this warrior is free to act.
    p.auras.push(control('trash_slow', 'slow', mob.id, 0.5));
    p.auras.push(control('trash_silence', 'silence', mob.id));

    sim.castAbility('avatar');

    expect(hasAura(p, 'trash_slow')).toBe(false);
    expect(hasAura(p, 'trash_silence')).toBe(false);
    expect(hasAvatarBuff(p)).toBe(true);
  });

  it('emits an aura-lost event for each aura actually removed, and none for kept ones', () => {
    const { sim, p } = rigWarrior();
    const mob = addTrashMob(sim);
    const boss = addBossMob(sim);
    p.auras.push(control('trash_stun', 'stun', mob.id));
    p.auras.push(control('boss_stun', 'stun', boss.id));

    sim.castAbility('avatar');
    const lost = sim
      .tick()
      .filter((e) => e.type === 'aura' && e.targetId === p.id && e.gained === false)
      .map((e) => (e as { name: string }).name);

    expect(lost).toContain('trash_stun');
    expect(lost).not.toContain('boss_stun');
  });

  it('replays deterministically', () => {
    const run = () => {
      const { sim, p } = rigWarrior();
      const mob = addTrashMob(sim);
      const boss = addBossMob(sim);
      p.auras.push(control('trash_stun', 'stun', mob.id));
      p.auras.push(control('boss_fear', 'incapacitate', boss.id));
      sim.castAbility('avatar');
      const events = [];
      for (let i = 0; i < 40; i++) events.push(...sim.tick());
      return { auras: p.auras.map((a) => a.id), events };
    };
    const first = run();
    expect(first).toEqual(run());
    // Decisive end state, so this test also fails if either fix hunk regresses
    // (not only on nondeterminism in general).
    expect(first.auras).not.toContain('trash_stun');
    expect(first.auras).toContain('boss_fear');
    expect(first.auras.some((id) => id === 'avatar')).toBe(true);
  });
});
