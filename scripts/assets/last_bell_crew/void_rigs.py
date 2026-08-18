"""Rig and animate the two void creatures: the Sundered Horror and the Riftspawn.

The MODELS were always good. Their rigs and clips were not, and no amount of tuning the
clips could reach the reason. This is the settled fix, in the order it has to run.

WHAT WAS ACTUALLY WRONG, measured rather than eyeballed
------------------------------------------------------
Sundered Horror. Its rest skeleton is a straight T-pose: the whole arm chain runs along
+X at a constant z=1.107 and stops at x=0.899. The MESH is not a straight T-pose; its
elbows bend forward, so each arm reaches x=1.29 and then sweeps to y=-0.60. The chain
therefore leaves the arm around 60% of its length and the entire forearm and fist contain
no bone at all. The skin proved it: `upperarm` dominated ZERO vertices while `hand`, a
0.112-long bone, dominated 1104. So the shoulder could not swing the arm, and every
clip's elbow bend creased the limb mid-forearm. That is the "weird elbow".

Riftspawn. It has FOUR arms and the shipped rig has one pair of arm bones. `chest`
dominated 4079 of 6363 vertices; the four arms shared 898. The lower pair had no bones
whatsoever and rode the chest as rigid geometry, which is what made the arms read as
noodles. On top of that, `lowerarm`/`wrist` drove geometry centred at z=1.39 while their
bones sat at z=0.926, so the pivot was 0.46 BELOW the mesh it deformed. And each hand is
a flat wedge palm with five straight talons splayed in one plane, with no finger bones
anywhere in the rig, so a hand could never close: every attack frame showed the same
open rake.

WHY NOT AMPLIFY THE CLIPS
-------------------------
The previous pass scaled the existing keyframes. It could not work: the clips are
retargeted KayKit HUMAN motion, and scaling a human overhead chop cannot turn it into a
four-yard brute's swing. That pass ended up DAMPING the Horror's torso to 0.55 gain to
stop the creature folding over and face-planting, which is an admission that the source
motion was wrong rather than merely small. Both attacks here are authored instead.

STAGE ORDER, and why it is not negotiable
-----------------------------------------
1. CLAWS (Riftspawn only). Curl the talons in the REST mesh. Rest IS the bind, so the
   model does not move and nothing needs rebinding, but it must happen BEFORE stage 2 so
   the weights are authored against the final geometry.
2. RIG. Put the joints on the centreline measured out of the geometry, create the
   Riftspawn's missing second arm chain, re-skin the arm bands, and retarget every
   existing clip onto the new rest pose.
3. CLIPS. Author the two attacks, and for the Riftspawn damp the arm channels in the
   locomotion clips, whose human arm swings both wreck its silhouette and drag the
   chest-to-arm weight boundary through 100+ degrees.

NOT IDEMPOTENT. Stage 2 retargets the clips onto a new rest pose, so running it twice
applies the correction twice. Always run from a pristine source; this entry point
refuses to write over its own input.

Run (same shape as model.py, run by hand, never from `npm run build`):

    VOID_SRC=tmp/void_src VOID_OUT=public/models/chars/npcs \\
      blender --background --python scripts/assets/last_bell_crew/void_rigs.py

Environment:
  VOID_SRC     directory holding the pristine source GLBs (required)
  VOID_OUT     directory to write the rigged GLBs (required)
  VOID_MEMBER  `horror`, `riftspawn`, or `all` (default `all`)
  VOID_SKIP_CLAWS  set to 1 when the source's talons are already curled
                   (the preserved riftspawn source is post-stage-1)

Verify afterwards with the review tooling this was built against, which lives beside it
so these instructions cannot rot:

  review_rig_audit.py    -- <glb>
      bone hierarchy against the geometry each bone actually dominates. This is what
      found both defects; a bone owning 0 vertices, or owning geometry whose centroid is
      nowhere near it, is the whole story.
  review_stretch_check.py -- <glb> <clip> [samples] [ratio] [min_gap]
      skinning tears, as edges whose posed length bears no relation to their rest length.
      Needs BOTH a ratio and an absolute gap: this mesh is full of sliver edges a few
      thousandths long that hit 5x while moving a distance nobody can see.
  review_strip.py        -- <glb> <clip> out.png [n] [yaw] [pitch]
      one clip as a single montage, because a swing is a shape over time and separate
      frames hide whether that shape reads. Pass "Clip@frame" to orbit ONE pose instead;
      a key pose aimed at the camera is foreshortened to nothing, which is how a swing
      that reads badly gets called good.
  review_rig_viz.py      -- <glb> <outdir> [clip] [frame] [alpha]
      the rig as real geometry over a ghosted body, so a chain sitting outside the limb
      it drives is visible. Blender's bone overlay only exists in the viewport; this
      renders committed images that can be compared across iterations.
"""

import math
import os
import sys
from collections import defaultdict, deque

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "..", ".."))


def V(*a):
    return Vector(a)


# ---------------------------------------------------------------------------
# Measured specs. Every joint below sits on a centreline traced out of the mesh by
# geodesic banding, not guessed: a bone only helps if it lies INSIDE the limb it drives
# along the bone's whole length.
# ---------------------------------------------------------------------------

SPECS = {
    "horror": {
        "src": "sundered_horror_thicket.glb",
        "chains": [{
            "bones": ["upperarm", "lowerarm", "wrist", "hand"],
            "joints": [
                (0.212, 0.000, 1.107),   # shoulder, unchanged: already in the shoulder mass
                (0.930, 0.020, 1.075),   # elbow, where the arm turns from outward to forward
                (1.150, -0.300, 1.080),  # wrist
                (1.170, -0.420, 1.075),
                (1.190, -0.620, 1.065),  # fist
            ],
            "handslot": (1.175, -0.500, 1.020),
        }],
        # arc: blend out of the chest over the first 0.34 yard ALONG the arm. Ramping on
        # |x| instead forces an impossible choice, wide enough to blend smoothly and the
        # upper arm never becomes arm-driven at all, narrow enough for the shoulder to own
        # it and the chest boundary tears.
        "inner": 0.30, "arc": (0.02, 0.34), "smooth": (14, 0.55),
        # Tube radius PER LINK: the limb is not a uniform cylinder. The traced centreline
        # runs r=0.33 through the thick upper arm down to r=0.08 at the fist, and the
        # shoulder spikes sit ~0.58 out. One radius for the chain either cuts the upper arm
        # loose or lets the spikes in, and spikes taking arm weight get FLUNG OFF.
        "radii": {"upperarm": (0.34, 0.52), "lowerarm": (0.24, 0.40),
                  "wrist": (0.20, 0.34), "hand": (0.22, 0.38)},
        "pad_z": 1.52,
        "claws": None,
    },
    "riftspawn": {
        "src": "riftspawn_antler.glb",
        "chains": [
            {
                "bones": ["upperarm", "lowerarm", "wrist", "hand"],
                "joints": [
                    (0.240, 0.060, 1.170),   # upper shoulder
                    (0.600, 0.020, 1.280),   # elbow, raised
                    (0.820, -0.090, 1.390),
                    (0.900, -0.140, 1.380),
                    (1.000, -0.260, 1.350),  # claw
                ],
                "handslot": (0.930, -0.200, 1.330),
            },
            {
                # The lower pair has no bones in the shipped rig. New bones stay at rest
                # in the existing clips, so locomotion carries the extra limbs along for
                # free and only the authored attacks drive them.
                "bones": ["upperarm2", "lowerarm2", "wrist2", "hand2"],
                "create_parent": "chest",
                "joints": [
                    (0.260, 0.100, 0.920),   # lower shoulder
                    (0.600, -0.010, 0.880),  # elbow
                    (0.820, -0.110, 0.830),
                    (0.900, -0.140, 0.840),
                    (0.960, -0.260, 0.810),  # claw
                ],
                "handslot": None,
            },
        ],
        "inner": 0.14, "arc": (0.02, 0.20), "smooth": (13, 0.52),
        "radii": {"upperarm": (0.15, 0.26), "lowerarm": (0.13, 0.23),
                  "wrist": (0.11, 0.20), "hand": (0.14, 0.25),
                  "upperarm2": (0.15, 0.26), "lowerarm2": (0.13, 0.23),
                  "wrist2": (0.11, 0.20), "hand2": (0.14, 0.25)},
        # the antlers live above this; they are head geometry and must never take arm
        # weight, the same failure mode as the Horror's shoulder spikes
        "pad_z": 1.60,
        "claws": {"curl": 74.0, "splay": 0.34, "sign": 1.0, "pow": 1.5,
                  "xcut": 0.22, "antler_z": 1.60, "hand_f": 0.66, "palm_f": 0.30},
    },
}


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def seg_dist(p, a, b):
    ab = b - a
    if ab.length_squared == 0:
        return (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def wipe():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                 bpy.data.actions, bpy.data.images, bpy.data.collections, bpy.data.lights,
                 bpy.data.cameras):
        for item in list(coll):
            try:
                coll.remove(item)
            except Exception:
                pass


def load(path):
    """Import a GLB. The seed empty exists because the glTF importer reads
    bpy.context.object, which does not resolve in a freshly emptied file."""
    seed = bpy.data.objects.new("ctx_seed", None)
    bpy.context.scene.collection.objects.link(seed)
    bpy.context.view_layer.objects.active = seed
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.data.objects.remove(seed, do_unlink=True)
    for o in [o for o in bpy.data.objects
              if o.type == "MESH" and o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(o, do_unlink=True)
    body = next(o for o in bpy.data.objects if o.type == "MESH")
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    return body, rig


def weld(body):
    """Group vertices by POSITION.

    Tripo ships a triangle soup with duplicate vertices at one point. Weighting per
    VERTEX lets two vertices at the same place disagree and pull apart, which cracks the
    mesh open under deformation, and it leaves the edge graph disconnected at every seam.
    Everything here works per welded position and writes identical weights to duplicates.
    """
    me = body.data
    W = body.matrix_world
    key, node_of = {}, {}
    for i, v in enumerate(me.vertices):
        p = W @ v.co
        node_of[i] = key.setdefault((round(p.x, 5), round(p.y, 5), round(p.z, 5)), len(key))
    npos = [None] * len(key)
    verts_of = defaultdict(list)
    for i, v in enumerate(me.vertices):
        npos[node_of[i]] = W @ v.co
        verts_of[node_of[i]].append(i)
    adj = defaultdict(set)
    for e in me.edges:
        a, b = node_of[e.vertices[0]], node_of[e.vertices[1]]
        if a != b:
            adj[a].add(b)
            adj[b].add(a)
    return node_of, npos, verts_of, adj


# ---------------------------------------------------------------------------
# Stage 1: curl the talons
# ---------------------------------------------------------------------------

def curl_claws(body, rig, cfg):
    """Bend each splayed talon into a hook, using the model's own faces.

    `scripts/assets/CLAUDE.md` is explicit for this family: edit the MESH, never generate
    a shape and fit it over the model. So no claw is modelled and no finger bones are
    invented; each existing talon is found and progressively rotated about its own base.
    """
    me = body.data
    Wi = body.matrix_world.inverted()
    node_of, npos, verts_of, adj = weld(body)

    def components(sel):
        seen, out = set(), []
        for n in sel:
            if n in seen:
                continue
            q, c = deque([n]), []
            seen.add(n)
            while q:
                x = q.popleft()
                c.append(x)
                for m in adj[x]:
                    if m in sel and m not in seen:
                        seen.add(m)
                        q.append(m)
            out.append(c)
        return out

    sel = {n for n in range(len(npos))
           if abs(npos[n].x) > cfg["xcut"] and npos[n].z < cfg["antler_z"]}
    limbs = [c for c in components(sel) if len(c) >= 40]
    moved, report = 0, []

    for li, comp in enumerate(limbs):
        cs = set(comp)
        root = min(comp, key=lambda n: abs(npos[n].x))
        dist = {root: 0.0}
        q = deque([root])
        while q:
            x = q.popleft()
            for m in adj[x]:
                if m in cs and m not in dist:
                    dist[m] = dist[x] + (npos[m] - npos[x]).length
                    q.append(m)
        dmax = max(dist.values())
        hand = [n for n, d in dist.items() if d > dmax * cfg["hand_f"]]
        if len(hand) < 12:
            continue
        hd = {n: dist[n] for n in hand}
        lo, hh = min(hd.values()), max(hd.values())
        palm = [n for n in hand if hd[n] < lo + (hh - lo) * cfg["palm_f"]]
        if not palm:
            continue
        pc = sum((npos[n] for n in palm), Vector()) / len(palm)
        wrist = min(hand, key=lambda n: hd[n])
        axis = (pc - npos[wrist]).normalized()

        # Palm plane normal: the fan is nearly planar, so the direction with the LEAST
        # spread across the hand is that plane's normal, and that is the axis the talons
        # must curl across.
        pts = [npos[n] - pc for n in hand]
        best, normal = None, V(0, 0, 1)
        for cand in (V(1, 0, 0), V(0, 1, 0), V(0, 0, 1),
                     axis.cross(V(0, 0, 1)), axis.cross(V(0, 1, 0)), axis.cross(V(1, 0, 0))):
            if cand.length < 1e-6:
                continue
            c = cand.normalized()
            spread = sum(p.dot(c) ** 2 for p in pts)
            if best is None or spread < best:
                best, normal = spread, c
        grasp = (normal * cfg["sign"]).normalized()

        # Digits by TIP, then nearest-tip assignment. Connectivity cannot separate these
        # talons (they stay joined at their bases however much palm is removed, and
        # removing more finds FEWER), and angular sectors fail because the talons
        # converge. But each talon has exactly one tip: a node further from the palm
        # centre than all its neighbours.
        hset = set(hand)
        rad = {n: (npos[n] - pc).length for n in hand}
        tips = [n for n in hand if rad[n] > (hh - lo) * 0.30
                and all(rad[n] >= rad[m] for m in adj[n] if m in hset)]
        if not tips:
            continue
        owner = {t: t for t in tips}
        q = deque(tips)
        while q:
            x = q.popleft()
            for m in adj[x]:
                if m in hset and m not in owner:
                    owner[m] = owner[x]
                    q.append(m)
        groups = defaultdict(list)
        for n, t in owner.items():
            if rad[n] > (hh - lo) * cfg["palm_f"]:
                groups[t].append(n)
        digits = [g for g in groups.values() if len(g) >= 3]

        for digit in digits:
            base = min(digit, key=lambda n: (npos[n] - pc).length)
            bp = npos[base]
            daxis = sum((npos[n] for n in digit), Vector()) / len(digit) - bp
            if daxis.length < 1e-6:
                continue
            daxis.normalize()
            dlen = max((npos[n] - bp).dot(daxis) for n in digit) or 1e-6
            curl_axis = daxis.cross(grasp)
            if curl_axis.length < 1e-5:
                continue
            curl_axis.normalize()
            splay_axis = daxis.cross(axis)
            for n in digit:
                t = max(0.0, min(1.0, (npos[n] - bp).dot(daxis) / dlen))
                r = Matrix.Rotation(math.radians(cfg["curl"]) * (t ** cfg["pow"]), 3, curl_axis)
                if splay_axis.length > 1e-5:
                    r = Matrix.Rotation(-cfg["splay"] * daxis.angle(axis) * (t ** cfg["pow"]),
                                        3, splay_axis.normalized()) @ r
                newp = bp + r @ (npos[n] - bp)
                for i in verts_of[n]:
                    me.vertices[i].co = Wi @ newp
                npos[n] = newp
                moved += 1
        report.append(f"    limb {li} palm=({pc.x:+.2f},{pc.y:+.2f},{pc.z:+.2f}) "
                      f"digits={len(digits)}")
    me.update()
    print(f"  CLAWS curl={cfg['curl']}deg nodes_moved={moved}")
    for line in report:
        print(line)


# ---------------------------------------------------------------------------
# Stage 2: put the chain on the arm, and re-skin to it
# ---------------------------------------------------------------------------

def rebuild_rig(body, rig, spec):
    RWi = rig.matrix_world.inverted()
    me = body.data

    def rest_rel(bone):
        if bone.parent is None:
            return bone.matrix_local.copy()
        return bone.parent.matrix_local.inverted() @ bone.matrix_local

    REST_OLD = {b.name: rest_rel(b) for b in rig.data.bones}

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    created = []
    for chain in spec["chains"]:
        for side in ("l", "r"):
            sx = 1.0 if side == "l" else -1.0
            pts = [Vector((p[0] * sx, p[1], p[2])) for p in chain["joints"]]
            prev = None
            for i, link in enumerate(chain["bones"]):
                name = f"{link}.{side}"
                eb = rig.data.edit_bones.get(name)
                if eb is None:
                    if not chain.get("create_parent"):
                        continue
                    eb = rig.data.edit_bones.new(name)
                    eb.parent = (prev if prev is not None
                                 else rig.data.edit_bones[chain["create_parent"]])
                    eb.use_connect = False
                    created.append(name)
                eb.head = RWi @ pts[i]
                eb.tail = RWi @ pts[i + 1]
                prev = eb
            hs = rig.data.edit_bones.get(f"handslot.{side}")
            if hs is not None and chain.get("handslot"):
                h = Vector((chain["handslot"][0] * sx, chain["handslot"][1],
                            chain["handslot"][2]))
                d = hs.tail - hs.head
                hs.head = RWi @ h
                hs.tail = RWi @ h + d
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    for name in created:
        if name not in body.vertex_groups:
            body.vertex_groups.new(name=name)
    print(f"  RIG created={sorted(created)}")

    # Retarget every existing clip onto the new rest pose.
    #
    # A pose channel is stored RELATIVE TO REST, so re-aiming a bone silently changes
    # what all 22 clips do with it. Here that is a double-bend: the clips bend a STRAIGHT
    # elbow forward and the new rest already has it bent forward, so the two add and the
    # forearm curls across the body. Blender composes a pose bone as
    #     matrix = parent.matrix @ (parent_rest.inverted() @ rest) @ matrix_basis
    # so holding orientation fixed while rest changes needs
    #     q_new = R_new_rot.inverted() @ R_old_rot @ q_old
    # Only ROTATION is corrected, deliberately: the translation part of the change is the
    # joint moving to where it belongs, which is the whole point and must not be undone.
    REST_NEW = {b.name: rest_rel(b) for b in rig.data.bones}
    CORR = {}
    for name, old in REST_OLD.items():
        new = REST_NEW.get(name)
        if new is None:
            continue
        q = new.to_quaternion().inverted() @ old.to_quaternion()
        if abs(q.angle) > 1e-4:
            CORR[name] = q
    fixed = 0
    for action in bpy.data.actions:
        for bone, corr in CORR.items():
            quad = channel(action, bone)
            if quad is None:
                continue
            for i in range(len(quad[0].keyframe_points)):
                q = Quaternion([fc.keyframe_points[i].co[1] for fc in quad])
                if q.magnitude < 1e-9:
                    continue
                q.normalize()
                write_key(quad, i, corr @ q)
            for fc in quad:
                fc.update()
            fixed += 1
    print(f"  RETARGET bones={len(CORR)} channels={fixed} "
          + ", ".join(f"{n}:{math.degrees(q.angle):.0f}deg" for n, q in sorted(CORR.items())))

    # ---- re-skin the arm bands
    node_of, npos, verts_of, adj = weld(body)
    gname = {g.index: g.name for g in body.vertex_groups}
    buckets = defaultdict(list)
    for n, ids in verts_of.items():
        buckets[n] = ids
    wts = [defaultdict(float) for _ in npos]
    for n, ids in verts_of.items():
        for i in ids:
            for g in me.vertices[i].groups:
                wts[n][gname[g.group]] += g.weight / len(ids)

    def seg_of(name):
        b = rig.data.bones[name]
        return rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local

    ARM_BONES = [f"{l}.{s}" for c in spec["chains"] for l in c["bones"] for s in ("l", "r")]
    ARM_SEGS = {n: seg_of(n) for n in ARM_BONES if n in rig.data.bones}

    # Arc length from each chain's SHOULDER SOCKET to the start of each of its bones. The
    # blend out of the chest ramps on THIS, because "how far out of the body are we" is a
    # distance along the limb, and it cannot confuse one arm pair for another.
    ARM_S0 = {}
    for c in spec["chains"]:
        for side in ("l", "r"):
            run = 0.0
            for link in c["bones"]:
                name = f"{link}.{side}"
                if name not in ARM_SEGS:
                    continue
                a, b = ARM_SEGS[name]
                ARM_S0[name] = run
                run += (b - a).length

    def arc_of(p, name):
        a, b = ARM_SEGS[name]
        ab = b - a
        t = (0.0 if ab.length_squared == 0
             else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)))
        return ARM_S0.get(name, 0.0) + t * ab.length

    INNER = spec["inner"]
    S_IN, S_OUT = spec["arc"]
    RADII = spec["radii"]
    reassigned, pad_hits = 0, 0
    for n, p in enumerate(npos):
        if abs(p.x) <= INNER:
            continue
        side = "l" if p.x > 0 else "r"
        mine = {k: v for k, v in ARM_SEGS.items() if k.endswith(f".{side}")}
        if not mine:
            continue
        ds = sorted(((seg_dist(p, *v), k) for k, v in mine.items()), key=lambda kv: kv[0])
        d_arm = ds[0][0]
        # Bind to a chain only what lies within the LIMB'S OWN THICKNESS of it. Asking
        # instead whether the arm chain is nearer than the torso chain is what tore the
        # shoulder pads off and flung them: the chest bone is a thin line down the body's
        # centre, so a spike outboard on the shoulder is genuinely closer to the arm chain
        # than to the chest bone despite being body, not arm.
        r_in, r_out = RADII[ds[0][1].split(".")[0]]
        ramp = smoothstep((arc_of(p, ds[0][1]) - S_IN) / (S_OUT - S_IN))
        radial = 1.0 - smoothstep((d_arm - r_in) / (r_out - r_in))
        w_arm = ramp * radial
        if w_arm <= 1e-3:
            continue
        (d0, n0), (d1, n1) = ds[0], ds[1] if len(ds) > 1 else ds[0]
        f0 = 1.0 if d0 + d1 <= 1e-9 else d1 / (d0 + d1)
        wts[n] = defaultdict(float)
        wts[n][n0] = w_arm * f0
        wts[n][n1] = w_arm * (1.0 - f0)
        wts[n]["chest"] = 1.0 - w_arm
        reassigned += 1
        # pad_z is a DIAGNOSTIC, deliberately: it reports how much decoration above
        # the shoulder line is taking arm weight, and does not clamp it. Enforcing
        # it was tried and measured worse. Tapering arm weight to zero below pad_z
        # puts a boundary in the weight field, and on the Riftspawn that boundary
        # lands inside the arm itself (its wrist sits at z=1.39 against a pad_z of
        # 1.60), so the shoulder tears: edges over 2x with a real gap went from
        # 0.007% to 0.068% of the mesh for no visible gain. The radial term already
        # keeps decoration out by limb thickness, which is the mechanism that
        # works; this counter is here to say when it stops working.
        if p.z > spec["pad_z"] and w_arm > 0.15:
            pad_hits += 1

    # Laplacian smoothing over the welded neighbour graph. This is what removes sharp
    # weight gradients everywhere at once, including seams that shipped in the original.
    iters, mix = spec["smooth"]
    for _ in range(iters):
        nxt = []
        for n in range(len(npos)):
            ns = adj.get(n)
            if not ns:
                nxt.append(wts[n])
                continue
            avg = defaultdict(float)
            for m in ns:
                for k, w in wts[m].items():
                    avg[k] += w / len(ns)
            blend = defaultdict(float)
            for k in set(avg) | set(wts[n]):
                blend[k] = (1.0 - mix) * wts[n].get(k, 0.0) + mix * avg.get(k, 0.0)
            nxt.append(blend)
        wts = nxt

    groups = {g.name: g for g in body.vertex_groups}
    for n in range(len(npos)):
        w = {b: x for b, x in wts[n].items() if x > 1e-4 and b in groups}
        total = sum(w.values())
        if total <= 1e-6:
            w, total = {"chest": 1.0}, 1.0
        ids = buckets[n]
        for g in groups.values():
            try:
                g.remove(ids)
            except Exception:
                pass
        for b, x in w.items():
            groups[b].add(ids, x / total, "REPLACE")

    ARMSET = tuple({b.split(".")[0] for b in ARM_BONES}) + ("handslot",)

    def armw(n):
        return sum(x for b, x in wts[n].items() if b.split(".")[0] in ARMSET)

    jumps = [abs(armw(a) - armw(b)) for a in adj for b in adj[a]]
    dom = defaultdict(int)
    for n in range(len(npos)):
        if wts[n]:
            dom[max(wts[n].items(), key=lambda kv: kv[1])[0]] += len(buckets[n])
    print(f"  SKIN reassigned={reassigned} pad_nodes_taking_arm_weight={pad_hits} "
          f"worst_adjacent_jump={max(jumps) if jumps else 0:.3f} "
          f"over_0.45={sum(1 for j in jumps if j > 0.45) // 2}")
    print("  DOMINANCE " + " ".join(f"{b}={dom.get(b, 0)}" for b in ARM_BONES + ["chest"]))


# ---------------------------------------------------------------------------
# Stage 3: author the attacks
# ---------------------------------------------------------------------------

def channel(action, bone):
    want = f'pose.bones["{bone}"].rotation_quaternion'
    fcurves = [c for lay in action.layers for st in lay.strips
               for bag in st.channelbags for c in bag.fcurves]
    quad = sorted((fc for fc in fcurves if fc.data_path == want),
                  key=lambda fc: fc.array_index)
    return quad if len(quad) == 4 else None


def write_key(quad, i, q):
    for fc in quad:
        kp = fc.keyframe_points[i]
        kp.co[1] = q[fc.array_index]
        kp.handle_left[1] = q[fc.array_index]
        kp.handle_right[1] = q[fc.array_index]


WORST = {"err": -1.0, "bone": "", "frame": -1}


def aim(rig, pb, d, twist=0.0):
    """Point a pose bone along world direction `d`, then twist about its own axis.

    REST ORIENTATION composed with the minimal swing carrying the bone's rest direction
    to `d`, so rest roll passes through untouched and no roll is ever invented. Building
    a fresh basis from a reference vector looks equivalent and is not: for a near-vertical
    bone (spine, chest) the reference is parallel to the bone, the cross product
    collapses, and the fallback picks an arbitrary roll. That twisted the chest about its
    own axis, which leaves its DIRECTION correct while silently swapping the left and
    right shoulders hanging off it.
    """
    Ai = rig.matrix_world.inverted().to_3x3()
    d = (Ai @ Vector(d)).normalized()
    rest = pb.bone.matrix_local.to_3x3().normalized()
    rot = (rest @ V(0.0, 1.0, 0.0)).normalized().rotation_difference(d).to_matrix() @ rest
    assert rot.determinant() > 0.9, f"aim built a reflection for {pb.name}"
    if twist:
        rot = Matrix.Rotation(math.radians(twist), 3, d) @ rot
    pb.matrix = Matrix.Translation(pb.matrix.to_translation()) @ rot.to_4x4()


def hierarchy_order(rig):
    """Bone names, parents before children, read from the rig.

    A hardcoded list silently skipped the Riftspawn's second arm chain, because those
    bones are CREATED by stage 2 and could not appear in a list written before they
    existed: four limbs were posed and four were quietly ignored.
    """
    out = []

    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)

    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    return out


def apply_pose(rig, pose, frame=-1):
    for name in hierarchy_order(rig):
        pb = rig.pose.bones.get(name)
        if pb is None or name not in pose:
            continue
        spec = pose[name]
        aim(rig, pb, spec[0], spec[1] if len(spec) > 1 else 0.0)
        bpy.context.view_layer.update()
    # Verify: read each posed bone's achieved direction back. Without this a silently
    # wrong basis looks plausible in the numbers and only shows up in a render.
    for name, spec in pose.items():
        pb = rig.pose.bones.get(name)
        if pb is None:
            continue
        got = rig.matrix_world.to_3x3() @ (pb.tail - pb.head)
        err = (math.degrees(Vector(spec[0]).normalized().angle(got))
               if got.length > 1e-6 else 999.0)
        if err > WORST["err"]:
            WORST.update(err=err, bone=name, frame=frame)


def shift_root(rig, offset):
    """Move the figure by a WORLD offset. root.location is in the BONE's axes and root
    points up, so its local Y is world +Z; writing world numbers straight in sends the
    creature sideways when you meant forward."""
    root = rig.pose.bones.get("root")
    if root is None:
        return
    basis = (rig.matrix_world @ root.bone.matrix_local).to_3x3().normalized()
    root.location = basis.inverted() @ Vector(offset)


def build(rig, clip, beats):
    if clip in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[clip])
    if rig.animation_data is None:
        rig.animation_data_create()
    act = bpy.data.actions.new(clip)
    rig.animation_data.action = act
    if hasattr(rig.animation_data, "action_slot") and act.slots:
        rig.animation_data.action_slot = act.slots[0]
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    for frame, pose in beats:
        for pb in rig.pose.bones:
            pb.matrix_basis = Matrix()
        bpy.context.view_layer.update()
        apply_pose(rig, pose, frame)
        shift_root(rig, pose.get("_shift", (0.0, 0.0, 0.0)))
        root = rig.pose.bones.get("root")
        if root is not None:
            root.keyframe_insert("location", frame=frame)
        for pb in rig.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame)
    for fc in [c for lay in act.layers for st in lay.strips
               for bag in st.channelbags for c in bag.fcurves]:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        fc.update()


def damp(clips, bones, gain):
    """Scale a bone's rotation ANGLE about its own axis in existing clips, which deepens
    or shallows a pose without moving any keyframe in time, so loop points stay exact."""
    n = 0
    for name in clips:
        act = bpy.data.actions.get(name)
        if act is None:
            continue
        for bone in bones:
            quad = channel(act, bone)
            if quad is None:
                continue
            for i in range(len(quad[0].keyframe_points)):
                q = Quaternion([fc.keyframe_points[i].co[1] for fc in quad])
                if q.magnitude < 1e-9:
                    continue
                q.normalize()
                if abs(q.angle) < 1e-5:
                    continue
                write_key(quad, i, Quaternion(q.axis, q.angle * gain))
            for fc in quad:
                fc.update()
            n += 1
    return n


def mirror(left):
    out = {}
    for base, spec in left.items():
        d = spec[0]
        twist = spec[1] if len(spec) > 1 else 0.0
        out[f"{base}.l"] = (V(d[0], d[1], d[2]), twist)
        out[f"{base}.r"] = (V(-d[0], d[1], d[2]), -twist)
    return out


def horror_clips(rig):
    """A brute that swings from the hip: about 180 degrees of horizontal arc, hips and
    chest leading the arm so the blow is the body arriving rather than a forearm flick.

    Twist is graded UP the spine rather than shared evenly. The feet are planted, so the
    hips can only give a little and the coil has to live in spine and chest; twisting the
    hips as hard as the chest wrenched the planted legs and bent the body into a crescent.
    Torso pitch stays shallow because this creature's head is a third of its height, so
    real forward pitch reads as face-planting, not effort.
    """
    def legs(spread=0.30, crouch=-0.94):
        return {
            "upperleg.l": (V(spread, -0.06, crouch),), "lowerleg.l": (V(0.04, 0.10, -1),),
            "foot.l": (V(0.02, -0.90, -0.35),),
            "upperleg.r": (V(-spread, -0.06, crouch),), "lowerleg.r": (V(-0.04, 0.10, -1),),
            "foot.r": (V(-0.02, -0.90, -0.35),),
        }

    def P(torso, arms, shift=(0, 0, 0), spread=0.30, crouch=-0.94):
        p = dict(legs(spread, crouch))
        p.update(torso)
        p.update(arms)
        p["_shift"] = shift
        return p

    ready = P(
        {"hips": (V(0, 0, 1), 0), "spine": (V(0, -0.10, 1), 0),
         "chest": (V(0, -0.14, 1), 0), "head": (V(0, -0.26, 1), 0)},
        {"upperarm.l": (V(0.85, -0.45, -0.28),), "lowerarm.l": (V(0.35, -0.90, -0.25),),
         "hand.l": (V(0.20, -0.95, -0.22),),
         "upperarm.r": (V(-0.85, -0.45, -0.28),), "lowerarm.r": (V(-0.35, -0.90, -0.25),),
         "hand.r": (V(-0.20, -0.95, -0.22),)})
    wind = P(
        {"hips": (V(0, 0.04, 1), -14), "spine": (V(0.10, 0.12, 1), -24),
         "chest": (V(0.14, 0.18, 1), -34), "head": (V(-0.14, -0.30, 1), 28)},
        {"upperarm.r": (V(-0.34, 0.86, 0.38),), "lowerarm.r": (V(-0.18, 0.52, 0.84),),
         "hand.r": (V(-0.12, 0.34, 0.93),),
         "upperarm.l": (V(0.78, -0.34, -0.52),), "lowerarm.l": (V(0.28, -0.86, -0.42),),
         "hand.l": (V(0.14, -0.92, -0.36),)},
        shift=(-0.05, 0.16, -0.05))
    mid = P(
        {"hips": (V(0, 0, 1), 2), "spine": (V(0.02, -0.04, 1), 6),
         "chest": (V(-0.04, -0.14, 1), 10), "head": (V(-0.04, -0.34, 1), -4)},
        {"upperarm.r": (V(-0.99, -0.10, 0.08),), "lowerarm.r": (V(-0.90, -0.44, 0.04),),
         "hand.r": (V(-0.78, -0.62, 0.0),),
         "upperarm.l": (V(0.72, 0.40, -0.58),), "lowerarm.l": (V(0.24, -0.50, -0.82),),
         "hand.l": (V(0.10, -0.66, -0.74),)},
        shift=(0.02, -0.06, 0.02))
    contact = P(
        {"hips": (V(0, -0.03, 1), 14), "spine": (V(-0.10, -0.12, 1), 22),
         "chest": (V(-0.16, -0.20, 1), 32), "head": (V(-0.12, -0.32, 1), -26)},
        {"upperarm.r": (V(-0.20, -0.97, -0.12),), "lowerarm.r": (V(0.42, -0.88, -0.22),),
         "hand.r": (V(0.66, -0.70, -0.24),),
         "upperarm.l": (V(0.60, 0.60, -0.52),), "lowerarm.l": (V(0.28, -0.26, -0.92),),
         "hand.l": (V(0.12, -0.46, -0.88),)},
        shift=(0.06, -0.20, -0.10), spread=0.34, crouch=-0.88)
    follow = P(
        {"hips": (V(-0.03, -0.02, 1), 20), "spine": (V(-0.14, -0.08, 1), 30),
         "chest": (V(-0.24, -0.12, 1), 42), "head": (V(-0.20, -0.28, 1), -34)},
        {"upperarm.r": (V(0.52, -0.80, -0.30),), "lowerarm.r": (V(0.86, -0.42, -0.30),),
         "hand.r": (V(0.94, -0.22, -0.26),),
         "upperarm.l": (V(0.46, 0.74, -0.48),), "lowerarm.l": (V(0.32, -0.06, -0.94),),
         "hand.l": (V(0.18, -0.30, -0.92),)},
        shift=(0.08, -0.14, -0.06), spread=0.32, crouch=-0.90)
    recover = dict(ready)
    recover.update({"hips": (V(0, 0, 1), 14), "spine": (V(-0.06, -0.10, 1), 12),
                    "chest": (V(-0.12, -0.14, 1), 16), "_shift": (0.02, -0.04, 0.0)})

    # Timing carries the impact: a wind-up that HOLDS, then only 3 frames from full
    # extension to contact, then a slow settle. Even spacing reads as a shove.
    build(rig, "1H_Melee_Attack_Chop", [
        (0, ready), (9, wind), (14, wind), (18, mid), (21, contact), (27, follow),
        (34, recover), (40, ready)])

    def dg(p, **over):
        q = dict(p)
        q.update(over)
        return q

    # The diagonal comes over the top and finishes low across the body, so the two
    # attacks are different shapes rather than one move played twice.
    build(rig, "1H_Melee_Attack_Slice_Diagonal", [
        (0, ready),
        (8, dg(wind, **{"upperarm.r": (V(-0.40, 0.35, 0.85),),
                        "lowerarm.r": (V(-0.22, 0.20, 0.95),),
                        "hand.r": (V(-0.15, 0.10, 0.98),)})),
        (12, dg(wind, **{"upperarm.r": (V(-0.45, 0.20, 0.88),),
                         "lowerarm.r": (V(-0.25, 0.10, 0.96),),
                         "hand.r": (V(-0.18, 0.02, 0.98),)})),
        (17, dg(mid, **{"upperarm.r": (V(-0.80, -0.40, 0.45),),
                        "lowerarm.r": (V(-0.62, -0.66, 0.42),),
                        "hand.r": (V(-0.50, -0.80, 0.34),)})),
        (20, dg(contact, **{"upperarm.r": (V(-0.34, -0.86, -0.38),),
                            "lowerarm.r": (V(0.20, -0.80, -0.56),),
                            "hand.r": (V(0.45, -0.66, -0.60),)})),
        (26, dg(follow, **{"upperarm.r": (V(0.30, -0.70, -0.65),),
                           "lowerarm.r": (V(0.66, -0.40, -0.64),),
                           "hand.r": (V(0.80, -0.24, -0.55),)})),
        (33, recover), (39, ready)])


def riftspawn_clips(rig):
    """Four arms, so the blow is a converging RAKE rather than one swing: all four coil
    back and wide together, then whip forward so the claws arrive on one point.

    They converge in HEIGHT while staying apart in WIDTH. Aiming all four at the same
    forward vector is the obvious reading of "converge" and it looks like the creature
    hugging itself: four long limbs off a narrow torso all pointing one way pile up and
    the strike disappears into a tangle.
    """
    ARMS = [b for b in (f"{l}{p}.{s}" for l in ("upperarm", "lowerarm", "wrist", "hand")
                        for p in ("", "2") for s in ("l", "r")) if b in rig.pose.bones]
    # Every shipped clip is retargeted human motion that swings the arms to a human's
    # positions. On a body holding two pairs of arms wide that destroys the silhouette AND
    # drags the chest-to-arm weight boundary through 100+ degrees, which tore it.
    LOCO = ["Idle", "Walking_A", "Walking_Backwards", "Running_A", "Running_Strafe_Left",
            "Running_Strafe_Right", "Block", "Cheer", "Jump_Idle", "Death_A",
            "Spellcasting", "Spellcast_Raise", "Spellcast_Shoot", "2H_Ranged_Shoot",
            "Sit_Floor_Down", "Sit_Floor_Idle", "Lie_Idle", "Dualwield_Melee_Attack_Chop",
            "2H_Melee_Attack_Chop", "Hit_A"]
    print(f"  DAMPED {damp(LOCO, ARMS, 0.30)} arm channels across {len(LOCO)} clips")
    # The head gets the same treatment as the arms, for the same reason. The
    # retargeted human head channel pitches the skull forward through locomotion,
    # and on this silhouette (a giant antlered skull over a hunched neck, with the
    # mane shards riding the head bone) that pitch buries the FACE under the mane
    # every stride: judged side by side in renders, the walk reads as a face-plant.
    # The earlier shipped build dodged this only by defect, its skull was weighted
    # to `chest` (which barely pitches) instead of `head`; once the solver assigns
    # the skull correctly, the clip has to be tamed here instead.
    print(f"  DAMPED {damp(LOCO, ['head'], 0.35)} head channels across {len(LOCO)} clips")

    def P(torso, arms, shift=(0, 0, 0), crouch=-0.97, spread=0.16):
        p = {
            "upperleg.l": (V(spread, -0.04, crouch),), "lowerleg.l": (V(0.02, 0.06, -1),),
            "foot.l": (V(0.0, -0.92, -0.30),),
            "upperleg.r": (V(-spread, -0.04, crouch),), "lowerleg.r": (V(-0.02, 0.06, -1),),
            "foot.r": (V(0.0, -0.92, -0.30),),
        }
        p.update(torso)
        p.update(mirror(arms))
        p["_shift"] = shift
        return p

    ready = P({"hips": (V(0, 0, 1), 0), "spine": (V(0, -0.05, 1), 0),
               "chest": (V(0, -0.08, 1), 0), "head": (V(0, -0.16, 1), 0)},
              {"upperarm": (V(0.86, -0.18, 0.44),), "lowerarm": (V(0.70, -0.46, 0.52),),
               "wrist": (V(0.60, -0.56, 0.54),), "hand": (V(0.54, -0.62, 0.54),),
               "upperarm2": (V(0.90, -0.12, -0.30),), "lowerarm2": (V(0.74, -0.42, -0.42),),
               "wrist2": (V(0.64, -0.54, -0.46),), "hand2": (V(0.58, -0.60, -0.48),)})
    wind = P({"hips": (V(0, 0.05, 1), 0), "spine": (V(0, 0.12, 1), 0),
              "chest": (V(0, 0.18, 1), 0), "head": (V(0, -0.30, 1), 0)},
             {"upperarm": (V(0.62, 0.70, 0.36),), "lowerarm": (V(0.42, 0.84, 0.34),),
              "wrist": (V(0.32, 0.90, 0.30),), "hand": (V(0.26, 0.93, 0.26),),
              "upperarm2": (V(0.70, 0.64, -0.32),), "lowerarm2": (V(0.48, 0.80, -0.36),),
              "wrist2": (V(0.36, 0.88, -0.32),), "hand2": (V(0.30, 0.91, -0.28),)},
             shift=(0, 0.14, -0.02), crouch=-0.94, spread=0.20)
    strike = P({"hips": (V(0, 0, 1), 0), "spine": (V(0, -0.06, 1), 0),
                "chest": (V(0, -0.12, 1), 0), "head": (V(0, -0.32, 1), 0)},
               {"upperarm": (V(0.96, -0.20, 0.20),), "lowerarm": (V(0.84, -0.52, 0.16),),
                "wrist": (V(0.70, -0.70, 0.12),), "hand": (V(0.62, -0.78, 0.08),),
                "upperarm2": (V(0.96, -0.18, -0.18),), "lowerarm2": (V(0.84, -0.50, -0.18),),
                "wrist2": (V(0.70, -0.68, -0.16),), "hand2": (V(0.62, -0.76, -0.12),)},
               shift=(0, -0.08, 0.02), crouch=-0.98)
    contact = P({"hips": (V(0, -0.04, 1), 0), "spine": (V(0, -0.16, 1), 0),
                 "chest": (V(0, -0.28, 1), 0), "head": (V(0, -0.34, 1), 0)},
                {"upperarm": (V(0.50, -0.82, 0.28),), "lowerarm": (V(0.34, -0.92, 0.18),),
                 "wrist": (V(0.24, -0.96, 0.12),), "hand": (V(0.18, -0.97, 0.08),),
                 "upperarm2": (V(0.52, -0.81, -0.28),), "lowerarm2": (V(0.36, -0.91, -0.20),),
                 "wrist2": (V(0.26, -0.95, -0.14),), "hand2": (V(0.20, -0.97, -0.10),)},
                shift=(0, -0.30, -0.06), crouch=-0.92, spread=0.22)
    follow = P({"hips": (V(0, -0.03, 1), 0), "spine": (V(0, -0.18, 1), 0),
                "chest": (V(0, -0.30, 1), 0), "head": (V(0, -0.26, 1), 0)},
               {"upperarm": (V(0.44, -0.78, -0.42),), "lowerarm": (V(0.28, -0.84, -0.46),),
                "wrist": (V(0.22, -0.86, -0.46),), "hand": (V(0.18, -0.87, -0.46),),
                "upperarm2": (V(0.46, -0.74, -0.48),), "lowerarm2": (V(0.30, -0.80, -0.52),),
                "wrist2": (V(0.24, -0.82, -0.52),), "hand2": (V(0.20, -0.83, -0.52),)},
               shift=(0, -0.24, -0.12), crouch=-0.88, spread=0.24)

    build(rig, "1H_Melee_Attack_Chop", [
        (0, ready), (8, wind), (13, wind), (17, strike), (21, contact), (27, follow),
        (34, ready)])

    def over(p, **kw):
        q = dict(p)
        q.update(mirror(kw))
        return q

    # The diagonal leads with the UPPER pair overhead and brings the lower pair up from
    # below, so the two attacks are different shapes.
    build(rig, "1H_Melee_Attack_Slice_Diagonal", [
        (0, ready),
        (8, over(wind, upperarm=(V(0.40, 0.42, 0.82),), lowerarm=(V(0.24, 0.30, 0.92),),
                 wrist=(V(0.18, 0.20, 0.96),), hand=(V(0.14, 0.14, 0.98),),
                 upperarm2=(V(0.72, 0.50, -0.48),), lowerarm2=(V(0.50, 0.66, -0.56),),
                 wrist2=(V(0.38, 0.76, -0.52),), hand2=(V(0.32, 0.82, -0.48),))),
        (12, over(wind, upperarm=(V(0.44, 0.28, 0.86),), lowerarm=(V(0.26, 0.16, 0.95),),
                  wrist=(V(0.20, 0.08, 0.98),), hand=(V(0.16, 0.02, 0.99),),
                  upperarm2=(V(0.74, 0.42, -0.52),), lowerarm2=(V(0.52, 0.60, -0.60),),
                  wrist2=(V(0.40, 0.70, -0.58),), hand2=(V(0.34, 0.76, -0.54),))),
        (17, over(strike, upperarm=(V(0.72, -0.42, 0.55),), lowerarm=(V(0.54, -0.70, 0.46),),
                  wrist=(V(0.44, -0.82, 0.36),), hand=(V(0.38, -0.88, 0.28),),
                  upperarm2=(V(0.80, -0.40, -0.44),), lowerarm2=(V(0.60, -0.68, -0.42),),
                  wrist2=(V(0.48, -0.80, -0.36),), hand2=(V(0.42, -0.86, -0.30),))),
        (21, over(contact, upperarm=(V(0.20, -0.88, -0.44),), lowerarm=(V(0.02, -0.86, -0.52),),
                  wrist=(V(-0.14, -0.84, -0.52),), hand=(V(-0.22, -0.82, -0.52),),
                  upperarm2=(V(0.28, -0.86, 0.42),), lowerarm2=(V(0.08, -0.88, 0.48),),
                  wrist2=(V(-0.10, -0.88, 0.46),), hand2=(V(-0.18, -0.86, 0.46),))),
        (27, follow), (34, ready)])


CLIPS = {"horror": horror_clips, "riftspawn": riftspawn_clips}


def run(key, src_dir, out_dir):
    spec = SPECS[key]
    src = os.path.join(src_dir, spec["src"])
    out = os.path.join(out_dir, spec["src"])
    if os.path.abspath(src) == os.path.abspath(out):
        raise SystemExit(
            f"refusing to write over the source ({src}): stage 2 retargets the clips onto "
            "a new rest pose, so running it on its own output applies the correction twice"
        )
    print(f"== {key}  {src} -> {out}")
    wipe()
    body, rig = load(src)
    # VOID_SKIP_CLAWS=1 for a source whose talons are ALREADY curled. The
    # preserved Riftspawn pristine source (tmp/void_src/riftspawn_antler.glb,
    # a post-stage-1 snapshot carrying the hand-done mane edit) is such a file;
    # running stage 1 on it would curl every talon a second time.
    if spec["claws"] and not os.environ.get("VOID_SKIP_CLAWS"):
        curl_claws(body, rig, spec["claws"])
    rebuild_rig(body, rig, spec)
    rig.data.pose_position = "POSE"
    bpy.context.view_layer.objects.active = rig
    CLIPS[key](rig)
    print(f"  AIM CHECK worst_error={WORST['err']:.2f}deg on {WORST['bone']} "
          f"frame={WORST['frame']}")
    assert WORST["err"] < 2.0, "a bone did not reach its requested world direction"
    for o in bpy.data.objects:
        o.select_set(o.type in ("MESH", "ARMATURE"))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="ACTIONS",
        export_apply=False, export_skins=True, export_yup=True)
    print(f"  WROTE {out} bytes={os.path.getsize(out)} clips={len(bpy.data.actions)}")


SRC_DIR = os.environ.get("VOID_SRC")
OUT_DIR = os.environ.get("VOID_OUT")
if not SRC_DIR or not OUT_DIR:
    raise SystemExit("set VOID_SRC (pristine sources) and VOID_OUT (destination)")
SRC_DIR = os.path.join(REPO, SRC_DIR) if not os.path.isabs(SRC_DIR) else SRC_DIR
OUT_DIR = os.path.join(REPO, OUT_DIR) if not os.path.isabs(OUT_DIR) else OUT_DIR

MEMBER = os.environ.get("VOID_MEMBER", "all")
for k in (list(SPECS) if MEMBER == "all" else MEMBER.split(",")):
    if k not in SPECS:
        raise SystemExit(f"unknown void creature: {k}")
    WORST.update(err=-1.0, bone="", frame=-1)
    run(k, SRC_DIR, OUT_DIR)
