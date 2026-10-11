"""The harbor route marker: the signpost that stands at every passenger ferry berth.

  blender --background --python scripts/assets/harbor_route_marker/build_harbor_route_marker.py -- \
      [--preview OUT_DIR] [--save FILE.blend]

Writes harbor_route_marker_source.glb beside this file. `node scripts/assets/harbor_route_marker/build.mjs`
ships it (validate, fingerprint, meshopt) to public/models/props/harbor_route_marker.glb, and
src/render/harbor_route_markers.ts draws one per berth (src/sim/content/harbor_route_markers.ts).

One model serves every berth. It says three things and nothing else: this is a ship stop (the
anchor roundel on top), where the ship goes (the destination the game writes on the cream panel
at runtime, never modelled here), and which way to board (the arrow board, whose head is part of
the silhouette). The arrow always points down local +x; the runtime turns the whole sign toward
the boarding point, and draws the destination on BOTH faces of the board as separate planes, so
the name never reads mirrored whichever side a player stands on.

Frame: game yards, origin at the foot of the post (floor-seated at y 0, the post centred on x/z),
+x the arrow, +y up, +z the front face (shiplib.P maps it to Blender). Scale: the player model
stands 2.6 yd to the crown (HUMANOID_H in render/characters/manifest.ts); the sign stands about
2.5 times that, its arrow board above head height so it reads over a crowd on the pier.

Hierarchy (the runtime depends on these names):

  HarborRouteMarker_ROOT      root, the placed transform (the foot of the post)
    Post                      the chunky post, its base collar and iron foot plate
    SignBoard                 the arrow board: two planks, the swallowtail, the blue head, the
                              cream destination panels on both faces
    MaritimeIcon              the anchor roundel on top of the post, turned 45 degrees toward
                              the tail so it reads from the pier approach as well as the sides
    MetalTrim                 iron bands, straps, corner brackets, bolts, knee brace, brass tip,
                              mooring ring (medium tier and up)
    OptionalLantern           the bracket lantern beside the tail (high tier and up)
    OptionalChain             the lantern's short chain (high tier and up)
    OptionalRope              the rope coil on the collar (high tier and up)
    DestinationTextAnchor     the centre of the destination panel (extras: its size and the
                              face offset of each text plane)
    Socket_ArrowTip           the tip of the arrow (the direction the sign points)

Everything is original procedural work for this project. The palette is the Eastbrook ferry's
(scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py PAL) so the sign belongs to the ship.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'eastbrook_ferry'))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from shiplib import EDGE, FLAT, GLOW, IRON, ROPE, WOOD, P, Piece, empty, scale_color, triangles  # noqa: E402

# ---------------------------------------------------------------------------
# Palette: the Eastbrook ferry's own values (build_eastbrook_ferry.py PAL)
# ---------------------------------------------------------------------------
PAL = dict(
    plank=[(0.66, 0.45, 0.29), (0.62, 0.42, 0.27), (0.69, 0.47, 0.3), (0.64, 0.435, 0.28)],
    post=(0.5, 0.34, 0.22),
    post_dark=(0.42, 0.28, 0.18),
    trim_dark=(0.54, 0.37, 0.24),
    seam=(0.3, 0.21, 0.14),
    iron=(0.36, 0.36, 0.38),
    iron_hi=(0.52, 0.52, 0.54),
    brass=(0.82, 0.63, 0.32),
    accent=(0.2, 0.36, 0.7),
    accent_hi=(0.23, 0.4, 0.74),
    cream=(0.95, 0.9, 0.76),
    ivory=(0.93, 0.88, 0.75),
    rope=(0.72, 0.6, 0.43),
    rope_dark=(0.56, 0.46, 0.32),
    glow=(1.0, 0.78, 0.46),
)

MATERIAL_SPECS = (
    # name, roughness, metallic, emission; indexed like shiplib (WOOD, IRON, -, ROPE, GLOW)
    ('HarborWood', 0.82, 0.0, 0.0),
    ('HarborIron', 0.5, 0.4, 0.0),
    ('HarborUnused', 0.9, 0.0, 0.0),
    ('HarborRope', 0.95, 0.0, 0.0),
    ('HarborGlow', 0.5, 0.0, 2.2),
)

# ---------------------------------------------------------------------------
# Dimensions (yards). The sim reads POST_COLLIDER_R; the runtime reads the text anchor.
# ---------------------------------------------------------------------------
PLAYER_H = 2.6
POST_HW = 0.22              # the shaft's half width
POST_TOP = 5.1
COLLAR_HW = 0.31
COLLAR_TOP = 0.62
POST_COLLIDER_R = 0.35      # the one narrow collision volume: the post and its collar
BOARD_T = 0.2               # board thickness (z)
BOARD_Y0, BOARD_Y1 = 3.3, 4.5
BOARD_MID = (BOARD_Y0 + BOARD_Y1) / 2
TAIL_X = -0.55              # the swallowtail's outer points
NOTCH = 0.35                # how deep the swallowtail cuts in
HEAD_X = 3.2                # where the arrow head starts
TIP_X = 4.3                 # the arrow's point
HEAD_OVER = 0.22            # how far the head's barbs stand past the board
PANEL_X0, PANEL_X1 = 0.36, 3.02
PANEL_Y0, PANEL_Y1 = BOARD_MID - 0.44, BOARD_MID + 0.44
PANEL_PROUD = 0.022         # the cream panel stands this far off each board face
PANEL_CORNER = 0.07         # the panel's clipped corners
TEXT_FILL = (0.9, 0.62)     # the share of the panel the lettering may fill (w, h)
ICON_C = 5.86               # the anchor roundel's centre
ICON_R = 0.56
ICON_T = 0.16
ICON_TURN_DEG = -45.0        # the roundel's face turned from +z toward the tail (-x)


def plank(i):
    return PAL['plank'][i % len(PAL['plank'])]


def slab(p, poly, z0, z1, color, mat=WOOD, side_color=None, tag=FLAT):
    """A convex polygon in the game XY plane (counter-clockwise seen from +z), extruded
    from z0 to z1: a closed prism with shared corners. Sides take `side_color` as an
    edge highlight."""
    bm = p.bm
    back = [bm.verts.new(P(x, y, z0)) for x, y in poly]
    front = [bm.verts.new(P(x, y, z1)) for x, y in poly]
    faces = [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    p.paint(faces, color, mat, tag)
    sides = []
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        sides.append(bm.faces.new((back[i], back[j], front[j], front[i])))
    p.paint(sides, side_color if side_color is not None else scale_color(color, 0.9), mat, EDGE)
    p.closed.extend(faces + sides)
    return faces + sides


def both_faces(fn):
    """Build a front-face detail at +z and its twin at -z."""
    for s in (1, -1):
        fn(s)


# ---------------------------------------------------------------------------
# Post
# ---------------------------------------------------------------------------
def build_post():
    p = Piece('Post', wear=0.07, gradient=0.14)
    # iron foot plate bolted to the pier planks
    p.box((0, 0.04, 0), (0.86, 0.08, 0.86), PAL['iron'], IRON, bevel=0.02)
    # heavy base collar, a touch tapered
    p.box((0, 0.08 + (COLLAR_TOP - 0.08) / 2, 0), (COLLAR_HW * 2, COLLAR_TOP - 0.08, COLLAR_HW * 2),
          PAL['post_dark'], WOOD, bevel=0.04, taper=0.9)
    # the shaft, one timber, chamfered and gently tapered
    h = POST_TOP - COLLAR_TOP
    p.box((0, COLLAR_TOP + h / 2, 0), (POST_HW * 2, h, POST_HW * 2), PAL['post'], WOOD, bevel=0.035,
          taper=0.92)
    # the cap the roundel stands on
    p.box((0, POST_TOP + 0.08, 0), (0.56, 0.16, 0.56), PAL['trim_dark'], WOOD, bevel=0.03)
    p.box((0, POST_TOP + 0.2, 0), (0.4, 0.08, 0.4), PAL['post_dark'], WOOD, taper=0.7)
    return p


# ---------------------------------------------------------------------------
# The arrow board
# ---------------------------------------------------------------------------
def build_board():
    p = Piece('SignBoard', wear=0.08, gradient=0.1)
    zt = BOARD_T / 2
    seam_y0, seam_y1 = BOARD_MID - 0.022, BOARD_MID + 0.022
    # the swallowtail: each plank's tail end is cut on the slant toward the notch
    slope = NOTCH / (BOARD_Y1 - BOARD_MID)

    def tail_x(y):
        return TAIL_X + NOTCH - abs(y - BOARD_MID) * slope

    upper = [(tail_x(seam_y1), seam_y1), (HEAD_X, seam_y1), (HEAD_X, BOARD_Y1), (TAIL_X, BOARD_Y1)]
    lower = [(TAIL_X, BOARD_Y0), (HEAD_X, BOARD_Y0), (HEAD_X, seam_y0), (tail_x(seam_y0), seam_y0)]
    slab(p, upper, -zt, zt, plank(0), side_color=scale_color(plank(0), 1.12), tag=0)
    slab(p, lower, -zt, zt, plank(1), side_color=scale_color(plank(1), 1.12), tag=0)
    # the dark seam between the planks (seen in the gap)
    p.box(((tail_x(BOARD_MID) + HEAD_X) / 2 + 0.02, BOARD_MID, 0),
          (HEAD_X - tail_x(BOARD_MID) - 0.02, 0.05, BOARD_T - 0.03), PAL['seam'], WOOD)

    # the arrow head: a broad blue point, thicker than the board, barbs past both edges
    head = [(HEAD_X - 0.02, BOARD_Y0 - HEAD_OVER), (TIP_X, BOARD_MID), (HEAD_X - 0.02, BOARD_Y1 + HEAD_OVER)]
    slab(p, head, -zt - 0.02, zt + 0.02, PAL['accent'], side_color=PAL['accent_hi'], tag=0)
    # a raised inner chevron on each face (the painted relief the eye reads at distance)
    inset = [(HEAD_X + 0.16, BOARD_Y0 - HEAD_OVER + 0.3), (TIP_X - 0.34, BOARD_MID),
             (HEAD_X + 0.16, BOARD_Y1 + HEAD_OVER - 0.3)]

    def chevron(s):
        z0 = s * (zt + 0.02)
        z1 = s * (zt + 0.036)
        slab(p, inset, min(z0, z1), max(z0, z1), PAL['accent_hi'])

    both_faces(chevron)

    # dark border strips along the top and bottom edges, both faces
    def border(s):
        zc = s * (zt + 0.012)
        for y in (BOARD_Y1 - 0.045, BOARD_Y0 + 0.045):
            p.box(((tail_x(y) + 0.05 + HEAD_X) / 2, y, zc), (HEAD_X - tail_x(y) - 0.05, 0.09, 0.024),
                  PAL['post_dark'], WOOD)

    both_faces(border)

    # the destination panel: cream paint on a thin board over both planks, both faces.
    # The runtime writes the destination name on a plane just off it (DestinationTextAnchor).
    def panel(s):
        z0, z1 = s * zt, s * (zt + PANEL_PROUD)
        # a softened rectangle: the corners clipped so it reads as a painted plaque
        c = PANEL_CORNER
        poly = [(PANEL_X0 + c, PANEL_Y0), (PANEL_X1 - c, PANEL_Y0), (PANEL_X1, PANEL_Y0 + c),
                (PANEL_X1, PANEL_Y1 - c), (PANEL_X1 - c, PANEL_Y1), (PANEL_X0 + c, PANEL_Y1),
                (PANEL_X0, PANEL_Y1 - c), (PANEL_X0, PANEL_Y0 + c)]
        slab(p, poly, min(z0, z1), max(z0, z1), PAL['cream'], side_color=PAL['ivory'])

    both_faces(panel)
    return p


# ---------------------------------------------------------------------------
# The anchor roundel
# ---------------------------------------------------------------------------
def anchor_relief(p, s):
    """A chunky anchor glyph raised off one face of the roundel (s = +1 front, -1 back)."""
    zt = ICON_T / 2
    z0, z1 = sorted((s * zt, s * (zt + 0.05)))
    zc = (z0 + z1) / 2
    col = PAL['ivory']
    cy = ICON_C
    # shank
    slab(p, [(-0.05, cy - 0.3), (0.05, cy - 0.3), (0.05, cy + 0.27), (-0.05, cy + 0.27)], z0, z1, col)
    # stock with its end knobs
    slab(p, [(-0.22, cy + 0.15), (0.22, cy + 0.15), (0.22, cy + 0.22), (-0.22, cy + 0.22)], z0, z1, col)
    for x in (-0.25, 0.25):
        slab(p, [(x - 0.04, cy + 0.12), (x + 0.04, cy + 0.12), (x + 0.04, cy + 0.25), (x - 0.04, cy + 0.25)],
             z0, z1, col)
    # the ring on top
    p.ring((0, cy + 0.34, zc), 0.07, z1 - z0, col, segments=10, axis=(0, 0, 1), depth=0.04)
    # the arms: an arc under the shank, and a fluke at each end
    arc_c = (0.0, cy - 0.04)
    r = 0.27
    pts = []
    for k in range(9):
        a = math.radians(205 + (335 - 205) * k / 8)
        pts.append((arc_c[0] + math.cos(a) * r, arc_c[1] + math.sin(a) * r, zc))
    p.beam(pts, 0.085, z1 - z0, col, up=(0, 0, 1))
    for a_deg, sign in ((205, 1), (335, -1)):
        a = math.radians(a_deg)
        e = Vector((arc_c[0] + math.cos(a) * r, arc_c[1] + math.sin(a) * r))
        # the arc's continuing direction at this end, and its outward normal
        t = Vector((math.sin(a), -math.cos(a))) * sign
        n = Vector((math.cos(a), math.sin(a)))
        tip = e + t * 0.15
        b0 = e + n * 0.085 - t * 0.03
        b1 = e - n * 0.085 - t * 0.03
        tri = [tuple(b0), tuple(b1), tuple(tip)]
        # keep the triangle counter-clockwise seen from +z
        cross = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0])
        if cross < 0:
            tri = [tri[0], tri[2], tri[1]]
        slab(p, tri, z0, z1, col)
    # the crown where the arms meet the shank
    slab(p, [(-0.07, cy - 0.33), (0.07, cy - 0.33), (0.07, cy - 0.25), (-0.07, cy - 0.25)], z0, z1, col)


def build_icon():
    p = Piece('MaritimeIcon', wear=0.04, gradient=0.08)
    m = p.mark()
    # the iron saddle that seats the roundel on the cap
    p.box((0, POST_TOP + 0.3, 0), (0.3, 0.14, 0.26), PAL['iron'], IRON, bevel=0.02)
    # the roundel, ferry blue, ringed in brass
    p.cylinder((0, ICON_C, -ICON_T / 2), (0, ICON_C, ICON_T / 2), ICON_R, PAL['accent'], WOOD, sides=20,
               soft=False)
    p.ring((0, ICON_C, 0), ICON_R + 0.02, ICON_T + 0.06, PAL['brass'], segments=20, axis=(0, 0, 1),
           mat=IRON, depth=0.09)
    both_faces(lambda s: anchor_relief(p, s))
    # Turn the roundel half way between the board's face and the tail (the pier's landward
    # approach). A player walking down the pier sees the board edge-on; the anchor still
    # reads at 71 percent width from there, from the ship, and from either face of the board.
    p.turn(m, Matrix.Rotation(math.radians(ICON_TURN_DEG), 4, 'Z'))
    return p


# ---------------------------------------------------------------------------
# Metal trim (medium tier and up)
# ---------------------------------------------------------------------------
def build_trim():
    p = Piece('MetalTrim', wear=0.05, gradient=0.06)
    iron, hi = PAL['iron'], PAL['iron_hi']
    # bolts on the foot plate
    for x in (-0.32, 0.32):
        for z in (-0.32, 0.32):
            p.box((x, 0.1, z), (0.09, 0.05, 0.09), hi, IRON, taper=0.7)
    # iron bands on the post
    for y in (0.78, 2.7):
        p.box((0, y, 0), (POST_HW * 2 + 0.05, 0.1, POST_HW * 2 + 0.05), iron, IRON, bevel=0.012)
    # straps that hold the board through the post
    for y in (BOARD_Y0 - 0.06, BOARD_Y1 + 0.06):
        p.box((0, y, 0), (POST_HW * 2 + 0.06, 0.09, POST_HW * 2 + 0.06), iron, IRON, bevel=0.012)
    zt = BOARD_T / 2
    # corner brackets at the tail and at the head, both faces, one big bolt each

    def brackets(s):
        z = s * (zt + 0.03)
        for x, dx in ((TAIL_X + 0.12, 1), (HEAD_X - 0.12, -1)):
            for y, dy in ((BOARD_Y1 - 0.05, -1), (BOARD_Y0 + 0.05, 1)):
                xb = x + (NOTCH * 0.25 if dx > 0 else 0)
                p.box((xb + dx * 0.1, y, z), (0.3, 0.07, 0.022), iron, IRON)
                p.box((xb, y + dy * 0.12, z), (0.07, 0.3, 0.022), iron, IRON)
                p.box((xb, y + dy * 0.02, z + s * 0.018), (0.07, 0.07, 0.03), hi, IRON, taper=0.7)

    both_faces(brackets)
    # a knee brace from the post up under the board
    p.beam([(POST_HW, 2.45, 0), (1.25, BOARD_Y0 - 0.02, 0)], 0.07, 0.07, iron, IRON, up=(0, 0, 1))
    p.box((POST_HW + 0.02, 2.45, 0), (0.05, 0.2, 0.14), iron, IRON)
    # brass cap along the arrow head's two leading edges
    a = (HEAD_X - 0.02, BOARD_Y1 + HEAD_OVER)
    tip = (TIP_X, BOARD_MID)
    b = (HEAD_X - 0.02, BOARD_Y0 - HEAD_OVER)
    for p0, p1 in ((a, tip), (tip, b)):
        d = Vector((p1[0] - p0[0], p1[1] - p0[1]))
        n = Vector((d.y, -d.x)).normalized() * 0.03
        p.beam([(p0[0] + n.x, p0[1] + n.y, 0), (p1[0] + n.x, p1[1] + n.y, 0)], 0.05, BOARD_T + 0.07,
               PAL['brass'], IRON, up=(0, 0, 1))
    # a mooring ring on the post's back face (-x, away from the arrow)
    p.box((-POST_HW - 0.02, 1.62, 0), (0.05, 0.1, 0.1), iron, IRON)
    p.ring((-POST_HW - 0.05, 1.46, 0), 0.13, 0.035, iron, segments=12, axis=(1, 0, 0), mat=IRON, depth=0.035)
    return p


# ---------------------------------------------------------------------------
# Optional detail (high tier and up)
# ---------------------------------------------------------------------------
LANTERN_X = -0.95
LANTERN_BRACKET_Y = 4.95
LANTERN_Y = 4.5


def build_lantern():
    p = Piece('OptionalLantern', wear=0.04, gradient=0.08)
    iron = PAL['iron']
    # the bracket arm off the post's back face, with its diagonal stay
    p.beam([(-POST_HW, LANTERN_BRACKET_Y, 0), (LANTERN_X - 0.05, LANTERN_BRACKET_Y, 0)], 0.06, 0.06, iron,
           IRON, up=(0, 0, 1))
    p.beam([(-POST_HW, LANTERN_BRACKET_Y - 0.36, 0), (LANTERN_X + 0.28, LANTERN_BRACKET_Y, 0)], 0.045, 0.045,
           iron, IRON, up=(0, 0, 1))
    p.box((-POST_HW - 0.02, LANTERN_BRACKET_Y - 0.18, 0), (0.05, 0.5, 0.12), iron, IRON)
    # the lantern: the ferry's lantern (iron frame, warm panes, tapered cap)
    s = 0.3
    x, y, z = LANTERN_X, LANTERN_Y, 0.0
    p.box((x, y, z), (s * 1.1, s * 1.35, s * 1.1), iron, IRON, bevel=0.02)
    p.box((x, y, z), (s * 0.8, s * 1.1, s * 1.18), PAL['glow'], GLOW)
    p.box((x, y, z), (s * 1.18, s * 1.1, s * 0.8), PAL['glow'], GLOW)
    p.box((x, y + s * 0.82, z), (s * 0.75, s * 0.32, s * 0.75), iron, IRON, taper=0.4)
    p.box((x, y - s * 0.74, z), (s * 0.7, s * 0.12, s * 0.7), iron, IRON, taper=0.8)
    return p


def build_chain():
    p = Piece('OptionalChain', wear=0.03, gradient=0.05)
    top = LANTERN_BRACKET_Y - 0.04
    bottom = LANTERN_Y + 0.3 * 0.82 + 0.1
    n = 3
    step = (top - bottom) / n
    for k in range(n):
        y = top - step * (k + 0.5)
        axis = (0, 0, 1) if k % 2 == 0 else (1, 0, 0)
        p.ring((LANTERN_X, y, 0), step * 0.55, 0.03, PAL['iron_hi'], segments=8, axis=axis, mat=IRON,
               depth=0.03)
    return p


def build_rope():
    p = Piece('OptionalRope', wear=0.05, gradient=0.06)
    # a rope coiled on the collar and a short tail through the mooring ring
    for k, y in enumerate((COLLAR_TOP + 0.05, COLLAR_TOP + 0.13)):
        p.ring((0, y, 0), POST_HW + 0.06, 0.075, PAL['rope'] if k == 0 else PAL['rope_dark'], segments=14,
               axis=(0, 1, 0), mat=ROPE, depth=0.075)
    p.sweep([(-POST_HW - 0.05, 1.34, 0.0), (-POST_HW - 0.2, 1.0, 0.08), (-POST_HW - 0.18, 0.72, 0.12),
             (-POST_HW - 0.02, COLLAR_TOP + 0.1, 0.1)], 0.035, 0.035, PAL['rope'], sides=5, mat=ROPE)
    return p


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
def make_materials():
    mats = []
    for name, rough, metal, emission in MATERIAL_SPECS:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        mat.use_backface_culling = True
        mats.append(mat)
    return mats


CRITICAL = ('Post', 'SignBoard', 'MaritimeIcon')
TRIM = ('MetalTrim',)
OPTIONAL = ('OptionalLantern', 'OptionalChain', 'OptionalRope')


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    root = empty('HarborRouteMarker_ROOT', None, display='ARROWS', size=1.0)
    pieces = {}
    for build in (build_post, build_board, build_icon, build_trim, build_lantern, build_chain, build_rope):
        piece = build()
        pieces[piece.name] = piece.finish(mats, root)
    panel_center = ((PANEL_X0 + PANEL_X1) / 2, BOARD_MID, 0.0)
    anchor = empty('DestinationTextAnchor', root, location=panel_center, display='PLAIN_AXES', size=0.3)
    anchor['destinationText'] = {
        'width': round(PANEL_X1 - PANEL_X0, 4),
        'height': round(PANEL_Y1 - PANEL_Y0, 4),
        'corner': PANEL_CORNER,
        'faceOffset': BOARD_T / 2 + PANEL_PROUD + 0.004,
        'textWidth': TEXT_FILL[0],
        'textHeight': TEXT_FILL[1],
        'faces': ['+z', '-z'],
    }
    empty('Socket_ArrowTip', root, location=(TIP_X, BOARD_MID, 0.0), size=0.2)
    root['harborRouteMarker'] = {
        'arrow': [1, 0, 0],
        'front': [0, 0, 1],
        'postColliderRadius': POST_COLLIDER_R,
        'postTop': POST_TOP,
        'boardBottom': BOARD_Y0,
        'boardTop': BOARD_Y1,
        'tiers': {'low': list(CRITICAL), 'medium': list(TRIM), 'high': list(OPTIONAL)},
    }
    return dict(root=root, pieces=pieces, mats=mats, anchor=anchor)


def report(objs):
    total = 0
    for name, obj in objs['pieces'].items():
        n = triangles(obj)
        total += n
        print(f'PIECE {name} triangles {n}')
    print(f'TRIANGLES total {total}')
    root = objs['root']
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objs['pieces'].values():
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    # Blender (x, -z, y) back to game: x, height, depth
    print(f'BOUNDS game x {lo.x:.3f}..{hi.x:.3f} y {lo.z:.3f}..{hi.z:.3f} z {-hi.y:.3f}..{-lo.y:.3f}')
    print(f'HEIGHT {hi.z:.3f} = {hi.z / PLAYER_H:.2f} x player')
    return total, root


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    root = objs['root']
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_morph=False,
    )
    print('WROTE', path)


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


if __name__ == '__main__':
    objs = build_scene()
    report(objs)
    export(os.path.join(HERE, 'harbor_route_marker_source.glb'), objs)
    out_dir = arg('--preview')
    if out_dir or arg('--save'):
        import marker_preview  # noqa: E402

        marker_preview.stage(objs)
        if out_dir:
            marker_preview.render_all(out_dir)
        if arg('--save'):
            marker_preview.save(arg('--save'))
