// Read-only terrain + surroundings probe for a dungeon door: the sim's own
// terrainHeight and groundHeight on a fine (0.5 yd) and a coarse grid, and every
// road, NPC, camp, quest object, gather node, prop and static collider near it.
// The Seal Gate (build_sanctum_entrance.py) is modelled against its output.
// Usage (from the repo root):
//   npx tsx docs/design/dungeon-rework/entrance/probe.mts sanctum 0 858 <outDir> 32 130
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WT = new URL('../../../../src/sim/', import.meta.url).href;
const world = await import(`${WT}world.ts`);
const data = await import(`${WT}data.ts`);
const seedMod = await import(`${WT}world_seed.ts`);
const colliders = await import(`${WT}colliders.ts`);
const wb = await import(`${WT}world_boss.ts`);

const [name, sx, sz, outDir, fh, ch] = process.argv.slice(2);
const DX = Number(sx);
const DZ = Number(sz);
const FINE_HALF = Number(fh ?? 24);
const COARSE_HALF = Number(ch ?? 120);
const SEED = seedMod.WORLD_SEED;
mkdirSync(outDir, { recursive: true });

function grid(half: number, step: number, fn: (x: number, z: number) => number) {
  const n = Math.round((2 * half) / step) + 1;
  const rows: number[][] = [];
  for (let j = 0; j < n; j++) {
    const z = DZ - half + j * step;
    const row: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = DX - half + i * step;
      row.push(Math.round(fn(x, z) * 1000) / 1000);
    }
    rows.push(row);
  }
  return { originX: DX - half, originZ: DZ - half, step, n, rows };
}

const th = (x: number, z: number) => world.terrainHeight(x, z, SEED);
const gh = (x: number, z: number) => world.groundHeight(x, z, SEED);
const fineT = grid(FINE_HALF, 0.5, th);
const fineG = grid(FINE_HALF, 0.5, gh);
const coarse = grid(COARSE_HALF, 2, th);
let wl: number | null = null;
try {
  wl = world.waterLevelAt(DX, DZ, SEED);
} catch {
  wl = world.WATER_LEVEL;
}

const R = 70;
const near = (x: number, z: number) => Math.hypot(x - DX, z - DZ) <= R;
const content = data.getActiveWorldContent();
const feats: any[] = [];
const push = (kind: string, x: number, z: number, extra: any = {}) => {
  if (near(x, z))
    feats.push({
      kind,
      x,
      z,
      d: Math.round(Math.hypot(x - DX, z - DZ) * 10) / 10,
      y: Math.round(th(x, z) * 100) / 100,
      ...extra,
    });
};
for (const npc of Object.values(content.npcs) as any[])
  push('npc', npc.pos.x, npc.pos.z, { id: npc.id, name: npc.name, facing: npc.facing });
for (const c of content.camps as any[]) {
  if (Math.hypot(c.center.x - DX, c.center.z - DZ) <= R + c.radius)
    feats.push({
      kind: 'camp',
      x: c.center.x,
      z: c.center.z,
      r: c.radius,
      mobId: c.mobId,
      count: c.count,
      d: Math.round(Math.hypot(c.center.x - DX, c.center.z - DZ) * 10) / 10,
    });
}
for (const g of content.groundObjects as any[])
  for (const p of g.positions) push('groundObject', p.x, p.z, { itemId: g.itemId, name: g.name });
for (const n of data.GATHER_NODES as any[])
  push('gatherNode', n.pos.x, n.pos.z, { id: n.id, type: n.type });
for (const b of wb.WORLD_BOSSES as any[])
  push('worldBoss', b.pos.x, b.pos.z, { id: b.id ?? b.mobId });
for (const d of data.DUNGEON_LIST as any[])
  if (d.doorPos) push('dungeonDoor', d.doorPos.x, d.doorPos.z, { id: d.id });
// Props: generic scan.
function scan(obj: any, label: string) {
  if (Array.isArray(obj)) {
    for (const it of obj) {
      if (Array.isArray(it) && typeof it[0] === 'number' && typeof it[1] === 'number')
        push('prop:' + label, it[0], it[1], { raw: it });
      else if (
        it &&
        typeof it === 'object' &&
        typeof it.x === 'number' &&
        typeof it.z === 'number'
      ) {
        const { x, z, ...rest } = it;
        push('prop:' + label, x, z, { raw: rest });
      } else if (it && typeof it === 'object' && typeof it.x1 === 'number') {
        const mx = (it.x1 + it.x2) / 2,
          mz = (it.z1 + it.z2) / 2;
        if (near(it.x1, it.z1) || near(it.x2, it.z2) || near(mx, mz))
          feats.push({ kind: 'prop:' + label, x: mx, z: mz, raw: it });
      } else if (it && typeof it === 'object') scan(it, label);
    }
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) scan(v, label ? `${label}.${k}` : k);
  }
}
scan(content.props, '');
if (content.services) scan(content.services, 'service');
const pois: any[] = [];
for (const z of content.zones as any[])
  for (const p of z.pois ?? [])
    if (p.x !== undefined && near(p.x, p.z)) pois.push({ zone: z.id, ...p });
for (const z of content.zones as any[])
  for (const p of z.pois ?? [])
    if (p.pos && near(p.pos.x, p.pos.z)) pois.push({ zone: z.id, ...p });
// Roads: segments with any point within R.
const roads: any[] = [];
content.roads.forEach((r: any[], idx: number) => {
  if (r.some((p) => near(p.x, p.z))) roads.push({ idx, pts: r });
});
// Colliders.
const cols = (colliders.colliderInternalsForTest.staticWorldColliders(SEED) as any[]).filter((c) =>
  near(c.x, c.z),
);

const out = {
  name,
  door: {
    x: DX,
    z: DZ,
    terrainY: th(DX, DZ),
    groundY: gh(DX, DZ),
    exitDrop: { x: DX, z: DZ - 4, y: gh(DX, DZ - 4) },
  },
  seed: SEED,
  waterLevel: wl,
  note: 'heights: terrainHeight (render mesh, sampled at 1.2yd lattice by the renderer) and groundHeight (walk surface). +z north, +x WEST.',
  fineTerrain: fineT,
  fineGround: fineG,
  coarseTerrain: coarse,
};
writeFileSync(path.join(outDir, `${name}_heightgrid.json`), JSON.stringify(out));
writeFileSync(
  path.join(outDir, `${name}_surroundings.json`),
  JSON.stringify(
    {
      door: out.door,
      waterLevel: wl,
      feats: feats.sort((a, b) => (a.d ?? 0) - (b.d ?? 0)),
      pois,
      roads,
      colliders: cols,
    },
    null,
    1,
  ),
);
// Quick stats.
let mn = Infinity,
  mx = -Infinity;
for (const row of fineT.rows)
  for (const v of row) {
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
console.log(
  JSON.stringify({
    door: out.door,
    waterLevel: wl,
    fineMin: mn,
    fineMax: mx,
    feats: feats.length,
    roads: roads.length,
    colliders: cols.length,
  }),
);
