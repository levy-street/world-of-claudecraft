// The Thornhollow Fields MAP BUILDER's pure halves: the combat plan, the terrain stamp
// chain, the ground paint and the kit arithmetic that fits catalogue pieces to
// the plan (scripts/assets/battleground/).
//
// tests/battleground_band.test.ts pins the COMPILED field: what blocks, what
// opens, what a flood fill reaches. This suite pins the SOURCE, one step
// earlier, because the compiled field is 2700 placements deep and a fairness
// break there reads as a hundred failures with no obvious cause. Here a plan
// edit that moved one side only, a gate that stopped being ten yards, a wall
// course that no longer spans its run, or a paint grid that lost its mirror
// fails on its own terms in a couple of milliseconds.
//
// These modules are the deliberate exception to "tests never touch scripts/":
// they ARE the map, and the map is gameplay.

import { describe, expect, it } from 'vitest';
import {
  BASES,
  COVER_CRATES,
  COVER_PILLARS,
  COVER_WALLS,
  CURTAIN_WALLS,
  CURTAIN_Z,
  FLAG_Z,
  GATEHOUSE_WALLS,
  GRAVEYARD_FENCES,
  GRAVEYARDS,
  HALF_X,
  HALF_Z,
  HEART_RUIN,
  insideAnyWall,
  KEEP_BARRICADES,
  KEEP_HALF_X,
  KEEP_MOUTH_DZ,
  keepInteriorBounds,
  keepWallSegments,
  LOCATIONS,
  MAIN_GATES,
  PERIMETER_WALLS,
  type PlanPoint,
  type PlanRect,
  POWER_RUNES,
  planWalls,
  RUBBLE_PILES,
  SPEED_RUNES,
} from '../scripts/assets/battleground/field_plan.mjs';
import { buildPaint, SWATCHES } from '../scripts/assets/battleground/ground_paint.mjs';
import { bodyOffset, courseFit, r4, yaw } from '../scripts/assets/battleground/kit.mjs';
import { makeHeightAt } from '../scripts/assets/battleground/stamp_chain.mjs';
import { terrainStamps } from '../scripts/assets/battleground/terrain.mjs';

/** Does `set` contain the point mirror of `p`, to within `eps`? */
function hasMirror(set: readonly PlanPoint[], p: PlanPoint, eps = 1e-9): boolean {
  return set.some((q) => Math.hypot(q.x + p.x, q.z + p.z) <= eps);
}

/** Does `set` contain the point-mirrored twin of rectangle `r`? */
function hasMirrorRect(set: readonly PlanRect[], r: PlanRect, eps = 1e-9): boolean {
  return set.some(
    (q) =>
      Math.hypot(q.x + r.x, q.z + r.z) <= eps &&
      Math.abs(q.hw - r.hw) <= eps &&
      Math.abs(q.hd - r.hd) <= eps,
  );
}

describe('Thornhollow Fields plan: point symmetry, the fairness invariant', () => {
  it('every wall rectangle on the field has a point-mirrored twin', () => {
    // The ONE property the whole layout rests on: (x, z) -> (-x, -z) maps the
    // field onto itself, so neither team fights a different shape. Checked over
    // the full wall set, so a single hand edit to one curtain segment or one
    // gatehouse door fails here rather than in a playtest.
    const walls = planWalls();
    expect(walls.length).toBeGreaterThan(30);
    for (const w of walls) {
      expect(hasMirrorRect(walls, w), `wall (${w.x}, ${w.z}) ${w.hw}x${w.hd} has no mirror`).toBe(
        true,
      );
    }
  });

  it('every anchor, pad and piece of cover mirrors too', () => {
    for (const [name, set] of [
      ['speed rune', SPEED_RUNES],
      ['power rune', POWER_RUNES],
      ['cover pillar', COVER_PILLARS],
      ['cover crate', COVER_CRATES],
      ['graveyard', GRAVEYARDS],
      ['rubble pile', RUBBLE_PILES],
    ] as const) {
      for (const p of set) {
        expect(hasMirror(set, p), `${name} (${p.x}, ${p.z}) has no mirror`).toBe(true);
      }
    }
    // Rubble mirrors as the SAME size, or one team gets the bigger block.
    for (const pile of RUBBLE_PILES) {
      const twin = RUBBLE_PILES.find((q) => Math.hypot(q.x + pile.x, q.z + pile.z) <= 1e-9);
      expect(twin?.kind, `rubble (${pile.x}, ${pile.z}) mirror kind`).toBe(pile.kind);
    }
    // Flags, spawn rings and banners are the mode's own anchors.
    expect(hasMirror([BASES[1].flag], BASES[0].flag)).toBe(true);
    expect(hasMirror([BASES[1].banner], BASES[0].banner)).toBe(true);
    for (const s of BASES[0].spawns) expect(hasMirror(BASES[1].spawns, s)).toBe(true);
    expect(BASES[0].spawns).toHaveLength(BASES[1].spawns.length);
  });

  it('the terrain chain is point-symmetric to floating-point exactness', () => {
    const h = makeHeightAt(terrainStamps());
    let worst = 0;
    for (let x = -HALF_X; x <= HALF_X; x += 2.5) {
      for (let z = -HALF_Z; z <= HALF_Z; z += 2.5) {
        worst = Math.max(worst, Math.abs(h(x, z) - h(-x, -z)));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('the painted ground is mirrored cell for cell', () => {
    const paint = buildPaint();
    expect(paint.ids).toHaveLength(paint.cols * paint.rows);
    let asymmetric = 0;
    for (let r = 0; r < paint.rows; r++) {
      for (let c = 0; c < paint.cols; c++) {
        if (
          paint.ids[r * paint.cols + c] !==
          paint.ids[(paint.rows - 1 - r) * paint.cols + (paint.cols - 1 - c)]
        ) {
          asymmetric++;
        }
      }
    }
    expect(asymmetric).toBe(0);
  });
});

describe('Thornhollow Fields plan: the combat shape itself', () => {
  it('keeps the 100x280 footprint and the 236yd flag run', () => {
    expect([HALF_X * 2, HALF_Z * 2]).toEqual([100, 280]);
    expect(FLAG_Z * 2).toBe(236);
    for (const base of BASES) {
      expect(base.flag.x).toBe(0);
      expect(Math.abs(base.flag.z)).toBe(FLAG_Z);
    }
  });

  it('each curtain leaves exactly one 10yd main gate, and its segments butt-join', () => {
    for (const gate of MAIN_GATES) {
      const runs = CURTAIN_WALLS.filter((w) => w.z === gate.z)
        .map((w) => [w.x - w.hw, w.x + w.hw] as const)
        .sort((a, b) => a[0] - b[0]);
      // The curtain spans the full field width apart from its openings.
      expect(runs[0][0]).toBeCloseTo(-HALF_X + 1, 9);
      expect(runs[runs.length - 1][1]).toBeCloseTo(HALF_X - 1, 9);
      // Exactly one gap is the main gate, at the authored width.
      const gaps: number[][] = [];
      for (let i = 1; i < runs.length; i++) {
        if (runs[i][0] > runs[i - 1][1] + 1e-9) gaps.push([runs[i - 1][1], runs[i][0]]);
      }
      const mains = gaps.filter((g) => Math.abs((g[0] + g[1]) / 2 - gate.x) < 1e-9);
      expect(mains, `curtain z=${gate.z} main gate`).toHaveLength(1);
      expect(mains[0][1] - mains[0][0]).toBeCloseTo(gate.half * 2, 9);
      expect(mains[0][1] - mains[0][0]).toBe(10);
    }
  });

  it('each gatehouse has two doors, on OPPOSITE halves of the room', () => {
    // The offset doors are what make a gatehouse a jog past ambush corners
    // rather than a straight run: enter one half, leave by the other.
    for (const z of [-CURTAIN_Z, CURTAIN_Z]) {
      const sign = Math.sign(z);
      const field = GATEHOUSE_WALLS.find(
        (w) => w.hw > w.hd && Math.sign(w.z) === sign && Math.abs(w.z) === 65,
      );
      const court = GATEHOUSE_WALLS.find(
        (w) => w.hw > w.hd && Math.sign(w.z) === sign && Math.abs(w.z) === 47,
      );
      const sides = GATEHOUSE_WALLS.filter((w) => w.hd > w.hw && Math.sign(w.z) === sign);
      expect(field, `gatehouse z=${z} field wall`).toBeTruthy();
      expect(court, `gatehouse z=${z} courtyard wall`).toBeTruthy();
      expect(sides, `gatehouse z=${z} side walls`).toHaveLength(2);
      const roomMin = Math.min(...sides.map((s) => s.x));
      const roomMax = Math.max(...sides.map((s) => s.x));
      const mid = (roomMin + roomMax) / 2;
      // Each end wall covers one side of the room and leaves the other open.
      const fieldDoorMid = field!.x > mid ? roomMin : roomMax;
      const courtDoorMid = court!.x > mid ? roomMin : roomMax;
      expect(Math.sign(fieldDoorMid - mid)).toBe(-Math.sign(courtDoorMid - mid));
      // Both doors are wide enough for a body plus its radius, with room over.
      for (const [label, wall] of [
        ['field', field!],
        ['courtyard', court!],
      ] as const) {
        const covered = wall.hw * 2;
        const span = roomMax - roomMin;
        expect(span - covered, `gatehouse z=${z} ${label} door width`).toBeGreaterThan(3);
      }
    }
  });

  it('the keep mouth is the only opening, and the barricade sits outside the hold box', () => {
    for (const team of [0, 1] as const) {
      const segs = keepWallSegments(team);
      expect(segs).toHaveLength(3); // a back wall and two solid sides
      const back = segs.filter((s) => s.hw > s.hd);
      const sides = segs.filter((s) => s.hd > s.hw);
      expect(back).toHaveLength(1);
      expect(sides).toHaveLength(2);
      expect(back[0].hw).toBe(KEEP_HALF_X);
      expect(sides.map((s) => s.x).sort((a, b) => a - b)).toEqual([-KEEP_HALF_X, KEEP_HALF_X]);
      // The side walls stop AT the mouth line: past it, the keep is open.
      const dir = team === 0 ? -1 : 1;
      const mouthZ = dir * (FLAG_Z - KEEP_MOUTH_DZ);
      for (const s of sides) {
        expect(Math.abs(Math.abs(s.z) - Math.abs(s.hd) - Math.abs(mouthZ))).toBeCloseTo(0, 9);
      }
      // The form-up containment agrees with those walls, and the barricade is
      // field-side of it so the countdown never reads it.
      const box = keepInteriorBounds(team);
      expect(box.minX).toBe(-KEEP_HALF_X);
      expect(box.maxX).toBe(KEEP_HALF_X);
      const barricade = KEEP_BARRICADES.find((b) => Math.sign(b.z) === dir);
      expect(barricade, `team ${team} barricade`).toBeTruthy();
      expect(Math.abs(barricade!.z)).toBeLessThan(Math.abs(mouthZ));
    }
  });

  it('the heart ruin straddles the centre, on the gate-to-gate line', () => {
    // The gates are point mirrors, so the line between them runs through the
    // origin: the ruin has to sit on it, and be wide enough that the ray cannot
    // graze past a corner.
    expect(HEART_RUIN.x).toBe(0);
    expect(HEART_RUIN.z).toBe(0);
    const [a, b] = MAIN_GATES;
    expect(a.x + b.x).toBe(0);
    expect(a.z + b.z).toBe(0);
    // Perpendicular distance from the origin-crossing gate line to the ruin's
    // nearest face, i.e. how much of the ruin the ray really has to cross.
    expect(Math.min(HEART_RUIN.hw, HEART_RUIN.hd)).toBeGreaterThanOrEqual(8);
  });

  it('nothing the plan places sits inside a wall it would be buried by', () => {
    // A pad, a spawn or a flag stand overlapping a wall footprint is a spot the
    // collision solver has to shove a body out of, which is how an objective
    // ends up unreachable.
    for (const [name, set] of [
      ['speed rune', SPEED_RUNES],
      ['power rune', POWER_RUNES],
      ['spawn', [...BASES[0].spawns, ...BASES[1].spawns]],
      ['flag', BASES.map((base) => base.flag)],
      ['graveyard centre', GRAVEYARDS],
    ] as const) {
      for (const p of set) {
        expect(insideAnyWall(p.x, p.z, 1.5), `${name} (${p.x}, ${p.z}) is inside a wall`).toBe(
          false,
        );
      }
    }
  });

  it('every rectangle the plan places stays inside the field, ramparts included', () => {
    for (const w of planWalls()) {
      expect(Math.abs(w.x) + w.hw, `wall (${w.x}, ${w.z}) x span`).toBeLessThanOrEqual(HALF_X + 1);
      expect(Math.abs(w.z) + w.hd, `wall (${w.x}, ${w.z}) z span`).toBeLessThanOrEqual(HALF_Z + 1);
    }
    expect(PERIMETER_WALLS).toHaveLength(4);
    expect(COVER_WALLS.length).toBeGreaterThan(4);
    expect(GRAVEYARD_FENCES.length % 2).toBe(0);
  });

  it('the named places cover the field and label the two keeps', () => {
    const names = LOCATIONS.map((l) => l.name);
    expect(names).toContain('Crimson Keep');
    expect(names).toContain('Azure Keep');
    // The M map reads its team line from the keep rects: exactly two, mirrored.
    const keeps = LOCATIONS.filter((l) => l.name.endsWith('Keep'));
    expect(keeps).toHaveLength(2);
    expect(keeps[0].minZ + keeps[1].maxZ).toBe(0);
    expect(keeps[0].maxZ + keeps[1].minZ).toBe(0);
    for (const l of LOCATIONS) {
      expect(l.minX).toBeGreaterThanOrEqual(-HALF_X);
      expect(l.maxX).toBeLessThanOrEqual(HALF_X);
      expect(l.minZ).toBeGreaterThanOrEqual(-HALF_Z);
      expect(l.maxZ).toBeLessThanOrEqual(HALF_Z);
    }
  });
});

describe('Thornhollow Fields terrain plan: shallow by design', () => {
  const h = makeHeightAt(terrainStamps());

  it('keeps the whole play surface inside a few yards of relief', () => {
    // The layout under the terrain was tuned on flat ground. Deep relief would
    // change sight lines and lane costs that nothing here re-derives, so the
    // amplitude is a CONTRACT, not an accident.
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = -HALF_X; x <= HALF_X; x += 1) {
      for (let z = -HALF_Z; z <= HALF_Z; z += 1) {
        const v = h(x, z);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    expect(hi - lo).toBeLessThan(6);
    expect(hi - lo).toBeGreaterThan(3); // and it is real relief, not a plane
  });

  it('never exceeds a walkable gradient anywhere on the field', () => {
    // PLAYER_MAX_CLIMB_SLOPE is 1.5; the field must stay far under it, or the
    // movement kernel's slope gate starts refusing ground the plan calls a lane.
    let steepest = 0;
    for (let x = -HALF_X + 1; x <= HALF_X - 1; x += 1) {
      for (let z = -HALF_Z + 1; z <= HALF_Z - 1; z += 1) {
        steepest = Math.max(
          steepest,
          Math.abs(h(x + 0.5, z) - h(x - 0.5, z)),
          Math.abs(h(x, z + 0.5) - h(x, z - 0.5)),
        );
      }
    }
    expect(steepest).toBeLessThan(0.5);
  });

  it('sinks the courtyard and lifts both keep terraces', () => {
    expect(h(0, 0)).toBeLessThan(-1.5);
    expect(h(0, -FLAG_Z)).toBeGreaterThan(1.5);
    expect(h(0, FLAG_Z)).toBeGreaterThan(1.5);
    // The terrace is a full-width shelf, not a lobe under the flag only.
    for (const x of [-45, -20, 0, 20, 45]) expect(h(x, -125)).toBeGreaterThan(1.5);
  });

  it('emits only stamp shapes both other ports of the chain implement', () => {
    for (const s of terrainStamps()) {
      expect(['smooth', 'flat']).toContain(s.falloff);
      if (s.mode !== undefined) expect(s.mode).toBe('level');
      expect(s.alpha).toBeUndefined();
      expect(Number.isFinite(s.radius) && s.radius > 0).toBe(true);
    }
  });
});

describe('Thornhollow Fields ground paint: complete, legible, and every swatch earning its layer', () => {
  const paint = buildPaint();

  it('covers the whole rect at the authoring resolution', () => {
    expect(paint.cols).toBe((HALF_X * 2) / paint.cell + 1);
    expect(paint.rows).toBe((HALF_Z * 2) / paint.cell + 1);
    expect(paint.originX).toBe(-HALF_X);
    expect(paint.originZ).toBe(-HALF_Z);
  });

  it('paints every cell: no bare ground shows through the field', () => {
    // 255 is the unpainted sentinel; the terrain's flat base tone underneath is
    // a fallback, not a look anyone authored.
    expect(paint.ids.filter((v) => v === 255)).toHaveLength(0);
  });

  it('uses every swatch it declares, so no texture-array layer is dead weight', () => {
    // Each swatch costs a layer in the ground shader's texture array and a
    // texture load at field build. A declared-but-unused one is pure cost.
    const used = new Set(paint.ids);
    for (const s of SWATCHES) {
      expect(used.has(s.id), `swatch ${s.id} (${s.label}) is never painted`).toBe(true);
    }
    expect(used.size).toBe(SWATCHES.length);
    // Every swatch resolves to a builtin texture the renderer can name.
    for (const s of SWATCHES) expect(s.textureSha.startsWith('builtin:')).toBe(true);
    expect(new Set(SWATCHES.map((s) => s.id)).size).toBe(SWATCHES.length);
  });

  it('compresses to a run length the generated module can carry', () => {
    // The compiled field embeds this as run-length pairs. Per-cell noise would
    // explode it (and read as static on the ground), so the paint is authored
    // as large regions with analytically warped borders.
    let runs = 1;
    for (let i = 1; i < paint.ids.length; i++) if (paint.ids[i] !== paint.ids[i - 1]) runs++;
    expect(runs).toBeLessThan(paint.ids.length / 10);
  });
});

describe('Thornhollow Fields kit arithmetic: catalogue pieces fitted to the plan', () => {
  it('a course of modules spans its run exactly, whatever the run length', () => {
    // A course that overshoots pokes through the wall it joins; one that
    // undershoots leaves a hairline a body can be pushed into.
    for (const length of [10, 14, 16, 20, 31, 100, 280]) {
      const fit = courseFit(2.18, length, 2.6);
      expect(fit.count).toBeGreaterThanOrEqual(1);
      expect(fit.count * fit.pitch).toBeCloseTo(length, 9);
      expect(fit.pitch).toBeCloseTo(2.18 * 2.6 * fit.scaleX, 9);
    }
  });

  it('the body offset centres an off-origin piece on the point asked for', () => {
    // Several kit pieces are authored with their origin at one end. Placing one
    // by its origin lands the whole run beside the rectangle it should fill.
    const ext = {
      width: 2,
      depth: 1,
      height: 1,
      top: 1,
      minY: 0,
      centerX: 1.08,
      centerZ: 0,
    };
    const flat = bodyOffset(ext, 2, 1, 0);
    expect(flat.dx).toBeCloseTo(-2.16, 9);
    expect(flat.dz).toBeCloseTo(0, 9);
    // Yawed a quarter turn, the same shift comes out along world -z, which is
    // where the compiler's own rotXZ convention puts local +x.
    const turned = bodyOffset(ext, 2, 1, Math.PI / 2);
    expect(turned.dx).toBeCloseTo(0, 9);
    expect(turned.dz).toBeCloseTo(2.16, 9);
    // A centred piece needs no shift at all.
    const centred = bodyOffset({ ...ext, centerX: 0 }, 2, 1, 0);
    expect(centred.dx).toBeCloseTo(0, 12);
    expect(centred.dz).toBeCloseTo(0, 12);
  });

  it('rounds and normalizes the way the field compiler does', () => {
    expect(r4(1.23456789)).toBe(1.2346);
    expect(Object.is(r4(-0.00001), 0)).toBe(true); // never emits -0
    // yaw rounds to the compiler's own four places, so the map file and the
    // generated module can never differ by a float tail.
    expect(yaw(-Math.PI / 2)).toBe(4.7124);
    expect(yaw(Math.PI * 4)).toBe(0);
  });
});
