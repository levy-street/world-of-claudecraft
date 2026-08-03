// Canvas painter for the M-key world map's Thornhollow Fields surface (the delve
// schematic's routing sibling): an illustrated field plan of THORNHOLLOW drawn
// from the same authored map data the colliders and the terrain are built from
// (the real wall boxes, the field heightfield, the authored ground paint, the
// tree and boulder placements, the graveyard plots, the flag stands), so the map
// can never drift from the ground a fighter walks, plus the honest marker set
// the pure model provides (self + teammates only; the fog's no-scouting rule
// owns everything else). Rune pads are deliberately NOT drawn: whether a pad is
// up is live state the map does not scout, and a plate full of static pips
// collided with the landmark names for no read a player acts on.
//
// THE PLATE. The static half of this surface is a hand-drawn fantasy atlas
// plate, the same art language src/ui/map_terrain.ts paints the overworld map
// in, so the two map surfaces read as one atlas. Layer by layer:
//   1. the old growth the hollow sits in, filling the WHOLE square canvas
//      (deterministic hash-grid canopy plus an edge vignette), so the tall
//      field never floats on the window's bare background,
//   2. the tree crowns standing just outside the walls, painted blobs with a
//      lit northwest side (map_terrain's clumped crowns, from the real trees),
//   3. the field slab's cast shadow, thrown southeast onto that lip,
//   4. the field itself: the authored ground paint as base colour (the two
//      graveyard plots included, stamped in as their own surface family so a
//      plot is drawn GROUND rather than a flat rectangle laid over the plate),
//      hypsometric tinting, fbm vegetation mottling, contour banding, inked
//      edges where one surface meets another, and two-axis hillshade lit from
//      the northwest (all of it in the pure core,
//      bg_field_relief_core.paintBgFieldAtlas),
//   5. the keep floors, the crowns standing inside the walls, the boulder and
//      rubble stipples, and the headstones on the two plots (the mark read
//      itself is the shared battleground_atlas_marks_painter, which the
//      MINIMAP's cached raster bakes the same marks with),
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

import { BG_BASES, BG_FLAG_Z, bgFieldPlanWalls } from '../../../sim/battleground_layout';
import { TH_LOCATIONS } from '../../../sim/thornhollow_field.generated';
import { paintBgFieldAtlas } from '../../bg_field_relief_core';
import { getI18nRevision, type TranslationKey, t } from '../../i18n';
import { drawBgAtlasMarks, drawBgBackdropCrowns } from './battleground_atlas_marks_painter';
import { type BgAtlasLabelId, type BgAtlasMark, bgAtlasLabels } from './battleground_atlas_view';
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
const WALL_FILL = '#333a48';
// The atlas plate's own cartography, same precedent and the same reason a token
// cannot serve: the lip is painted UNDER a raster the pure core writes as raw
// bytes, and the halo exists to hold ink on that raster. SURROUND is the old
// growth the hollow was cut out of; LABEL_HALO is the parchment the landmark
// names are written on. The marks standing on both (crowns, boulders,
// headstones) carry their own palette in the shared
// battleground_atlas_marks_painter, which the minimap raster draws from too.
const SURROUND_FILL = '#3d4a33';
const LABEL_HALO = '#efe6cf';

const FIELD_PAD_PX = 18;
// The wooded surround's edge vignette (ink token; alphas compound with it).
const VIGNETTE_ALPHA = 0.16;
const VIGNETTE_DEPTH_FRAC = 0.14;
const VIGNETTE_DEPTH_MAX_PX = 72;
const MATE_R = 4;
const SELF_R = 6;
const WASH_ALPHA = 0.2;
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
    // southeast and stand its labels on their heads. The plate is the WHOLE
    // square canvas (the field centered in a full-bleed wooded surround), so it
    // blits at the origin.
    const plan = this.ensurePlan(
      canvasSize,
      fieldW,
      fieldH,
      model.halfX,
      model.halfZ,
      s,
      flip,
      colors,
    );
    ctx.drawImage(plan, 0, 0);

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

    // Field frame on top of the plan, so the perimeter reads as one edge.
    // Small furniture (pillars, crates, banners) stays OFF the plan on
    // purpose: the map answers routes and objectives. The graveyard plots are
    // drawn GROUND on the plate (their own surface family in the relief core),
    // so nothing re-stamps them here.
    ctx.strokeStyle = colors.fieldEdge;
    ctx.lineWidth = FRAME_WIDTH;
    ctx.strokeRect(left, top, fieldW, fieldH);

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
    canvasSize: number,
    w: number,
    h: number,
    halfX: number,
    halfZ: number,
    s: number,
    flip: number,
    colors: BgMapColors,
  ): HTMLCanvasElement {
    const key = `${canvasSize}:${w}x${h}:${flip}:${getI18nRevision()}`;
    if (this.plan && this.planKey === key) return this.plan;
    // The field sits centered in the square canvas; everything outside it is
    // the wooded surround, filled edge to edge so the tall field never floats
    // on the window's bare background.
    const mx = Math.round((canvasSize - w) / 2);
    const my = Math.round((canvasSize - h) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const bctx = canvas.getContext('2d');
    // A transient context failure must not be cached: returning the blank
    // canvas makes this redraw's blit a no-op and self-heals on the next one.
    if (!bctx) return canvas;
    // Field-local yards to plate pixels. Both axes negate (the map's east-left,
    // north-up convention) and `flip` turns the whole field for the away team.
    const fx = (x: number): number => mx + (halfX - x * flip) * s;
    const fy = (z: number): number => my + (halfZ - z * flip) * s;

    // 1. the old growth the hollow was cut out of, filling the whole canvas.
    bctx.fillStyle = SURROUND_FILL;
    bctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1b. the canopy over that old growth: a deterministic hash-grid crown
    //     fill (shared palette and crown read) across everything the field
    //     raster will not overwrite, so the margin reads as painted forest
    //     rather than flat green. Crowns whose center falls under the field
    //     are skipped; ones straddling the boundary are cut by the slab.
    drawBgBackdropCrowns(
      bctx,
      canvasSize,
      canvasSize,
      (x, y) => x > mx && x < mx + w && y > my && y < my + h,
    );

    // 2. the crowns standing OUTSIDE the walls, drawn before the field slab so
    //    the rampart line cuts them the way the wall really does. The mark read
    //    itself is the shared routine the minimap raster bakes its own marks
    //    with, so the two surfaces cannot draw the same tree two ways.
    const proj = { fx, fy, s };
    const onField = (mark: BgAtlasMark): boolean =>
      Math.abs(mark.x) <= halfX && Math.abs(mark.z) <= halfZ;
    drawBgAtlasMarks(bctx, proj, (mark) => mark.kind === 'crown' && !onField(mark));

    // 2b. a soft vignette pulling the canopy down toward the canvas edges, so
    //     the eye lands on the lit field. Ink-token based and drawn BEFORE the
    //     relief, so the field itself never darkens.
    this.drawBackdropVignette(bctx, canvasSize, colors);

    // 3. the slab's cast shadow on the lip (light from the northwest, so the
    //    shadow falls southeast). The part under the field is painted over by
    //    the relief below; what survives is the band beyond two edges.
    bctx.save();
    bctx.globalAlpha = SLAB_SHADOW_ALPHA;
    bctx.fillStyle = colors.ink;
    bctx.fillRect(mx + SLAB_SHADOW_PX, my + SLAB_SHADOW_PX, w, h);
    bctx.restore();

    // 4. the field itself, written straight into a pixel buffer by the pure core.
    const relief = bctx.createImageData(w, h);
    paintBgFieldAtlas(relief.data, w, h, s, flip * halfX, flip * halfZ, flip < 0 ? -1 : 1);
    bctx.putImageData(relief, mx, my);

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
    //     rubble stipples, then the headstones on the two graveyard plots, each
    //     lit from the northwest like the crowns outside. The shared routine
    //     owns that order, so this pass is everything step 2 did not draw.
    drawBgAtlasMarks(bctx, proj, (mark) => mark.kind !== 'crown' || onField(mark));

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
    bctx.strokeRect(mx, my, w, h);

    // 8. the landmark names, written on the plate at build time.
    this.drawLabels(bctx, fx, fy, h, colors);

    this.plan = canvas;
    this.planKey = key;
    return canvas;
  }

  /** Darken the wooded surround toward each canvas edge (ink token at a low
   *  alpha, one linear gradient per side), so the backdrop frames the field
   *  instead of competing with it. Runs before the field raster is placed, so
   *  only the surround ever darkens. */
  private drawBackdropVignette(
    bctx: CanvasRenderingContext2D,
    canvasSize: number,
    colors: BgMapColors,
  ): void {
    const depth = Math.min(Math.round(canvasSize * VIGNETTE_DEPTH_FRAC), VIGNETTE_DEPTH_MAX_PX);
    bctx.save();
    bctx.globalAlpha = VIGNETTE_ALPHA;
    const edges: ReadonlyArray<readonly [number, number, number, number]> = [
      [0, 0, depth, 0], // left, fading rightward
      [canvasSize, 0, canvasSize - depth, 0], // right
      [0, 0, 0, depth], // top
      [0, canvasSize, 0, canvasSize - depth], // bottom
    ];
    for (const [x0, y0, x1, y1] of edges) {
      const g = bctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, colors.ink);
      g.addColorStop(1, 'transparent'); // the CSS keyword, not a colour choice
      bctx.fillStyle = g;
      bctx.fillRect(0, 0, canvasSize, canvasSize);
    }
    bctx.restore();
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
