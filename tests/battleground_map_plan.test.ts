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

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { bgAtlasMarks } from '../src/ui/hud/battleground/battleground_atlas_view';
import { BattlegroundMapPainter } from '../src/ui/hud/battleground/battleground_map_painter';
import type { BgMapModel } from '../src/ui/hud/battleground/battleground_map_view';
import { setLanguage, t } from '../src/ui/i18n';

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

// ---------------------------------------------------------------------------
// The M-map painter's no-magic-colour rule (the canvas sub-rule), mirroring the
// decentralized scan in tests/minimap_painter.test.ts.
//
// The painter draws two different kinds of thing and they take different rules.
// The sampled TERRAIN palette stays literal on the documented map_terrain.ts
// precedent: it is the field's own dressing (flagstone, slate, dirt), authored
// against the 3D ground, and it is not part of any theme. Everything a player
// reads as INTERFACE (team hues, the dead ring, the self arrow, the frame, the
// halfway line, the glyph edge, the carrier ring) must resolve from a CSS token
// in the painter's ONE cached getComputedStyle pass, so the map cannot drift
// from the HUD it belongs to. The carrier ring is the case that proved it: it
// duplicated the scoreboard's .carried orange by hand.

const MAP_PAINTER_SRC = readFileSync(
  new URL('../src/ui/hud/battleground/battleground_map_painter.ts', import.meta.url),
  'utf8',
);
// Drop comments so prose can never create a false positive (mirrors architecture.test).
const mapPainterCode = MAP_PAINTER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /(^|[^:])\/\/.*$/gm,
  '$1',
);

// The shared mark painter, held to the same rule: the plate's crowns, stipples
// and headstones are drawn from this ONE module (the minimap's cached
// battleground raster bakes the same marks with it).
const marksPainterCode = readFileSync(
  new URL('../src/ui/hud/battleground/battleground_atlas_marks_painter.ts', import.meta.url),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The ONLY colour literals allowed to survive in this file, by CONSTANT NAME.
// A new name may not be added here without the same justification the two
// groups below carry; interface chrome belongs in MAP_CHROME_TOKENS with a CSS
// var, and every entry must still be DRAWN with (the second test below).
const TERRAIN_PALETTE_CONSTANTS = [
  // GROUP 1, the sampled field dressing: the built things standing on the
  // ground, sampled from the 3D field's own materials (flagstone keep floors,
  // slate walls). The graveyard dirt and the rune-pad fill were here too and
  // are deliberately gone: the plots are painted GROUND in the relief core's
  // raster now (their own surface family, so they take the plate's tinting,
  // mottling, hillshade and inked edge instead of being a flat rectangle laid
  // over the finished plate), and the rune pads are not drawn on the map at all.
  'KEEP_FLOOR',
  'WALL_FILL',
  // GROUP 2, the atlas plate's cartography, added with the M-map restyle. Same
  // map_terrain.ts precedent and one extra reason a token cannot serve: these
  // are painted into the CACHED PLATE, under and around a raster the pure core
  // (bg_field_relief_core.paintBgFieldAtlas) writes as raw RGBA bytes, where a
  // CSS var is not readable at all. They are plate art, not theme surface: the
  // plate is rebuilt only on a resize, a team swap or a language switch, so a
  // themeable value here could not follow a theme change anyway.
  // SURROUND_FILL is the old growth the hollow was cut out of, filling the
  // plate margin outside the ramparts.
  'SURROUND_FILL',
  // The MARK palette (crowns, boulders, headstones) is deliberately NOT here
  // any more: the mark read and its colours moved to the shared
  // battleground_atlas_marks_painter, which the minimap's cached battleground
  // raster bakes the same marks with. It is held to this same rule below.
  // LABEL_HALO is the parchment each landmark name is written on. Its partner
  // (the ink the name is written IN) is the --color-bg-map-ink TOKEN, which is
  // the split this rule exists to enforce: the halo is plate material, the ink
  // is HUD chrome.
  'LABEL_HALO',
];

describe('Thornhollow Fields map painter: no magic colours (canvas sub-rule)', () => {
  it('keeps every colour literal in the terrain palette or a documented token fallback', () => {
    const stray: string[] = [];
    for (const line of mapPainterCode.split('\n')) {
      if (!/#[0-9a-fA-F]{3,8}\b/.test(line) && !/\brgba?\s*\(/.test(line)) continue;
      const isTerrain = TERRAIN_PALETTE_CONSTANTS.some((name) =>
        new RegExp(`const ${name} = '#`).test(line),
      );
      // A chrome fallback is only legal ON the token row it backs, so a literal
      // can never be smuggled in as a bare constant.
      const isTokenFallback = line.includes("'--color-");
      if (!isTerrain && !isTokenFallback) stray.push(line.trim());
    }
    expect(stray, `unowned colour literals: ${stray.join(' | ')}`).toEqual([]);
    // Non-vacuous: the terrain palette really is still here and still literal.
    for (const name of TERRAIN_PALETTE_CONSTANTS) {
      expect(mapPainterCode, `${name} is no longer a literal palette entry`).toContain(
        `const ${name} = '#`,
      );
    }
  });

  it('draws with resolved colours only: no literal reaches a canvas draw call', () => {
    // The teeth that survive a MOVE: a literal re-introduced inside paint() or
    // the plan raster would pass a definition-site scan.
    const start = mapPainterCode.indexOf('paint(ctx');
    expect(start, 'battleground_map_painter.ts no longer defines paint(ctx').toBeGreaterThan(0);
    const drawBody = mapPainterCode.slice(start);
    for (const [what, re] of [
      ['hex', /#[0-9a-fA-F]{3,8}\b/g],
      ['rgb', /\brgba?\s*\(/g],
    ] as const) {
      const hits = drawBody.match(re) ?? [];
      expect(hits, `${what} literal in a draw body: ${hits.join(', ')}`).toEqual([]);
    }
    // The terrain palette is used BY NAME there, so the scan above is not
    // passing merely because the draw bodies stopped painting the ground.
    for (const name of TERRAIN_PALETTE_CONSTANTS) expect(drawBody).toContain(name);
  });

  it('draws its marks through the SHARED mark painter, and defines none of its own', () => {
    // The mark read (a blob plus its lit northwest face, map_terrain's
    // clumped-crown read drawn as two arcs) and its palette live in ONE module
    // now, because the minimap's cached battleground raster bakes the same
    // marks. A second copy here would let the two surfaces drift into drawing
    // the same tree two ways, which is the whole reason the ground already
    // shares bg_field_relief_core.
    expect(mapPainterCode).toContain(
      "import { drawBgAtlasMarks, drawBgBackdropCrowns } from './battleground_atlas_marks_painter'",
    );
    expect(
      mapPainterCode.match(/drawBgAtlasMarks\(bctx,/g) ?? [],
      'the plate still draws marks in two passes: the crowns outside the ramparts, under the field slab, and everything else over it',
    ).toHaveLength(2);
    // and it kept no private mark drawer or mark palette of its own.
    expect(mapPainterCode).not.toContain('private drawMark(');
    for (const name of ['CROWN_FILL', 'CROWN_LIT', 'BOULDER_FILL', 'HEADSTONE_FILL']) {
      expect(mapPainterCode, `${name} is still defined here as well`).not.toContain(
        `const ${name} =`,
      );
    }
    // The shared module takes the same no-magic-colours rule the plate does: the
    // mark palette is sampled terrain dressing (green canopy, grey rock, pale
    // headstone), and nothing in it may be a colour a player reads as interface.
    const stray: string[] = [];
    for (const line of marksPainterCode.split('\n')) {
      if (!/#[0-9a-fA-F]{3,8}\b/.test(line) && !/\brgba?\s*\(/.test(line)) continue;
      if (/const [A-Z_]+ = '#[0-9a-fA-F]{3,8}';/.test(line)) continue;
      stray.push(line.trim());
    }
    expect(stray, `unowned colour literals: ${stray.join(' | ')}`).toEqual([]);
    for (const name of [
      'CROWN_FILL',
      'CROWN_LIT',
      'BOULDER_FILL',
      'BOULDER_LIT',
      'HEADSTONE_FILL',
      'HEADSTONE_LIT',
    ]) {
      expect(marksPainterCode, `${name} is not a literal palette entry there`).toMatch(
        new RegExp(`const ${name} = '#[0-9a-fA-F]{3,8}';`),
      );
    }
    // It resolves nothing and owns no element: it is handed a context and a
    // projection, which is what keeps it out of the token-resolving bucket.
    expect(marksPainterCode).not.toContain('getComputedStyle');
    expect(marksPainterCode).not.toContain('document.');
  });

  it('resolves the chrome tokens in the SAME single cached getComputedStyle pass', () => {
    // One pass for the session (the minimap_painter caching rule); promoting the
    // chrome must not have bought a second style read, and it must not have made
    // the map refuse to draw when a var is absent (Node tests have no stylesheet,
    // and so does the very first frame in the browser).
    expect(mapPainterCode.match(/getComputedStyle/g) ?? []).toHaveLength(1);
    expect(mapPainterCode).toContain('MAP_CHROME_TOKENS');
    for (const key of ['carryRing', 'fieldEdge', 'midLine', 'ink']) {
      expect(mapPainterCode, `${key} is not resolved from a token`).toMatch(
        new RegExp(`${key}: \\['--color-[a-z-]+', '#[0-9a-fA-F]{3,8}'\\]`),
      );
      expect(mapPainterCode, `${key} is never drawn with`).toContain(`colors.${key}`);
    }
    // The REQUIRED group still gates the draw; the chrome group falls back.
    expect(mapPainterCode).toContain('if (!v) return null;');
    expect(mapPainterCode).toMatch(/getPropertyValue\(token\)\.trim\(\) \|\| fallback/);
  });
});

// ---------------------------------------------------------------------------
// The atlas PLATE itself, driven through a fake 2D context.
//
// The plate is the map's golden look: a cached raster nothing re-derives per
// frame, so a drift in it is invisible to every other suite here. These arms
// drive the REAL painter and record the plate's draw-command trace, which makes
// three claims behaviour rather than prose: the build is deterministic (same
// inputs, same trace, so the look cannot silently move), it is keyed on the
// things that must rebuild it (size, team, language), and it survives the away
// team's 180-degree turn with its labels upright and point-mirrored.

/** One recorded plate command: the op, its arguments, and the style in force. */
type PlateOp = string;

interface PlateTrace {
  /** Every offscreen canvas the painter minted, with the ops drawn into it. */
  plates: Array<{ w: number; h: number; ops: PlateOp[] }>;
  /** Every text entry point used on the MAP context (labels belong to the
   *  plate, so this must stay empty). */
  mapText: string[];
  /** Every shape op drawn on the MAP context per redraw, so what the live half
   *  of the surface draws (and, decisively, what it does NOT) is assertable. */
  mapOps: string[];
}

function fakePlateCanvas(trace: PlateTrace): unknown {
  const plate = { w: 0, h: 0, ops: [] as PlateOp[] };
  trace.plates.push(plate);
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: (): void => void plate.ops.push('save'),
    restore: (): void => void plate.ops.push('restore'),
    translate: (x: number, y: number): void => void plate.ops.push(`translate ${x} ${y}`),
    rotate: (a: number): void => void plate.ops.push(`rotate ${a}`),
    beginPath: (): void => void plate.ops.push('beginPath'),
    arc: (x: number, y: number, r: number): void => void plate.ops.push(`arc ${x} ${y} ${r}`),
    fill: (): void => void plate.ops.push(`fill ${ctx.fillStyle} a=${ctx.globalAlpha}`),
    fillRect: (x: number, y: number, w: number, h: number): void =>
      void plate.ops.push(`fillRect ${x} ${y} ${w} ${h} ${ctx.fillStyle} a=${ctx.globalAlpha}`),
    strokeRect: (x: number, y: number, w: number, h: number): void =>
      void plate.ops.push(`strokeRect ${x} ${y} ${w} ${h} ${ctx.strokeStyle} ${ctx.lineWidth}`),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number): void => {
      // The raster is compared pixel for pixel in tests/bg_field_relief_core.test.ts;
      // here a cheap checksum is enough to catch a plate that painted DIFFERENT
      // ground into the same commands.
      let sum = 0;
      for (let i = 0; i < image.data.length; i += 997) sum = (sum + image.data[i]) | 0;
      plate.ops.push(`putImageData ${x} ${y} ${image.data.length} ${sum}`);
    },
    strokeText: (text: string, x: number, y: number): void =>
      void plate.ops.push(`strokeText ${text} ${x} ${y} ${ctx.font} ${ctx.strokeStyle}`),
    fillText: (text: string, x: number, y: number): void =>
      void plate.ops.push(`fillText ${text} ${x} ${y} ${ctx.font} ${ctx.fillStyle}`),
    // The vignette draws one edge gradient per side; the trace records the
    // geometry and stops so a moved vignette fails the deterministic arm.
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => ({
      addColorStop: (offset: number, color: string): void =>
        void plate.ops.push(`gradientStop ${x0} ${y0} ${x1} ${y1} ${offset} ${color}`),
    }),
    // Deterministic stand-in for the real metrics: the label clamp reads the
    // glyph-run width to keep names inside the plate, so the fake returns a
    // width proportional to the text length (any stable function works; the
    // deterministic-plate arm compares the resulting clamped coordinates).
    measureText: (text: string) => ({ width: text.length * 7 }),
    canvas: null as unknown,
  };
  const canvas = {
    set width(v: number) {
      plate.w = v;
    },
    get width(): number {
      return plate.w;
    },
    set height(v: number) {
      plate.h = v;
    },
    get height(): number {
      return plate.h;
    },
    getContext: (kind: string): unknown => (kind === '2d' ? ctx : null),
  };
  ctx.canvas = canvas;
  return canvas;
}

function fakeMapCtx(trace: PlateTrace): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    clearRect: (): void => {},
    save: (): void => {},
    restore: (): void => {},
    translate: (): void => {},
    rotate: (): void => {},
    setLineDash: (): void => {},
    beginPath: (): void => void trace.mapOps.push('beginPath'),
    moveTo: (x: number, y: number): void => void trace.mapOps.push(`moveTo ${x} ${y}`),
    lineTo: (x: number, y: number): void => void trace.mapOps.push(`lineTo ${x} ${y}`),
    closePath: (): void => void trace.mapOps.push('closePath'),
    arc: (x: number, y: number, r: number): void => void trace.mapOps.push(`arc ${x} ${y} ${r}`),
    fill: (): void => void trace.mapOps.push('fill'),
    stroke: (): void => void trace.mapOps.push('stroke'),
    fillRect: (x: number, y: number, w: number, h: number): void =>
      void trace.mapOps.push(`fillRect ${x} ${y} ${w} ${h}`),
    strokeRect: (x: number, y: number, w: number, h: number): void =>
      void trace.mapOps.push(`strokeRect ${x} ${y} ${w} ${h}`),
    drawImage: (): void => void trace.mapOps.push('drawImage'),
    createLinearGradient: () => ({ addColorStop: (): void => {} }),
    fillText: (text: string): void => void trace.mapText.push(`fillText:${text}`),
    strokeText: (text: string): void => void trace.mapText.push(`strokeText:${text}`),
    measureText: (text: string) => {
      trace.mapText.push(`measureText:${text}`);
      return { width: 0 };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

/** The four REQUIRED tokens, so the painter draws instead of bailing. */
const PLATE_TOKENS: Record<string, string> = {
  '--color-team-red': 'red',
  '--color-team-blue': 'blue',
  '--color-minimap-party-dead': 'grey',
  '--color-minimap-player': 'white',
};

function installPlateGlobals(trace: PlateTrace): void {
  vi.stubGlobal('document', {
    documentElement: {},
    createElement: (tag: string): unknown => {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return fakePlateCanvas(trace);
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (token: string): string => PLATE_TOKENS[token] ?? '',
  }));
}

const PLATE_CANVAS_SIZE = 480;

function plateModel(myTeam: number): BgMapModel {
  return { active: true, myTeam, self: null, mates: [], halfX: HALF_X, halfZ: HALF_Z };
}

/** Paint once with a FRESH painter and hand back the whole trace. */
function paintOnce(myTeam: number): PlateTrace {
  const trace: PlateTrace = { plates: [], mapText: [], mapOps: [] };
  installPlateGlobals(trace);
  const painter = new BattlegroundMapPainter();
  painter.paint(fakeMapCtx(trace), plateModel(myTeam), PLATE_CANVAS_SIZE);
  expect(trace.plates, 'exactly one plate per fresh painter').toHaveLength(1);
  expect(trace.mapText, 'labels belong to the cached plate, never the redraw').toEqual([]);
  return trace;
}

/** Paint once with a FRESH painter and hand back the plate it built. */
function buildPlate(myTeam: number): { w: number; h: number; ops: PlateOp[] } {
  return paintOnce(myTeam).plates[0];
}

/** The label ops of a plate, in draw order. */
function plateLabels(plate: {
  ops: PlateOp[];
}): Array<{ text: string; x: number; y: number; font: string }> {
  const out: Array<{ text: string; x: number; y: number; font: string }> = [];
  for (const op of plate.ops) {
    const m = /^fillText (.+) (-?[\d.]+) (-?[\d.]+) (bold \d+px \w+) /.exec(op);
    if (m) out.push({ text: m[1], x: Number(m[2]), y: Number(m[3]), font: m[4] });
  }
  return out;
}

describe('Thornhollow Fields atlas plate: built once, and always the same plate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is deterministic: two fresh painters draw the identical plate', () => {
    // The plate is a cached raster nothing re-derives per frame, so nothing else
    // would notice it drifting. Same size, same team, same language, same
    // commands in the same order with the same styles, down to the raster
    // checksum: the golden look cannot move without this failing.
    const a = buildPlate(0);
    const b = buildPlate(0);
    expect([b.w, b.h]).toEqual([a.w, a.h]);
    expect(b.ops).toEqual(a.ops);
    // Non-vacuous: a plate really is a full atlas build, not two fillRects.
    expect(a.ops.length).toBeGreaterThan(500);
    expect(a.ops.some((op) => op.startsWith('putImageData'))).toBe(true);
  });

  it('is the whole square canvas, with the field centered in a full-bleed surround', () => {
    // The geometry the blit depends on. The plate IS the map's inner square
    // now (blitted at the origin): the field raster sits centered, and every
    // pixel around it is the wooded surround, so the tall field never floats
    // on the window's bare background. Get the centering wrong and the whole
    // plan slides against the markers drawn over it.
    const plate = buildPlate(0);
    const s = (PLATE_CANVAS_SIZE - 36) / (HALF_Z * 2);
    const fieldW = Math.round(HALF_X * 2 * s);
    const fieldH = Math.round(HALF_Z * 2 * s);
    const mx = Math.round((PLATE_CANVAS_SIZE - fieldW) / 2);
    const my = Math.round((PLATE_CANVAS_SIZE - fieldH) / 2);
    expect(plate.w).toBe(PLATE_CANVAS_SIZE);
    expect(plate.h).toBe(PLATE_CANVAS_SIZE);
    // The tall axis keeps the map's own 18px padding; the wide axis's margin
    // is the leftover half-width, which is what the surround fills.
    expect(my).toBe(18);
    // The 100x280 field in a square canvas leaves a wide flank on each side
    // (floor: a third of the old 18px lip era would fail this loudly).
    expect(mx).toBeGreaterThan(40);
    const raster = plate.ops.find((op) => op.startsWith('putImageData'));
    expect(raster?.startsWith(`putImageData ${mx} ${my} `)).toBe(true);
    // Non-vacuous surround: the backdrop canopy really grows in the wide
    // margins (crown arcs whose centers sit left of the field slab).
    const marginArcs = plate.ops.filter((op) => {
      const m = /^arc (-?[\d.]+) /.exec(op);
      return m !== null && Number(m[1]) < mx - 4;
    });
    expect(marginArcs.length).toBeGreaterThan(50);
  });

  it('caches per size, team and language, and rebuilds when any of the three moves', () => {
    const trace: PlateTrace = { plates: [], mapText: [], mapOps: [] };
    installPlateGlobals(trace);
    const painter = new BattlegroundMapPainter();
    const ctx = fakeMapCtx(trace);
    painter.paint(ctx, plateModel(0), PLATE_CANVAS_SIZE);
    painter.paint(ctx, plateModel(0), PLATE_CANVAS_SIZE);
    expect(trace.plates, 'a second identical redraw must blit the cache').toHaveLength(1);
    painter.paint(ctx, plateModel(0), PLATE_CANVAS_SIZE - 40);
    expect(trace.plates, 'a resize rebuilds').toHaveLength(2);
    painter.paint(ctx, plateModel(1), PLATE_CANVAS_SIZE - 40);
    expect(trace.plates, 'the away view is its own plate, not a rotated blit').toHaveLength(3);
    // ...and a language switch, because the labels are baked INTO the raster.
    // de_DE's chunk is not resident in Node, so the strings stay English; what
    // is under test is the cache key, not the translation.
    setLanguage('de_DE');
    try {
      painter.paint(ctx, plateModel(1), PLATE_CANVAS_SIZE - 40);
      expect(trace.plates, 'a language switch rebuilds the baked labels').toHaveLength(4);
    } finally {
      setLanguage('en');
    }
  });

  it('writes every landmark the authored map names, from t(), on the plate only', () => {
    const labels = plateLabels(buildPlate(0));
    // ONE title per end of the field: the keep name titles the keep AND the
    // chamber in front of it, so the separate "Crimson Field" / "Azure Field"
    // names are gone from the plate (and from the catalogue with them).
    expect(labels.map((l) => l.text).sort()).toEqual(
      [
        t('hudChrome.bg.map.azureKeep'),
        t('hudChrome.bg.map.crimsonKeep'),
        t('hudChrome.bg.map.graveyard'),
        t('hudChrome.bg.map.graveyard'),
        t('hudChrome.bg.map.ruinCourtyard'),
      ].sort(),
    );
    // Every name is haloed before it is inked, so it holds over turf and wall.
    const strokes = buildPlate(0).ops.filter((op) => op.startsWith('strokeText'));
    expect(strokes).toHaveLength(labels.length);
    // The two tiers really are two sizes (regions larger than the graveyards).
    const region = labels.find((l) => l.text === t('hudChrome.bg.map.crimsonKeep'));
    const place = labels.find((l) => l.text === t('hudChrome.bg.map.graveyard'));
    expect(region && place, 'both label tiers drawn').toBeTruthy();
    expect(region?.font).not.toBe(place?.font);
  });

  it('draws NO rune pads: neither a disc nor a diamond survives anywhere', () => {
    // The pads were static pips: whether a pad is UP is live state the map
    // deliberately does not scout, so all they did was clutter the plate and
    // collide with the landmark names. Pinned as an ABSENCE, per shape, on a
    // marker-free redraw (no self, no mates): the sprint discs were the only
    // arcs left on the map context, and the Battle/Ward diamonds the only
    // closed paths besides the flag banners. Plus the source teeth, so a pad
    // cannot come back on the cached PLATE instead.
    expect(
      SPEED_RUNES.length + POWER_RUNES.length,
      'the field really does place pads this map is choosing not to draw',
    ).toBeGreaterThan(3);
    const ops = paintOnce(0).mapOps;
    expect(
      ops.filter((op) => op.startsWith('arc')),
      'a rune disc is still drawn',
    ).toEqual([]);
    expect(
      ops.filter((op) => op === 'closePath'),
      'only the flag banners are closed paths',
    ).toHaveLength(BASES.length);
    // The source teeth, which also cover the cached PLATE (a pad drawn there
    // would never appear in a redraw trace at all): the painter no longer names
    // a rune symbol or reads a rune table.
    expect(mapPainterCode, 'the painter still names a rune symbol').not.toMatch(/RUNE/);
  });

  it('stamps no flat graveyard rectangle over the finished plate', () => {
    // The bug this fixed: each plot was a solid fill plus a team tint, drawn on
    // the MAP context every redraw over the finished atlas ground, which read
    // as a rendering error. The plot is plate ground now (its own surface
    // family in the relief core), so the redraw's only rectangles are the two
    // end washes and the two flag poles, and none of them is plot-sized.
    const ops = paintOnce(0).mapOps.filter((op) => op.startsWith('fillRect'));
    const s = (PLATE_CANVAS_SIZE - 36) / (HALF_Z * 2);
    const plotW = GRAVEYARDS[0].hw * 2 * s;
    const plotH = GRAVEYARDS[0].hd * 2 * s;
    expect(plotW, 'a plot is a visible rectangle at this scale').toBeGreaterThan(5);
    for (const op of ops) {
      const [, , , w, h] = op.split(' ');
      expect(
        Math.abs(Number(w) - plotW) > 1 || Math.abs(Number(h) - plotH) > 1,
        `a graveyard-sized fill survives the redraw: ${op}`,
      ).toBe(true);
    }
    expect(ops, 'two end washes and one pole per flag stand, nothing else').toHaveLength(
      2 + BASES.length,
    );
  });

  it('stipples both graveyard plots with headstones, on the plate', () => {
    // The other half of the same change: the plot reads as a graveyard because
    // the atlas language says so (ground surface plus stone marks), not because
    // a coloured rectangle was laid over it. Every headstone the pure core
    // emits must land as a drawn mark at its own projected position.
    const plate = buildPlate(0);
    const s = (PLATE_CANVAS_SIZE - 36) / (HALF_Z * 2);
    const arcs: Array<{ x: number; y: number }> = [];
    for (const op of plate.ops) {
      const m = /^arc (-?[\d.]+) (-?[\d.]+) /.exec(op);
      if (m) arcs.push({ x: Number(m[1]), y: Number(m[2]) });
    }
    const stones = bgAtlasMarks().filter((mark) => mark.kind === 'headstone');
    expect(stones.length).toBe(6 * GRAVEYARDS.length);
    const mx = Math.round((PLATE_CANVAS_SIZE - Math.round(HALF_X * 2 * s)) / 2);
    for (const stone of stones) {
      const sx = mx + (HALF_X - stone.x) * s;
      const sy = 18 + (HALF_Z - stone.z) * s;
      expect(
        arcs.some((a) => Math.hypot(a.x - sx, a.y - sy) < 1),
        `no headstone drawn for the stone at (${stone.x}, ${stone.z})`,
      ).toBe(true);
    }
  });

  it('turns the whole plate for the away team, labels upright and point-mirrored', () => {
    // The mirror-honesty rule: the field is point-symmetric and the away view is
    // the same ground read the other way round, so every label must land at the
    // 180-degree image of its home-view position. Same font (never rotated,
    // never mirrored) is the other half: a rotated PLATE would stand the names
    // on their heads.
    const home = buildPlate(0);
    const away = buildPlate(1);
    expect([away.w, away.h]).toEqual([home.w, home.h]);
    const homeLabels = plateLabels(home);
    const awayLabels = plateLabels(away);
    expect(awayLabels).toHaveLength(homeLabels.length);
    for (const label of homeLabels) {
      const twin = awayLabels.find(
        (l) =>
          l.text === label.text &&
          Math.abs(l.x + label.x - home.w) < 1 &&
          Math.abs(l.y + label.y - home.h) < 1,
      );
      expect(twin, `${label.text} at (${label.x}, ${label.y}) has no mirrored twin`).toBeTruthy();
      expect(twin?.font).toBe(label.font);
    }
  });
});
