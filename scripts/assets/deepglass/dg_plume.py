# Brennoch's burner plume, the thing that comes OUT of the thrustpack.
#
# Replaces the two authored `fire.*` cones, which were a 128-vert party hat
# apiece: a straight taper, a circular cross-section and nothing along their
# length for a shader to grab hold of. At the size a burn actually draws them
# that read as an orange traffic cone stuck to the model.
#
# What ships instead is four nested parts, each a separate node so the runtime
# can drive them apart (src/render/jet_fire.ts):
#
#   plume_wash  a short flared collar at the nozzle mouth, the shock collar
#   plume_core  the white-hot spike, PINCHED four times down its length so the
#               shock diamonds are in the geometry rather than faked in a
#               gradient; it is the shortest part and the brightest
#   plume_veil  the long soft envelope, with a five-lobed cross-section that
#               twists as it goes, so the silhouette is never a circle
#   plume_tail  three crossed ribbons running out past the veil, for the
#               turbulent whipping end
#
# EVERY PART CARRIES ITS OWN PARAMETERISATION, which is the actual point of
# authoring this in Blender rather than tweaking a cone:
#
#   UV0 = (angle around the plume, distance along it)   0 at the mouth
#   UV1 = (rim: 0 on the axis and 1 at the silhouette, seed: per-part random)
#
# so the shader can do a heat gradient, a soft volumetric edge, per-lobe
# turbulence and a shock-banded brightness without a single texture fetch and
# without guessing at the geometry from object space.
#
# Authored along -Z, which the glTF exporter turns into -Y: the same axis the
# jetpack's own `fire.*` sockets point down, so the plume drops straight into
# them and the gimbal in deepglass_pack.ts needs to know nothing about it.
#
# Run:
#   python3 ~/.claude/tools/blender_bridge.py run scripts/assets/deepglass/dg_plume.py
import traceback

LOG = []
try:
    exec(open("/Users/troy/Documents/woc/deepglass/scripts/assets/deepglass/dg_lib.py").read())
    reset_scene()

    import random

    OUT = os.path.join(OUT_DIR, "brennoch_plume.glb")
    rng = random.Random(0xB4E)

    # ---- sizes -------------------------------------------------------------
    # One unit long overall, mouth radius a shade over a tenth. The runtime
    # scales from here, so these are RATIOS as much as sizes: the core is 62% of
    # the veil's length, the tail runs half as far again past it.
    R_MOUTH = 0.105
    L_CORE = 0.62
    L_VEIL = 1.00
    L_TAIL = 1.78

    def mk_mat(name, rgb, strength):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
            for key in ("Emission Color", "Emission"):
                if key in bsdf.inputs:
                    bsdf.inputs[key].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
                    break
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = strength
        # The runtime replaces this material outright; it exists so the GLB is
        # well formed and so a Blender preview is not black.
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            try:
                m.blend_method = 'BLEND'
            except Exception:
                pass
        return m

    def finish(name, bm, uvs, uv2s, mat):
        """Bake the per-vert UV payload onto loops and make the object."""
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        uv0 = me.uv_layers.new(name="UVMap")
        uv1 = me.uv_layers.new(name="UVData")
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uv0.data[li].uv = uvs[vi]
                uv1.data[li].uv = uv2s[vi]
        me.shade_smooth()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob

    # -----------------------------------------------------------------------
    # A revolved shell that closes to a point at the tip.
    #
    # `r_fn(t)` is the radius profile and `lobes`/`lobe_amp`/`twist` break the
    # cross-section off circular. The angular seam is DUPLICATED (segs + 1
    # columns) so u can run a clean 0..1 without the last quad wrapping
    # backwards through the whole texture, the standard lathe in dg_lib shares
    # its seam column, which is right for a solid and wrong for anything
    # gradient-mapped around its circumference.
    # -----------------------------------------------------------------------
    def shell(name, mat, segs, rings, length, r_fn, seed,
              lobes=0, lobe_amp=0.0, twist=0.0, v0=0.0, v1=1.0):
        bm = bmesh.new()
        uvs, uv2s = [], []
        grid = []
        for j in range(rings + 1):
            t = j / rings
            z = -length * t
            base = r_fn(t)
            row = []
            for i in range(segs + 1):
                a = TAU * i / segs
                r = base
                if lobes:
                    r *= 1.0 + lobe_amp * math.cos(lobes * a + twist * t)
                v = bm.verts.new((math.cos(a) * r, math.sin(a) * r, z))
                row.append(v)
                uvs.append((i / segs, v0 + (v1 - v0) * t))
                # rim is 1 everywhere on a shell: every vert IS the silhouette.
                # The shader gets its across-the-plume falloff from the normal
                # instead, which is what makes a shell read as a volume.
                uv2s.append((1.0, seed))
            grid.append(row)
        bm.verts.index_update()
        for j in range(rings):
            for i in range(segs):
                a, b = grid[j], grid[j + 1]
                try:
                    f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
                    f.smooth = True
                except ValueError:
                    pass
        return finish(name, bm, uvs, uv2s, mat)

    # ---- the shock collar --------------------------------------------------
    # A trumpet at the mouth. Short, wide and fixed: it is the one part that
    # does not stretch with the throttle, so the nozzle always looks socketed.
    wash = shell(
        "plume_wash", mk_mat("plume_wash", (1.0, 0.93, 0.78), 6.0),
        segs=20, rings=3, length=0.10,
        r_fn=lambda t: R_MOUTH * (1.0 + 0.42 * t ** 1.4),
        seed=0.12,
    )

    # ---- the core ----------------------------------------------------------
    # Four pinches down its length. A real afterburner's shock diamonds ARE a
    # periodic narrowing of the jet, so they belong in the profile, banding the
    # brightness alone gives stripes on a cone, which is not the same thing and
    # does not survive being looked at from the side.
    def core_r(t):
        taper = (1.0 - t) ** 0.62
        pinch = 1.0 + 0.19 * math.cos(t * TAU * 2.0)
        return R_MOUTH * 0.92 * taper * pinch

    core = shell(
        "plume_core", mk_mat("plume_core", (1.0, 0.97, 0.88), 12.0),
        segs=14, rings=22, length=L_CORE, r_fn=core_r, seed=0.41,
    )

    # ---- the veil ----------------------------------------------------------
    # Swells out of the mouth, peaks a third of the way down, tapers away. Five
    # lobes with a slow twist: enough to kill the circle in silhouette, not so
    # much that it reads as a flower.
    def veil_r(t):
        return 0.148 * math.sin(math.pi * t ** 0.78) ** 0.95 + 0.052 * (1.0 - t) ** 1.6

    veil = shell(
        "plume_veil", mk_mat("plume_veil", (1.0, 0.55, 0.18), 4.0),
        segs=18, rings=16, length=L_VEIL, r_fn=veil_r, seed=0.73,
        lobes=5, lobe_amp=0.13, twist=1.9,
    )

    # ---- the tail ----------------------------------------------------------
    # Three ribbons crossed at 60 degrees, running from halfway down the veil out
    # past its tip. Flat geometry on purpose: additive, unlit and always seen
    # through something else, so a shell here would only cost fill. They carry
    # v > 1 so the shader can tell "past the flame" from "in it" and whip them.
    #
    # THREE columns, not two. A two-vertex ribbon has no interior, so its only
    # possible cross-section is a flat band with hard edges, the centre spine is
    # what lets the shader run a soft transverse falloff and makes a flat quad
    # read as a rope of fire rather than a strip of tape.
    def tail(name, mat):
        bm = bmesh.new()
        uvs, uv2s = [], []
        segs_len = 14
        t0 = 0.52
        for k in range(3):
            ang = math.pi * k / 3.0
            ca, sa = math.cos(ang), math.sin(ang)
            seed = rng.random()
            cols = []
            for j in range(segs_len + 1):
                t = j / segs_len
                z = -(L_VEIL * t0 + (L_TAIL - L_VEIL * t0) * t)
                # Fat where it leaves the veil, whipped to nothing at the end.
                w = 0.082 * math.sin(math.pi * (0.16 + 0.84 * t)) ** 1.4 * (1.0 - t) ** 0.5
                trio = []
                for s in (-1.0, 0.0, 1.0):
                    v = bm.verts.new((ca * w * s, sa * w * s, z))
                    trio.append(v)
                    uvs.append(((s + 1.0) * 0.5, t0 + (L_TAIL / L_VEIL - t0) * t))
                    uv2s.append((abs(s), seed))
                cols.append(trio)
            bm.verts.index_update()
            for j in range(segs_len):
                a, b = cols[j], cols[j + 1]
                for c in (0, 1):
                    try:
                        f = bm.faces.new((a[c], a[c + 1], b[c + 1], b[c]))
                        f.smooth = True
                    except ValueError:
                        pass
        return finish(name, bm, uvs, uv2s, mat)

    tails = tail("plume_tail", mk_mat("plume_tail", (1.0, 0.36, 0.09), 2.5))

    objs = [wash, core, veil, tails]
    for o in objs:
        LOG.append(f"{o.name}: {len(o.data.polygons)} faces, {len(o.data.vertices)} verts")

    # ---- export ------------------------------------------------------------
    activate(objs)
    with bpy.context.temp_override(**ctx_override()):
        bpy.ops.export_scene.gltf(
            filepath=OUT,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_normals=True,
            export_texcoords=True,
            export_materials='EXPORT',
            export_animations=False,
            export_skins=False,
            export_cameras=False,
            export_lights=False,
        )
    LOG.append(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
    print("\n".join(LOG))
except Exception:
    print("\n".join(LOG))
    traceback.print_exc()
