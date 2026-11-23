// Shared harness for the Wildheart Basin boss suites (the Fanglord Beastmaster
// and his Great Jaguar, the Gorgebloom, Zulgar): a real claimed Basin with a
// real party, every pack and patrol cleared (the Great Saurian too), the gates
// open, and every damage event recorded so a suite can read what each
// mechanic dealt without racing the health top-up. The Bastion harness's
// shape.

import { DUNGEONS, instanceOrigin } from '../../src/sim/data';
import {
  BEASTMASTER_ID,
  FANGLORD_JAGUAR_ID,
  GORGEBLOOM_ID,
  ZULGAR_ID,
} from '../../src/sim/encounters/wildheart_basin';
import { setDungeonGatesDevOpen } from '../../src/sim/instances/dungeon_gates';
import { claimedInstanceAt, enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import { DT, type Entity, type PlayerClass } from '../../src/sim/types';

export interface Hit {
  sourceId: number;
  targetId: number;
  amount: number;
  ability: string | null;
  kind: string;
  school: string;
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
  /** Every log and chat line since the fight began. */
  lines: string[];
  /** Every spellfx ability id since the fight began. */
  fx: string[];
}

const KEEP = new Set([BEASTMASTER_ID, FANGLORD_JAGUAR_ID, GORGEBLOOM_ID, ZULGAR_ID]);

export function fight(
  difficulty: 'normal' | 'heroic' = 'normal',
  extra = 3,
  cls: PlayerClass = 'mage',
  keepAlso: readonly string[] = [],
): Fight {
  const sim = new Sim({ seed: 37, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer(cls, `Basinhand${i}`);
    sim.partyInvite(pid, tank.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev wildheart enter ${difficulty}`, tank.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'wildheart_basin', pid);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no wildheart claim');
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (e && !e.dead && !KEEP.has(e.templateId) && !keepAlso.includes(e.templateId))
      sim.ctx.handleDeath(e, tank);
  }
  setDungeonGatesDevOpen(inst, true);
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [tank, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.wildheart_basin.index, inst.slot);
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, tank, others, hits: [], lines: [], fx: [] };
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
  for (const ev of f.sim.tick()) {
    if (ev.type === 'damage')
      f.hits.push({
        sourceId: ev.sourceId,
        targetId: ev.targetId,
        amount: ev.amount,
        ability: ev.ability,
        kind: ev.kind,
        school: ev.school,
      });
    else if (ev.type === 'log' || ev.type === 'chat') f.lines.push(ev.text);
    else if (ev.type === 'spellfx' && ev.ability) f.fx.push(ev.ability);
  }
}

export function run(f: Fight, seconds: number, keep: () => void = () => {}): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) tick(f, keep);
}

/** Tick until `done` holds (at most `seconds`); true when it did. */
export function until(f: Fight, done: () => boolean, seconds: number, keep?: () => void): boolean {
  for (let t = 0; t < seconds; t += DT) {
    if (done()) return true;
    tick(f, keep);
  }
  return done();
}

/** The hits `e` took from `ability` since hit index `from`. */
export function hitsOn(f: Fight, e: Entity, ability: string, from = 0): Hit[] {
  return f.hits.slice(from).filter((h) => h.targetId === e.id && h.ability === ability);
}

/** Pull a boss onto the tank with a big pool so the fight lasts. */
export function engage(f: Fight, b: Entity, pool = 1e6): void {
  b.maxHp = Math.max(b.maxHp, pool);
  b.hp = b.maxHp;
  f.sim.ctx.aggroMob(b, f.tank, false);
}

/** Everyone falls back out of reach and the boss walks home: a wipe. */
export function wipe(f: Fight, ...bosses: Entity[]): void {
  for (const p of [f.tank, ...f.others]) put(f, p, 0, -217);
  for (const b of bosses) {
    b.inCombat = false;
    b.aggroTargetId = null;
    b.aiState = 'evade';
  }
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

export function live(f: Fight, templateId: string): Entity[] {
  return [...f.sim.ctx.entities.values()].filter((e) => e.templateId === templateId && !e.dead);
}

export function earned(f: Fight, e: Entity, deed: string): boolean {
  return f.sim.players.get(e.id)?.deedsEarned.has(deed) ?? false;
}

/** Hold every player still where they stand (no input: the tests place them). */
export function everyone(f: Fight): Entity[] {
  return [f.tank, ...f.others];
}
