// Shared harness for the Drowned Temple sixth-pass suites (the chasing
// Colossus, the elemental Mere Hydra, the trash kits): a real claimed Temple
// with a real party, every pack but the bosses and the Hydra cleared, and every
// damage event recorded so a suite can read what each mechanic dealt without
// racing the health top-up.

import { DUNGEONS, instanceOrigin } from '../../src/sim/data';
import {
  COLOSSUS_ID,
  HYDRA_CENTER_ID,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  SELTHE_ID,
  YSOLEI_ID,
} from '../../src/sim/encounters/drowned_temple';
import { claimedInstanceAt, enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import { DT, type Entity } from '../../src/sim/types';

export interface Hit {
  targetId: number;
  sourceId: number;
  amount: number;
  ability: string | null;
}

export interface Fight {
  sim: Sim;
  inst: InstanceSlot;
  ox: number;
  oz: number;
  tank: Entity;
  others: Entity[];
  /** Every damage event since the fight began, in order. */
  hits: Hit[];
}

const KEEP = new Set([
  SELTHE_ID,
  COLOSSUS_ID,
  YSOLEI_ID,
  HYDRA_LEFT_ID,
  HYDRA_CENTER_ID,
  HYDRA_RIGHT_ID,
]);

/** A claimed Temple and a party; `clear` kills every pack (keeping the bosses). */
export function fight(difficulty: 'normal' | 'heroic' = 'normal', extra = 2, clear = true): Fight {
  const sim = new Sim({ seed: 29, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('mage', `Tidewader${i}`);
    sim.partyInvite(pid, tank.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev temple enter ${difficulty}`, tank.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'drowned_temple', pid);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no temple claim');
  if (clear) {
    for (const id of inst.mobIds) {
      const e = sim.ctx.entities.get(id);
      if (e && !e.dead && !KEEP.has(e.templateId)) sim.ctx.handleDeath(e, tank);
    }
  }
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [tank, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.drowned_temple.index, inst.slot);
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, tank, others, hits: [] };
}

export function boss(f: Fight, id: string): Entity {
  for (const mid of f.inst.mobIds) {
    const e = f.sim.ctx.entities.get(mid);
    if (e?.templateId === id) return e;
  }
  throw new Error(`no ${id}`);
}

export function put(f: Fight, e: Entity, x: number, z: number): void {
  e.pos = f.sim.ctx.groundPos(f.ox + x, f.oz + z);
  e.prevPos = { ...e.pos };
  f.sim.ctx.grid.update(e);
}

export function local(f: Fight, e: Entity): { x: number; z: number } {
  return { x: e.pos.x - f.ox, z: e.pos.z - f.oz };
}

export function tick(f: Fight, keep: () => void = () => {}): void {
  for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
  keep();
  for (const ev of f.sim.tick())
    if (ev.type === 'damage')
      f.hits.push({
        targetId: ev.targetId,
        sourceId: ev.sourceId,
        amount: ev.amount,
        ability: ev.ability,
      });
}

export function run(f: Fight, seconds: number, keep: () => void = () => {}): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) tick(f, keep);
}

/** Damage `e` took from `ability` since hit index `from`. */
export function took(f: Fight, e: Entity, ability: string, from = 0): number {
  let sum = 0;
  for (let i = from; i < f.hits.length; i++) {
    const h = f.hits[i];
    if (h.targetId === e.id && h.ability === ability) sum += h.amount;
  }
  return sum;
}

/** Tick until `done` holds (at most `seconds`); true when it did. */
export function until(f: Fight, done: () => boolean, seconds: number, keep?: () => void): boolean {
  for (let t = 0; t < seconds; t += DT) {
    if (done()) return true;
    tick(f, keep);
  }
  return done();
}

export function engage(f: Fight, b: Entity, hp = 1e6): void {
  b.maxHp = Math.max(b.maxHp, hp);
  b.hp = b.maxHp;
  f.sim.ctx.aggroMob(b, f.tank, false);
}

export function aura(e: Entity, id: string) {
  return e.auras.find((a) => a.id === id);
}

export function objects(f: Fight, template: string): Entity[] {
  const out: Entity[] = [];
  for (const id of f.inst.objectIds) {
    const e = f.sim.ctx.entities.get(id);
    if (e?.templateId === template) out.push(e);
  }
  return out;
}

export function earned(f: Fight, e: Entity, deed: string): boolean {
  return f.sim.players.get(e.id)?.deedsEarned.has(deed) ?? false;
}
