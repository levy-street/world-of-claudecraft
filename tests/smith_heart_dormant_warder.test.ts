// The Hammer Vein Warders lie dormant until the raid reaches them (src/sim/mob/dormant.ts):
// born asleep in the claim with a 95 percent ward, they stand up over their Awaken clip when a
// player comes within their aggro radius, strikes them or pulls their pack, holding still and
// taking 95 percent less damage until they are up, and they lie down again after an evade, a
// wake nobody followed up, or a respawn. Every case stands the player on real floor: the
// vein's cleft (48 yd from the nearest Warder, out of every reach) or the gallery landing
// (inside the first pack's reach); a spot over the void drops a player to their death.

import { describe, expect, it } from 'vitest';
import { writeWorldBossWireFields } from '../server/world_boss_wire';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { DORMANT_AURA_ID } from '../src/sim/mob/dormant_state';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { resetEvadingMob } from '../src/sim/mob/locomotion';
import { TRASH_ENGINE_DEMO_KIT } from '../src/sim/mob/trash_kit/engine_demo';
import { Sim } from '../src/sim/sim';
import { type Entity, TICK_RATE } from '../src/sim/types';

const WARDER = 'heart_hammer_warder';
const AUTHORED = SMITH_HEART_MOBS[WARDER].dormant;
if (!AUTHORED) throw new Error('the Hammer Vein Warder is not dormant');
const DEF = AUTHORED;
const RISE_TICKS = Math.ceil(DEF.riseSeconds * TICK_RATE);

const dev = (sim: Sim, line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);

/** A claim with the player at the cleft. `god` keeps the player standing, but a god's own
 *  blows are lethal (combat/damage.ts), so the damage cases strike as an ordinary player. */
function claim(seed = 23, god = true) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  dev(sim, '/dev heart enter');
  dev(sim, '/dev heart tp cleft');
  sim.player.devGod = god;
  const warders = [...sim.ctx.entities.values()].filter(
    (e) => e.templateId === WARDER && !e.dead && Math.abs(e.pos.x - sim.player.pos.x) < 400,
  );
  return { sim, warders };
}

/** Walk onto the gallery landing, inside the first pack's reach, and return that pack. */
function approach(sim: Sim, warders: Entity[]): Entity[] {
  dev(sim, '/dev heart tp gallery');
  ticks(sim, 2);
  return warders.filter((w) => !w.asleep);
}

const ward = (e: Entity) => e.auras.find((a) => a.id === DORMANT_AURA_ID);
const packOf = (warders: Entity[], w: Entity) =>
  warders.filter((o) => o.dungeonPackId === w.dungeonPackId);
const ticks = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) sim.tick();
};
/** Ticks, noting whether any of `pack` landed a blow (a god player still logs each one). */
function swingsOver(sim: Sim, pack: Entity[], n: number): boolean {
  let swung = false;
  for (let i = 0; i < n; i++) {
    for (const ev of sim.tick()) {
      if (ev.type === 'damage' && pack.some((w) => w.id === ev.sourceId)) swung = true;
    }
  }
  return swung;
}

describe('the dormant Hammer Vein Warder', { timeout: 120_000 }, () => {
  it('is authored dormant for as long as its Awaken clip takes to stand it up', () => {
    expect(DEF).toEqual({ riseSeconds: 3.4, ward: 0.95, auraName: 'Dormant' });
    // Only the Hammer's Warder: the other veins' warders share warder() and stay as they were.
    expect(SMITH_HEART_MOBS.heart_ring_warder.dormant).toBeUndefined();
  });

  it('is born asleep in the claim, warded, and holds still while nobody is near', () => {
    const { sim, warders } = claim();
    expect(warders.length).toBe(9);
    const start = warders.map((w) => ({ ...w.pos }));
    ticks(sim, 3 * TICK_RATE);
    expect(sim.player.dead).toBe(false);
    warders.forEach((w, i) => {
      expect(w.asleep).toBe(true);
      expect(w.dormantRise).toBe(0);
      expect(w.hostile).toBe(true);
      expect(w.aiState).toBe('idle');
      expect(ward(w)).toMatchObject({ kind: 'shield_wall', value: 0.95, name: 'Dormant' });
      expect(w.pos).toEqual(start[i]);
    });
  });

  it('never wanders while asleep, even where its spawn would let it', () => {
    const { sim, warders } = claim();
    // Pack spawns stand still anyway (idleStationary); a spawn without that flag is held by
    // its sleep alone. The control is the same body awake and unpulled: it wanders.
    const sleeper = warders[0];
    const control = warders.find((w) => w.dungeonPackId !== sleeper.dungeonPackId);
    if (!control) throw new Error('no second pack');
    sleeper.idleStationary = false;
    control.idleStationary = false;
    control.asleep = false;
    const s0 = { ...sleeper.pos };
    const c0 = { ...control.pos };
    ticks(sim, 20 * TICK_RATE);
    expect(sleeper.asleep).toBe(true);
    expect(sleeper.pos).toEqual(s0);
    expect(Math.hypot(control.pos.x - c0.x, control.pos.z - c0.z)).toBeGreaterThan(0.5);
  });

  it('wakes with its pack when a player comes in reach, holds through the rise, then fights', () => {
    const { sim, warders } = claim();
    ticks(sim, 2);
    const hp = sim.player.hp;
    const pack = approach(sim, warders);
    expect(pack.length).toBe(3);
    expect(new Set(pack.map((w) => w.dungeonPackId)).size).toBe(1);
    for (const w of pack) {
      expect(w.dormantRise ?? 0).toBeGreaterThan(DEF.riseSeconds - 0.2);
      expect(ward(w)).toBeDefined();
    }
    const others = warders.filter((w) => !pack.includes(w));
    // Standing up: nobody moves, nobody swings, and nobody is let go back to idle.
    const standing = pack.map((w) => ({ ...w.pos }));
    let swung = false;
    for (let i = 0; i < RISE_TICKS - 6; i++) {
      if (swingsOver(sim, pack, 1)) swung = true;
      for (const w of pack) expect(w.aiState).not.toBe('idle');
    }
    expect(swung).toBe(false);
    pack.forEach((w, i) => {
      expect(w.pos).toEqual(standing[i]);
    });
    for (const w of others) expect(w.asleep).toBe(true);
    expect(sim.player.hp).toBe(hp);
    // Up: the ward is gone and they come for the player.
    ticks(sim, 8);
    for (const w of pack) {
      expect(w.dormantRise).toBe(0);
      expect(ward(w)).toBeUndefined();
      expect(['chase', 'attack']).toContain(w.aiState);
      expect(w.aggroTargetId).toBe(sim.player.id);
    }
    // ...and fight: blows land, and each one closed in or stood in reach swinging.
    expect(swingsOver(sim, pack, 4 * TICK_RATE)).toBe(true);
    pack.forEach((w, i) => {
      const moved = Math.hypot(w.pos.x - standing[i].x, w.pos.z - standing[i].z) > 0.01;
      expect(moved || w.aiState === 'attack', w.id.toString()).toBe(true);
    });
  });

  it('wakes on each way a pull reaches it, one at a time', () => {
    const { sim, warders } = claim();
    ticks(sim, 2);
    const pid = sim.player.id;
    const pulls: [string, (w: Entity) => void][] = [
      ['moved off idle', (w) => (w.aiState = 'chase')],
      ['in combat', (w) => (w.inCombat = true)],
      ['on a hate table', (w) => w.threat.set(pid, 1)],
      ['given a target', (w) => (w.aggroTargetId = pid)],
    ];
    pulls.forEach(([, pull], i) => {
      pull(warders[i]);
    });
    const control = warders[pulls.length];
    sim.tick();
    pulls.forEach(([what], i) => {
      expect(warders[i].asleep, what).toBe(false);
    });
    expect(control.asleep).toBe(true);
  });

  it('wakes when a ranged auto attack lands from out of its reach, then comes for the shooter', () => {
    // A level 20 hunter's Auto Shot from 30 yd, well outside its aggro radius, so the blow is
    // the only pull. The spot is on the cleft's walk, on the line to the nearest Warder.
    const sim = new Sim({ seed: 23, playerClass: 'hunter', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    dev(sim, '/dev heart enter');
    dev(sim, '/dev heart tp cleft');
    ticks(sim, 4);
    const p = sim.player;
    const dist = (e: Entity) => Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    const warders = [...sim.ctx.entities.values()].filter(
      (e) => e.templateId === WARDER && !e.dead && Math.abs(e.pos.x - p.pos.x) < 400,
    );
    const w = warders.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    const k = 30 / dist(w);
    p.pos.x = w.pos.x + (p.pos.x - w.pos.x) * k;
    p.pos.z = w.pos.z + (p.pos.z - w.pos.z) * k;
    p.prevPos = { ...p.pos };
    p.facing = Math.atan2(w.pos.x - p.pos.x, w.pos.z - p.pos.z);
    p.targetId = w.id;
    sim.startAutoAttack(p.id);
    let shot = false;
    for (let i = 0; i < 4 * TICK_RATE && !shot; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === p.id && ev.targetId === w.id) shot = true;
      }
      if (!shot) expect(w.asleep).toBe(true);
    }
    expect(shot).toBe(true);
    sim.tick();
    for (const o of packOf(warders, w)) expect(o.asleep, o.id.toString()).toBe(false);
    const from = dist(w);
    ticks(sim, RISE_TICKS + 3 * TICK_RATE);
    expect(w.dead).toBe(false);
    expect(w.aggroTargetId).toBe(p.id);
    expect(dist(w)).toBeLessThan(from - 5);
  });

  it('takes 95 percent less damage until it is up, from any school or a tick', () => {
    const { sim, warders } = claim(23, false);
    ticks(sim, 2);
    const w = warders[0];
    // A blow from range is a pull: it wakes the Warder and its pack.
    const blows: [string, boolean][] = [
      ['fire', true],
      ['physical', true],
      ['shadow', false], // a periodic tick (direct = false), as an aura's damage arrives
    ];
    // 400 a blow: seven of them stay well inside its health, so every blow lands in full.
    const strike = ([school, direct]: [string, boolean]) => {
      const before = w.hp;
      sim.dealDamage(sim.player, w, 400, false, school, null, 'hit', false, undefined, direct);
      return before - w.hp;
    };
    const asleep = strike(blows[0]);
    ticks(sim, 2);
    expect(w.asleep).toBe(false);
    for (const o of packOf(warders, w)) expect(o.asleep).toBe(false);
    const rising = blows.map(strike);
    ticks(sim, RISE_TICKS + 2);
    expect(sim.player.dead).toBe(false);
    expect(w.dead).toBe(false);
    expect(ward(w)).toBeUndefined();
    const up = blows.map(strike);
    expect(w.dead).toBe(false);
    expect(up[0]).toBe(400);
    expect(asleep).toBe(Math.round(up[0] * (1 - DEF.ward)));
    rising.forEach((taken, i) => {
      expect(taken, blows[i][0]).toBe(Math.round(up[i] * (1 - DEF.ward)));
    });
  });

  it('lies down again when it evades home, and stays down', () => {
    const { sim, warders } = claim(23, false);
    const w = warders[0];
    const pack = packOf(warders, w);
    sim.dealDamage(sim.player, w, 10, false, 'fire', null, 'hit');
    ticks(sim, RISE_TICKS + 4);
    expect(w.dead).toBe(false);
    expect(w.asleep).toBe(false);
    expect(ward(w)).toBeUndefined();
    for (const o of pack) expect(o.aggroTargetId).toBe(sim.player.id);
    // resetEvadingMob clears the hate table but not the target, so lying down drops it too:
    // the dormant tick reads a target as a fresh pull and would stand the pack straight up.
    for (const o of pack) resetEvadingMob(sim.ctx, o);
    expect(w.asleep).toBe(true);
    expect(w.dormantRise).toBe(0);
    expect(ward(w)).toMatchObject({ kind: 'shield_wall', value: 0.95 });
    expect(w.hp).toBe(w.maxHp);
    ticks(sim, 2 * TICK_RATE);
    for (const o of pack) {
      expect(o.asleep, o.id.toString()).toBe(true);
      expect(o.dormantRise).toBe(0);
      expect(o.aggroTargetId).toBeNull();
      expect(ward(o)).toBeDefined();
    }
  });

  it('walks home and lies down when its pull wipes, after the rise or during it', () => {
    for (const midRise of [false, true]) {
      const { sim, warders } = claim(23, false);
      ticks(sim, 2);
      const pack = approach(sim, warders);
      expect(pack.length).toBe(3);
      if (midRise) {
        ticks(sim, 10);
        sim.dealDamage(null, sim.player, 1e6, false, 'physical', null, 'hit');
      }
      // Otherwise the pack stands up and kills the level 1 player itself.
      ticks(sim, 30 * TICK_RATE);
      expect(sim.player.dead).toBe(true);
      for (const w of pack) {
        const where = `${midRise ? 'mid-rise' : 'after the rise'} ${w.id}`;
        expect(w.asleep, where).toBe(true);
        expect(w.dormantRise, where).toBe(0);
        expect(ward(w), where).toBeDefined();
        expect(w.inCombat, where).toBe(false);
        expect(w.aggroTargetId, where).toBeNull();
        expect(w.hp, where).toBe(w.maxHp);
        expect(Math.hypot(w.pos.x - w.spawnPos.x, w.pos.z - w.spawnPos.z), where).toBeLessThan(1.5);
      }
    }
  });

  it('lies straight back down when something wakes it that never pulled it', () => {
    const { sim, warders } = claim(23, false);
    ticks(sim, 2);
    const w = warders[0];
    const other = warders.find((o) => o.dungeonPackId !== w.dungeonPackId);
    if (!other) throw new Error('no second pack');
    // Another mob's blow engages it with no threat behind it (combat/damage.ts adds threat for
    // players and pets only): it stands up, finds nobody to fight, and lies down again.
    sim.dealDamage(other, w, 100, false, 'physical', null, 'hit');
    ticks(sim, 2);
    expect(w.asleep).toBe(false);
    ticks(sim, RISE_TICKS + 2);
    expect(w.asleep).toBe(true);
    expect(w.inCombat).toBe(false);
    expect(ward(w)).toBeDefined();
    ticks(sim, 2 * TICK_RATE);
    expect(w.asleep).toBe(true);
    expect(w.aiState).toBe('idle');
  });

  it('dies awake, and an in-place respawn comes back asleep', () => {
    const { sim, warders } = claim(23, false);
    ticks(sim, 2);
    const w = warders[0];
    // A blow big enough to kill through the ward: the corpse keeps no sleep bit.
    sim.dealDamage(sim.player, w, w.maxHp * 40, false, 'fire', null, 'hit');
    expect(w.dead).toBe(true);
    expect(w.asleep).toBe(false);
    expect(w.dormantRise ?? 0).toBe(0);
    const corpse: Record<string, unknown> = {};
    writeWorldBossWireFields(w, corpse);
    expect(corpse.slp).toBeUndefined();
    respawnMob(sim.ctx, w);
    expect(w.dead).toBe(false);
    expect(w.asleep).toBe(true);
    expect(w.dormantRise).toBe(0);
    expect(ward(w)).toMatchObject({ kind: 'shield_wall', value: 0.95 });
    expect(w.hp).toBe(w.maxHp);
    ticks(sim, 2 * TICK_RATE);
    expect(w.asleep).toBe(true);
  });

  it('holds a trash kit until it has stood up', () => {
    const { sim, warders } = claim();
    ticks(sim, 2);
    // No dormant template carries a kit today; the engine's demo kit stands in for one.
    for (const w of warders) w.devTrashKit = TRASH_ENGINE_DEMO_KIT;
    const pack = approach(sim, warders);
    expect(pack.length).toBe(3);
    for (let i = 0; i < RISE_TICKS - 6; i++) {
      sim.tick();
      for (const w of pack) {
        expect(w.trashKit).toBeUndefined();
        expect(w.castingAbility).toBeNull();
      }
    }
    ticks(sim, 2 * TICK_RATE);
    expect(pack.some((w) => w.trashKit !== undefined)).toBe(true);
  });

  it('wakes, rises and fights the same way on every run (no rng, no clock)', () => {
    const run = () => {
      const { sim, warders } = claim(41);
      ticks(sim, 2);
      approach(sim, warders);
      ticks(sim, 8 * TICK_RATE);
      return warders.map((w) => [
        w.asleep,
        w.dormantRise,
        w.aiState,
        w.hp,
        w.pos.x,
        w.pos.z,
        w.aggroTargetId,
        w.auras.map((a) => a.id).join(','),
        w.threat.size,
      ]);
    };
    expect(run()).toEqual(run());
  });

  it('rides the sleep bit every client already reads, and drops it on the wake', () => {
    const { sim, warders } = claim(23, false);
    ticks(sim, 2);
    const w = warders[0];
    const asleep: Record<string, unknown> = {};
    writeWorldBossWireFields(w, asleep);
    expect(asleep.slp).toBe(1);
    sim.dealDamage(sim.player, w, 10, false, 'fire', null, 'hit');
    ticks(sim, 2);
    expect(w.dead).toBe(false);
    const woken: Record<string, unknown> = {};
    writeWorldBossWireFields(w, woken);
    expect(woken.slp).toBeUndefined();
  });
});
