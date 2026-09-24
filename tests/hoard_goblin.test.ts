// The Coinsack Scurrier (src/sim/rift/hoard_goblin.ts): a goblin that sometimes
// runs through a Buried Hoard with a sack of stolen gold. It never fights, runs
// from players, escapes 20 seconds after the first blow (or after two minutes
// untouched), and pays everyone in the room the room chest's copper if killed.
import { describe, expect, it, vi } from 'vitest';
import { VAULT_GUEST_PAYOUTS_PER_CYCLE } from '../src/sim/content/treasure_maps';
import { riftInstanceOrigin } from '../src/sim/data';
import { HOARD_GOBLIN_ESCAPE_CAST } from '../src/sim/rift/hoard_control_cast_ids';
import {
  announceHoardGoblin,
  HOARD_GOBLIN_CHANCE,
  HOARD_GOBLIN_ESCAPE_SEC,
  HOARD_GOBLIN_IDLE_SEC,
  HOARD_GOBLIN_TEMPLATE_ID,
  hoardGoblinCopper,
  hoardGoblinHealth,
  maybeSpawnHoardGoblin,
} from '../src/sim/rift/hoard_goblin';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

function hoard(args = 'mushroom rare goblin'): { sim: Sim; inst: RiftInstance; goblin?: Entity } {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  sim.chat(`/dev hoard ${args}`, sim.player.id);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst) throw new Error('missing hoard');
  const id = inst.hoardGoblin?.id;
  return { sim, inst, goblin: id === undefined ? undefined : sim.entities.get(id) };
}

function run(sim: Sim, seconds: number, events: SimEvent[] = []): SimEvent[] {
  for (let elapsed = 0; elapsed < seconds - DT * 0.5; elapsed += DT) {
    events.push(...sim.tick());
  }
  return events;
}

/** Park the player well away from the goblin so it stands still. */
function standAway(sim: Sim, inst: RiftInstance): void {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const goblin = sim.entities.get(inst.hoardGoblin!.id)!;
  const far = sim.ctx.groundPos(
    origin.x + (goblin.pos.x > origin.x ? -1 : 1) * 30,
    goblin.pos.z - origin.z > 0 ? origin.z - 40 : origin.z + 40,
  );
  sim.player.pos.x = far.x;
  sim.player.pos.y = far.y;
  sim.player.pos.z = far.z;
}

function wound(sim: Sim, goblin: Entity): void {
  goblin.hp -= 10;
  goblin.tappedById = sim.player.id;
}

describe('the Coinsack Scurrier', () => {
  it('rolls into a hoard room on the dev flag, outside the room mob list', () => {
    const { inst, goblin } = hoard();
    expect(goblin?.templateId).toBe(HOARD_GOBLIN_TEMPLATE_ID);
    expect(inst.mobIds).not.toContain(goblin!.id);
    expect(goblin!.maxHp).toBe(hoardGoblinHealth(goblin!.level, 1));
    expect(goblin!.hp).toBe(goblin!.maxHp);
  });

  it('is sized for the head count and paid at the room chest rate', () => {
    // A lone reader at level 20: about 15 seconds of steady damage.
    expect(hoardGoblinHealth(20, 1)).toBe(1200);
    expect(hoardGoblinHealth(20, 5)).toBe(3000);
    // The casket's level-20 copper (6g) times each rarity's chest share.
    expect(hoardGoblinCopper(20, 'common')).toBe(18_000);
    expect(hoardGoblinCopper(20, 'rare')).toBe(36_000);
    expect(hoardGoblinCopper(20, 'epic')).toBe(54_000);
    expect(hoardGoblinCopper(20, 'legendary')).toBe(78_000);
  });

  it('rolls its 15% on every hoard, and an ordinary rift never draws for it', () => {
    const { sim, inst } = hoard('mushroom rare');
    const spots = [{ x: 0, z: 10, level: 20 }];
    const chance = vi.spyOn(sim.ctx.rng, 'chance');
    // A losing roll: drawn once at the goblin's odds, and no goblin.
    chance.mockReturnValueOnce(false);
    maybeSpawnHoardGoblin(sim.ctx, inst, spots);
    expect(chance).toHaveBeenLastCalledWith(HOARD_GOBLIN_CHANCE);
    expect(inst.hoardGoblin).toBeUndefined();
    // A winning roll spawns one at the room spot.
    chance.mockReturnValueOnce(true);
    maybeSpawnHoardGoblin(sim.ctx, inst, spots);
    expect(inst.hoardGoblin).toBeDefined();
    expect(sim.entities.get(inst.hoardGoblin!.id)?.templateId).toBe(HOARD_GOBLIN_TEMPLATE_ID);
    // An ordinary rift (no vault): nothing drawn, nothing spawned.
    const calls = chance.mock.calls.length;
    const rift = { ...inst, vault: null, hoardGoblin: undefined } as RiftInstance;
    maybeSpawnHoardGoblin(sim.ctx, rift, spots);
    expect(chance.mock.calls.length).toBe(calls);
    expect(rift.hoardGoblin).toBeUndefined();
    chance.mockRestore();
  });

  it('runs from a player who comes near, slower than a player runs', () => {
    const { sim, inst, goblin } = hoard();
    const g = goblin!;
    sim.player.pos.x = g.pos.x + 4;
    sim.player.pos.z = g.pos.z;
    const start = { x: g.pos.x, z: g.pos.z };
    const before = Math.hypot(sim.player.pos.x - g.pos.x, sim.player.pos.z - g.pos.z);
    run(sim, 2);
    const moved = Math.hypot(g.pos.x - start.x, g.pos.z - start.z);
    const after = Math.hypot(sim.player.pos.x - g.pos.x, sim.player.pos.z - g.pos.z);
    expect(moved).toBeGreaterThan(3);
    expect(moved).toBeLessThanOrEqual(7 * 0.8 * 2 + 0.5);
    expect(after).toBeGreaterThan(before);
    expect(inst.hoardGoblin?.settled).toBe(false);
  });

  it('stands still while nobody is near and nothing has hurt it', () => {
    const { sim, inst, goblin } = hoard();
    standAway(sim, inst);
    const start = { x: goblin!.pos.x, z: goblin!.pos.z };
    run(sim, 3);
    expect(Math.hypot(goblin!.pos.x - start.x, goblin!.pos.z - start.z)).toBeLessThan(0.01);
    expect(goblin!.castingAbility).toBeNull();
  });

  it('escapes with the gold 20 seconds after the first blow, and a kick cannot shorten it', () => {
    const { sim, inst, goblin } = hoard();
    const g = goblin!;
    standAway(sim, inst);
    wound(sim, g);
    const events = run(sim, 1);
    expect(g.castingAbility).toBe(HOARD_GOBLIN_ESCAPE_CAST);
    expect(g.castTotal).toBe(HOARD_GOBLIN_ESCAPE_SEC);
    const remaining = g.castRemaining;
    expect(remaining).toBeGreaterThan(HOARD_GOBLIN_ESCAPE_SEC - 1.1);
    // An interrupt clears the bar; the goblin's own clock puts it straight back.
    g.castingAbility = null;
    g.castRemaining = 0;
    run(sim, DT, events);
    expect(g.castingAbility).toBe(HOARD_GOBLIN_ESCAPE_CAST);
    expect(g.castRemaining).toBeCloseTo(remaining - DT, 3);
    const meta = sim.ctx.players.get(sim.player.id)!;
    const copper = meta.copper;
    run(sim, HOARD_GOBLIN_ESCAPE_SEC, events);
    expect(sim.entities.has(g.id)).toBe(false);
    expect(inst.hoardGoblin?.settled).toBe(true);
    expect(meta.copper).toBe(copper);
    expect(
      events.some((e) => e.type === 'log' && e.text === 'Coinsack Scurrier escapes with the gold!'),
    ).toBe(true);
  });

  it('leaves on its own after two minutes nobody touched it', () => {
    const { sim, inst, goblin } = hoard();
    standAway(sim, inst);
    // Skip most of the wait rather than simulate two minutes of the whole world.
    inst.hoardGoblin!.spawnedAt -= HOARD_GOBLIN_IDLE_SEC - 1;
    run(sim, 0.5);
    expect(sim.entities.has(goblin!.id)).toBe(true);
    run(sim, 1);
    expect(sim.entities.has(goblin!.id)).toBe(false);
  });

  it('pays everyone in the room the chest copper when it dies, and credits the deed', () => {
    const { sim, inst, goblin } = hoard();
    const g = goblin!;
    const meta = sim.ctx.players.get(sim.player.id)!;
    const copper = meta.copper;
    sim.ctx.handleDeath(g, sim.player);
    const events = run(sim, 1);
    const paid = hoardGoblinCopper(sim.player.level, 'rare');
    expect(meta.copper - copper).toBe(paid);
    expect(meta.deedStats.counters.hoardGoblinKills).toBe(1);
    expect(meta.deedsEarned.has('cmb_coinsack_caught')).toBe(true);
    expect(events.some((e) => e.type === 'loot' && e.text.startsWith('You loot '))).toBe(true);
    // Paid once: more ticks change nothing.
    run(sim, 2);
    expect(meta.copper - copper).toBe(paid);
    expect(inst.hoardGoblin?.settled).toBe(true);
  });

  it('pays a guest like the chest does: nothing once the cycle cap is spent', () => {
    for (const spent of [0, VAULT_GUEST_PAYOUTS_PER_CYCLE]) {
      const { sim, inst, goblin } = hoard();
      const meta = sim.ctx.players.get(sim.player.id)!;
      // Seat the player as a guest in someone else's hoard.
      inst.vault!.ownerPid = sim.player.id + 1_000_000;
      meta.vaultGuestCycle = meta.worldQuestCycle;
      meta.vaultGuestPayouts = spent;
      const copper = meta.copper;
      sim.ctx.handleDeath(goblin!, sim.player);
      run(sim, 1);
      expect(meta.copper - copper, `guest with ${spent} payouts spent`).toBe(
        spent === 0 ? hoardGoblinCopper(sim.player.level, 'rare') : 0,
      );
      // The goblin reads the cap, it never spends it.
      expect(meta.vaultGuestPayouts).toBe(spent);
    }
  });

  it('starts its bar the moment anything puts it on a hate table', () => {
    const { sim, inst, goblin } = hoard();
    standAway(sim, inst);
    goblin!.threat.set(sim.player.id, 1);
    run(sim, 0.1);
    expect(goblin!.castingAbility).toBe(HOARD_GOBLIN_ESCAPE_CAST);
    expect(inst.hoardGoblin?.escapeAt).not.toBeNull();
  });

  it('never holds the room: its bar does not keep the clear or the combat check alive', () => {
    const { sim, inst } = hoard();
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob) sim.ctx.handleDeath(mob, sim.player);
    }
    run(sim, 2);
    expect(inst.vault?.chest).toBeDefined();
  });

  it('is dropped with the floor when the run ends', () => {
    const { sim, inst, goblin } = hoard();
    sim.leaveRift(sim.player.id);
    // The empty room's grace is long; jump to its end.
    inst.emptyFor = 1e6;
    run(sim, 1.1);
    expect(sim.entities.has(goblin!.id)).toBe(false);
  });

  it('warns the player climbing into its room, with its live clocks', () => {
    const { sim } = hoard();
    const sighted = run(sim, DT).filter((ev) => ev.type === 'hoardGoblinSighted');
    expect(sighted).toHaveLength(1);
    expect(sighted[0]).toMatchObject({ escapeSec: HOARD_GOBLIN_ESCAPE_SEC, pid: sim.player.id });
    const idle = (sighted[0] as { idleSec: number }).idleSec;
    expect(idle).toBeGreaterThan(HOARD_GOBLIN_IDLE_SEC - 1);
    expect(idle).toBeLessThanOrEqual(HOARD_GOBLIN_IDLE_SEC);
  });

  it('tells a late arrival the time it has LEFT, and stays quiet once the bar runs', () => {
    const { sim, inst } = hoard();
    const out: SimEvent[] = [];
    vi.spyOn(sim.ctx, 'emit').mockImplementation((ev) => void out.push(ev));
    const state = inst.hoardGoblin as NonNullable<typeof inst.hoardGoblin>;
    state.spawnedAt = sim.ctx.time - (HOARD_GOBLIN_IDLE_SEC - 30);
    announceHoardGoblin(sim.ctx, inst, sim.player.id);
    expect((out[0] as { idleSec: number }).idleSec).toBeCloseTo(30, 6);
    out.length = 0;
    state.escapeAt = sim.ctx.time + 5;
    announceHoardGoblin(sim.ctx, inst, sim.player.id);
    expect(out).toHaveLength(0);
  });

  it('says nothing about a goblin already killed, already gone, or to a ghost', () => {
    const emitted = (sim: Sim) => {
      const out: SimEvent[] = [];
      const emit = vi.spyOn(sim.ctx, 'emit').mockImplementation((ev) => void out.push(ev));
      return { out, emit };
    };
    // Killed.
    let { sim, inst, goblin } = hoard();
    let spy = emitted(sim);
    goblin!.dead = true;
    announceHoardGoblin(sim.ctx, inst, sim.player.id);
    expect(spy.out).toHaveLength(0);
    // Gone (escaped or paid: settled).
    ({ sim, inst } = hoard());
    spy = emitted(sim);
    inst.hoardGoblin!.settled = true;
    announceHoardGoblin(sim.ctx, inst, sim.player.id);
    expect(spy.out).toHaveLength(0);
    // A ghost on a corpse run.
    ({ sim, inst } = hoard());
    spy = emitted(sim);
    sim.player.dead = true;
    announceHoardGoblin(sim.ctx, inst, sim.player.id);
    expect(spy.out).toHaveLength(0);
    // No goblin in the room at all.
    delete inst.hoardGoblin;
    sim.player.dead = false;
    announceHoardGoblin(sim.ctx, inst, sim.player.id);
    expect(spy.out).toHaveLength(0);
    // And the control: the same call on a living goblin does warn.
    ({ sim, inst } = hoard());
    spy = emitted(sim);
    announceHoardGoblin(sim.ctx, inst, sim.player.id);
    expect(spy.out.map((ev) => ev.type)).toEqual(['hoardGoblinSighted']);
  });
});
