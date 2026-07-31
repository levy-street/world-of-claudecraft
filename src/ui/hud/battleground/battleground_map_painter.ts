// Canvas painter for the M-key world map's Thornhollow Fields surface (the delve
// schematic's routing sibling): an illustrated field plan of THORNHOLLOW drawn
// from the same authored map data the colliders and the terrain are built from
// (the real wall boxes, the field heightfield, the graveyard plots, the rune
// pads, the flag stands), so the map can never drift from the ground a fighter
// walks, plus the honest marker set the pure model provides (self + teammates
// only; the fog's no-scouting rule owns everything else).
//
// Thornhollow is 240x452yd against the old code-defined field's 100x280, and
// its walls are concentrated in the two keeps, so a bare wall plan would leave
// the whole flag run empty. The plan is therefore built on a shaded terrain
// relief (bg_field_relief_core, shared with the minimap raster): the sunken
// Fightpit, the two flank ridges and the keep plateaus read as ground shape,
// with the wall plan on top. The relief plus the wall plan is STATIC in field
// coordinates, so it is rasterized once per canvas size into an offscreen
// canvas and blitted (the delve_map_painter / minimapBg cache technique); only
// the team washes and the live markers re-stroke per redraw.
//
// The terrain palette is hardcoded here the way map_terrain.ts hardcodes the
// world-map biome colours: sand flagstone ground, slate stone walls, dirt
// graveyards, sampled from the real field dressing. Only the two team hues
// resolve from CSS tokens (the minimap_painter caching rule: static :root
// tokens, no runtime mutation) so they ride the shared --color-team-*.

import {
  BG_BASES,
  BG_FLAG_Z,
  BG_GRAVEYARDS,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  bgFieldPlanWalls,
} from '../../../sim/battleground_layout';
import { TH_LOCATIONS } from '../../../sim/thornhollow_field.generated';
import { paintBgFieldRelief } from '../../bg_field_relief_core';
import type { BgMapModel } from './battleground_map_view';

const MAP_COLOR_TOKENS = {
  teamRed: '--color-team-red',
  teamBlue: '--color-team-blue',
  dead: '--color-minimap-party-dead',
} as const;

type BgMapColors = Record<keyof typeof MAP_COLOR_TOKENS, string>;

// Field palette (see header): the relief carries the ground now, so the flat
// fills left here are the built things standing on it, which read cool and dark
// against the sand so the team-colour marks always separate from them.
const KEEP_FLOOR = '#a49c8f';
const KEEP_FLOOR_ALPHA = 0.4;
const GRAVE_DIRT = '#8a7a5e';
const WALL_FILL = '#333a48';
const RUNE_FILL = '#e6dcc2';
const FIELD_EDGE = '#262c38';
const INK = '#00000090'; // dark edge that holds glyphs on the pale ground
const CARRY_RING = '#ffb03c'; // the scoreboard's .carried orange

const FIELD_PAD_PX = 18;
const MATE_R = 4;
const SELF_R = 6;
// Rune pads: shape-coded, never colour-coded, so they can never be mistaken for
// a team mark. Sprint pads are discs, the Battle/Ward pads diamonds.
const RUNE_R = 3;
const RUNE_EDGE_WIDTH = 1;
const WASH_ALPHA = 0.2;
const GRAVE_TINT_ALPHA = 0.22;
const MID_LINE = '#00000026';
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

export class BattlegroundMapPainter {
  private colors: BgMapColors | null = null;
  // The static field plan (relief + keep floors + the wall plan), rasterized at
  // the exact on-screen field size so the walls stay crisp, and keyed by it so
  // a canvas resize rebuilds rather than resampling.
  private plan: HTMLCanvasElement | null = null;
  private planKey = '';

  private resolveColors(): BgMapColors | null {
    if (this.colors) return this.colors;
    const style = getComputedStyle(document.documentElement);
    const out = {} as Record<string, string>;
    for (const [key, token] of Object.entries(MAP_COLOR_TOKENS)) {
      const v = style.getPropertyValue(token).trim();
      if (!v) return null; // stylesheet not applied yet: draw next frame
      out[key] = v;
    }
    this.colors = out as BgMapColors;
    return this.colors;
  }

  /** Draw the full-field plan + markers into the square map canvas. */
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

    // The cached plan is built in team-0 orientation. The field is
    // point-symmetric, so team 1's home-down view is that same raster turned
    // 180 degrees about the field centre, which is exactly the flip the pure
    // model applies to the markers.
    const plan = this.ensurePlan(fieldW, fieldH, model.halfX, model.halfZ, s);
    ctx.save();
    if (flip < 0) {
      ctx.translate(cx, cy);
      ctx.scale(-1, -1); // both axes: a rotation, never a mirror
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(plan, left, top, fieldW, fieldH);
    ctx.restore();

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
      wash.addColorStop(1, '#00000000');
      ctx.save();
      ctx.globalAlpha = WASH_ALPHA;
      ctx.fillStyle = wash;
      ctx.fillRect(left, top, fieldW, fieldH);
      ctx.restore();
    }

    // Mid line: the halfway mark through the Fightpit, dashed so it never reads
    // as a wall.
    ctx.save();
    ctx.strokeStyle = MID_LINE;
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
    ctx.strokeStyle = FIELD_EDGE;
    ctx.lineWidth = FRAME_WIDTH;
    ctx.strokeRect(left, top, fieldW, fieldH);

    // Rune pads (static positions; whether a pad is UP is live state the map
    // deliberately does not scout). Sprint discs, Battle/Ward diamonds.
    ctx.fillStyle = RUNE_FILL;
    ctx.strokeStyle = INK;
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
      ctx.strokeStyle = INK;
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
        ctx.strokeStyle = INK;
        ctx.lineWidth = MARK_EDGE_WIDTH;
        ctx.stroke();
      }
      if (mate.carrying) {
        ctx.strokeStyle = CARRY_RING;
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
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = SELF_EDGE_WIDTH;
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Rasterize the static half of the plan once per canvas size: the shaded
   * relief, the keep floors, then every REAL wall box of the field under its
   * own yaw. Built in team-0 (field-local) orientation with +x toward column 0
   * and +z toward row 0, which is the same projection paint() blits into.
   */
  private ensurePlan(
    w: number,
    h: number,
    halfX: number,
    halfZ: number,
    s: number,
  ): HTMLCanvasElement {
    const key = `${w}x${h}`;
    if (this.plan && this.planKey === key) return this.plan;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const bctx = canvas.getContext('2d');
    // A transient context failure must not be cached: returning the blank
    // canvas makes this redraw's blit a no-op and self-heals on the next one.
    if (!bctx) return canvas;
    const relief = bctx.createImageData(w, h);
    paintBgFieldRelief(relief.data, w, h, s, halfX, halfZ);
    bctx.putImageData(relief, 0, 0);

    // Keep floors: cooler stone over the two keep plateaus, so the fortresses
    // read as built rather than as bright high ground.
    bctx.save();
    bctx.globalAlpha = KEEP_FLOOR_ALPHA;
    bctx.fillStyle = KEEP_FLOOR;
    for (const rect of KEEP_RECTS) {
      // The raster negates both axes, so the rect's +x/+z bounds are its
      // top-left corner here.
      bctx.fillRect(
        (halfX - rect.maxX) * s,
        (halfZ - rect.maxZ) * s,
        (rect.maxX - rect.minX) * s,
        (rect.maxZ - rect.minZ) * s,
      );
    }
    bctx.restore();

    // The wall plan: every non-ghost box collider of the field (keep curtains,
    // court walls, gate structures, the ruins). Thornhollow's walls are placed
    // structures rather than axis-aligned segments, so each box is stroked
    // under its own yaw; negating both axes is a 180 degree rotation, which
    // preserves the rectangle but reverses the sense of the angle, hence -rot.
    bctx.fillStyle = WALL_FILL;
    for (const wall of bgFieldPlanWalls()) {
      bctx.save();
      bctx.translate((halfX - wall.x) * s, (halfZ - wall.z) * s);
      bctx.rotate(-wall.rot);
      bctx.fillRect(-wall.hw * s, -wall.hd * s, wall.hw * 2 * s, wall.hd * 2 * s);
      bctx.restore();
    }
    this.plan = canvas;
    this.planKey = key;
    return canvas;
  }

  private ownTint(model: BgMapModel, colors: BgMapColors): string {
    return model.myTeam === 0 ? colors.teamRed : colors.teamBlue;
  }

  private foeTint(model: BgMapModel, colors: BgMapColors): string {
    return model.myTeam === 0 ? colors.teamBlue : colors.teamRed;
  }
}
