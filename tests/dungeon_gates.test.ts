// In-dungeon gates and encounter seals (src/sim/instances/dungeon_gates.ts)
// driven through a real Sim claim of the Hollow Crypt: closed until their
// packs and bosses die, sealed while the named boss is engaged, reopened on
// the wipe, closed again when the instance resets, and mirrored to collision
// per slot.

import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { HOLLOW_CRYPT_GATES } from '../src/sim/content/hollow_crypt';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import {
  DUNGEON_GATE_TEMPLATES,
  dungeonGateEntity,
  dungeonGateState,
  dungeonGateStateOf,
} from '../src/sim/instances/dungeon_gates';
import { enterDungeon, freeInstance } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function setup(seed = 11): { sim: Sim; pid: number; inst: InstanceSlot } {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: WORLD });
  const pid = sim.addPlayer('warrior', 'Gatewalker');
  expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
  ) as InstanceSlot;
  sim.tick();
  return { sim, pid, inst };
}

function gate(id: string) {
  const g = HOLLOW_CRYPT_GATES.find((x) => x.id === id);
  if (!g) throw new Error(id);
  return g;
}

/** Kill every claim mob of the listed packs or templates (instant, no loot). */
function kill(sim: Sim, inst: InstanceSlot, ids: string[]): void {
  const spawns = DUNGEONS.hollow_crypt.spawns;
  spawns.forEach((s, i) => {
    if (!ids.includes(s.packId ?? '') && !ids.includes(s.mobId)) return;
    const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
    mob.hp = 0;
    mob.dead = true;
    mob.aiState = 'dead';
    mob.inCombat = false;
  });
}

function blockedAt(sim: Sim, inst: InstanceSlot, id: string): boolean {
  const g = gate(id);
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
  return isBlocked(sim.cfg.seed, o.x + g.x, o.z + g.z, 0.5);
}

function mob(sim: Sim, inst: InstanceSlot, templateId: string): Entity {
  const i = DUNGEONS.hollow_crypt.spawns.findIndex((s) => s.mobId === templateId);
  return sim.ctx.entities.get(inst.mobIds[i]) as Entity;
}

describe('dungeon gates: the Hollow Crypt claim', () => {
  afterEach(() => clearDungeonGateStateForTest());

  it('spawns one closed gate object per gate and blocks every passage', () => {
    const { sim, inst } = setup();
    for (const g of HOLLOW_CRYPT_GATES) {
      const e = dungeonGateEntity(sim.ctx, inst, g);
      expect(e, g.id).not.toBeNull();
      if (g.id === 'rite_ward') continue; // no prerequisites: open until Morthen engages
      expect(e?.templateId, g.id).toBe(DUNGEON_GATE_TEMPLATES.closed);
      expect(blockedAt(sim, inst, g.id), g.id).toBe(true);
    }
    expect(dungeonGateEntity(sim.ctx, inst, gate('rite_ward'))?.templateId).toBe(
      DUNGEON_GATE_TEMPLATES.open,
    );
  });

  it('the Grille opens once every cloister pack is dead, and says so', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, ['c1', 'c2', 'c3']);
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('grille'))).toBe('closed');
    expect(blockedAt(sim, inst, 'grille')).toBe(true);
    kill(sim, inst, ['c4']);
    const events = sim.tick() as { type: string; text?: string; pid?: number }[];
    expect(dungeonGateState(sim.ctx, inst, gate('grille'))).toBe('open');
    expect(dungeonGateEntity(sim.ctx, inst, gate('grille'))?.templateId).toBe('dungeon_gate_open');
    expect(blockedAt(sim, inst, 'grille')).toBe(false);
    const logs = events.filter((e) => e.type === 'log' && e.pid === pid);
    expect(logs.map((l) => l.text)).toContain('The Undercroft Grille grinds open.');
    // Announced once: a later tick does not repeat it.
    expect(
      (sim.tick() as { type: string; text?: string }[]).some(
        (e) => e.text === 'The Undercroft Grille grinds open.',
      ),
    ).toBe(false);
  });

  it('an arena seals while its boss is engaged and reopens when it resets', () => {
    const { sim, inst } = setup();
    kill(sim, inst, ['c1', 'c2', 'c3', 'c4', 'w1', 'w2', 'w3', 'w4']);
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('yard_barrier'))).toBe('open');
    const marrow = mob(sim, inst, 'sexton_marrow');
    marrow.aiState = 'chase';
    marrow.inCombat = true;
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('yard_barrier'))).toBe('sealed');
    expect(dungeonGateEntity(sim.ctx, inst, gate('yard_barrier'))?.templateId).toBe(
      'dungeon_gate_sealed',
    );
    expect(blockedAt(sim, inst, 'yard_barrier')).toBe(true);
    // The wipe: the boss evades home and goes idle again.
    marrow.aiState = 'idle';
    marrow.inCombat = false;
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('yard_barrier'))).toBe('open');
    expect(blockedAt(sim, inst, 'yard_barrier')).toBe(false);
  });

  it('the Webbed Causeway opens on Rimeweb death, not before', () => {
    const { sim, inst } = setup();
    kill(sim, inst, ['c1', 'c2', 'c3', 'c4', 'e1', 'e2', 'e3']);
    sim.tick();
    expect(blockedAt(sim, inst, 'web_bridge')).toBe(true);
    kill(sim, inst, ['rimeweb']);
    sim.tick();
    expect(blockedAt(sim, inst, 'web_bridge')).toBe(false);
    expect(blockedAt(sim, inst, 'web_curtain')).toBe(false);
  });

  it('the Twin Seals need both wing bosses, the Processional packs and the drake', () => {
    const { sim, inst } = setup();
    kill(sim, inst, [
      ...['c1', 'c2', 'c3', 'c4', 'w1', 'w2', 'w3', 'w4', 'e1', 'e2', 'e3'],
      ...['p1', 'p2', 'sexton_marrow', 'rimeweb'],
    ]);
    sim.tick();
    // The drake still flies: the seals hold.
    expect(dungeonGateState(sim.ctx, inst, gate('twin_seals'))).toBe('closed');
    kill(sim, inst, ['drake']);
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('twin_seals'))).toBe('open');
    expect(blockedAt(sim, inst, 'twin_seals')).toBe(false);
  });

  it('the Twin Seals need both wing bosses', () => {
    const { sim, inst } = setup();
    kill(sim, inst, [
      ...['c1', 'c2', 'c3', 'c4', 'w1', 'w2', 'w3', 'w4', 'e1', 'e2', 'e3'],
      ...['p1', 'drake', 'p2', 'sexton_marrow'],
    ]);
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('twin_seals'))).toBe('closed');
    kill(sim, inst, ['rimeweb']);
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, gate('twin_seals'))).toBe('open');
    expect(blockedAt(sim, inst, 'twin_seals')).toBe(false);
  });

  it('a reset re-closes every gate for the fresh claim', () => {
    const { sim, pid, inst } = setup();
    kill(sim, inst, ['c1', 'c2', 'c3', 'c4']);
    sim.tick();
    expect(blockedAt(sim, inst, 'grille')).toBe(false);
    // Leave, free the claim, and claim again from the door.
    sim.leaveDungeon(pid);
    freeInstance(sim.ctx, inst);
    sim.tick();
    expect(blockedAt(sim, inst, 'grille')).toBe(true);
    expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
    const fresh = sim.ctx.instances.find(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    ) as InstanceSlot;
    sim.tick();
    expect(dungeonGateState(sim.ctx, fresh, gate('grille'))).toBe('closed');
    expect(blockedAt(sim, fresh, 'grille')).toBe(true);
  });

  it('every gate announcement is a known client line (i18n EXACT matcher)', () => {
    for (const g of HOLLOW_CRYPT_GATES) {
      if (!g.openText) continue;
      expect(localizeSimText(g.openText), g.id).not.toBeNull();
    }
  });

  it('gate template ids round-trip through the wire decoder', () => {
    for (const state of ['open', 'closed', 'sealed'] as const) {
      expect(dungeonGateStateOf(DUNGEON_GATE_TEMPLATES[state])).toBe(state);
    }
    expect(dungeonGateStateOf('dungeon_door')).toBeNull();
  });

  it('is deterministic: two worlds from one seed derive identical gate states', () => {
    const run = (): string[] => {
      const { sim, inst } = setup(21);
      kill(sim, inst, ['c1', 'c2', 'c3', 'c4', 'e1']);
      for (let i = 0; i < 5; i++) sim.tick();
      return HOLLOW_CRYPT_GATES.map((g) => dungeonGateState(sim.ctx, inst, g));
    };
    expect(run()).toEqual(run());
  });
});
