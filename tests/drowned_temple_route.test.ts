// The Drowned Temple route contract (docs/design/dungeon-rework/drowned_temple.md,
// "no skipping"): walk the walkable graph of the open-air lagoon temple from
// the arrival point, with the gates open exactly as the dead packs and bosses
// allow, and prove every pack and boss is unreachable until the packs before
// it die.
//
// The walk is a flood fill over a one-yard grid that asks the REAL collision
// seam (colliders.ts isBlocked, which reads the field's generated cliffs,
// props and the per-slot gate view). It ignores height, so a missing cliff
// wall would let it spill into the lagoon, which the last cases forbid.

import { beforeEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  DROWNED_TEMPLE_GATES,
  DROWNED_TEMPLE_PACKS,
  DROWNED_TEMPLE_PATROLS,
  DROWNED_TEMPLE_SPAWNS,
} from '../src/sim/content/drowned_temple';
import {
  DROWNED_TEMPLE_ANCHORS,
  DROWNED_TEMPLE_FIELD,
} from '../src/sim/content/drowned_temple_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import {
  clearDungeonGateStateForTest,
  setOpenDungeonGates,
} from '../src/sim/instances/dungeon_gate_state';

const SEED = 7;
const DUNGEON = DUNGEONS.drowned_temple;
const SLOT = 5;
const O = instanceOrigin(DUNGEON.index, SLOT);
const { minX, maxX, minZ, maxZ } = DROWNED_TEMPLE_FIELD.bounds;
const W = maxX - minX + 1;
const H = maxZ - minZ + 1;

function cell(x: number, z: number): number {
  return (Math.round(z) - minZ) * W + (Math.round(x) - minX);
}

/** Flood fill from the arrival point with the given gates open. */
function reachable(open: string[]): Uint8Array {
  setOpenDungeonGates(O.x, O.z, open);
  const seen = new Uint8Array(W * H);
  const blocked = new Int8Array(W * H).fill(-1);
  const isFree = (x: number, z: number): boolean => {
    const i = cell(x, z);
    if (blocked[i] === -1) blocked[i] = isBlocked(SEED, O.x + x, O.z + z, 0.5) ? 1 : 0;
    return blocked[i] === 0;
  };
  const start = DUNGEON.entry;
  const queue: number[] = [Math.round(start.x), Math.round(start.z)];
  seen[cell(start.x, start.z)] = 1;
  for (let q = 0; q < queue.length; q += 2) {
    const x = queue[q];
    const z = queue[q + 1];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
      const i = cell(nx, nz);
      if (seen[i] || !isFree(nx, nz)) continue;
      seen[i] = 1;
      queue.push(nx, nz);
    }
  }
  return seen;
}

/** Is a spawn standing inside the reached region (its own or a next cell)? */
function spawnReached(seen: Uint8Array, x: number, z: number): boolean {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = Math.round(x) + dx;
      const cz = Math.round(z) + dz;
      if (cx < minX || cx > maxX || cz < minZ || cz > maxZ) continue;
      if (seen[cell(cx, cz)]) return true;
    }
  }
  return false;
}

function reachedPacks(seen: Uint8Array): string[] {
  const out = new Set<string>();
  for (const s of DROWNED_TEMPLE_SPAWNS) {
    // A patrol is reachable when any point of its loop is.
    const pts = s.patrol ? s.patrol.points : [{ x: s.x, z: s.z }];
    if (!pts.some((p) => spawnReached(seen, p.x, p.z))) continue;
    out.add(s.packId ?? s.mobId);
  }
  return [...out].sort();
}

/** The gates a set of dead packs and bosses opens (seals idle: nobody engaged). */
function openGates(dead: Set<string>): string[] {
  return DROWNED_TEMPLE_GATES.filter(
    (g) => (g.packs ?? []).every((p) => dead.has(p)) && (g.bosses ?? []).every((b) => dead.has(b)),
  ).map((g) => g.id);
}

const SELTHE = 'choirmother_selthe';
const COLOSSUS = 'tideglass_colossus';
const YSOLEI = 'ysolei';
const APPROACH = ['g1', 'g2', 'g3', 'pa', 'g4', 'g5'];
const BRANCHES = ['g6', 'g7', 'g8', 'g9', 'pb', 'hydra'];
const PRISM = ['g10', 'g11', 'pc'];
const ALTAR = ['g12', 'g13'];

/** Everything dead up to and including a stage. */
function upTo(...stages: string[][]): Set<string> {
  return new Set(stages.flat());
}

describe('Drowned Temple route contract: every pack is mandatory', () => {
  beforeEach(() => clearDungeonGateStateForTest());

  it('lists 13 groups, 3 patrols and the Hydra, each a real pack of the spawn list', () => {
    expect(DROWNED_TEMPLE_PACKS).toHaveLength(17);
    expect(DROWNED_TEMPLE_PATROLS).toHaveLength(3);
    const groups = DROWNED_TEMPLE_PACKS.filter(
      (p) => p !== 'hydra' && !(DROWNED_TEMPLE_PATROLS as readonly string[]).includes(p),
    );
    expect(groups).toHaveLength(13);
    const packs = new Set(DROWNED_TEMPLE_SPAWNS.map((s) => s.packId));
    for (const p of DROWNED_TEMPLE_PACKS) expect(packs.has(p), p).toBe(true);
    for (const p of DROWNED_TEMPLE_PATROLS) {
      const members = DROWNED_TEMPLE_SPAWNS.filter((s) => s.packId === p);
      expect(members.length, p).toBe(3);
      for (const m of members) expect(m.patrol, `${p} ${m.mobId}`).toBeDefined();
    }
    // Every group is three to five mobs; the Hydra is its three heads.
    for (const p of groups) {
      const n = DROWNED_TEMPLE_SPAWNS.filter((s) => s.packId === p).length;
      expect(n, p).toBeGreaterThanOrEqual(3);
      expect(n, p).toBeLessThanOrEqual(5);
    }
    expect(DROWNED_TEMPLE_SPAWNS.filter((s) => s.packId === 'hydra')).toHaveLength(3);
    // Every placed mob resolves.
    for (const s of DROWNED_TEMPLE_SPAWNS) expect(MOBS[s.mobId], s.mobId).toBeDefined();
  });

  it('with nothing dead, only the approach to the Choir Veil is reachable', () => {
    const seen = reachable(openGates(new Set()));
    expect(reachedPacks(seen)).toEqual([...APPROACH].sort());
  });

  it('the Choir Veil needs every approach pack, the causeway patrol included', () => {
    for (const missing of APPROACH) {
      const dead = new Set(APPROACH.filter((p) => p !== missing));
      expect(reachedPacks(reachable(openGates(dead))), `${missing} alive`).not.toContain(SELTHE);
    }
    const packs = reachedPacks(reachable(openGates(upTo(APPROACH))));
    expect(packs).toContain(SELTHE);
    for (const p of BRANCHES) expect(packs).not.toContain(p);
  });

  it('both Court Stairs open only on Selthe, onto both branches and the Hydra Pool', () => {
    const packs = reachedPacks(reachable(openGates(upTo(APPROACH, [SELTHE]))));
    expect(packs).toEqual(expect.arrayContaining(BRANCHES));
    for (const p of PRISM) expect(packs).not.toContain(p);
  });

  it('the Prism Stair rises only when both branches, the falls patrol and the Hydra die', () => {
    for (const missing of BRANCHES) {
      const dead = upTo(
        APPROACH,
        [SELTHE],
        BRANCHES.filter((p) => p !== missing),
      );
      const packs = reachedPacks(reachable(openGates(dead)));
      for (const p of PRISM) expect(packs, `${missing} alive`).not.toContain(p);
    }
    const packs = reachedPacks(reachable(openGates(upTo(APPROACH, [SELTHE], BRANCHES))));
    expect(packs).toEqual(expect.arrayContaining(PRISM));
    expect(packs).not.toContain(COLOSSUS);
  });

  it('the Colossus waits behind the Prism Ward until the stair packs and patrol die', () => {
    for (const missing of PRISM) {
      const dead = upTo(
        APPROACH,
        [SELTHE],
        BRANCHES,
        PRISM.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), missing).not.toContain(COLOSSUS);
    }
    const packs = reachedPacks(reachable(openGates(upTo(APPROACH, [SELTHE], BRANCHES, PRISM))));
    expect(packs).toContain(COLOSSUS);
    for (const p of ALTAR) expect(packs).not.toContain(p);
  });

  it('the Moonbridge assembles on the Colossus, and Ysolei waits behind the Altar Ward', () => {
    const base = upTo(APPROACH, [SELTHE], BRANCHES, PRISM);
    const bridge = reachedPacks(reachable(openGates(upTo([...base], [COLOSSUS]))));
    expect(bridge).toEqual(expect.arrayContaining(ALTAR));
    expect(bridge).not.toContain(YSOLEI);
    for (const missing of ALTAR) {
      const dead = upTo(
        [...base],
        [COLOSSUS],
        ALTAR.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), missing).not.toContain(YSOLEI);
    }
    expect(reachedPacks(reachable(openGates(upTo([...base], [COLOSSUS], ALTAR))))).toContain(
      YSOLEI,
    );
  });

  it('a fully cleared route reaches every placement and never the lagoon', () => {
    const dead = new Set<string>([
      ...DROWNED_TEMPLE_GATES.flatMap((g) => g.packs ?? []),
      SELTHE,
      COLOSSUS,
      YSOLEI,
    ]);
    const seen = reachable(openGates(dead));
    for (const s of DROWNED_TEMPLE_SPAWNS) {
      expect(spawnReached(seen, s.x, s.z), `${s.mobId} at ${s.x},${s.z}`).toBe(true);
    }
    let voidCells = 0;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!seen[cell(x, z)]) continue;
        if (authoredFieldHeight(DROWNED_TEMPLE_FIELD, x, z) <= DROWNED_TEMPLE_FIELD.voidHeight) {
          voidCells++;
        }
      }
    }
    expect(voidCells).toBe(0);
  });

  it('keeps the whole walkable field inside the slot footprint the claim counts', () => {
    const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = DROWNED_TEMPLE_FIELD.bounds;
    expect(Math.max(Math.abs(x0), Math.abs(x1))).toBeLessThan(120);
    expect(Math.max(Math.abs(z0), Math.abs(z1))).toBeLessThan(250);
  });

  it('keeps each patrol walk clear of the held packs (it passes them, never through them)', () => {
    const held = DROWNED_TEMPLE_SPAWNS.filter((s) => !s.patrol && s.packId);
    for (const s of DROWNED_TEMPLE_SPAWNS) {
      if (!s.patrol) continue;
      const pts = s.patrol.points;
      let nearest = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          for (const h of held) nearest = Math.min(nearest, Math.hypot(h.x - x, h.z - z));
        }
      }
      expect(nearest, `${s.packId} ${s.mobId}`).toBeGreaterThanOrEqual(7.5);
    }
  });

  it('every patrol loop stays on walkable ground, clear of props', () => {
    for (const s of DROWNED_TEMPLE_SPAWNS) {
      if (!s.patrol) continue;
      const pts = s.patrol.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          expect(
            authoredFieldHeight(DROWNED_TEMPLE_FIELD, x, z),
            `${s.packId} over the lagoon at ${x},${z}`,
          ).toBeGreaterThan(DROWNED_TEMPLE_FIELD.voidHeight);
          expect(isBlocked(SEED, O.x + x, O.z + z, 0.5), `${s.packId} at ${x},${z}`).toBe(false);
        }
      }
    }
  });

  it('the arrival stands on the crater rim, far above and clear of the first pack', () => {
    const e = DROWNED_TEMPLE_ANCHORS.entry;
    expect(authoredFieldHeight(DROWNED_TEMPLE_FIELD, e.x, e.z)).toBe(30);
    for (const s of DROWNED_TEMPLE_SPAWNS) {
      const d = Math.hypot(s.x - e.x, s.z - e.z);
      expect(d, `${s.mobId} at ${s.x},${s.z}`).toBeGreaterThan(35);
    }
  });

  it('gate state is per slot: opening slot 5 leaves slot 6 sealed', () => {
    setOpenDungeonGates(O.x, O.z, ['choir_veil']);
    const o6 = instanceOrigin(DUNGEON.index, SLOT + 1);
    expect(isBlocked(SEED, O.x, O.z - 33, 0.5)).toBe(false);
    expect(isBlocked(SEED, o6.x, o6.z - 33, 0.5)).toBe(true);
  });
});
