// The Sunken Bastion route contract (docs/design/dungeon-rework/sunken_bastion.md,
// "no skipping"): walk the walkable graph of the open-air sea fortress from the
// arrival point, with the gates open exactly as the dead packs and bosses
// allow, and prove every pack and boss is unreachable until the packs before
// it die.
//
// The walk is a flood fill over a one-yard grid that asks the REAL collision
// seam (colliders.ts isBlocked, which reads the field's generated cliffs,
// walls, props and the per-slot gate view). It ignores height, so a missing
// cliff wall would let it spill into the sea, which the last cases forbid.

import { beforeEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  SUNKEN_BASTION_GATES,
  SUNKEN_BASTION_PACKS,
  SUNKEN_BASTION_PATROLS,
  SUNKEN_BASTION_SPAWNS,
} from '../src/sim/content/sunken_bastion';
import {
  SUNKEN_BASTION_ANCHORS,
  SUNKEN_BASTION_FIELD,
} from '../src/sim/content/sunken_bastion_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import {
  clearDungeonGateStateForTest,
  setOpenDungeonGates,
} from '../src/sim/instances/dungeon_gate_state';

const SEED = 7;
const DUNGEON = DUNGEONS.sunken_bastion;
const SLOT = 5;
const O = instanceOrigin(DUNGEON.index, SLOT);
const { minX, maxX, minZ, maxZ } = SUNKEN_BASTION_FIELD.bounds;
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
  for (const s of SUNKEN_BASTION_SPAWNS) {
    // A patrol is reachable when any point of its loop is.
    const pts = s.patrol ? s.patrol.points : [{ x: s.x, z: s.z }];
    if (!pts.some((p) => spawnReached(seen, p.x, p.z))) continue;
    out.add(s.packId ?? s.mobId);
  }
  return [...out].sort();
}

/** The gates a set of dead packs and bosses opens (seals idle: nobody engaged). */
function openGates(dead: Set<string>): string[] {
  return SUNKEN_BASTION_GATES.filter(
    (g) => (g.packs ?? []).every((p) => dead.has(p)) && (g.bosses ?? []).every((b) => dead.has(b)),
  ).map((g) => g.id);
}

const OLEN = 'knight_commander_olen';
const OSSICK = 'gaoler_ossick';
const VAEL = 'vael_the_mistcaller';
const FLATS = ['f1', 'f2', 'f3', 'fa', 'fb'];
const BAILEY = ['b1', 'b2', 'hermit', 'bc'];
const RAMPART = ['r1', 'r2', 'rc'];
const GAOL = ['turnkey', 'g1', 'g2', 'g3', 'gd'];
const KEEP = ['k1', 'k2', 'k3', 'kc'];

/** Everything dead up to and including a stage. */
function upTo(...stages: string[][]): Set<string> {
  return new Set(stages.flat());
}

describe('Sunken Bastion route contract: every pack is mandatory', () => {
  beforeEach(() => clearDungeonGateStateForTest());

  it('lists 13 groups, the Gaol Turnkey and 7 patrols, each a real pack of the spawn list', () => {
    expect(SUNKEN_BASTION_PACKS).toHaveLength(21);
    expect(SUNKEN_BASTION_PATROLS).toHaveLength(7);
    for (const p of SUNKEN_BASTION_PATROLS)
      expect(SUNKEN_BASTION_PACKS as readonly string[]).toContain(p);
    const packs = new Set(SUNKEN_BASTION_SPAWNS.map((s) => s.packId));
    for (const p of SUNKEN_BASTION_PACKS) expect(packs.has(p), p).toBe(true);
    for (const p of SUNKEN_BASTION_PATROLS) {
      const members = SUNKEN_BASTION_SPAWNS.filter((s) => s.packId === p);
      expect(members.length, p).toBeGreaterThan(0);
      for (const m of members) expect(m.patrol, `${p} ${m.mobId}`).toBeDefined();
    }
    // Every group is three to five mobs, a patrol two or three (the
    // showpiece Hermit patrols alone, the Gaol Turnkey miniboss holds alone).
    const patrols = new Set<string>(SUNKEN_BASTION_PATROLS);
    for (const p of SUNKEN_BASTION_PACKS) {
      const n = SUNKEN_BASTION_SPAWNS.filter((s) => s.packId === p).length;
      if (p === 'hermit' || p === 'turnkey') expect(n).toBe(1);
      else expect(n, p).toBeGreaterThanOrEqual(patrols.has(p) ? 2 : 3);
      expect(n, p).toBeLessThanOrEqual(5);
    }
    // Every placed mob resolves.
    for (const s of SUNKEN_BASTION_SPAWNS) expect(MOBS[s.mobId], s.mobId).toBeDefined();
  });

  it('with nothing dead, only the flats are reachable', () => {
    const seen = reachable(openGates(new Set()));
    expect(reachedPacks(seen)).toEqual([...FLATS].sort());
  });

  it('the Sea Gate needs every flats pack, the patrol included', () => {
    for (const missing of FLATS) {
      const dead = new Set(FLATS.filter((p) => p !== missing));
      const packs = reachedPacks(reachable(openGates(dead)));
      for (const p of BAILEY) expect(packs, `${missing} alive`).not.toContain(p);
    }
    const packs = reachedPacks(reachable(openGates(upTo(FLATS))));
    expect(packs).toEqual(expect.arrayContaining(BAILEY));
    for (const p of [...RAMPART, OLEN]) expect(packs).not.toContain(p);
  });

  it('the drawbridge needs both yards, the Turretback Hermit and the bailey watch', () => {
    for (const missing of BAILEY) {
      const dead = upTo(
        FLATS,
        BAILEY.filter((p) => p !== missing),
      );
      const packs = reachedPacks(reachable(openGates(dead)));
      for (const p of RAMPART) expect(packs, `${missing} alive`).not.toContain(p);
    }
    const packs = reachedPacks(reachable(openGates(upTo(FLATS, BAILEY))));
    expect(packs).toEqual(expect.arrayContaining(RAMPART));
    expect(packs).not.toContain(OLEN);
  });

  it('Olen is reachable only after both towers and the wall patrol die', () => {
    for (const missing of RAMPART) {
      const dead = upTo(
        FLATS,
        BAILEY,
        RAMPART.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), missing).not.toContain(OLEN);
    }
    const packs = reachedPacks(reachable(openGates(upTo(FLATS, BAILEY, RAMPART))));
    expect(packs).toContain(OLEN);
    for (const p of GAOL) expect(packs).not.toContain(p);
  });

  it('the gaol opens only on Olen, and Ossick only after the whole gaol', () => {
    const beforeOlen = upTo(FLATS, BAILEY, RAMPART);
    expect(reachedPacks(reachable(openGates(beforeOlen)))).not.toContain('g1');
    const afterOlen = reachedPacks(reachable(openGates(upTo(FLATS, BAILEY, RAMPART, [OLEN]))));
    expect(afterOlen).toEqual(expect.arrayContaining(GAOL));
    expect(afterOlen).not.toContain(OSSICK);
    for (const missing of GAOL) {
      const dead = upTo(
        FLATS,
        BAILEY,
        RAMPART,
        [OLEN],
        GAOL.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), missing).not.toContain(OSSICK);
    }
    const all = reachedPacks(reachable(openGates(upTo(FLATS, BAILEY, RAMPART, [OLEN], GAOL))));
    expect(all).toContain(OSSICK);
    for (const p of KEEP) expect(all).not.toContain(p);
  });

  it('the Keep Stair opens on Ossick, and Vael only after the keep packs', () => {
    const base = upTo(FLATS, BAILEY, RAMPART, [OLEN], GAOL);
    expect(reachedPacks(reachable(openGates(base)))).not.toContain('k1');
    const keep = reachedPacks(reachable(openGates(upTo([...base], [OSSICK]))));
    expect(keep).toEqual(expect.arrayContaining(KEEP));
    expect(keep).not.toContain(VAEL);
    for (const missing of KEEP) {
      const dead = upTo(
        [...base],
        [OSSICK],
        KEEP.filter((p) => p !== missing),
      );
      expect(reachedPacks(reachable(openGates(dead))), missing).not.toContain(VAEL);
    }
    const all = reachedPacks(reachable(openGates(upTo([...base], [OSSICK], KEEP))));
    expect(all).toContain(VAEL);
  });

  it('a fully cleared route reaches every placement and never the sea', () => {
    const dead = new Set<string>([
      ...SUNKEN_BASTION_GATES.flatMap((g) => g.packs ?? []),
      OLEN,
      OSSICK,
      VAEL,
    ]);
    const seen = reachable(openGates(dead));
    for (const s of SUNKEN_BASTION_SPAWNS) {
      expect(spawnReached(seen, s.x, s.z), `${s.mobId} at ${s.x},${s.z}`).toBe(true);
    }
    let voidCells = 0;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (!seen[cell(x, z)]) continue;
        if (authoredFieldHeight(SUNKEN_BASTION_FIELD, x, z) <= SUNKEN_BASTION_FIELD.voidHeight) {
          voidCells++;
        }
      }
    }
    expect(voidCells).toBe(0);
  });

  it('spreads the patrols across the route: at least one per open-air stage', () => {
    const byStage: [string, string[]][] = [
      ['flats', FLATS],
      ['bailey', BAILEY],
      ['rampart', RAMPART],
      ['gaol', GAOL],
      ['keep', KEEP],
    ];
    for (const [stage, packs] of byStage) {
      const patrols = packs.filter((p) =>
        (SUNKEN_BASTION_PATROLS as readonly string[]).includes(p),
      );
      expect(patrols.length, stage).toBeGreaterThanOrEqual(1);
    }
    // The flats and the bailey, the long open walks, carry two each.
    for (const packs of [FLATS, BAILEY]) {
      expect(
        packs.filter((p) => (SUNKEN_BASTION_PATROLS as readonly string[]).includes(p)).length,
      ).toBe(2);
    }
  });

  it('keeps each patrol walk clear of the held packs (it passes them, never through them)', () => {
    const held = SUNKEN_BASTION_SPAWNS.filter((s) => !s.patrol && s.packId);
    for (const s of SUNKEN_BASTION_SPAWNS) {
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
      expect(nearest, `${s.packId} ${s.mobId}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('every patrol loop stays on walkable ground, clear of props', () => {
    for (const s of SUNKEN_BASTION_SPAWNS) {
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
            authoredFieldHeight(SUNKEN_BASTION_FIELD, x, z),
            `${s.packId} over the sea at ${x},${z}`,
          ).toBeGreaterThan(SUNKEN_BASTION_FIELD.voidHeight);
          expect(isBlocked(SEED, O.x + x, O.z + z, 0.5), `${s.packId} at ${x},${z}`).toBe(false);
        }
      }
    }
  });

  it('the arrival stands on the landing, far above and clear of the first pack', () => {
    const e = SUNKEN_BASTION_ANCHORS.entry;
    expect(authoredFieldHeight(SUNKEN_BASTION_FIELD, e.x, e.z)).toBe(4);
    for (const s of SUNKEN_BASTION_SPAWNS) {
      const d = Math.hypot(s.x - e.x, s.z - e.z);
      expect(d, `${s.mobId} at ${s.x},${s.z}`).toBeGreaterThan(35);
    }
  });

  it('gate state is per slot: opening slot 5 leaves slot 6 sealed', () => {
    setOpenDungeonGates(O.x, O.z, ['sea_gate']);
    const o6 = instanceOrigin(DUNGEON.index, SLOT + 1);
    expect(isBlocked(SEED, O.x, O.z - 130, 0.5)).toBe(false);
    expect(isBlocked(SEED, o6.x, o6.z - 130, 0.5)).toBe(true);
  });
});
