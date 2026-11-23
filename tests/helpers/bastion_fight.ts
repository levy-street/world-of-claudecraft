// Shared harness for the Sunken Bastion fifth-pass suites (the Gaol Turnkey,
// Gaoler Ossick and Vael the reaper): a real claimed Bastion with a real party,
// every pack but the three bosses cleared, and every damage event recorded so a
// suite can read what each mechanic dealt without racing the health top-up.

import { DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { OSSICK_ID, TURNKEY_ID, VAEL_ID } from '../../src/sim/encounters/sunken_bastion';
import { claimedInstanceAt, enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import { DT, type Entity } from '../../src/sim/types';

export interface Hit {
  targetId: number;
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
  /** Every spellfx cue since the fight began, in order. */
  cues: { sourceId: number; targetId: number; ability: string | null }[];
}

const KEEP = new Set([TURNKEY_ID, OSSICK_ID, VAEL_ID]);

export function fight(
  difficulty: 'normal' | 'heroic' = 'normal',
  extra = 3,
  keep: ReadonlySet<string> = KEEP,
): Fight {
  const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  const ids: number[] = [];
  for (let i = 0; i < extra; i++) {
    const pid = sim.addPlayer('mage', `Gaolbird${i}`);
    sim.partyInvite(pid, tank.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev bastion enter ${difficulty}`, tank.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'sunken_bastion', pid);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error('no bastion claim');
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (e && !e.dead && !keep.has(e.templateId)) sim.ctx.handleDeath(e, tank);
  }
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [tank, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.sunken_bastion.index, inst.slot);
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, tank, others, hits: [], cues: [] };
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

export function tick(f: Fight, keep: () => void = () => {}): void {
  for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
  keep();
  for (const ev of f.sim.tick()) {
    if (ev.type === 'damage')
      f.hits.push({ targetId: ev.targetId, amount: ev.amount, ability: ev.ability });
    else if (ev.type === 'spellfx')
      f.cues.push({ sourceId: ev.sourceId, targetId: ev.targetId, ability: ev.ability ?? null });
  }
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

export function engage(f: Fight, b: Entity): void {
  b.maxHp = Math.max(b.maxHp, 1e6);
  b.hp = b.maxHp;
  f.sim.ctx.aggroMob(b, f.tank, false);
}

export function aura(e: Entity, id: string) {
  return e.auras.find((a) => a.id === id);
}

export function live(f: Fight, templateId: string): Entity[] {
  return [...f.sim.ctx.entities.values()].filter((e) => e.templateId === templateId && !e.dead);
}

export function earned(f: Fight, e: Entity, deed: string): boolean {
  return f.sim.players.get(e.id)?.deedsEarned.has(deed) ?? false;
}
