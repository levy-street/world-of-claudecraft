# The Warden's Keep, an ENTERABLE castle. Front faces +Y (exports to -Z).
#
# SCALE. Everything below is in KIT units; S is the export scale, so one kit
# unit is S yards in game and a PLAYER is 1.8yd. S=1.35 puts a castle storey at
# 6.75yd (~3.7 player heights) and the arch doorway at ~4.5yd. The first cut
# shipped at S=2.0, which made every storey 10yd and the hall read as a canyon
# with doll furniture in it, the scale complaint. Keep props measured against
# PLAYER_KIT below, never by eye.
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    reset_build()
    M = 2.5
    S = 1.35
    PLAYER_KIT = 1.8 / S          # a player's height in kit units (1.333)
    HX, HY = 7.5, 6.25            # keep half footprint
    XS = (-6.25, -3.75, -1.25, 1.25, 3.75, 6.25)
    YS = (-5.0, -2.5, 0.0, 2.5, 5.0)
    CY0, CY1 = HY, HY + 15.0      # courtyard y range, in front of the keep
    CHX = 12.5                    # courtyard half width
    # Courtyard curtain: 3x the kit module's 0.28 (Troy, 2026-09-10: "make
    # these courtyard walls 3x thicker"). The flat LOD walls are re-UVed with
    # world-planar stone (cobblify), so a thickness scale stretches nothing;
    # the caps and the gate arch scale to the same 0.84 so the top reads as
    # one rampart. Everything dressing the yard walls seats off YARD_HALF.
    YARD_K = 3.0
    YARD_HALF = 0.14 * YARD_K     # 0.42: half the thick wall
    YARD_OUT = YARD_HALF + 0.08   # brass / rune conduits proud of the face
    YARD_CAP = (2 * YARD_HALF) / 0.62   # CastleRoof_01 is 0.62 deep
    YARD_ARCH = (2 * YARD_HALF) / 0.47  # CastleWall_06 is 0.47 deep
    PI = math.pi
    # The gallery's inner edge, the pillar line, and the stair strips. The first
    # cut ran the stairs from the wall to x=-5.05 and then stood the pillars at
    # x=-5.0, a 0.49-radius pillar overlapping the treads by 0.44. The stair
    # strip and the pillar line are now separate numbers with a real gap.
    SPIRE_GILD_Z = 14.35          # ChurchTower_03: slate cone below, gold above
    GAL_EDGE = 5.0                # gallery balcony inner edge
    PILLAR_X = 4.55               # pillar centres (half-width 0.488 -> face 5.04)
    ST_OUT, ST_IN = 7.25, 5.6     # stair strip: 1.65 kit = 2.2yd of tread width
    # Each flight gets its OWN footprint. The engine keeps ONE walkable deck per
    # (x, z), stacking a switchback in one strip means the upper flight wins
    # and the lower one is unusable, which a tp ladder up the shaft proves.
    # So: the lower flight climbs the WEST strip front-to-back, the upper climbs
    # the EAST strip back-to-front, and the gallery is the back balcony they
    # both meet on.
    ST_FOOT, ST_HEAD = 1.2, -3.3  # 4.5 kit of run per flight
    ST_TREADS = 16

    # ---------------- helpers ----------------
    def tower(cx, cy, storeys, cap, grp='L0'):
        """A 5x5 stone tower from CastleWall modules, corner pillars, a floor
        cap and either a spire or a crenellated band."""
        for st in range(storeys):
            z = 5 * st
            for dx in (-1.25, 1.25):
                use('buildings/CastleWall_01', cx + dx, cy + 2.5, z, 0, grp)
                use('buildings/CastleWall_01', cx + dx, cy - 2.5, z, 0, grp)
            for dy in (-1.25, 1.25):
                use('buildings/CastleWall_01', cx - 2.5, cy + dy, z, PI / 2, grp)
                use('buildings/CastleWall_01', cx + 2.5, cy + dy, z, PI / 2, grp)
            for ex, ey in ((-2.5, -2.5), (-2.5, 2.5), (2.5, -2.5), (2.5, 2.5)):
                use('buildings/CastleCorner_01' if st == 0 else 'buildings/CastleCorner_02',
                    cx + ex, cy + ey, z, 0, grp)
        top = 5 * storeys
        for dx in (-1.25, 1.25):
            for dy in (-1.25, 1.25):
                use('buildings/Floor_01', cx + dx, cy + dy, top - 0.1, 0, grp)
        if cap == 'spire':
            # ChurchTower_03's geometry is NOT centred on its origin: its bbox
            # runs y -0.894..5.699 (centre +2.4025) and z 4.899..19.358. Dropped
            # at a tower centre it sat 2.4 kit to +y and left the tower's top
            # face bare on the other side, the "floating roofs". Offset by that
            # centre and seat the piece's own base (4.899*s) on the tower top.
            sp_s = 5.6 / 6.559     # eave 5.6 wide over a 5.0 tower: 0.3 overhang
            sp = use('buildings/ChurchTower_03', cx, cy - 2.4025 * sp_s,
                     top - 4.899 * sp_s, 0, grp, s=sp_s)
            retint_roof([sp])
            # Above the cone tip (local z 14.2 in the piece's own space) the
            # spire is mast, collars and a star: metalwork, gilded with the
            # same brass as the wall courses rather than left reading as brick.
            gild_spire([sp], SPIRE_GILD_Z)
        else:
            for dx in (-1.25, 1.25):
                use('buildings/CastleRoof_01', cx + dx, cy + 2.5, top + 0.85, 0, grp)
                use('buildings/CastleRoof_01', cx + dx, cy - 2.5, top + 0.85, PI, grp)
            for dy in (-1.25, 1.25):
                use('buildings/CastleRoof_01', cx - 2.5, cy + dy, top + 0.85, PI / 2, grp)
                use('buildings/CastleRoof_01', cx + 2.5, cy + dy, top + 0.85, -PI / 2, grp)
        col(cx, cy, top / 2, 2.55, 2.55, top / 2)

    def stone_stair(x0, x1, y_lo, y_hi, z_lo, z_hi, treads, grp, rail_at=None):
        """A flight whose deck is z_lo at y_lo and z_hi at y_hi. y_hi may be
        BELOW y_lo, that is how the switchback's upper flight doubles back,         so the run is taken as an absolute and the deck's rz follows the sign.

        Each tread is a FLAT Floor_01 tile (unscaled in z, so its stonework
        keeps its proportions) sitting on a plain riser block. Do not build a
        tread by scaling a tile in z to reach the flight's base: Tile_01 and
        Floor_01 both carry relief on their top face, and at the 20-30x needed
        for a real flight that relief stretches into a palisade of vertical
        SPIKES. And do not use stone_slab for the tread top either, it paints
        one flat atlas texel over every face, so the flight reads as a smooth
        grey wedge. Flat tile on top, slab for the mass underneath.
        """
        d = (y_hi - y_lo) / treads
        rise = (z_hi - z_lo) / treads
        w = x1 - x0
        for i in range(treads):
            top = z_lo + (i + 1) * rise
            cx, cy = (x0 + x1) / 2, y_lo + (i + 0.5) * d
            # Floor_01 spans z +-0.1, so seat it 0.1 under the tread's top.
            use('buildings/Floor_01', cx, cy, top - 0.1, 0, grp,
                sx=w / 2.5, sy=(abs(d) + 0.06) / 2.5)
            mass = max(0.02, (top - 0.2) - z_lo)
            stone_slab(cx, cy, z_lo, w / 2, (abs(d) + 0.06) / 2, mass / 2, grp)
        ramp((x0 + x1) / 2, (y_lo + y_hi) / 2, abs(y_hi - y_lo) / 2 + 0.15, w / 2,
             PI / 2 if y_hi > y_lo else -PI / 2, z_lo, z_hi)
        if rail_at is not None:
            # A raking parapet on the flight's open side, one block per two
            # treads, its top a constant 1.0 kit over the tread it guards.
            for i in range(0, treads, 2):
                top = z_lo + (i + 1.5) * rise
                stone_slab(rail_at, y_lo + (i + 1) * d, top, 0.14, abs(d) + 0.02, 0.5, grp)
            col_wall(rail_at, min(y_lo, y_hi), rail_at, max(y_lo, y_hi),
                     min(z_lo, z_hi), max(z_lo, z_hi) + 1.0, 0.16)

    def flat_steps(x, y_front, width, treads, top_z, depth=0.42, grp='L0'):
        """Steps descending FORWARD (+y) from a platform face at y_front, built
        the same way as stone_stair: a FLAT Floor_01 tile per tread on a plain
        riser block.

        bl_build_common's steps() reaches the ground by scaling ONE Tile_01 in
        z (sz = top/0.166). At a 0.2-kit entry step that is a 1.2x stretch and
        looks fine, which is why the tavern uses it, but a 1.0-kit dais needs
        6x, and Tile_01's cobble relief stretches into the jagged shingled mess
        Troy flagged. Collision is unchanged: the same single ramp deck."""
        rise = top_z / treads
        for i in range(treads):
            top = top_z - i * rise
            cy = y_front + depth * (i + 0.5)
            use('buildings/Floor_01', x, cy, top - 0.1, 0, grp,
                sx=width / 2.5, sy=(depth + 0.06) / 2.5)
            mass = max(0.02, top - 0.2)
            stone_slab(x, cy, 0.0, width / 2, (depth + 0.06) / 2, mass / 2, grp)
        run = treads * depth
        ramp(x, y_front + run / 2, run / 2 + 0.1, width / 2, PI / 2, top_z, 0.0)

    def brazier(x, y, z=0.0, grp='L0', collide=True):
        """A standing brazier that reads at player scale: a stone plinth plus
        the kit's fire bowl. Total ~1.25 kit = 1.7yd, i.e. shoulder height.
        Fire_02 (0.13 wide, 0.49 tall = 0.18 x 0.66yd) was the 'tiny torches on
        the floor', it is a table candle, not a hall light."""
        stone_slab(x, y, z, 0.22, 0.22, 0.34, grp)
        use('props/Fire_01', x, y, z + 0.68, 0, grp, s=1.35)
        if collide:
            col(x, y, z + 0.5, 0.3, 0.3, 0.5)

    # ================= KEEP SHELL (L0) =================
    for x in XS:
        for y in YS:
            use('buildings/Floor_01', x, y, 0.1, 0, 'L0')
    # Front (+Y): windows, the 5-wide arch, windows; arrow slits above.
    use('buildings/CastleWall_04', -6.25, HY, 0, 0, 'L0')
    use('buildings/CastleWall_01', -3.75, HY, 0, 0, 'L0')
    use('buildings/CastleWall_06', 0, HY, 0, 0, 'L0')
    use('buildings/CastleWall_01', 3.75, HY, 0, 0, 'L0')
    use('buildings/CastleWall_04', 6.25, HY, 0, 0, 'L0')
    for x, p in zip(XS, ('CastleWall_01', 'CastleWall_05', 'CastleWall_04',
                         'CastleWall_04', 'CastleWall_05', 'CastleWall_01')):
        use('buildings/' + p, x, HY, 5, 0, 'L0')
    use('buildings/CastleDoor_02', -0.95, HY - 0.15, 0, -2.35, 'L0')
    use('buildings/CastleDoor_03', 0.95, HY - 0.15, 0, 2.3, 'L0')
    # Back (-Y): solid behind the dais.
    for x, p in zip(XS, ('CastleWall_01', 'CastleWall_04', 'CastleWall_01',
                         'CastleWall_01', 'CastleWall_04', 'CastleWall_01')):
        use('buildings/' + p, x, -HY, 0, 0, 'L0')
    for x, p in zip(XS, ('CastleWall_05', 'CastleWall_01', 'CastleWall_05',
                         'CastleWall_05', 'CastleWall_01', 'CastleWall_05')):
        use('buildings/' + p, x, -HY, 5, 0, 'L0')
    # Sides.
    for y, p in zip(YS, ('CastleWall_01', 'CastleWall_04', 'CastleWall_01',
                         'CastleWall_04', 'CastleWall_01')):
        use('buildings/' + p, -HX, y, 0, PI / 2, 'L0')
        use('buildings/' + p, HX, y, 0, PI / 2, 'L0')
    for y, p in zip(YS, ('CastleWall_05', 'CastleWall_01', 'CastleWall_05',
                         'CastleWall_01', 'CastleWall_05')):
        use('buildings/' + p, -HX, y, 5, PI / 2, 'L0')
        use('buildings/' + p, HX, y, 5, PI / 2, 'L0')
    for cx, cy in ((-HX, -HY), (-HX, HY), (HX, -HY), (HX, HY)):
        use('buildings/CastleCorner_01', cx, cy, 0, 0, 'L0')
        use('buildings/CastleCorner_02', cx, cy, 5, 0, 'L0')
    # Base course: a plinth all round so the walls meet the ground on something
    # rather than growing straight out of it (the flat-slab facade note).
    for x in XS:
        # HAND EDIT: no plinth across the door opening (x = +-1.25).
        if abs(x) > 2:
            use('buildings/CastleBase_02', x, HY + 0.24, 0, 0, 'L0')
        use('buildings/CastleBase_02', x, -HY - 0.24, 0, PI, 'L0')
    for y in YS:
        use('buildings/CastleBase_02', -HX - 0.24, y, 0, -PI / 2, 'L0')
        use('buildings/CastleBase_02', HX + 0.24, y, 0, PI / 2, 'L0')

    # Corner towers, OUTSIDE the keep corners (centred on a corner they punch
    # into the hall and bury the stair strip).
    TOFF = 2.3
    for cx, cy in ((-(HX + TOFF), -(HY + TOFF)), (HX + TOFF, -(HY + TOFF)),
                   (-(HX + TOFF), HY + TOFF), (HX + TOFF, HY + TOFF)):
        tower(cx, cy, 3, 'spire')

    # ================= BRASS COURSES (L0) =================
    # The string courses are geometry now (riveted brass runs proud of the
    # faces), not a band in the wall texture, so they never tile or seam.
    brass_ring(0, 0, HX, HY, 5.0, out=0.24)
    for cx, cy in ((-(HX + TOFF), -(HY + TOFF)), (HX + TOFF, -(HY + TOFF)),
                   (-(HX + TOFF), HY + TOFF), (HX + TOFF, HY + TOFF)):
        for z in (5.0, 10.0):
            brass_ring(cx, cy, 2.5, 2.5, z, out=0.2)
    for z in (5.0, 10.0):
        brass_ring(-CHX, CY1, 2.5, 2.5, z, out=0.2)
        brass_ring(CHX, CY1, 2.5, 2.5, z, out=0.2)
    brass_run(-CHX + 2.5, CY1, -1.6, CY1, 2.6, out=YARD_OUT)      # gate wall, outward (+Y)
    brass_run(1.6, CY1, CHX - 2.5, CY1, 2.6, out=YARD_OUT)
    brass_run(CHX, CY1 - 2.5, CHX, CY0, 2.6, out=YARD_OUT)         # yard sides, outward
    brass_run(-CHX, CY0, -CHX, CY1 - 2.5, 2.6, out=YARD_OUT)
    brass_run(HX + TOFF + 2.5, CY0, CHX, CY0, 2.6, out=-YARD_OUT)  # yard front returns (face +Y)
    brass_run(-CHX, CY0, -(HX + TOFF + 2.5), CY0, 2.6, out=-YARD_OUT)

    # ================= RUNE CONDUITS (L0) =================
    # The Warden wall's cyan rune channel on both faces of every courtyard
    # wall, one lozenge sigil per module, the runs starting at the tower
    # faces so the sigils land on the modules, and the Warden tower's
    # vertical conduits on every tower's outward faces, broken at the brass
    # straps. A gate wall run is mirrored (from its tower toward the gate) so
    # the two halves match; `out` flips with it to stay on the same face.
    RUNE_Z = 3.1   # above the 2.6 brass course, like the wall's strap-then-channel
    # Inlaid flush with the faces (rune_run seats off the FACE, not a band
    # centre like brass_run), so the ivy that climbs these walls lies over it.
    for face in (YARD_HALF, -YARD_HALF):
        rune_run(-CHX + 2.5, CY1, -1.7, CY1, RUNE_Z, face)      # gate wall, west half
        rune_run(CHX - 2.5, CY1, 1.7, CY1, RUNE_Z, -face)       # east half, mirrored
        rune_run(CHX, CY1 - 2.5, CHX, CY0, RUNE_Z, face)        # east yard side
        rune_run(-CHX, CY1 - 2.5, -CHX, CY0, RUNE_Z, -face)     # west yard side, mirrored
    def tower_runes(cx, cy, storeys, faces):
        spans = [(5 * k + 1.2, 5 * k + 4.4) for k in range(storeys)]
        sigil_z = 5 * (storeys - 1) + 2.8
        for nx, ny in faces:
            rune_post(cx + nx * 2.5, cy + ny * 2.5, nx, ny, spans, sigil_z)
    # Only the faces nothing else joins: a yard wall dies into the courtyard
    # towers' inner faces and the keep's north towers' outer faces, and the
    # keep body buries the inner faces of all four keep towers.
    for sx in (-1, 1):
        tower_runes(sx * CHX, CY1, 2, ((sx, 0), (0, 1)))
        tower_runes(sx * (HX + TOFF), -(HY + TOFF), 3, ((sx, 0), (0, -1)))
        tower_runes(sx * (HX + TOFF), HY + TOFF, 3, ((0, 1),))

    # ================= WALL DRESSING (L0) =================
    # Lanterns, ivy and weathering decals over the keep's (banners and shields
    # were removed from the exterior at Troy's request, 2026-09-06)
    # outer faces and the courtyard walls, so the stonework reads lived-in.
    # Wall faces: keep front y=+HY faces +Y (into the courtyard); keep sides
    # x=+-HX face outward; courtyard end wall y=CY1 faces +Y (the gate side).
    # Flags/shields hang with rz=pi on a +Y face, 0 on a -Y face, +-pi/2 on x.
    FRONT = HY + 0.48   # banners hang PROUD of the brass course (0.34), their own layer over the gold
    for x in (-3.9, 3.9):                                   # standing lanterns at the door
        use('props/Lantern_01', x, HY + 0.9, 0.2, PI, 'L0', s=1.1)
    for x, k in ((-7.0, 'moss'), (7.2, 'moss'), (-2.2, 'grime'), (4.6, 'grime')):  # weathering
        if k == 'moss':
            decal(x, FRONT - 0.04, 0.95, 1.6, 1.4, 0, 'moss', flip=x > 0)
        else:
            decal(x, FRONT - 0.04, 4.1, 1.3, 1.9, 0, 'grime', flip=x > 0)
    # sides of the keep (outward faces)
    for sx in (-1, 1):
        rz = -PI / 2 if sx < 0 else PI / 2
        xo = sx * (HX + 0.48)
        use('nature/Ivy_04', sx * (HX + 0.15), 3.6, 0, rz, 'L0', s=1.25, snap_ground=True)
        use('nature/Ivy_05', sx * (HX + 0.15), -4.4, 0, rz, 'L0', s=0.9, snap_ground=True)
        decal(sx * (HX + 0.16), -0.2, 4.0, 1.4, 2.0, rz, 'grime')
        decal(sx * (HX + 0.16), 2.4, 0.9, 1.5, 1.3, rz, 'moss')
    # back of the keep: ivy climbs the shaded side
    use('nature/Ivy_06', -3.0, -HY - 0.15, 0, PI, 'L0', s=1.1, snap_ground=True)
    use('nature/Ivy_04', 4.2, -HY - 0.15, 0, PI, 'L0', s=1.0, snap_ground=True)
    decal(0.6, -HY - 0.16, 3.9, 1.6, 2.0, PI, 'grime')
    # courtyard end wall (gate side, faces +Y outward) and its inner face
    # x 9.0 (was 10.4): the corner towers span x 10..15, and at 10.4 this ivy
    # stood inside the tower shell, invisible. It climbs the gate wall now,
    # 0.03 off the face so its leaves lie over the rune inlay.
    for x in (-9.0, 9.0):
        use('nature/Ivy_05', x, CY1 + YARD_HALF + IVY_OFF, 0, PI, 'L0', s=1.0, snap_ground=True)
        decal(x * 0.62, CY1 + YARD_HALF + DECAL_OFF, 0.9, 1.6, 1.3, PI, 'moss', flip=x > 0)
    for x in (-6.3, 6.3):
        decal(x, CY1 + YARD_HALF + DECAL_OFF, 4.0, 1.2, 1.7, PI, 'grime', flip=x > 0)
    # courtyard side walls, outward faces
    for sx in (-1, 1):
        rz = -PI / 2 if sx < 0 else PI / 2
        xo = sx * (CHX + 0.48)
        use('nature/Ivy_04', sx * (CHX + YARD_HALF + IVY_OFF), CY0 + 7.3, 0, rz, 'L0', s=1.15, snap_ground=True)
        decal(sx * (CHX + YARD_HALF + DECAL_OFF), CY0 + 5.4, 0.9, 1.5, 1.3, rz, 'moss')
        decal(sx * (CHX + YARD_HALF + DECAL_OFF), CY0 + 9.6, 3.9, 1.3, 1.8, rz, 'grime')

    # ================= GREAT HALL (L0) =================
    # Runner from the doors to the dais foot (stops short of the steps).
    for cy in (4.6, 2.1, -0.4, -2.35):
        use('props/Carpet_04', 0, cy, 0.215, PI / 2, 'L0', sy=1.4, sx=1.7)
    # --- the dais: 1.0 kit (1.35yd) high, with real steps up the front ---
    DAIS_BACK, DAIS_FRONT, DAIS_H = -HY + 0.25, -3.9, 1.0
    stone_slab(0, (DAIS_BACK + DAIS_FRONT) / 2, 0.0, 3.4, (DAIS_FRONT - DAIS_BACK) / 2, DAIS_H * 0.55 / 2)
    stone_slab(0, (DAIS_BACK + DAIS_FRONT) / 2 - 0.16, DAIS_H * 0.55, 3.15,
               (DAIS_FRONT - DAIS_BACK) / 2 - 0.16, DAIS_H * 0.45 / 2)
    # Three flat treads over 1.26 kit of run for a 1.0 rise, plus their deck.
    flat_steps(0, DAIS_FRONT, 4.4, 3, DAIS_H)
    # NO carpet on the treads. A flat 0.02-thick quad laid on each tread reads
    # in game as a red plate hovering with a shadow gap under it, whatever its
    # footprint, the cobble treads carry the step read on their own.
    # Throne: back 1.35 kit = 1.82yd, i.e. a head taller than the player, seat
    # at 0.42 kit. It shipped at s=1.5 -> a 5.8yd back, over 3x player height.
    THRONE_S = 1.65 / 1.942
    # HAND EDIT: rz = PI. Throne_01's deep side (bbox y -0.396..0.294) is the
    # SEAT direction, so rz=0 pointed it into the back wall.
    use('props/Throne_01', 0, DAIS_BACK + 0.85, DAIS_H, PI, 'L0', s=THRONE_S)
    use('props/Carpet_03', 0, DAIS_FRONT + 0.8, DAIS_H + 0.01, PI / 2, 'L0', sx=1.0, sy=2.55)
    use('props/Candle_05', -2.5, DAIS_BACK + 0.9, DAIS_H, 0.15, 'L0', s=0.85)
    use('props/Candle_05', 2.5, DAIS_BACK + 0.9, DAIS_H, -0.15, 'L0', s=0.85)
    use('props/Flag_04', -1.7, -HY + 0.2, 4.5, 0, 'L0', s=1.3)
    use('props/Flag_04', 1.7, -HY + 0.2, 4.5, 0, 'L0', s=1.3)
    use('props/Shield_02', 0, -HY + 0.2, 4.4, 0, 'L0', s=1.5)  # clear of the throne back
    # Pillars carrying the gallery edge, clear of both stair strips.
    # HAND EDIT: the two back pillars on each side were pulled toward the dais,
    # and no longer match side to side, hence two explicit rows.
    PILLAR_W = (-5.407, -2.234, 2.25, 5.0)
    PILLAR_E = (-5.299, -2.088, 2.25, 5.0)
    for py in PILLAR_W:
        use('buildings/CastlePart_02', -PILLAR_X, py, 0.2, 0, 'L0')
    for py in PILLAR_E:
        use('buildings/CastlePart_02', PILLAR_X, py, 0.2, 0, 'L0')
    # Braziers down the aisle, set between the pillars and the runner so the
    # walking line stays clear.
    # HAND EDIT: the south-west brazier moved out to the pillar line.
    for bx, by in ((-4.559, 0.17), (2.6, -1.6), (-2.6, 3.4), (2.6, 3.4)):
        brazier(bx, by)
    # Chandeliers hung under the gallery (Light_01 hangs BELOW its origin).
    for lx in (-2.6, 2.6):
        for ly in (-3.6, 0.4, 4.4):
            use('props/Light_01', lx, ly, 4.6, 0, 'L0', s=1.1)
    # Hall furnishing, all against the side walls out of the circulation.
    # The war table sits in the WEST bay, not across the aisle: the run from
    # the doors to the dais steps has to stay clear.
    use('props/Table_02', -3.2, -1.4, 0.2, PI / 2, 'L0', sx=1.05)
    use('props/Furniture_14', -2.35, -1.4, 0.2, -PI / 2, 'L0', s=0.85)
    use('props/Scroll_01', -3.15, -0.9, 0.87, 0.4, 'L0')
    use('props/Book_05', -3.3, -1.9, 0.87, 0.2, 'L0')
    use('props/Candle_03', -3.1, -2.2, 0.87, 0, 'L0')
    # ...and the east bay gets the arms rack, so the two sides read as used.
    use('props/Weapon_03', HX - 0.25, 1.579, 2.3, -PI / 2, 'L0')   # HAND EDIT
    use('props/Weapon_05', HX - 0.25, 3.303, 2.3, -PI / 2, 'L0')   # HAND EDIT
    use('props/Shield_03', HX - 0.25, 0.0, 2.3, -PI / 2, 'L0')
    use('props/Chest_01', HX - 0.55, -4.6, 0.2, -PI / 2, 'L0')
    use('props/Chest_01', HX - 0.55, -3.5, 0.2, -PI / 2, 'L0')
    use('props/Altar_02', -HX + 0.6, -4.4, 0.2, PI / 2, 'L0')
    use('props/Helmet_01', -HX + 0.6, -4.4, 0.2 + 1.349, 0.3, 'L0')
    for fy, fl in ((3.9, 'Flag_05'), (0.9, 'Flag_06')):
        use('props/' + fl, -HX + 0.2, fy, 4.4, PI / 2, 'L0', s=1.15)
        use('props/' + fl, HX - 0.2, fy, 4.4, -PI / 2, 'L0', s=1.15)

    # ================= STAIRWELL =================
    # West flight: hall -> gallery. East flight: gallery -> terrace. Both sit in
    # the outer strips with a raking balustrade on the open side, so the player
    # walks a 2.2yd-wide flight with nothing in it.
    # Lower flight: hall floor at the FRONT of the west strip up to the gallery
    # at the BACK. Upper flight: mirrored in the east strip, gallery at the back
    # up to the terrace at the front. Separate footprints, so each deck owns its
    # own ground.
    # HAND EDIT: both raking stone balustrades deleted (rail_at=None). The
    # flights' open sides are therefore UNGUARDED, art and collision agree,
    # but there is nothing stopping a walk off the edge into the hall.
    stone_stair(-ST_OUT, -ST_IN, ST_FOOT, ST_HEAD, 0.2, 5.0, ST_TREADS, 'L0')
    stone_stair(ST_IN, ST_OUT, ST_HEAD, ST_FOOT, 5.0, 10.0, ST_TREADS, 'H1')

    # ================= GALLERY (H1) =================
    # A minstrel's balcony across the BACK of the hall, with a stub into each
    # stair strip: the lower flight's head lands on the west stub, the upper
    # flight's foot leaves from the east one, and the back row joins them. An
    # earlier cut ran the balcony round three sides and left the piece the
    # stairs actually landed on an ISLAND, everything upstairs unreachable.
    INNER = (-3.75, -1.25, 1.25, 3.75)
    for x in INNER:
        for y in (-5.0, -2.5):
            use('buildings/Floor_01', x, y, 5.1, 0, 'H1')
    # Stubs are SCALED to meet the flights exactly (y -6.25..ST_HEAD). A plain
    # 2.5-wide tile at y=-5 stops at -3.75 and leaves a 0.45-kit hole in the
    # floor right where you step off the stairs, even though the deck under it
    # is continuous.
    STUB_D = -3.3 - (-6.25)
    use('buildings/Floor_01', -6.25, (-6.25 + ST_HEAD) / 2, 5.1, 0, 'H1', sy=STUB_D / 2.5)
    use('buildings/Floor_01', 6.25, (-6.25 + ST_HEAD) / 2, 5.1, 0, 'H1', sy=STUB_D / 2.5)
    # Balustrade along the balcony's open front edge, and the inner lip of each
    # stair shaft.
    for x in (-4.375, -3.125, -1.875, -0.625, 0.625, 1.875, 3.125, 4.375):
        use('buildings/CastleFence_01', x, -1.25, 5.2, 0, 'H1')
    # HAND EDIT: the west stairwell lip and the east lip's inner piece removed;
    # one east piece left at y=-5.625.
    use('buildings/CastleFence_01', GAL_EDGE, -5.625, 5.2, PI / 2, 'H1', s=0.98)
    # Gallery dressing, back wall only (the strips stay walkable).
    # HAND EDIT: the bookcases were authored facing INTO the back wall; turned
    # about PI so their fronts read to the gallery. Left slightly off-square on
    # purpose, a shelf run that is dead parallel looks placed, not lived in.
    for bx, brz in ((-2.5, 3.092), (0.0, 3.1408), (2.5, 3.1504)):
        use('props/Furniture_03', bx, -HY + 0.45, 5.2, brz, 'H1')
    use('props/Table_01', -2.2, -3.5, 5.2, 0.15, 'H1', s=0.95)
    use('props/Book_01', -2.3, -3.4, 5.9, 0.4, 'H1')
    use('props/Candle_03', -1.8, -3.6, 5.9, 0, 'H1')
    use('props/Furniture_08', -2.2, -2.8, 5.2, 3.0, 'H1')
    use('props/Carpet_05', 1.6, -3.6, 5.21, 0, 'H1')
    # HAND EDIT: pulled in between the bookcases and turned to face out.
    use('props/Chest_01', 1.24, -HY + 0.5, 5.2, 3.199, 'H1')
    # HAND EDIT: both gallery braziers removed (their citadel.ts flames go too).

    # ================= TERRACE + PARAPET (H2) =================
    for x in XS:
        for y in YS:
            if x == 6.25 and y in (-5.0, -2.5, 0.0, 2.5, 5.0):
                continue                     # the upper flight's shaft; the two
                # scaled tiles below close on it exactly
            use('buildings/Floor_01', x, y, 10.1, 0, 'H2')
    for x in XS:
        use('buildings/CastleRoof_01', x, HY, 10.35, 0, 'H2', sz=0.55)
        use('buildings/CastleRoof_01', x, -HY, 10.35, PI, 'H2', sz=0.55)
    for y in YS:
        use('buildings/CastleRoof_01', -HX, y, 10.35, PI / 2, 'H2', sz=0.55)
        use('buildings/CastleRoof_01', HX, y, 10.35, -PI / 2, 'H2', sz=0.55)
    # Terrace tiles either side of the shaft, sized to meet the flight's ends.
    use('buildings/Floor_01', 6.25, (-6.25 + ST_HEAD) / 2, 10.1, 0, 'H2', sy=STUB_D / 2.5)
    use('buildings/Floor_01', 6.25, (ST_FOOT + 6.25) / 2, 10.1, 0, 'H2',
        sy=(6.25 - ST_FOOT) / 2.5)
    # HAND EDIT: railing carried one bay further north, and a piece added
    # across the shaft mouth at x=6.826.
    for y in (-3.125, -1.875, -0.625, 0.622):
        use('buildings/CastleFence_01', GAL_EDGE, y, 10.2, PI / 2, 'H2')
    use('buildings/CastleFence_01', 5.625, -3.75, 10.2, 0, 'H2')
    use('buildings/CastleFence_01', 6.826, -3.781, 10.169, 0, 'H2')
    # A banner mast at player scale (CastlePart_01 raw is 9.5 kit = 12.8yd of
    # bare pole and read as a flagpole antenna).
    use('buildings/CastlePart_01', 0, -2.5, 10.2, 0, 'H2', s=0.42)
    use('props/Flag_01', 0, -2.395, 13.6, 0, 'H2', s=1.5)          # HAND EDIT
    brazier(-3.75, 2.5, 10.1, 'H2', collide=False)
    brazier(3.75, 2.5, 10.1, 'H2', collide=False)

    # ================= COURTYARD (L0) =================
    for ix in range(10):
        for iy in range(6):
            use('environment/Tile_01', -CHX + M / 2 + ix * M, CY0 + M / 2 + iy * M, 0.0, 0, 'L0')
    for y in (CY0 + 1.25 + i * M for i in range(6)):
        use('buildings/CastleWall_01', -CHX, y, 0, PI / 2, 'L0', sy=YARD_K)
        use('buildings/CastleWall_01', CHX, y, 0, PI / 2, 'L0', sy=YARD_K)
        use('buildings/CastleRoof_01', -CHX, y, 5.85, PI / 2, 'L0', sy=YARD_CAP)
        use('buildings/CastleRoof_01', CHX, y, 5.85, -PI / 2, 'L0', sy=YARD_CAP)
    for x in (-11.25, -8.75, -6.25, -3.75, 3.75, 6.25, 8.75, 11.25):
        use('buildings/CastleWall_01', x, CY1, 0, 0, 'L0', sy=YARD_K)
        use('buildings/CastleRoof_01', x, CY1, 5.85, 0, 'L0', sy=YARD_CAP)
    use('buildings/CastleWall_06', 0, CY1, 0, 0, 'L0', sy=YARD_ARCH)   # the gate: a tunnel now
    use('buildings/CastleRoof_01', -1.25, CY1, 5.85, 0, 'L0', sy=YARD_CAP)
    use('buildings/CastleRoof_01', 1.25, CY1, 5.85, 0, 'L0', sy=YARD_CAP)
    use('buildings/CastleDoor_02', -0.95, CY1 - 0.15, 0, -2.0, 'L0')
    use('buildings/CastleDoor_03', 0.95, CY1 - 0.15, 0, 2.0, 'L0')
    for x in (8.75, 11.25):
        use('buildings/CastleWall_01', x, CY0, 0, 0, 'L0', sy=YARD_K)
        use('buildings/CastleWall_01', -x, CY0, 0, 0, 'L0', sy=YARD_K)
        use('buildings/CastleRoof_01', x, CY0, 5.85, PI, 'L0', sy=YARD_CAP)
        use('buildings/CastleRoof_01', -x, CY0, 5.85, PI, 'L0', sy=YARD_CAP)
    tower(-CHX, CY1, 2, 'spire')
    tower(CHX, CY1, 2, 'spire')
    # No towers at the courtyard's REAR corners: they overlapped the keep's own
    # front towers by 2.3 x 2.7 kit, welding into one lump with a curtain stub
    # buried inside it. The return walls die into the keep towers instead.
    use('buildings/CastlePart_01', -3.4, CY1 - 1.3, 0, 0, 'L0', s=0.36)
    use('buildings/CastlePart_01', 3.4, CY1 - 1.3, 0, 0, 'L0', s=0.36)
    use('props/Flag_02', -3.4, CY1 - 1.3, 3.0, 0, 'L0', s=1.3)
    use('props/Flag_02', 3.4, CY1 - 1.3, 3.0, 0, 'L0', s=1.3)
    # Off the gate-to-door axis: dead centre you walked out of the gate into it.
    use('environment/Fountain_01', -6.0, CY0 + 7.5, 0.0, 0, 'L0', s=0.95)
    for lx, ly in ((-6.5, CY0 + 3.2), (6.5, CY0 + 3.2), (-6.5, CY0 + 11.8), (6.5, CY0 + 11.8)):
        use('props/Lantern_01', lx, ly, 0.1, 0, 'L0', s=0.85)
    use('environment/FlowerBed_01', -10.0, CY0 + 4.0, 0.1, 0, 'L0')
    use('environment/FlowerBed_02', 10.0, CY0 + 4.0, 0.1, 0, 'L0')
    use('environment/FlowerBed_03', -10.0, CY0 + 11.0, 0.1, 0, 'L0')
    use('environment/FlowerBed_01', 10.0, CY0 + 11.0, 0.1, 0, 'L0')
    use('props/Box_01', 10.6, CY0 + 1.4, 0.17, 0.3, 'L0')
    use('props/Box_01', 10.55, CY0 + 1.45, 0.52, 1.1, 'L0')
    use('props/Barrel_01', 11.3, CY0 + 2.5, 0.17, 0, 'L0')
    use('props/Barrel_02', -11.1, CY0 + 1.9, 0.17, 0.6, 'L0')
    use('props/Dryer_01', -9.6, CY0 + 13.4, 0.17, 0.4, 'L0')
    use('props/NoticeBoard_01', -4.6, CY0 + 1.1, 0.17, 0, 'L0')
    use('props/Weapon_01', 9.1, CY0 + 13.5, 0.17, 0, 'L0')
    steps(0, CY1 + YARD_HALF + 0.09, 0, 3.4, 1, 0.166, y_low=-0.02)   # outside the thick gate wall

    # ================= COLLISION =================
    T = 0.22
    col_wall(-HX, HY, -1.3, HY, 0, 10, T)
    col_wall(1.3, HY, HX, HY, 0, 10, T)
    col(0, HY, 7.2, 1.3, T, 2.8)
    col_wall(-HX, -HY, HX, -HY, 0, 10, T)
    col_wall(-HX, -HY, -HX, HY, 0, 10, T)
    col_wall(HX, -HY, HX, HY, 0, 10, T)
    TY = YARD_HALF + 0.08   # the thick courtyard curtain, same padding as T
    col_wall(-CHX, CY0, -CHX, CY1, 0, 6.8, TY)
    col_wall(CHX, CY0, CHX, CY1, 0, 6.8, TY)
    col_wall(-CHX, CY1, -1.4, CY1, 0, 6.8, TY)
    col_wall(1.4, CY1, CHX, CY1, 0, 6.8, TY)
    col(0, CY1, 6.0, 1.4, TY, 1.0)
    col_wall(HX, CY0, CHX, CY0, 0, 6.8, TY)
    col_wall(-CHX, CY0, -HX, CY0, 0, 6.8, TY)
    # dais body (the steps carry their own deck)
    # Top 0.02 UNDER the step ramp's summit: a grounded mover steps DOWN onto a
    # box top but never UP onto one, so a dais level with its own ramp reads as
    # a wall at the last tread (the tavern's 2F floor follows the same rule).
    col(0, (DAIS_BACK + DAIS_FRONT) / 2, (DAIS_H - 0.02) / 2, 3.4,
        (DAIS_FRONT - DAIS_BACK) / 2, (DAIS_H - 0.02) / 2)
    col(0, DAIS_BACK + 0.85, DAIS_H + 0.6, 0.4, 0.32, 0.6)
    for py in PILLAR_W:
        col(-PILLAR_X, py, 2.5, 0.5, 0.5, 2.4)
    for py in PILLAR_E:
        col(PILLAR_X, py, 2.5, 0.5, 0.5, 2.4)
    col(-3.2, -1.4, 0.55, 0.42, 1.4, 0.35)
    col(-2.35, -1.4, 0.45, 0.3, 1.3, 0.3)
    col(-HX + 0.6, -4.4, 0.9, 0.4, 0.35, 0.7)
    col(HX - 0.55, -4.05, 0.5, 0.35, 0.9, 0.3)
    col(-6.0, CY0 + 7.5, 1.25, 2.15, 2.15, 1.25)
    # gallery: the back balcony plus a stub into each stair shaft. Each tops
    # 0.02 under the lower flight's summit so the last stride is a step DOWN.
    col(0, -3.75, 4.90, 5.0, 2.5, 0.08)              # back balcony
    col(-6.25, -4.775, 4.90, 1.25, 1.475, 0.08)      # west stub (lower head)
    col(6.25, -4.775, 4.90, 1.25, 1.475, 0.08)       # east stub (upper foot)
    col(0, -1.25, 5.75, 5.0, 0.12, 0.55)             # balcony front rail
    # HAND EDIT: the west lip rail and the east lip's inner piece were deleted,
    # so their colliders go with them, an invisible wall where the art was
    # removed is worse than an open edge.
    col(GAL_EDGE, -5.625, 5.75, 0.12, 0.625, 0.55)   # the one surviving east piece
    # terrace: everything but the east strip over the upper flight's shaft
    col(-1.25, 0, 9.90, 6.25, 6.25, 0.08)
    col(6.25, -4.775, 9.90, 1.25, 1.475, 0.08)
    col(6.25, 3.725, 9.90, 1.25, 2.525, 0.08)
    col_wall(-HX, HY, HX, HY, 10, 11.4, 0.3)
    col_wall(-HX, -HY, HX, -HY, 10, 11.4, 0.3)
    col_wall(-HX, -HY, -HX, HY, 10, 11.4, 0.3)
    col_wall(HX, -HY, HX, HY, 10, 11.4, 0.3)
    col(GAL_EDGE, -1.25, 10.75, 0.12, 2.5, 0.55)     # terrace shaft lip (extended)
    col(6.826, -3.781, 10.7, 0.63, 0.12, 0.5)        # HAND EDIT: shaft-mouth rail
    col(0, -2.5, 12.0, 0.16, 0.16, 1.8)              # banner mast
    # The furniture a player can actually walk into. Kept short on purpose:
    # asset_collision_overrides caps an asset at 64 boxes (MAX_BOXES in
    # scripts/lib/collision_overrides_emit.mjs) and the shell, towers, stairs
    # and gallery already spend most of it. Thin decorative poles stay ghosts.
    col(0.0, -HY + 0.45, 5.9, 3.7, 0.35, 0.85)       # the bookcase run, as one
    col(-4.6, CY0 + 1.1, 0.9, 0.9, 0.25, 0.85)       # notice board
    col(10.95, CY0 + 1.95, 0.45, 0.9, 0.9, 0.45)     # east crate/barrel group

    interior(-HX + 0.25, HX - 0.25, -HY + 0.25, HY - 0.25, 0.0, 10.0)

    # Explorable keep: no hidden-face cull, but flat floor tiles, planar
    # dissolve and slab decimation (the floors, not the walls, were the bulk
    # of the 229k tris once the castle kit swapped to its flat LODs).
    exec(open(SCRATCH + '/bl_lite.py').read())
    flatten_tiles()
    dissolve_planar()
    decimate_slabs()
    finalize('tidehold_castle', SCRATCH + '/out', S)
    print('CASTLE v2 DONE  player=%.3f kit' % PLAYER_KIT)
except Exception:
    print(traceback.format_exc())
