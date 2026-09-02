// Scratch bench for D139: the cost of emitToZonePlayers' O(all players) walk with a
// zoneAt call per player, on the fanout suite's own fixture shape (in-zone recipients,
// far-zone and instanced non-recipients). Not sim code: wall-clock is fine here.
import { performance } from 'node:perf_hooks';
import {
  DUNGEON_X_THRESHOLD,
  STRIP_MAX_X,
  STRIP_MIN_X,
  ZONES,
  zoneAt,
  zoneContaining,
} from '../../../src/sim/data';
import {
  emitToZonePlayers,
  GATHER_RARE_EVENT_CHANCE,
} from '../../../src/sim/professions/gather_events';
import type { SimContext } from '../../../src/sim/sim_context';
import type { SimEvent } from '../../../src/sim/types';

type Pos = { x: number; z: number };
function zoneCentre(i: number): Pos {
  const z = ZONES[i];
  const x0 = z.xMin ?? STRIP_MIN_X;
  const x1 = z.xMax ?? STRIP_MAX_X;
  return { x: (x0 + x1) / 2, z: (z.zMin + z.zMax) / 2 };
}
// Sanity: every zone centre resolves to its own zone under zoneAt.
for (let i = 0; i < ZONES.length; i++) {
  const c = zoneCentre(i);
  if (zoneAt(c.x, c.z).id !== ZONES[i].id) throw new Error(`centre of ${ZONES[i].id} resolves elsewhere`);
}
const HOME = ZONES[0].id;

function world(total: number, inZone: number, instancedShare = 0.1) {
  const entities = new Map<number, { pos: Pos }>();
  const players = new Map<number, { entityId: number; name: string }>();
  let emitted = 0;
  const instanced = Math.floor(total * instancedShare);
  const others = total - inZone - instanced;
  let pid = 100;
  for (let i = 0; i < inZone; i++, pid++) {
    const c = zoneCentre(0);
    entities.set(pid, { pos: { x: c.x + (i % 7) * 3, z: c.z + (i % 5) * 3 } });
    players.set(pid, { entityId: pid, name: `P${pid}` });
  }
  for (let i = 0; i < others; i++, pid++) {
    const zi = 1 + (i % (ZONES.length - 1));
    const c = zoneCentre(zi);
    entities.set(pid, { pos: { x: c.x + (i % 5), z: c.z + (i % 3) } });
    players.set(pid, { entityId: pid, name: `P${pid}` });
  }
  for (let i = 0; i < instanced; i++, pid++) {
    entities.set(pid, { pos: { x: DUNGEON_X_THRESHOLD + 100 + i, z: (i % 9) * 20 } });
    players.set(pid, { entityId: pid, name: `P${pid}` });
  }
  const ctx = {
    entities,
    players,
    emit: (_ev: SimEvent) => {
      emitted++;
    },
  } as unknown as SimContext;
  return { ctx, count: () => emitted, reset: () => (emitted = 0) };
}

const build = (recipientPid: number): SimEvent =>
  ({
    type: 'masterworkZone',
    pid: recipientPid,
    crafterPid: 100,
    crafterName: 'Grimmschaedel',
    itemId: 'eastbrook_ritual_vestments',
    recipeId: 'recipe_eastbrook_ritual_vestments',
    zoneId: HOME,
  }) as SimEvent;

function bench(label: string, fn: () => void, iters: number): number {
  for (let i = 0; i < Math.min(iters, 200); i++) fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iters;
  return ns;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

console.log(`ZONES=${ZONES.length} DUNGEON_X_THRESHOLD=${DUNGEON_X_THRESHOLD} GATHER_RARE_EVENT_CHANCE=${GATHER_RARE_EVENT_CHANCE}`);
console.log('rows: total players | in-zone | ns per celebration (median of 5) | ns per player walked | recipients');
const shapes: Array<[number, number]> = [
  [200, 200], // everyone in one zone (the record's measured sample, no waste)
  [200, 12],
  [1000, 200], // 1,000 sessions, 200 in-zone (the record's routing sample)
  [1000, 12],
  [5000, 200],
  [5000, 5000], // the absolute ceiling: whole realm in one zone
  [5000, 12],
];
const results: Record<string, number> = {};
for (const [total, inZone] of shapes) {
  const w = world(total, inZone);
  const iters = Math.max(200, Math.floor(2_000_000 / total));
  const runs: number[] = [];
  for (let r = 0; r < 5; r++) runs.push(bench('fanout', () => emitToZonePlayers(w.ctx, HOME, build), iters));
  w.reset();
  emitToZonePlayers(w.ctx, HOME, build);
  const recipients = w.count();
  const perCel = median(runs);
  results[`${total}/${inZone}`] = perCel;
  console.log(`${total} | ${inZone} | ${perCel.toFixed(0)} ns | ${(perCel / total).toFixed(1)} ns | ${recipients}`);
}
// zoneAt alone, per call, at the same position mix (the walk's per-player term minus the map get + emit).
{
  const w = world(5000, 200);
  const positions = [...w.ctx.entities.values()].map((e) => e.pos);
  let sink = 0;
  const ns = median(
    Array.from({ length: 5 }, () =>
      bench(
        'zoneAt',
        () => {
          for (const p of positions) sink += zoneAt(p.x, p.z).zMax;
        },
        100,
      ),
    ),
  );
  console.log(`zoneAt alone over 5000 positions: ${(ns / 5000).toFixed(1)} ns per call (sink ${sink > 0})`);
  const ns2 = median(
    Array.from({ length: 5 }, () =>
      bench(
        'zoneContaining',
        () => {
          for (const p of positions) sink += zoneContaining(p.x, p.z)?.zMax ?? 0;
        },
        100,
      ),
    ),
  );
  console.log(`zoneContaining alone over 5000 positions: ${(ns2 / 5000).toFixed(1)} ns per call`);
  // Instanced share: how many of the 5000 skip zoneAt via the x threshold.
  const skipped = positions.filter((p) => p.x > DUNGEON_X_THRESHOLD).length;
  console.log(`instanced (threshold-skipped) players in that world: ${skipped}`);
}
// The walk's non-recipient waste: the 5000/12 row minus the 12-recipient emit cost.
const emitOnly = results['200/200'] / 200; // ns per recipient incl walk, upper bound on the emit term
console.log(`upper bound on the per-recipient mint+emit term (200/200 row / 200): ${emitOnly.toFixed(1)} ns`);
