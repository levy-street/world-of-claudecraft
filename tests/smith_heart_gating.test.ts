// The Smith's Heart's gating (src/sim/encounters/smith_heart/seal.ts and the
// shared gate engine over content/smith_heart.ts SMITH_HEART_GATES), driven
// through a real Sim claim:
// - a fresh claim: every gate shut, the seal dark;
// - the Hammer ALWAYS FIRST: the Hammer Council's fall (all three of it, never
//   the Guardian alone) splits the Slab and lights the ochre quarter, and
//   nothing else orders the other three;
// - the Breath, the Quench and the Heat light in any order, each with its own
//   line to the raid, each once;
// - the seal opens into the portal only with all four lit AND the Ring
//   clear, says so once, and stays open; the portal walks a living player to
//   the Heart's arrival and the return portal walks them back to the dais;
// - the Heart Bridge seals behind the raid while the final boss fights;
// - a reset (a fresh claim) starts dark and shut again;
// - the raid is dev-only while it is a blockout.

import { afterEach, describe, expect, it } from 'vitest';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GATES,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_PACKS,
} from '../src/sim/content/smith_heart';
import {
  HEART_ARRIVAL,
  HEART_RETURN_PORTAL,
  RING_PORTAL,
  RING_PORTAL_LANDING,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import {
  SMITH_HEART_CLOSED_TEXT,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_PORTAL_HOP_TEXT,
  SMITH_HEART_PORTAL_OPEN_LOG,
  SMITH_HEART_PORTAL_RETURN_TEXT,
  SMITH_HEART_SEAL_FULL,
  SMITH_HEART_VEIN_BITS,
  SMITH_HEART_VEIN_LIT_LOG,
  smithHeartLitCount,
  smithHeartPortalBitSet,
  smithHeartProgress,
  smithHeartSealMaskOf,
  smithHeartSealTemplate,
  smithHeartVeinLit,
} from '../src/sim/encounters/smith_heart';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import { dungeonGateState } from '../src/sim/instances/dungeon_gates';
import { enterDungeon, freeInstance } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const SPAWNS = DUNGEONS.smith_heart.spawns;

function setup(seed = 17): { sim: Sim; pid: number; inst: InstanceSlot } {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Heartwalker');
  expect(enterDungeon(sim.ctx, 'smith_heart', pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === 'smith_heart' && i.partyKey !== null,
  ) as InstanceSlot;
  sim.tick();
  return { sim, pid, inst };
}

function gate(id: string) {
  const g = SMITH_HEART_GATES.find((x) => x.id === id);
  if (!g) throw new Error(id);
  return g;
}

function state(sim: Sim, inst: InstanceSlot, id: string) {
  return dungeonGateState(sim.ctx, inst, gate(id));
}

/** Kill every claim mob of the listed packs or templates (instant, no loot).
 *  The Hammer's guardian stands for its whole fight: the Hammer Council's
 *  three (killOnly kills exactly what it names). */
function kill(sim: Sim, inst: InstanceSlot, ids: readonly string[]): void {
  killOnly(
    sim,
    inst,
    ids.flatMap((id) => (id === SMITH_HEART_GUARDIANS.hammer ? SMITH_HEART_COUNCIL : [id])),
  );
}

function killOnly(sim: Sim, inst: InstanceSlot, ids: readonly string[]): void {
  SPAWNS.forEach((s, i) => {
    if (!ids.includes(s.packId ?? '') && !ids.includes(s.mobId)) return;
    const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
    mob.hp = 0;
    mob.dead = true;
    mob.aiState = 'dead';
    mob.inCombat = false;
  });
}

function markers(sim: Sim, inst: InstanceSlot): number[] {
  const out: number[] = [];
  for (const id of inst.objectIds) {
    const e = sim.ctx.entities.get(id);
    const m = e ? smithHeartSealMaskOf(e.templateId) : null;
    if (m !== null) out.push(m);
  }
  return out;
}

function logs(events: unknown[], pid: number): string[] {
  return (events as { type: string; text?: string; pid?: number }[])
    .filter((e) => e.type === 'log' && e.pid === pid)
    .map((e) => e.text ?? '');
}

/** Put the player at instance-local (x, z) of the claim. */
function put(sim: Sim, pid: number, inst: InstanceSlot, x: number, z: number): void {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, inst.slot);
  displacePlayerForDev(sim.ctx, sim.ctx.entities.get(pid) as Entity, o.x + x, o.z + z);
}

/** The player's instance-local position. */
function local(sim: Sim, pid: number, inst: InstanceSlot): { x: number; z: number } {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, inst.slot);
  const e = sim.ctx.entities.get(pid) as Entity;
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

function near(a: { x: number; z: number }, b: { x: number; z: number }, d: number): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < d;
}
const ARENA_MOUTH: Record<Exclude<SmithHeartVein, 'hammer'>, string> = {
  breath: 'cornice_mouth',
  quench: 'lake_mouth',
  heat: 'anvil_mouth',
};

describe("the Smith's Heart gating", () => {
  afterEach(() => clearDungeonGateStateForTest());

  it('the seal mask round-trips through the marker template id', () => {
    for (let m = 0; m <= (SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT); m++) {
      expect(smithHeartSealMaskOf(smithHeartSealTemplate(m))).toBe(m);
    }
    expect(smithHeartSealMaskOf('sanctum_story_3')).toBeNull();
    // 32 is the arrival's bit (smith_heart_arrival.test.ts); nothing past it.
    expect(smithHeartSealMaskOf('smith_heart_seal_64')).toBeNull();
    expect(smithHeartPortalBitSet(SMITH_HEART_SEAL_FULL)).toBe(false);
    expect(smithHeartPortalBitSet(SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT)).toBe(true);
    // The portal bit never reads as a lit vein.
    for (const v of SMITH_HEART_VEINS) {
      expect(smithHeartVeinLit(SMITH_HEART_PORTAL_BIT, v)).toBe(false);
    }
    expect(smithHeartLitCount(SMITH_HEART_SEAL_FULL)).toBe(4);
    expect(smithHeartVeinLit(SMITH_HEART_VEIN_BITS.quench, 'quench')).toBe(true);
    expect(smithHeartVeinLit(SMITH_HEART_VEIN_BITS.quench, 'heat')).toBe(false);
  });

  it('a fresh claim: every gate with a prerequisite is shut and the seal is dark', () => {
    const { sim, inst } = setup();
    for (const g of SMITH_HEART_GATES) {
      const waits = (g.packs?.length ?? 0) + (g.bosses?.length ?? 0) > 0;
      expect(state(sim, inst, g.id), g.id).toBe(waits ? 'closed' : 'open');
    }
    // Only the Heart's own bridge waits on nothing (the portal is its door).
    expect(
      SMITH_HEART_GATES.filter((g) => !g.packs?.length && !g.bosses?.length).map((g) => g.id),
    ).toEqual(['heart_bridge']);
    const ms = markers(sim, inst);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((m) => m === 0)).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst)).toEqual({
      mask: 0,
      slabOpen: false,
      sealLit: false,
      ringClear: false,
      portalOpen: false,
    });
  });

  it('the Hammer goes first: its packs open the Pit, its death splits the Slab', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, SMITH_HEART_PACKS.hammer);
    sim.tick();
    expect(state(sim, inst, 'hammer_pit_mouth')).toBe('open');
    expect(state(sim, inst, 'the_slab')).toBe('closed');
    // The Hammer Council: two of the three down is not the fight won.
    killOnly(sim, inst, [SMITH_HEART_GUARDIANS.hammer, 'heart_slabwright']);
    sim.tick();
    expect(state(sim, inst, 'the_slab')).toBe('closed');
    expect(markers(sim, inst).every((m) => m === 0)).toBe(true);
    kill(sim, inst, [SMITH_HEART_GUARDIANS.hammer]);
    const events = sim.tick();
    expect(state(sim, inst, 'the_slab')).toBe('open');
    expect(markers(sim, inst).every((m) => m === SMITH_HEART_VEIN_BITS.hammer)).toBe(true);
    expect(logs(events, pid)).toContain(SMITH_HEART_VEIN_LIT_LOG.hammer);
    expect(smithHeartProgress(sim.ctx, inst).slabOpen).toBe(true);
    // Said once.
    expect(logs(sim.tick(), pid)).not.toContain(SMITH_HEART_VEIN_LIT_LOG.hammer);
  });

  it('the other three veins light in any order, each arena behind its own packs only', () => {
    const orders: SmithHeartVein[][] = [
      ['breath', 'quench', 'heat'],
      ['heat', 'breath', 'quench'],
      ['quench', 'heat', 'breath'],
    ];
    for (const order of orders) {
      const { sim, pid, inst } = setup();
      kill(sim, inst, [...SMITH_HEART_PACKS.hammer, SMITH_HEART_GUARDIANS.hammer]);
      sim.tick();
      let mask = SMITH_HEART_VEIN_BITS.hammer;
      for (const vein of order) {
        const v = vein as Exclude<SmithHeartVein, 'hammer'>;
        expect(state(sim, inst, ARENA_MOUTH[v])).toBe('closed');
        kill(sim, inst, SMITH_HEART_PACKS[v]);
        sim.tick();
        expect(state(sim, inst, ARENA_MOUTH[v])).toBe('open');
        kill(sim, inst, [SMITH_HEART_GUARDIANS[v]]);
        const events = sim.tick();
        mask |= SMITH_HEART_VEIN_BITS[v];
        expect(markers(sim, inst).every((m) => m === mask)).toBe(true);
        expect(logs(events, pid)).toContain(SMITH_HEART_VEIN_LIT_LOG[v]);
      }
      expect(mask).toBe(SMITH_HEART_SEAL_FULL);
      clearDungeonGateStateForTest();
    }
  });

  it('the seal opens into the portal only with all four lit and the Ring clear', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, Object.values(SMITH_HEART_GUARDIANS));
    sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).sealLit).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(false);
    expect(markers(sim, inst).every((m) => m === SMITH_HEART_SEAL_FULL)).toBe(true);
    kill(sim, inst, SMITH_HEART_PACKS.ring.slice(0, 7));
    sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(false);
    kill(sim, inst, SMITH_HEART_PACKS.ring);
    const events = sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(true);
    expect(
      markers(sim, inst).every((m) => m === (SMITH_HEART_SEAL_FULL | SMITH_HEART_PORTAL_BIT)),
    ).toBe(true);
    expect(logs(events, pid)).toContain(SMITH_HEART_PORTAL_OPEN_LOG);
    // Said once, and it stays open.
    for (let i = 0; i < 5; i++) {
      expect(logs(sim.tick(), pid)).not.toContain(SMITH_HEART_PORTAL_OPEN_LOG);
      expect(smithHeartPortalBitSet(markers(sim, inst)[0])).toBe(true);
    }
    // Ring clear but a guardian alive: still shut.
    const fresh = setup(23);
    kill(fresh.sim, fresh.inst, [
      ...SMITH_HEART_PACKS.ring,
      ...SMITH_HEART_VEINS.slice(0, 3).map((v) => SMITH_HEART_GUARDIANS[v]),
    ]);
    fresh.sim.tick();
    expect(smithHeartProgress(fresh.sim.ctx, fresh.inst).portalOpen).toBe(false);
    expect(markers(fresh.sim, fresh.inst).every((m) => !smithHeartPortalBitSet(m))).toBe(true);
  });

  it('the portal walks a living player to the Heart, and the return portal back', () => {
    const { sim, pid, inst } = setup();
    // Shut: standing in the seal goes nowhere.
    put(sim, pid, inst, RING_PORTAL.x + 1, RING_PORTAL.z);
    sim.tick();
    expect(near(local(sim, pid, inst), { x: RING_PORTAL.x + 1, z: RING_PORTAL.z }, 1)).toBe(true);
    kill(sim, inst, [...Object.values(SMITH_HEART_GUARDIANS), ...SMITH_HEART_PACKS.ring]);
    const events = sim.tick();
    expect(near(local(sim, pid, inst), HEART_ARRIVAL, 0.5)).toBe(true);
    expect(logs(events, pid)).toContain(SMITH_HEART_PORTAL_HOP_TEXT);
    // The landing sits clear of the return portal: no bounce back.
    sim.tick();
    expect(near(local(sim, pid, inst), HEART_ARRIVAL, 0.5)).toBe(true);
    // The return portal sets the player down on the dais, clear of the portal.
    put(sim, pid, inst, HEART_RETURN_PORTAL.x, HEART_RETURN_PORTAL.z);
    const back = sim.tick();
    expect(near(local(sim, pid, inst), RING_PORTAL_LANDING, 0.5)).toBe(true);
    expect(logs(back, pid)).toContain(SMITH_HEART_PORTAL_RETURN_TEXT);
    sim.tick();
    expect(near(local(sim, pid, inst), RING_PORTAL_LANDING, 0.5)).toBe(true);
    // A corpse never crosses.
    put(sim, pid, inst, RING_PORTAL.x, RING_PORTAL.z);
    const e = sim.ctx.entities.get(pid) as Entity;
    e.dead = true;
    e.hp = 0;
    sim.tick();
    expect(near(local(sim, pid, inst), RING_PORTAL, 1)).toBe(true);
  });

  it('the Heart Bridge seals for the final boss, every arena mouth for its guardian', () => {
    expect(gate('heart_bridge').sealWhileEngaged).toBe(SMITH_HEART_FINAL_BOSS);
    expect(gate('hammer_pit_mouth').sealWhileEngaged).toBe(SMITH_HEART_GUARDIANS.hammer);
    for (const [vein, id] of Object.entries(ARENA_MOUTH)) {
      expect(gate(id).sealWhileEngaged).toBe(SMITH_HEART_GUARDIANS[vein as SmithHeartVein]);
    }
    // No gate of one free vein waits on another vein's guardian or packs.
    for (const [vein, id] of Object.entries(ARENA_MOUTH)) {
      const g = gate(id);
      expect(g.bosses ?? []).toEqual([]);
      expect(g.packs).toEqual([...SMITH_HEART_PACKS[vein as keyof typeof ARENA_MOUTH]]);
    }
  });

  it('a reset starts the seal dark and every gate shut again', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, Object.values(SMITH_HEART_GUARDIANS));
    sim.tick();
    expect(markers(sim, inst).every((m) => m === SMITH_HEART_SEAL_FULL)).toBe(true);
    freeInstance(sim.ctx, inst);
    expect(enterDungeon(sim.ctx, 'smith_heart', pid)).toBe(true);
    const again = sim.ctx.instances.find(
      (i) => i.dungeonId === 'smith_heart' && i.partyKey !== null,
    ) as InstanceSlot;
    sim.tick();
    expect(markers(sim, again).every((m) => m === 0)).toBe(true);
    expect(state(sim, again, 'the_slab')).toBe('closed');
    expect(smithHeartProgress(sim.ctx, again).portalOpen).toBe(false);
  });

  it('is dev-only while it is a blockout', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', noPlayer: true, world: WORLD });
    const pid = sim.addPlayer('warrior', 'Outsider');
    expect(enterDungeon(sim.ctx, 'smith_heart', pid)).toBe(false);
    sim.tick();
    expect(
      sim.ctx.instances.some((i) => i.dungeonId === 'smith_heart' && i.partyKey !== null),
    ).toBe(false);
  });

  it('every line it sends the raid is localized', () => {
    for (const text of [
      ...Object.values(SMITH_HEART_VEIN_LIT_LOG),
      SMITH_HEART_CLOSED_TEXT,
      SMITH_HEART_PORTAL_OPEN_LOG,
      SMITH_HEART_PORTAL_HOP_TEXT,
      SMITH_HEART_PORTAL_RETURN_TEXT,
    ]) {
      expect(localizeSimText(text), text).not.toBeNull();
    }
    for (const g of SMITH_HEART_GATES) {
      if (g.openText) expect(localizeSimText(g.openText), g.id).not.toBeNull();
    }
  });

  it("each vein's lit line names its own room (the Heat's is the Hearth, not a forge)", () => {
    expect(SMITH_HEART_VEIN_LIT_LOG.hammer).toContain('the Quarry');
    expect(SMITH_HEART_VEIN_LIT_LOG.breath).toContain('the Breath');
    expect(SMITH_HEART_VEIN_LIT_LOG.quench).toContain('the Quench');
    expect(SMITH_HEART_VEIN_LIT_LOG.heat).toContain('the Hearth');
    expect(SMITH_HEART_VEIN_LIT_LOG.heat).not.toMatch(/forge/i);
  });
});
