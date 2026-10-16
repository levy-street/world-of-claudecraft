// Shared harness for the Drowned Temple lore guide suites (tests/
// drowned_temple_cantor*.test.ts): a claimed Temple run with a party, the
// guide, and the route down the floating walkways, driven by full Sim ticks.

import { CANTOR_NPC_ID, CANTOR_SPAWN } from '../../src/sim/content/drowned_temple_cantor';
import { DUNGEONS, instanceOrigin } from '../../src/sim/data';
import { claimedInstanceAt, enterDungeon } from '../../src/sim/instances/dungeons';
import type { InstanceSlot } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import { DT, type Entity, type SimEvent, type Vec3 } from '../../src/sim/types';

export interface Run {
  sim: Sim;
  inst: InstanceSlot;
  ox: number;
  oz: number;
  lead: Entity;
  others: Entity[];
  guide: Entity;
  events: SimEvent[];
}

export const BOSSES = new Set([
  'choirmother_selthe',
  'tideglass_colossus',
  'ysolei',
  'mere_hydra_head_left',
  'mere_hydra_head_center',
  'mere_hydra_head_right',
]);

export function temple(
  opts: {
    difficulty?: 'normal' | 'heroic';
    extra?: number;
    clearTrash?: boolean;
    seed?: number;
  } = {},
): Run {
  const sim = new Sim({
    seed: opts.seed ?? 23,
    playerClass: 'warrior',
    autoEquip: false,
    devCommands: true,
  });
  const lead = sim.player;
  sim.chat('/dev level 20', lead.id);
  const ids: number[] = [];
  for (let i = 0; i < (opts.extra ?? 2); i++) {
    const pid = sim.addPlayer('priest', `Wader${i}`);
    sim.partyInvite(pid, lead.id);
    sim.partyAccept(pid);
    ids.push(pid);
  }
  sim.chat(`/dev temple enter ${opts.difficulty ?? 'normal'}`, lead.id);
  for (const pid of ids) enterDungeon(sim.ctx, 'drowned_temple', pid);
  const inst = claimedInstanceAt(sim.ctx, lead.pos);
  if (!inst) throw new Error('no temple claim');
  if (opts.clearTrash !== false) {
    for (const id of inst.mobIds) {
      const e = sim.ctx.entities.get(id);
      if (e && !e.dead && !BOSSES.has(e.templateId)) sim.ctx.handleDeath(e, lead);
    }
  }
  const others = ids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  for (const p of [lead, ...others]) {
    p.maxHp = 1e7;
    p.hp = 1e7;
  }
  const o = instanceOrigin(DUNGEONS.drowned_temple.index, inst.slot);
  const guideId = inst.npcIds.find((id) => sim.ctx.entities.get(id)?.templateId === CANTOR_NPC_ID);
  const guide = guideId === undefined ? null : sim.ctx.entities.get(guideId);
  if (!guide) throw new Error('no guide');
  sim.drainEvents();
  return { sim, inst, ox: o.x, oz: o.z, lead, others, guide, events: [] };
}

export function at(r: Run, x: number, z: number): Vec3 {
  return r.sim.ctx.groundPos(r.ox + x, r.oz + z);
}

export function put(r: Run, e: Entity, x: number, z: number): void {
  e.pos = at(r, x, z);
  e.prevPos = { ...e.pos };
  r.sim.ctx.rebucket(e);
}

export function tick(r: Run, seconds: number, each: () => void = () => {}): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    each();
    r.events.push(...r.sim.tick());
  }
}

export function linesFor(r: Run, pid: number): string[] {
  return r.events
    .filter(
      (ev): ev is Extract<SimEvent, { type: 'dungeonGuideLine' }> =>
        ev.type === 'dungeonGuideLine' && ev.pid === pid,
    )
    .map((ev) => ev.lineId);
}

/** Stand the whole group beside the guide on the landing. */
export function gather(r: Run): void {
  put(r, r.lead, CANTOR_SPAWN.x - 2, CANTOR_SPAWN.z);
  r.others.forEach((p, i) => {
    put(r, p, CANTOR_SPAWN.x - 3 - i, CANTOR_SPAWN.z + 1);
  });
}

// The Moongate Landing, down the Pilgrim Steps, along the Reflecting Causeway
// and the Colonnade to the Choir Stair: every point on a walkway.
export const ROUTE: [number, number][] = [
  [0, -224],
  [3.9, -218.1],
  [0, -215],
  [-24, -196],
  [-28, -193],
  [-31, -183],
  [-27.5, -178],
  [-11.3, -155],
  [-9.5, -152.5],
  [-5, -140],
  [0, -112],
  [0, -92],
  [0, -76],
  [0, -50],
];

/** Points every `step` yards along the route. */
export function routePoints(step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const [ax, az] = ROUTE[i];
    const [bx, bz] = ROUTE[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(ROUTE[ROUTE.length - 1]);
  return out;
}

/** Walk the group down the route at run pace (the others a few yards behind). */
export function walkRoute(
  r: Run,
  upto = Number.POSITIVE_INFINITY,
  each: () => void = () => {},
): void {
  const pts = routePoints(7 * DT);
  const n = Math.min(pts.length, upto);
  for (let i = 0; i < n; i++) {
    put(r, r.lead, pts[i][0], pts[i][1]);
    r.others.forEach((p, k) => {
      const j = Math.max(0, i - 15 * (k + 1));
      put(r, p, pts[j][0], pts[j][1]);
    });
    each();
    r.events.push(...r.sim.tick());
  }
}

export function bossOf(r: Run, id: string): Entity {
  for (const mid of r.inst.mobIds) {
    const e = r.sim.ctx.entities.get(mid);
    if (e?.templateId === id) return e;
  }
  throw new Error(`no ${id}`);
}
