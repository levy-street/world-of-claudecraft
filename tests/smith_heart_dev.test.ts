// /dev heart (src/sim/dev/smith_heart_dev.ts): the Smith's Heart's playtest
// helpers over a REAL Sim. Enter lands at the Cleft inside a claim; every tp
// area (the Heart's terrace included) lands on walkable floor at the field's
// height; kills credit so the gates, the heart seal and the portal follow on
// the next tick; `portal` forces the seal's portal open and the hop then
// works; reset hands back a fresh, dark, shut claim. Without devCommands
// neither the command nor the door lets anyone in.

import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_DUNGEON,
  SMITH_HEART_GATES,
  SMITH_HEART_SEAL_PREFIX,
} from '../src/sim/content/smith_heart';
import {
  HEART_ARRIVAL,
  inSmithHeartRoom,
  RING_PORTAL,
  SMITH_HEART_ANCHORS,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  handleSmithHeartDevChat,
  SMITH_HEART_DEV_AREAS,
  smithHeartSealReadout,
} from '../src/sim/dev/smith_heart_dev';
import {
  breathGuardian,
  smithHeartPortalBitSet,
  smithHeartProgress,
} from '../src/sim/encounters/smith_heart';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import { dungeonGateState } from '../src/sim/instances/dungeon_gates';
import { enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
const gate = (id: string) => {
  const g = SMITH_HEART_GATES.find((x) => x.id === id);
  if (!g) throw new Error(`no gate ${id}`);
  return g;
};

function devSim(devCommands = true) {
  const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: false, devCommands });
  // Straight to the handler: the chat seam's rate limit would drop a burst.
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
  // The claim whose slot band holds the player, read independently of the
  // claim footprint under test (instances/instance_footprint.ts).
  const claim = () =>
    sim.ctx.instances.find((inst) => {
      if (inst.dungeonId !== SMITH_HEART_DUNGEON || inst.partyKey === null) return false;
      if (inst.exitId === null) return false;
      const o = instanceOrigin(DUNGEON.index, inst.slot);
      const p = sim.player.pos;
      return Math.abs(p.x - o.x) < 300 && Math.abs(p.z - o.z) < 250;
    }) ?? null;
  return { sim, dev, claim };
}

function sealMasks(sim: Sim, inst: InstanceSlot): string[] {
  const out: string[] = [];
  for (const id of inst.objectIds) {
    const e = sim.ctx.entities.get(id);
    if (e?.templateId.startsWith(SMITH_HEART_SEAL_PREFIX)) out.push(e.templateId);
  }
  return out;
}

function logs(events: SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'log' ? [e.text] : []));
}

describe('/dev heart', () => {
  it('enter puts the player inside a claim at the entry', () => {
    const { sim, dev, claim } = devSim();
    expect(dev('/dev heart enter')).toBe(true);
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    const p = sim.player.pos;
    const { entry } = SMITH_HEART_ANCHORS;
    expect(Math.hypot(p.x - o.x - entry.x, p.z - o.z - entry.z)).toBeLessThan(4);
  });

  it('tp lands on walkable floor at the field height for every area', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    for (const [name, area] of Object.entries(SMITH_HEART_DEV_AREAS)) {
      expect(dev(`/dev heart tp ${name}`), name).toBe(true);
      const p = sim.player.pos;
      const lx = p.x - o.x;
      const lz = p.z - o.z;
      expect(Math.hypot(lx - area.x, lz - area.z), name).toBeLessThan(0.01);
      const floor = authoredFieldHeight(SMITH_HEART_FIELD, lx, lz);
      expect(floor, name).toBeGreaterThan(SMITH_HEART_FIELD.voidHeight);
      expect(p.y, name).toBeCloseTo(floor, 1);
      // Still inside the same claim.
      expect(claim(), name).toBe(inst);
    }
  });

  it('tp from outside enters the run first', () => {
    const { sim, dev, claim } = devSim();
    expect(claim()).toBeNull();
    dev('/dev heart tp forge');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    expect(sim.player.pos.x - o.x).toBeCloseTo(SMITH_HEART_ANCHORS.forge.x, 3);
  });

  it('kill hammer opens the Slab on the next tick; guardians light the seal; trash opens the portal', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    expect(dungeonGateState(sim.ctx, inst, gate('the_slab'))).not.toBe('open');
    expect(smithHeartProgress(sim.ctx, inst).slabOpen).toBe(false);

    dev('/dev heart kill hammer');
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('the_slab'))).toBe('open');
    expect(smithHeartProgress(sim.ctx, inst).slabOpen).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).mask).toBe(1);
    expect(sealMasks(sim, inst).every((t) => t === `${SMITH_HEART_SEAL_PREFIX}1`)).toBe(true);

    dev('/dev heart kill guardians');
    sim.tick();
    const masks = sealMasks(sim, inst);
    expect(masks.length).toBeGreaterThan(0);
    expect(masks.every((t) => t === 'smith_heart_seal_15')).toBe(true);
    let p = smithHeartProgress(sim.ctx, inst);
    expect(p.sealLit).toBe(true);
    expect(p.ringClear).toBe(false);
    expect(p.portalOpen).toBe(false);

    dev('/dev heart kill trash');
    sim.tick();
    p = smithHeartProgress(sim.ctx, inst);
    expect(p.ringClear).toBe(true);
    expect(p.portalOpen).toBe(true);
    expect(sealMasks(sim, inst).every((t) => t === 'smith_heart_seal_31')).toBe(true);
  });

  it('portal forces the seal open for the run, and the hop then works', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(false);
    dev('/dev heart portal');
    sim.tick();
    expect(smithHeartProgress(sim.ctx, inst).portalOpen).toBe(true);
    expect(smithHeartProgress(sim.ctx, inst).sealLit).toBe(false);
    expect(sealMasks(sim, inst).every((t) => smithHeartPortalBitSet(Number(t.slice(17))))).toBe(
      true,
    );
    // Step into the seal: the next tick sets the player down in the Heart.
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    dev('/dev heart tp portal');
    sim.player.pos.x = o.x + RING_PORTAL.x;
    sim.player.pos.z = o.z + RING_PORTAL.z;
    sim.tick();
    const lx = sim.player.pos.x - o.x;
    const lz = sim.player.pos.z - o.z;
    expect(inSmithHeartRoom(lx, lz)).toBe(true);
    expect(Math.hypot(lx - HEART_ARRIVAL.x, lz - HEART_ARRIVAL.z)).toBeLessThan(0.5);
    expect(claim()).toBe(inst);
  });

  it('kill pack <id> fells exactly that pack and an unknown target kills nothing', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    const alive = (packId: string) =>
      DUNGEON.spawns.filter((s, i) => {
        if (s.packId !== packId) return false;
        const mob = sim.ctx.entities.get(inst.mobIds[i]);
        return mob !== undefined && !mob.dead;
      }).length;
    expect(alive('r3')).toBe(3);
    dev('/dev heart kill pack r3');
    expect(alive('r3')).toBe(0);
    expect(alive('r4')).toBe(3);
    dev('/dev heart kill pack zz9');
    dev('/dev heart kill nobody');
    expect(alive('r4')).toBe(3);
  });

  it('seal prints the gating readout as a dev log line', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    sim.tick();
    dev('/dev heart seal');
    const lines = logs(sim.tick()).filter((t) => t.startsWith('[dev] Heart seal'));
    expect(lines).toEqual([
      '[dev] Heart seal: mask 0, slabOpen false, sealLit false, ringClear false, portalOpen false, awake false.',
    ]);
    dev('/dev heart kill all');
    sim.tick();
    expect(smithHeartSealReadout(sim.ctx, inst)).toBe(
      '[dev] Heart seal: mask 15, slabOpen true, sealLit true, ringClear true, portalOpen true, awake false.',
    );
  });

  it('gates opens every gate of the run', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('the_slab'))).not.toBe('open');
    dev('/dev heart gates');
    sim.tick();
    for (const g of SMITH_HEART_GATES)
      expect(dungeonGateState(sim.ctx, inst, g), g.id).toBe('open');
  });

  it('reset gives a fresh claim with everything closed and the seal dark', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const first = claim();
    expect(first).not.toBeNull();
    if (!first) return;
    dev('/dev heart kill all');
    sim.tick();
    expect(smithHeartProgress(sim.ctx, first).portalOpen).toBe(true);

    dev('/dev heart reset');
    sim.tick();
    const fresh = claim();
    expect(fresh).not.toBeNull();
    if (!fresh) return;
    const p = smithHeartProgress(sim.ctx, fresh);
    expect(p).toEqual({
      mask: 0,
      slabOpen: false,
      sealLit: false,
      ringClear: false,
      portalOpen: false,
    });
    expect(sealMasks(sim, fresh).every((t) => t === `${SMITH_HEART_SEAL_PREFIX}0`)).toBe(true);
    expect(sealMasks(sim, fresh).length).toBeGreaterThan(0);
    for (const id of ['the_slab', 'hammer_pit_mouth', 'cornice_mouth'])
      expect(dungeonGateState(sim.ctx, fresh, gate(id)), id).not.toBe('open');
  });

  it('breath pulls the Guardian of the Breath on the Cornice and forces every mechanic', () => {
    const { sim, dev, claim } = devSim();
    sim.setPlayerLevel(20);
    expect(dev('/dev heart breath pull')).toBe(true);
    const inst = claim();
    if (!inst) throw new Error('no claim');
    const boss = breathGuardian(sim.ctx, inst);
    expect(boss?.inCombat).toBe(true);
    const o = instanceOrigin(DUNGEON.index, inst.slot);
    expect(Math.hypot(sim.player.pos.x - o.x - 0, sim.player.pos.z - o.z - 198)).toBeLessThan(20);
    sim.player.maxHp = 1e6;
    sim.player.hp = 1e6;
    sim.tick();
    const replies: string[] = [];
    for (const verb of [
      'blow 90',
      'blow sw',
      'calm',
      'circle',
      'inhale',
      'tornado',
      'heroic',
      'phase2',
      'gust 45',
      'chain',
      'eye',
      'conductor',
      'mythic',
      'mythic off',
    ]) {
      const out = (() => {
        dev(`/dev heart breath ${verb}`);
        return logs(sim.tick());
      })();
      sim.player.hp = sim.player.maxHp;
      replies.push(`${verb}: ${out.find((l) => l.startsWith('[dev]')) ?? 'none'}`);
    }
    for (const r of replies) expect(r, r).not.toMatch(/: none$/);
    expect(dev('/dev heart breath')).toBe(true);
    expect(logs(sim.tick()).some((l) => l.includes('Guardian of the Breath'))).toBe(true);
    // Reset: whole, home and out of its fight (standing beside it, the next
    // tick pulls it again).
    expect(dev('/dev heart breath reset')).toBe(true);
    expect(boss?.smithHeartBreath).toBeUndefined();
    expect(boss?.inCombat).toBe(false);
    expect(boss?.hp).toBe(boss?.maxHp);
  });

  it('does nothing without devCommands, and the door refuses a non-dev world', () => {
    const { sim, claim } = devSim(false);
    const before = { ...sim.player.pos };
    sim.chat('/dev heart enter', sim.player.id);
    sim.tick();
    expect(claim()).toBeNull();
    expect(sim.player.pos.x).toBe(before.x);
    expect(sim.player.pos.z).toBe(before.z);
    sim.chat('/dev heart tp heart', sim.player.id);
    sim.tick();
    expect(claim()).toBeNull();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, sim.player.id)).toBe(false);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, sim.player.id, true)).toBe(false);
    expect(claim()).toBeNull();
  });
});
