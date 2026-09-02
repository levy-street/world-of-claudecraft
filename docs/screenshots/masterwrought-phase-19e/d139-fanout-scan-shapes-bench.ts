// D139 bench, part 2: the same walk under the two cheaper shapes the row prices, so the
// ruling can weigh them on numbers: Option 4 (rect test against the celebration zone's own
// rect, no new state) and Option 3's cheap form (a per-player cached zoneId string compare,
// the state Option 3 would have to keep roster-exact).
import { performance } from 'node:perf_hooks';
import {
  DUNGEON_X_THRESHOLD, STRIP_MAX_X, STRIP_MIN_X, ZONES, zoneAt,
} from '../../../src/sim/data';
import type { ZoneDef, SimEvent } from '../../../src/sim/types';

type Pos = { x: number; z: number };
function zoneCentre(i: number): Pos {
  const z = ZONES[i]; const x0 = z.xMin ?? STRIP_MIN_X; const x1 = z.xMax ?? STRIP_MAX_X;
  return { x: (x0 + x1) / 2, z: (z.zMin + z.zMax) / 2 };
}
function world(total: number, inZone: number, instancedShare = 0.1) {
  const entities = new Map<number, { pos: Pos; zoneId: string }>();
  const players = new Map<number, { entityId: number }>();
  const instanced = Math.floor(total * instancedShare); const others = total - inZone - instanced; let pid = 100;
  const add = (pos: Pos) => { entities.set(pid, { pos, zoneId: pos.x > DUNGEON_X_THRESHOLD ? '' : zoneAt(pos.x, pos.z).id }); players.set(pid, { entityId: pid }); pid++; };
  for (let i = 0; i < inZone; i++) { const c = zoneCentre(0); add({ x: c.x + (i % 7) * 3, z: c.z + (i % 5) * 3 }); }
  for (let i = 0; i < others; i++) { const c = zoneCentre(1 + (i % (ZONES.length - 1))); add({ x: c.x + (i % 5), z: c.z + (i % 3) }); }
  for (let i = 0; i < instanced; i++) add({ x: DUNGEON_X_THRESHOLD + 100 + i, z: (i % 9) * 20 });
  return { entities, players };
}
let emitted = 0; const emit = (_e: SimEvent) => { emitted++; };
const build = (pid: number): SimEvent => ({ type: 'masterworkZone', pid, crafterPid: 100, crafterName: 'G', itemId: 'x', recipeId: 'y', zoneId: ZONES[0].id }) as SimEvent;
const home: ZoneDef = ZONES[0];
// Shape today (zoneAt per player), re-implemented verbatim so all three run in one harness.
function walkZoneAt(w: ReturnType<typeof world>) {
  for (const meta of w.players.values()) { const e = w.entities.get(meta.entityId); if (!e) continue;
    if (e.pos.x > DUNGEON_X_THRESHOLD || zoneAt(e.pos.x, e.pos.z).id !== home.id) continue; emit(build(meta.entityId)); }
}
// Option 4: rect test against the celebration zone's own rect (zoneAt semantics for the
// in-rect case; the southmost-band fallback and active-content differences are NOT modelled).
function walkRect(w: ReturnType<typeof world>) {
  const x0 = home.xMin ?? STRIP_MIN_X, x1 = home.xMax ?? STRIP_MAX_X, z0 = home.zMin, z1 = home.zMax;
  for (const meta of w.players.values()) { const e = w.entities.get(meta.entityId); if (!e) continue;
    const p = e.pos; if (p.x > DUNGEON_X_THRESHOLD || p.z < z0 || p.z >= z1 || p.x < x0 || p.x >= x1) continue; emit(build(meta.entityId)); }
}
// Option 3 cheap form: a per-player cached zoneId (kept exact elsewhere), one string compare.
function walkCached(w: ReturnType<typeof world>) {
  for (const meta of w.players.values()) { const e = w.entities.get(meta.entityId); if (!e) continue;
    if (e.zoneId !== home.id) continue; emit(build(meta.entityId)); }
}
function bench(fn: () => void, iters: number) { for (let i = 0; i < 100; i++) fn(); const t0 = performance.now(); for (let i = 0; i < iters; i++) fn(); return ((performance.now() - t0) * 1e6) / iters; }
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log('total/in-zone | zoneAt walk (today) | rect test (opt 4) | cached zoneId (opt 3 cheap) | recipients agree');
for (const [total, inZone] of [[1000, 200], [5000, 200], [5000, 5000], [5000, 12]] as Array<[number, number]>) {
  const w = world(total, inZone); const iters = Math.max(200, Math.floor(2_000_000 / total));
  const a = med(Array.from({ length: 5 }, () => bench(() => walkZoneAt(w), iters)));
  const b = med(Array.from({ length: 5 }, () => bench(() => walkRect(w), iters)));
  const c = med(Array.from({ length: 5 }, () => bench(() => walkCached(w), iters)));
  emitted = 0; walkZoneAt(w); const ra = emitted; emitted = 0; walkRect(w); const rb = emitted; emitted = 0; walkCached(w); const rc = emitted;
  console.log(`${total}/${inZone} | ${(a / 1000).toFixed(1)} us | ${(b / 1000).toFixed(1)} us | ${(c / 1000).toFixed(1)} us | ${ra}/${rb}/${rc}`);
}
