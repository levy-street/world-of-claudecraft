// Canvas painter for the M-key world map's Thornhollow Fields surface (the delve
// schematic's routing sibling): an illustrated field plan of THORNHOLLOW drawn
// from the same authored map data the colliders and the terrain are built from
// (the real wall boxes, the field heightfield, the authored ground paint, the
// tree and boulder placements, the graveyard plots, the rune pads, the flag
// stands), so the map can never drift from the ground a fighter walks, plus the
// honest marker set the pure model provides (self + teammates only; the fog's
// no-scouting rule owns everything else).
//
// THE PLATE. The static half of this surface is a hand-drawn fantasy atlas
// plate, the same art language src/ui/map_terrain.ts paints the overworld map
// in, so the two map surfaces read as one atlas. Layer by layer:
//   1. the wooded lip the hollow sits in, filling the plate's margin,
//   2. the tree crowns standing OUT there, painted blobs with a lit northwest
//      side (map_terrain's clumped crowns, placed from the real trees),
//   3. the field slab's cast shadow, thrown southeast onto that lip,
//   4. the field itself: the authored ground paint as base colour, hypsometric
//      tinting, fbm vegetation mottling, contour banding, inked edges where one
//      surface meets another, and two-axis hillshade lit from the northwest
//      (all of it in the pure core, bg_field_relief_core.paintBgFieldAtlas),
//   5. the keep floors, the crowns standing inside the walls, and the boulder
//      and rubble stipples,
//   6. the wall plan: every real wall box, cast southeast and inked,
//   7. the carved slab edge, the ink line where the field meets the lip,
//   8. the landmark labels the map's own LOCATION rectangles name.
// map_terrain's remaining techniques do not transfer and are deliberately
// absent: there is no sea, no shoreline and no snowline on a walled field, and
// its mountain caret glyphs would be a lie about five yards of relief.
//
// All of that is STATIC in field coordinates, so it is rasterized once per
// (canvas size, team orientation, language) into an offscreen canvas and
// blitted (the delve_map_painter / minimapBg cache technique); only the team
// washes and the live markers re-stroke per redraw. The plate is built in the
// VIEWING orientation rather than built once and rotated, so the away team's
// plate is lit from the northwest too and its labels read upright.
//
// The TERRAIN palette is hardcoded here the way map_terrain.ts hardcodes the
// world-map biome colours: sampled field dressing, plate cartography ink, no
// theme. Everything a player reads as INTERFACE (the team hues, the dead ring,
// the self arrow, the frame, the halfway line, the glyph edge, the carrier
// ring) resolves from CSS tokens in one cached pass instead (the
// minimap_painter caching rule: static :root tokens, no runtime mutation), so
// the map cannot drift from the HUD it belongs to. See MAP_COLOR_TOKENS /
// MAP_CHROME_TOKENS below.

import {
  BG_BASES,
  BG_FLAG_Z,
  BG_GRAVEYARDS,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  bgFieldPlanWalls,
} from '../../../sim/battleground_layout';
import { TH_LOCATIONS } from '../../../sim/thornhollow_field.generated';
import { paintBgFieldAtlas } from '../../bg_field_relief_core';
import { getI18nRevision, type TranslationKey, t } from '../../i18n';
import { type BgAtlasLabelId, bgAtlasLabels, bgAtlasMarks } from './battleground_atlas_view';
import type { BgMapModel } from './battleground_map_view';

// REQUIRED tokens: the plan does not draw until every one of them resolves (an
// unstyled first frame would paint the team marks in the wrong hue, which is the
// one thing on this surface a player reads as sides).
const MAP_COLOR_TOKENS = {
  teamRed: '--color-team-red',
  teamBlue: '--color-team-blue',
  dead: '--color-minimap-party-dead',
  self: '--color-minimap-player',
} as const;

// CHROME tokens: the painter's own furniture (the frame, the halfway line, the
// glyph edge, the carrier ring). Resolved in the SAME single getComputedStyle
// pass as the required group, but each carries the literal it shipped with as a
// fallback, so an absent var (Node tests run with no stylesheet at all) degrades
// to today's exact appearance instead of blanking the map. The fallback is the
// ONLY place a colour literal is allowed to live in this file
// (tests/battleground_map_plan.test.ts pins that).
const MAP_CHROME_TOKENS = {
  fieldEdge: ['--color-bg-field-edge', '#262c38'],
  midLine: ['--color-bg-mid-line', '#00000026'],
  // dark edge that holds glyphs on the pale ground
  ink: ['--color-bg-map-ink', '#00000090'],
  // the scoreboard's .carried orange, which lives as a literal in components.css
  // today; this reads the token as soon as one is authored for it
  carryRing: ['--color-bg-carry-ring', '#ffb03c'],
} as const;

type BgMapColors = Record<keyof typeof MAP_COLOR_TOKENS | keyof typeof MAP_CHROME_TOKENS, string>;

// Field palette (see header): the atlas plate carries the ground now, so the
// flat fills left here are the built things standing on it, which read cool and
// dark against the sand so the team-colour marks always separate from them.
// These stay literals on the documented map_terrain precedent: they are a
// SAMPLED terrain palette (the field's own dressing), not interface chrome.
const KEEP_FLOOR = '#a49c8f';
const KEEP_FLOOR_ALPHA = 0.4;
const GRAVE_DIRT = '#8a7a5e';
const WALL_FILL = '#333a48';
const RUNE_FILL = '#e6dcc2';
// The atlas plate's own cartography, same precedent and the same reason a token
// cannot serve: the lip and the crowns are painted UNDER a raster the pure core
// writes as raw bytes, and the halo exists to hold ink on that raster.
// SURROUND is the old growth the hollow was cut out of; CROWN/BOULDER are the
// painted marks over it, each with a lit northwest side; LABEL_HALO is the
// parchment the landmark names are written on.
const SURROUND_FILL = '#3d4a33';
const CROWN_FILL = '#4a5f38';
const CROWN_LIT = '#71894f';
const BOULDER_FILL = '#8e8b82';
const BOULDER_LIT = '#b3b0a6';
const LABEL_HALO = '#efe6cf';

const FIELD_PAD_PX = 18;
// The plate keeps the map's own padding as a margin of wooded lip on every
// side, so it blits edge to edge in the square canvas and the field never
// floats on a bare background.
const PLATE_MARGIN_PX = FIELD_PAD_PX;
const MATE_R = 4;
const SELF_R = 6;
// Rune pads: shape-coded, never colour-coded, so they can never be mistaken for
// a team mark. Sprint pads are discs, the Battle/Ward pads diamonds.
const RUNE_R = 3;
const RUNE_EDGE_WIDTH = 1;
const WASH_ALPHA = 0.2;
const GRAVE_TINT_ALPHA = 0.22;
const MID_LINE_DASH = 4;
const FRAME_WIDTH = 2;
const FLAG_POLE_H = 14;
const FLAG_TOP_DY = 12;
const FLAG_FLY_X = 10;
const FLAG_MID_DY = 7.5;
const FLAG_BOTTOM_DY = 3;
const FLAG_POLE_W = 2.5;
const FLAG_POLE_DX = 1.5;
const FLAG_EDGE_WIDTH = 2;
const MARK_EDGE_WIDTH = 1;
const DEAD_RING_WIDTH = 1.5;
const CARRY_RING_GAP = 2.5;
const SELF_EDGE_WIDTH = 1.5;
const FULL_CIRCLE = Math.PI * 2;

// Plate geometry. The light is northwest throughout, so every cast shadow goes
// southeast and every lit face sits up-left of the thing it belongs to.
const SLAB_SHADOW_PX = 5;
// The ink token is itself a translucent black, so these alphas compound with it.
const SLAB_SHADOW_ALPHA = 0.55;
const SLAB_EDGE_WIDTH = 1.5;
const WALL_SHADOW_PX = 1.6;
const WALL_SHADOW_ALPHA = 0.55;
const WALL_INK_WIDTH = 0.7;
const LIT_OFFSET = 0.24; // fraction of a mark's radius, toward the light
const LIT_RADIUS = 0.66; // fraction of a mark's radius
const MARK_MIN_R_PX = 0.7; // below this a mark is grit, not a drawn thing

// Landmark labels. Sized off the plate rather than fixed, so the same plate
// reads at a phone's map canvas and a desktop's.
const LABEL_REGION_DIVISOR = 36;
const LABEL_REGION_MIN = 10;
const LABEL_REGION_MAX = 16;
const LABEL_PLACE_DIVISOR = 50;
const LABEL_PLACE_MIN = 8;
const LABEL_PLACE_MAX = 12;
const LABEL_HALO_WIDTH = 3;
const LABEL_FONT_FAMILY = 'Georgia';

// Every plate label is a t() key: the map's LOCATION names are authored English
// in a generated sim table, and the plate is the render sink that shows them.
// The plate cache is keyed on the i18n revision, so switching language rebuilds
// it with the new strings rather than blitting the old raster forever.
const LABEL_KEYS: Record<BgAtlasLabelId, TranslationKey> = {
  crimsonKeep: 'hudChrome.bg.map.crimsonKeep',
  azureKeep: 'hudChrome.bg.map.azureKeep',
  crimsonField: 'hudChrome.bg.map.crimsonField',
  azureField: 'hudChrome.bg.map.azureField',
  ruinCourtyard: 'hudChrome.bg.map.ruinCourtyard',
  graveyard: 'hudChrome.bg.map.graveyard',
};

// The authored regions the plan tints, taken from the map's own location
// rectangles (thornhollow_field.generated.ts) rather than from a code constant:
// the two keeps read as built stone, and their front line is where each team's
// end wash fades out. That line replaces the old BG_CURTAIN_Z chamber line,
// which went away with the code-defined field.
const KEEP_NAME_SUFFIX = 'Keep';
const KEEP_RECTS = TH_LOCATIONS.filter((l) => l.name.endsWith(KEEP_NAME_SUFFIX));
const KEEP_LINE_Z = KEEP_RECTS.length
  ? Math.min(...KEEP_RECTS.map((r) => Math.min(Math.abs(r.minZ), Math.abs(r.maxZ))))
  : BG_FLAG_Z;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class BattlegroundMapPainter {
  private colors: BgMapColors | null = null;
  // The static atlas plate (the lip, the relief, the keep floors, the marks,
  // the wall plan and the labels), rasterized at the exact on-screen field size
  // so the walls stay crisp, and keyed by that size, the viewing orientation
  // and the language, so a resize, a team swap or a language switch rebuilds
  // rather than resampling or blitting stale text.
  private plan: HTMLCanvasElement | null = null;
  private planKey = '';

  private resolveColors(): BgMapColors | null {
    if (this.colors) return this.colors;
    // ONE getComputedStyle pass for both groups, cached for the session (the
    // minimap_painter caching rule: these are static :root tokens).
    const style = getComputedStyle(document.documentElement);
    const out = {} as Record<string, string>;
    for (const [key, token] of Object.entries(MAP_COLOR_TOKENS)) {
      const v = style.getPropertyValue(token).trim();
      if (!v) return null; // stylesheet not applied yet: draw next frame
      out[key] = v;
    }
    for (const [key, [token, fallback]] of Object.entries(MAP_CHROME_TOKENS)) {
      out[key] = style.getPropertyValue(token).trim() || fallback;
    }
    this.colors = out as BgMapColors;
    return this.colors;
  }

  /** Draw the full-field plate + markers into the square map canvas. */
  paint(ctx: CanvasRenderingContext2D, model: BgMapModel, canvasSize: number): void {
    const colors = this.resolveColors();
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    if (!model.active || !colors) return;
    // Fit the tall field (2*halfX wide, 2*halfZ deep) into the square canvas;
    // +z (the away half) points UP, so map y = -z.
    const s = Math.min(
      (canvasSize - FIELD_PAD_PX * 2) / (model.halfX * 2),
      (canvasSize - FIELD_PAD_PX * 2) / (model.halfZ * 2),
    );
    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    // World-to-screen follows the minimap/world-map convention: +z (the away
    // half) points UP, and the world's east is -x, so +x maps LEFT (px
    // negates). Without the negation the plan mirrors east-west against the
    // field the player is standing in (the playtest bug).
    const px = (x: number): number => cx - x * s;
    const py = (z: number): number => cy - z * s;
    const flip = model.myTeam === 0 ? 1 : -1;
    const fieldW = Math.round(model.halfX * 2 * s);
    const fieldH = Math.round(model.halfZ * 2 * s);
    const left = cx - fieldW / 2;
    const top = cy - fieldH / 2;

    // The plate is built in the VIEWING orientation (the field is
    // point-symmetric, so team 1's home-down view is the same ground walked the
    // other way round), which is why it blits straight rather than under a
    // rotation: a rotated raster would light the away team's plate from the
    // southeast and stand its labels on their heads.
    const plan = this.ensurePlan(fieldW, fieldH, model.halfX, model.halfZ, s, flip, colors);
    ctx.drawImage(plan, left - PLATE_MARGIN_PX, top - PLATE_MARGIN_PX);

    // Team end washes: your colour bleeds up from the bottom edge, theirs down
    // from the top, fading out at the keep fronts, so orientation reads at a
    // glance without hiding the ground or the plan under it.
    const own = this.ownTint(model, colors);
    const foe = this.foeTint(model, colors);
    for (const [tint, edgeZ] of [
      [own, -model.halfZ],
      [foe, model.halfZ],
    ] as const) {
      const wash = ctx.createLinearGradient(0, py(edgeZ), 0, py(Math.sign(edgeZ) * KEEP_LINE_Z));
      wash.addColorStop(0, tint);
      wash.addColorStop(1, 'transparent'); // the CSS keyword, not a colour choice
      ctx.save();
      ctx.globalAlpha = WASH_ALPHA;
      ctx.fillStyle = wash;
      ctx.fillRect(left, top, fieldW, fieldH);
      ctx.restore();
    }

    // Mid line: the halfway mark through the Fightpit, dashed so it never reads
    // as a wall.
    ctx.save();
    ctx.strokeStyle = colors.midLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([MID_LINE_DASH, MID_LINE_DASH]);
    ctx.beginPath();
    ctx.moveTo(left, py(0));
    ctx.lineTo(left + fieldW, py(0));
    ctx.stroke();
    ctx.restore();

    // Graveyard plots: dirt inside the rails with a faint side tint (by MAP
    // side, not home team id: the bottom, own, side reads in your colour).
    for (const plot of BG_GRAVEYARDS) {
      const x = plot.x * flip;
      const z = plot.z * flip;
      const gx = px(x + plot.hw); // px negates: left edge is the +x bound
      const gy = py(z + plot.hd);
      ctx.fillStyle = GRAVE_DIRT;
      ctx.fillRect(gx, gy, plot.hw * 2 * s, plot.hd * 2 * s);
      ctx.save();
      ctx.globalAlpha = GRAVE_TINT_ALPHA;
      ctx.fillStyle = z < 0 ? own : foe;
      ctx.fillRect(gx, gy, plot.hw * 2 * s, plot.hd * 2 * s);
      ctx.restore();
    }

    // Field frame on top of the plan, so the perimeter reads as one edge.
    // Small furniture (pillars, crates, banners) stays OFF the plan on
    // purpose: the map answers routes and objectives.
    ctx.strokeStyle = colors.fieldEdge;
    ctx.lineWidth = FRAME_WIDTH;
    ctx.strokeRect(left, top, fieldW, fieldH);

    // Rune pads (static positions; whether a pad is UP is live state the map
    // deliberately does not scout). Sprint discs, Battle/Ward diamonds.
    ctx.fillStyle = RUNE_FILL;
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = RUNE_EDGE_WIDTH;
    for (const pad of BG_SPEED_RUNES) {
      ctx.beginPath();
      ctx.arc(px(pad.x * flip), py(pad.z * flip), RUNE_R, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
    }
    for (const pad of BG_POWER_RUNES) {
      const x = px(pad.x * flip);
      const y = py(pad.z * flip);
      ctx.beginPath();
      ctx.moveTo(x, y - RUNE_R);
      ctx.lineTo(x + RUNE_R, y);
      ctx.lineTo(x, y + RUNE_R);
      ctx.lineTo(x - RUNE_R, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Flag STANDS (static; live flag positions are deliberately not mapped).
    // The stands are the objective, so they read LARGE: a bold banner glyph
    // with a dark edge so it holds on both the keep floor and the wash.
    for (const base of BG_BASES) {
      const x = px(base.flag.x * flip);
      const y = py(base.flag.z * flip);
      const mine = base.team === model.myTeam;
      ctx.save();
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = FLAG_EDGE_WIDTH;
      ctx.fillStyle = mine ? own : foe;
      ctx.beginPath();
      ctx.moveTo(x, y - FLAG_TOP_DY);
      ctx.lineTo(x + FLAG_FLY_X, y - FLAG_MID_DY);
      ctx.lineTo(x, y - FLAG_BOTTOM_DY);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.fillRect(x - FLAG_POLE_DX, y - FLAG_TOP_DY, FLAG_POLE_W, FLAG_POLE_H);
      ctx.restore();
    }

    // Teammates: team-colour discs (hollow when dead, an orange ring when
    // carrying), each with a dark edge so they hold on the pale ground.
    for (const mate of model.mates) {
      const x = px(mate.x);
      const y = py(mate.z);
      ctx.beginPath();
      ctx.arc(x, y, MATE_R, 0, FULL_CIRCLE);
      if (mate.dead) {
        ctx.strokeStyle = colors.dead;
        ctx.lineWidth = DEAD_RING_WIDTH;
        ctx.stroke();
      } else {
        ctx.fillStyle = own;
        ctx.fill();
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = MARK_EDGE_WIDTH;
        ctx.stroke();
      }
      if (mate.carrying) {
        ctx.strokeStyle = colors.carryRing;
        ctx.lineWidth = DEAD_RING_WIDTH;
        ctx.beginPath();
        ctx.arc(x, y, MATE_R + CARRY_RING_GAP, 0, FULL_CIRCLE);
        ctx.stroke();
      }
    }

    // Self: the standard player arrow, rotated with the oriented facing,
    // white with a dark edge so it survives the light sand.
    const self = model.self;
    if (self) {
      ctx.save();
      ctx.translate(px(self.x), py(self.z));
      // canvas rotates clockwise; facing increases turning left (the minimap
      // player-arrow rule), so the arrow spins with -facing.
      ctx.rotate(-self.facing);
      ctx.beginPath();
      ctx.moveTo(0, -SELF_R - 2);
      ctx.lineTo(SELF_R - 1, SELF_R);
      ctx.lineTo(0, SELF_R * 0.45);
      ctx.lineTo(-SELF_R + 1, SELF_R);
      ctx.closePath();
      ctx.fillStyle = colors.self;
      ctx.fill();
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = SELF_EDGE_WIDTH;
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Rasterize the static half of the surface once per (size, orientation,
   * language): the atlas plate described in the file header, drawn in the
   * VIEWING orientation with +x toward the plate's left edge and +z toward its
   * top, which is exactly the projection paint() blits into.
   */
  private ensurePlan(
    w: number,
    h: number,
    halfX: number,
    halfZ: number,
    s: number,
    flip: number,
    colors: BgMapColors,
  ): HTMLCanvasElement {
    const key = `${w}x${h}:${flip}:${getI18nRevision()}`;
    if (this.plan && this.planKey === key) return this.plan;
    const m = PLATE_MARGIN_PX;
    const canvas = document.createElement('canvas');
    canvas.width = w + m * 2;
    canvas.height = h + m * 2;
    const bctx = canvas.getContext('2d');
    // A transient context failure must not be cached: returning the blank
    // canvas makes this redraw's blit a no-op and self-heals on the next one.
    if (!bctx) return canvas;
    // Field-local yards to plate pixels. Both axes negate (the map's east-left,
    // north-up convention) and `flip` turns the whole field for the away team.
    const fx = (x: number): number => m + (halfX - x * flip) * s;
    const fy = (z: number): number => m + (halfZ - z * flip) * s;

    // 1. the old growth the hollow was cut out of, filling the whole plate.
    bctx.fillStyle = SURROUND_FILL;
    bctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. the crowns standing OUTSIDE the walls, drawn before the field slab so
    //    the rampart line cuts them the way the wall really does.
    const marks = bgAtlasMarks();
    for (const mark of marks) {
      if (mark.kind !== 'crown') continue;
      if (Math.abs(mark.x) <= halfX && Math.abs(mark.z) <= halfZ) continue;
      this.drawMark(bctx, fx(mark.x), fy(mark.z), mark.r * s, CROWN_FILL, CROWN_LIT);
    }

    // 3. the slab's cast shadow on the lip (light from the northwest, so the
    //    shadow falls southeast). The part under the field is painted over by
    //    the relief below; what survives is the band beyond two edges.
    bctx.save();
    bctx.globalAlpha = SLAB_SHADOW_ALPHA;
    bctx.fillStyle = colors.ink;
    bctx.fillRect(m + SLAB_SHADOW_PX, m + SLAB_SHADOW_PX, w, h);
    bctx.restore();

    // 4. the field itself, written straight into a pixel buffer by the pure core.
    const relief = bctx.createImageData(w, h);
    paintBgFieldAtlas(relief.data, w, h, s, flip * halfX, flip * halfZ, flip < 0 ? -1 : 1);
    bctx.putImageData(relief, m, m);

    // 5a. Keep floors: cooler stone over the two keep plateaus, so the
    //     fortresses read as built rather than as bright high ground.
    bctx.save();
    bctx.globalAlpha = KEEP_FLOOR_ALPHA;
    bctx.fillStyle = KEEP_FLOOR;
    for (const rect of KEEP_RECTS) {
      const x0 = Math.min(fx(rect.minX), fx(rect.maxX));
      const y0 = Math.min(fy(rect.minZ), fy(rect.maxZ));
      bctx.fillRect(x0, y0, (rect.maxX - rect.minX) * s, (rect.maxZ - rect.minZ) * s);
    }
    bctx.restore();

    // 5b. the marks standing on the field: crowns first, then the boulder and
    //     rubble stipples, each lit from the northwest like the crowns outside.
    for (const mark of marks) {
      if (mark.kind !== 'crown') continue;
      if (Math.abs(mark.x) > halfX || Math.abs(mark.z) > halfZ) continue;
      this.drawMark(bctx, fx(mark.x), fy(mark.z), mark.r * s, CROWN_FILL, CROWN_LIT);
    }
    for (const mark of marks) {
      if (mark.kind !== 'boulder') continue;
      this.drawMark(bctx, fx(mark.x), fy(mark.z), mark.r * s, BOULDER_FILL, BOULDER_LIT);
    }

    // 6. The wall plan: every non-ghost box collider of the field (keep
    // curtains, court walls, gate structures, the ruins), each cast southeast
    // and then inked, so a wall reads as a standing thing rather than a decal.
    // Thornhollow's walls are placed structures rather than axis-aligned
    // segments, so each box is stroked under its own yaw; the two views differ
    // by a 180 degree turn, which preserves the rectangle but reverses the
    // sense of the angle, hence -rot for both.
    const walls = bgFieldPlanWalls();
    bctx.save();
    bctx.globalAlpha = WALL_SHADOW_ALPHA;
    bctx.fillStyle = colors.ink;
    for (const wall of walls) {
      bctx.save();
      bctx.translate(fx(wall.x) + WALL_SHADOW_PX, fy(wall.z) + WALL_SHADOW_PX);
      bctx.rotate(-wall.rot);
      bctx.fillRect(-wall.hw * s, -wall.hd * s, wall.hw * 2 * s, wall.hd * 2 * s);
      bctx.restore();
    }
    bctx.restore();
    bctx.fillStyle = WALL_FILL;
    bctx.strokeStyle = colors.ink;
    bctx.lineWidth = WALL_INK_WIDTH;
    for (const wall of walls) {
      bctx.save();
      bctx.translate(fx(wall.x), fy(wall.z));
      bctx.rotate(-wall.rot);
      bctx.fillRect(-wall.hw * s, -wall.hd * s, wall.hw * 2 * s, wall.hd * 2 * s);
      bctx.strokeRect(-wall.hw * s, -wall.hd * s, wall.hw * 2 * s, wall.hd * 2 * s);
      bctx.restore();
    }

    // 7. the carved slab edge: the ink line where the field's ground stops and
    //    the wood begins. map_terrain draws this where land meets sea; a walled
    //    field has no coast, and its rampart is the same cut.
    bctx.strokeStyle = colors.ink;
    bctx.lineWidth = SLAB_EDGE_WIDTH;
    bctx.strokeRect(m, m, w, h);

    // 8. the landmark names, written on the plate at build time.
    this.drawLabels(bctx, fx, fy, h, colors);

    this.plan = canvas;
    this.planKey = key;
    return canvas;
  }

  /** One painted atlas mark: a blob in `fill` with a lit face toward the
   *  northwest, the hand-drawn crown read map_terrain paints per pixel. */
  private drawMark(
    bctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    fill: string,
    lit: string,
  ): void {
    if (r < MARK_MIN_R_PX) return;
    bctx.fillStyle = fill;
    bctx.beginPath();
    bctx.arc(cx, cy, r, 0, FULL_CIRCLE);
    bctx.fill();
    bctx.fillStyle = lit;
    bctx.beginPath();
    bctx.arc(cx - r * LIT_OFFSET, cy - r * LIT_OFFSET, r * LIT_RADIUS, 0, FULL_CIRCLE);
    bctx.fill();
  }

  /** Write every landmark name the authored map exposes, in the atlas serif,
   *  each on a parchment halo so it holds over turf, stone and wall alike. */
  private drawLabels(
    bctx: CanvasRenderingContext2D,
    fx: (x: number) => number,
    fy: (z: number) => number,
    fieldH: number,
    colors: BgMapColors,
  ): void {
    const regionPx = clamp(
      Math.round(fieldH / LABEL_REGION_DIVISOR),
      LABEL_REGION_MIN,
      LABEL_REGION_MAX,
    );
    const placePx = clamp(
      Math.round(fieldH / LABEL_PLACE_DIVISOR),
      LABEL_PLACE_MIN,
      LABEL_PLACE_MAX,
    );
    bctx.save();
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.lineJoin = 'round';
    bctx.lineWidth = LABEL_HALO_WIDTH;
    for (const label of bgAtlasLabels()) {
      const size = label.tier === 'region' ? regionPx : placePx;
      const text = t(LABEL_KEYS[label.id]);
      bctx.font = `bold ${size}px ${LABEL_FONT_FAMILY}`;
      // The keeps anchor at the field ends, where the raw projection can put
      // half the glyph run past the plate edge; clamp the text box inside the
      // canvas so no landmark name is ever clipped by the plate boundary.
      const halfW = bctx.measureText(text).width / 2 + LABEL_HALO_WIDTH;
      const halfH = size * 0.62 + LABEL_HALO_WIDTH;
      const lx = clamp(fx(label.x), halfW, bctx.canvas.width - halfW);
      const lz = clamp(fy(label.z), halfH, bctx.canvas.height - halfH);
      bctx.strokeStyle = LABEL_HALO;
      bctx.strokeText(text, lx, lz);
      bctx.fillStyle = colors.ink;
      bctx.fillText(text, lx, lz);
    }
    bctx.restore();
  }

  private ownTint(model: BgMapModel, colors: BgMapColors): string {
    return model.myTeam === 0 ? colors.teamRed : colors.teamBlue;
  }

  private foeTint(model: BgMapModel, colors: BgMapColors): string {
    return model.myTeam === 0 ? colors.teamBlue : colors.teamRed;
  }
}
