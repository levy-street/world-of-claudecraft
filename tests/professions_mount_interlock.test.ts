// Mounts crossed with the profession sessions (the merge-settlement
// checkpoint's Scope B seam): the v0.32.0 expansion brought mounts, the
// packet brought the gather and fishing casts, and the two systems had no
// interlock until this pin. The contract is the release's own auto-dismount
// family (combat/casting_lifecycle.ts castStart: any deliberate cast
// dismounts the caster and drops an in-flight summon channel), extended to
// the two profession casts; the OTHER direction (starting a mount summon
// during a live session) is owned by useItem's generic busy guard, pinned
// here so neither half regresses alone.
import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { LAKE } from '../src/sim/data';
import { summonMountItem } from '../src/sim/mounts';
import { prepareRidingLessonRace, RIDING_LESSONS_QUEST_ID } from '../src/sim/mounts_training';
import { startFishing } from '../src/sim/professions/fishing';
import { Sim } from '../src/sim/sim';
import { type Entity, FISHING_CAST_ID, GATHER_CAST_ID } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const NODE = GATHER_NODES.find((n) => n.zoneId === 'veiled_hollow' && n.type === 'ore');
if (!NODE) throw new Error('no veiled_hollow ore node in content');

function makeSim(seed = 7): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function despawnMobs(sim: Sim): void {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob') continue;
    e.dead = true;
    e.hp = 0;
    e.aiState = 'dead';
    e.respawnTimer = 9999;
    e.corpseTimer = 9999;
    e.inCombat = false;
  }
}

function teleportTo(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing entity ${pid}`);
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

/** A rider standing beside the veiled_hollow ore vein, fully mounted. */
function mountedRider(sim: Sim): { pid: number; p: Entity } {
  despawnMobs(sim);
  const pid = sim.playerId;
  const meta = sim.meta(pid);
  if (!meta) throw new Error('no meta');
  meta.ridingTrained = true;
  sim.addItem('reins_valorsteed', 1, pid);
  sim.addItem('copper_mining_pick', 1, pid);
  teleportTo(sim, pid, NODE!.pos.x + 1.2, NODE!.pos.z + 1.2);
  expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(true);
  const p = sim.entities.get(pid) as Entity;
  for (let i = 0; i < 100 && !p.mountKey; i++) sim.tick();
  expect(p.mountKey).toBe('valorsteed');
  return { pid, p };
}

describe('starting a profession cast dismounts, like every other cast', () => {
  it('a mounted rider dismounts the moment a gather cast starts, and the harvest completes', () => {
    const sim = makeSim(7);
    const { pid, p } = mountedRider(sim);
    expect(sim.harvestNode(NODE!.id, undefined, pid)).toBe(true);
    expect(p.mountKey).toBe('');
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    for (let i = 0; i < 200 && p.castingAbility; i++) sim.tick();
    expect(p.castingAbility).toBeNull();
    expect(sim.countItem('thorium_ore', pid)).toBeGreaterThan(0);
  });

  it('a mounted angler dismounts the moment a fishing cast starts', () => {
    const sim = makeSim(8);
    despawnMobs(sim);
    const pid = sim.playerId;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    sim.addItem('simple_fishing_pole', 1, pid);
    const pz = LAKE.z - LAKE.radius - 2;
    teleportTo(sim, pid, LAKE.x, pz);
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(true);
    const p = sim.entities.get(pid) as Entity;
    for (let i = 0; i < 100 && !p.mountKey; i++) sim.tick();
    expect(p.mountKey).toBe('valorsteed');
    p.facing = Math.atan2(0, LAKE.z - pz);
    startFishing(sim.ctx, p, meta);
    expect(p.castingAbility).toBe(FISHING_CAST_ID);
    expect(p.mountKey).toBe('');
  });

  it('a REFUSED gather does not dismount (the deny arms run first)', () => {
    const sim = makeSim(9);
    const { pid, p } = mountedRider(sim);
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    // Drop the pick: the tool gate refuses before the cast (and therefore
    // before the dismount arm) is reached.
    meta.inventory = meta.inventory.filter((s) => s.itemId !== 'copper_mining_pick');
    expect(sim.harvestNode(NODE!.id, undefined, pid)).toBe(false);
    expect(p.mountKey).toBe('valorsteed');
    expect(p.castingAbility).toBeNull();
  });

  it('a gather start drops an in-flight summon channel instead of racing it', () => {
    const sim = makeSim(10);
    despawnMobs(sim);
    const pid = sim.playerId;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    sim.addItem('copper_mining_pick', 1, pid);
    teleportTo(sim, pid, NODE!.pos.x + 1.2, NODE!.pos.z + 1.2);
    expect(summonMountItem(sim.ctx, pid, 'valorsteed')).toBe(true);
    const p = sim.entities.get(pid) as Entity;
    expect(p.mountCastKey).toBe('valorsteed');
    expect(sim.harvestNode(NODE!.id, undefined, pid)).toBe(true);
    expect(p.mountCastKey).toBe('');
    expect(p.mountCastRemaining).toBe(0);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    // The dropped channel never lands: ticking past the summon time leaves
    // the gatherer on foot with the cast still live.
    for (let i = 0; i < 40 && p.castingAbility; i++) sim.tick();
    expect(p.mountKey).toBe('');
  });
});

describe('the other direction is the busy guard, not a dismount', () => {
  it('the lesson summon toggle during a live gather cast is refused as busy', () => {
    // The one mount path that skips useItem (no reins exist for the training
    // steed): the Z-toggle's lesson arm sets a summon channel directly, so it
    // carries its own busy refusal.
    const sim = makeSim(12);
    despawnMobs(sim);
    const pid = sim.playerId;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.mountTraining = {
      sessionId: 'mt_test',
      ownerId: pid,
      anchor: { x: 0, z: 0 },
      state: 'IN_PROGRESS',
      phase: 'ride',
    };
    sim.addItem('copper_mining_pick', 1, pid);
    teleportTo(sim, pid, NODE!.pos.x + 1.2, NODE!.pos.z + 1.2);
    expect(sim.harvestNode(NODE!.id, undefined, pid)).toBe(true);
    const p = sim.entities.get(pid) as Entity;
    sim.drainEvents();
    expect(sim.toggleMountFor(pid)).toBe(false);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.mountCastKey).toBe('');
    expect(sim.drainEvents().some((e) => e.type === 'error' && e.text === 'You are busy.')).toBe(
      true,
    );
  });

  it('the race-start lesson mount during a live gather cast is refused as busy', () => {
    // The race start mounts the lesson steed INSTANTLY (forceTrainingMount),
    // with no channel to interrupt: the deny must land before any session
    // state is written.
    const sim = makeSim(13);
    despawnMobs(sim);
    const pid = sim.playerId;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    sim.setPlayerLevel(20, pid);
    sim.addItem('copper_mining_pick', 1, pid);
    teleportTo(sim, pid, NODE!.pos.x + 1.2, NODE!.pos.z + 1.2);
    expect(sim.harvestNode(NODE!.id, undefined, pid)).toBe(true);
    // Set AFTER the item adds: the entry only needs to exist for the
    // needsRidingLessonRace gate, and a hand-built entry must not ride the
    // quest-credit inventory walk.
    meta.questLog.set(RIDING_LESSONS_QUEST_ID, { state: 'active', counts: [0] } as never);
    const p = sim.entities.get(pid) as Entity;
    sim.drainEvents();
    expect(prepareRidingLessonRace(sim.ctx, meta, p)).toBe(false);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.mountKey).toBe('');
    expect(meta.mountTraining?.state ?? 'none').not.toBe('IN_PROGRESS');
    expect(sim.drainEvents().some((e) => e.type === 'error' && e.text === 'You are busy.')).toBe(
      true,
    );
  });

  it('clicking the reins during a live gather cast is refused as busy', () => {
    const sim = makeSim(11);
    despawnMobs(sim);
    const pid = sim.playerId;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('no meta');
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    sim.addItem('copper_mining_pick', 1, pid);
    teleportTo(sim, pid, NODE!.pos.x + 1.2, NODE!.pos.z + 1.2);
    expect(sim.harvestNode(NODE!.id, undefined, pid)).toBe(true);
    const p = sim.entities.get(pid) as Entity;
    sim.drainEvents();
    // The REAL wire path: a reins click routes through useItem, whose busy
    // guard refuses during a non-spell cast. (A direct summonMountItem call
    // would bypass the guard; players cannot.)
    sim.useItem('reins_valorsteed', pid);
    expect(p.castingAbility).toBe(GATHER_CAST_ID);
    expect(p.mountCastKey).toBe('');
    expect(p.mountKey).toBe('');
    expect(sim.drainEvents().some((e) => e.type === 'error' && e.text === 'You are busy.')).toBe(
      true,
    );
  });
});
