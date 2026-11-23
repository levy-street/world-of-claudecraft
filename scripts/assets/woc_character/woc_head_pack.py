# WOC head pack builder: turns one Face Studio head authoring file into the game's
# head pack GLB for one body type, fitted onto the character rig's `head` bone.
#
# Run headless on the CHARACTER blend (read-only; this script never saves it):
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b \
#     "<WOC Armor Studio>/claude-animation-20260924/WOC_Characters_Anim_v01.blend" \
#     --python scripts/assets/woc_character/woc_head_pack.py -- \
#     --type a --out <raw.glb> --report <report.json> [--review <dir>] [--refit]
#
# then compress with scripts/assets/woc_character/woc_head_pack_compress.mjs and merge the
# report with woc_head_pack_report.mjs.
#
# What it does, per type (Type A = male rig + head-options-20260929/WOC_Male_Expanded.blend,
# Type B = female rig + WOC_Female_Expanded.blend):
#   1. retires the pieces an earlier placement left in the character blend (the
#      `HEADS | Type <T>` collections: every datablock gets a __v1 suffix, so this build's
#      names are exact and the v1 pieces stay available for before/after renders);
#   2. appends the worn look (`FSC | Character`) and every library variant (`FSC | Library`)
#      from the head file, keeping shape keys and packed images, plus the un-recoloured
#      source image behind every Face Studio "live" recolour;
#   3. fits the head space onto the old rigid head: the v1 export's similarity (uniform scale
#      plus translation) is PINNED so the in-game seat is unchanged; the landmark solve (eye
#      fronts, mouth front, scalp crown) is re-run and reported next to it (--refit uses it);
#   4. per piece: bakes the fit into the mesh data (basis and every shape key), zeroes the
#      key values, decimates to the web budget while keeping UVs (per material part for the
#      eyes' thin lid / globe / liner shells, one joint pass for hair so the smooth scalp cap
#      gives its triangles to the strands), then rebuilds every live shape key on the
#      decimated mesh by closest-point barycentric interpolation of the original key deltas
#      on the same material's surface (all-zero keys are not rebuilt);
#   5. places every piercing with Face Studio's own socket rule (clay_rig.anchor: raycasts on
#      the evaluated head, lips, nose, brow and eye, ear-band means) on the catalog default
#      look, and carries each slider that moves a socket (the lip with FS_Chin_Softness, the
#      brow with the eye and brow sliders) as a rigid-motion morph target on that piercing;
#   6. picks textures (every tinted material ships the un-recoloured source paint, never the
#      head file's last Face Studio recolour), downscales them per role,
#      shares byte-identical images (the seven beards cut from one source share one atlas),
#      and renames every material with its tint-role prefix (skin_, eye_, liner_, brow_,
#      hair_, metal_; a hairstyle's scalp cap is hair_<id>_scalp, a beard hair_beard_<id>);
#   7. names nodes per src/render/characters/woc_head_catalog.ts, parents every piece to the
#      rig's `head` bone keeping its world transform, and exports ONLY the rig plus the
#      pieces (morph targets on, no animations, no skins on the pieces);
#   8. verifies the written GLB JSON and writes the report (tris, materials and roles, morph
#      names and source slider ranges, textures, fit, default look, piercing sockets, cover
#      poke-through, neck-vs-body margins), then the optional review renders
#      (woc_head_pack_review.py).
import bpy
import hashlib
import json
import math
import os
import struct
import sys

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ARMOR_STUDIO = os.path.expanduser('~/Documents/WOC Armor Studio')
HEAD_OPTIONS = ARMOR_STUDIO + '/head-options-20260929'

BEARDS = ['moustache', 'handlebar', 'goatee', 'chin', 'boxed', 'long', 'chops', 'chinstrap']

TYPES = {
    'a': {
        'head_blend': HEAD_OPTIONS + '/WOC_Male_Expanded.blend',
        'rig': 'WOC_Rig_Male',
        'old_head': 'Head',
        'old_eye_l': 'Eye_02',
        'old_eye_r': 'Eye_01',
        'old_mouth': 'Lips',
        'old_pieces': ['Head', 'Hair', 'Eye_01', 'Eye_02', 'Lips'],
        'body': 'Body',
        'bodies': ['Body', 'Druid_Body_Male', 'Hunter_Body_Male', 'Mage_Body_Male', 'Paladin_Body_Male',
                   'Holy_Priest_Body_Male', 'Rogue_Body_Male', 'Shaman_Body_Male', 'Warlock_Body_Male'],
        'chest': ['breatplate_Front', 'breatplate_Back', 'Shoulder_L', 'Shoulder_R'],
        'covers': ['Helm', 'Paladin_Helm', 'Mage_Hood_Male'],
        'slots': {
            # ponytail, braid, waves: the female head's styles, fitted onto this head 2026-10-01
            # (owner: "use a few of the female hairs as options for male and vice versa";
            # head-options-20260929/hair-snug-20261001/tools/hair_transfer.py)
            'hair': ['swept', 'long', 'mohawk', 'quiff', 'undercut', 'topknot', 'shoulder',
                     'ponytail', 'braid', 'waves'],
            'beard': BEARDS,
            'nose': ['default', 'broad', 'aquiline'],
            'mouth': ['default', 'full', 'smirk'],
            'brows': ['default', 'slim', 'arched', 'relaxed', 'soft_arch', 'rounded'],
            'ears': ['default', 'large', 'pointed'],
            'eyes': ['default', 'almond', 'hooded'],
        },
        # catalog id -> Face Studio library key, where they differ
        'lib_keys': {'hair': {'quiff': 'm_quiff', 'undercut': 'm_undercut', 'topknot': 'm_topknot',
                              'shoulder': 'm_long'}},
        'defaults': {'hair': 'swept', 'beard': 'boxed', 'nose': 'default', 'mouth': 'default',
                     'brows': 'relaxed', 'ears': 'default', 'eyes': 'default'},
        # the v1 pack's landmark fit (2026-09-29 export), pinned so the in-game seat holds
        'pinned_fit': {'scale': 0.21763017761645112,
                       'translation': (0.0001449901300140121, -0.03276627937434976, 0.9599736428876959)},
        # 2026-10-01 owner: the neck read long and its open bottom showed above the collar at the
        # throat (the rim sat 0.0015 above the body there in the Idle, 0.0035 when the head
        # turns). The whole head seats this much lower (rig units, down the Z axis) than the pinned
        # fit: the rim sinks 0.005+ into the body in every upright pose and the visible front neck
        # shortens ~18%. The male helms and hoods in the character blend dropped by the same
        # amount (their head-weighted part), so every cover keeps its fit to the head.
        'seat_drop': 0.008,
        'v1_defaults': {'hair': 'swept', 'nose': 'default', 'mouth': 'default', 'brows': 'default',
                        'ears': 'default', 'eyes': 'default'},
    },
    'b': {
        'head_blend': HEAD_OPTIONS + '/WOC_Female_Expanded.blend',
        'rig': 'WOC_Rig_Female',
        'old_head': 'Female_Head',
        'old_eye_l': 'Female_Eye_02',
        'old_eye_r': 'Female_Eye_01',
        'old_mouth': 'Female_Lips',
        'old_pieces': ['Female_Head', 'Female_Hair_01', 'Female_Eye_01', 'Female_Eye_02',
                       'Female_Lips', 'Eyebrow', 'Eyebrow_R'],
        'body': 'Female_Warrior_Body',
        'bodies': ['Female_Warrior_Body', 'Druid_Body_Female', 'Hunter_Body_Female', 'Mage_Body_Female',
                   'Female_Paladin_Body', 'Holy_Priest_Body_Female', 'Rogue_Body_Female',
                   'Shaman_Body_Female', 'Warlock_Body_Female'],
        'chest': ['Female_Warrior_Chest_Front', 'Female_Warrior_Chest_Back', 'Female_Warrior_Shoulder_L',
                  'Female_Warrior_Shoulder_R'],
        'covers': ['Female_Warrior_Helm', 'Female_Paladin_Helm', 'Mage_Hood_Female'],
        'slots': {
            # undercut, topknot, shoulder: the male head's styles, fitted onto this head 2026-10-01
            'hair': ['waves', 'ponytail', 'braid', 'bob', 'crown', 'twins', 'curls',
                     'undercut', 'topknot', 'shoulder'],
            'beard': BEARDS,
            'nose': ['default', 'button', 'soft'],
            'mouth': ['default', 'full', 'relaxed', 'cupids_bow', 'narrow', 'thin', 'rounded'],
            'brows': ['default', 'soft', 'straight', 'relaxed', 'soft_arch', 'rounded'],
            'ears': ['default', 'round', 'pointed'],
            'eyes': ['default', 'almond', 'hooded'],
        },
        'lib_keys': {'hair': {'bob': 'f_bob', 'crown': 'f_crown', 'twins': 'f_twins', 'curls': 'f_curls',
                              'undercut': 'm_undercut', 'topknot': 'm_topknot', 'shoulder': 'm_long'}},
        'defaults': {'hair': 'braid', 'beard': 'none', 'nose': 'default', 'mouth': 'default',
                     'brows': 'relaxed', 'ears': 'default', 'eyes': 'default'},
        'pinned_fit': {'scale': 0.22601804307744297,
                       'translation': (0.01128333483353749, -0.0024078673534887185, 0.9574353321388986)},
        'v1_defaults': {'hair': 'waves', 'nose': 'default', 'mouth': 'default', 'brows': 'default',
                        'ears': 'default', 'eyes': 'default'},
        # Type B's per-type texture caps: the size budget (3.5 MB a pack) is met by trimming the
        # least visible maps (the scalp cap under the hair, the beards, the detailed female brow
        # paint, the six eyelid shells) rather than raising the KTX2 RDO on every texture
        'tex_caps': {'scalp': 128, 'beard': 320, 'brows': 320, 'eyes': 320},
    },
}

PIERCING_SITES = ['lobe_l', 'lobe_r', 'rim_l', 'rim_r', 'nostril', 'septum', 'brow', 'lip']
# catalog slot -> Face Studio library slot
LIB_SLOT = {'hair': 'hair', 'beard': 'beard', 'nose': 'nose', 'mouth': 'mouth', 'brows': 'brow',
            'ears': 'ear', 'eyes': 'eye'}
PAIRED = {'brows', 'ears', 'eyes'}
NO_MESH = {'hair': 'bald', 'beard': 'none'}
# worn object stem per catalog slot (FSC_<stem>[_L|_R])
WORN_STEM = {'hair': 'Hair', 'beard': 'Beard', 'nose': 'Nose', 'mouth': 'Mouth', 'brows': 'Brow',
             'ears': 'Ear', 'eyes': 'Eye'}
# triangle budgets
BUDGET = {'base': 3000, 'hair': 3500, 'beard': 1500, 'nose': 600, 'mouth': 900, 'eyes': 1000,
          'ears': 700, 'brows': 400}
# slots decimated in one joint pass (every other multi-material piece goes per material part)
JOINT_DECIMATE = {'hair'}
# texture size caps per slot, and per role suffix for the procedural scalp cap
TEX_MAX = {'base': 1024, 'hair': 512, 'beard': 384}
TEX_MAX_SCALP = 256
TEX_MAX_DEFAULT = 384
# roles whose texture ships as the un-recoloured source paint, never a Face Studio "live" copy:
# a live copy is whatever colour the variant had when it was last worn in the owner's session
# (near-black female brows and beards, clipped blonde twins, a blue default eyelid), while the
# runtime recolours every tinted role itself against the shipped texture's own median
SOURCE_PAINT_PREFIXES = ('hair_', 'brow_', 'skin_', 'eye_')
# a morph whose largest vertex delta is below this (metres, after the fit) is not shipped
KEY_EPS = 1e-6
# Face Studio's piercing scale (clay_rig.apply_piercings)
PIERCE_SCALE = 1.25
# every slider that can move a socket surface is a candidate piercing morph
PIERCE_MORPH_MIN = 5e-5


def log(*a):
    print('[head_pack]', *a, flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'type': 'a', 'out': None, 'report': None, 'review': None, 'render': True, 'refit': False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--type':
            opts['type'] = argv[i + 1]; i += 1
        elif a == '--out':
            opts['out'] = argv[i + 1]; i += 1
        elif a == '--report':
            opts['report'] = argv[i + 1]; i += 1
        elif a == '--review':
            opts['review'] = argv[i + 1]; i += 1
        elif a == '--no-render':
            opts['render'] = False
        elif a == '--refit':
            opts['refit'] = True
        i += 1
    if opts['type'] not in TYPES or not opts['out']:
        raise SystemExit('usage: -- --type a|b --out <glb> [--report <json>] [--review <dir>] [--refit]')
    return opts


def lib_key(T, slot, variant):
    return T.get('lib_keys', {}).get(slot, {}).get(variant, variant)


def variant_nodes(L, slot, variant):
    """Catalog node names one slot variant draws ([] for bald / clean shaven / unset)."""
    if variant is None or NO_MESH.get(slot) == variant:
        return []
    stem = 'WocHead_%s_%s_%s' % (L, slot, variant)
    return [stem + '_L', stem + '_R'] if slot in PAIRED else [stem]


# ----------------------------------------------------------------------------- mesh helpers

def mesh_co(me):
    a = np.zeros(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def world_co(obj):
    """World-space vertex positions of an object's evaluated mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    oe = obj.evaluated_get(dg)
    me = oe.to_mesh()
    co = mesh_co(me)
    M = np.array(oe.matrix_world)
    out = co @ M[:3, :3].T + M[:3, 3]
    me.calc_loop_triangles()
    t = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', t)
    oe.to_mesh_clear()
    return out, t.reshape(-1, 3)


def tri_count(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def tris_with_material(me):
    me.calc_loop_triangles()
    t = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', t)
    mi = np.zeros(len(me.loop_triangles), dtype=np.int64)
    me.loop_triangles.foreach_get('material_index', mi)
    return t.reshape(-1, 3), mi


def key_arrays(me):
    """(basis coords, {name: delta}, {name: meta}) of a mesh's relative shape keys."""
    base = mesh_co(me)
    deltas, meta = {}, {}
    if me.shape_keys:
        kb = me.shape_keys.key_blocks
        ref = me.shape_keys.reference_key
        refco = np.zeros(len(me.vertices) * 3)
        ref.data.foreach_get('co', refco)
        base = refco.reshape(-1, 3)
        for k in kb:
            if k == ref:
                continue
            c = np.zeros(len(me.vertices) * 3)
            k.data.foreach_get('co', c)
            d = c.reshape(-1, 3) - base
            deltas[k.name] = d
            meta[k.name] = {'slider_min': round(k.slider_min, 4), 'slider_max': round(k.slider_max, 4),
                            'source_value': round(k.value, 4), 'relative_key': k.relative_key.name,
                            'max_delta_m': round(float(np.linalg.norm(d, axis=1).max()), 6)}
    return base, deltas, meta


def rebuild_keys(obj, orig_base, orig_tris, orig_mat, deltas, key_order):
    """Rebuild shape keys on obj (whose mesh has no keys) from the original piece's key deltas
    by closest-point barycentric interpolation on the original basis surface, matching each
    new vertex against the original triangles of its own material part."""
    if not key_order:
        return 0.0
    me = obj.data
    new_co = mesh_co(me)
    ntri, nmi = tris_with_material(me)
    vmat = np.full(len(new_co), -1, dtype=np.int64)
    vmat[ntri[:, 0]] = nmi
    vmat[ntri[:, 1]] = nmi
    vmat[ntri[:, 2]] = nmi
    trees = {}
    for m in np.unique(orig_mat):
        sel = np.nonzero(orig_mat == m)[0]
        trees[int(m)] = (BVHTree.FromPolygons([tuple(v) for v in orig_base], [tuple(t) for t in orig_tris[sel]]), sel)
    every = (BVHTree.FromPolygons([tuple(v) for v in orig_base], [tuple(t) for t in orig_tris]),
             np.arange(len(orig_tris)))
    idx = np.zeros(len(new_co), dtype=np.int64)
    loc = np.zeros((len(new_co), 3))
    maxd = 0.0
    for i, p in enumerate(new_co):
        tree, sel = trees.get(int(vmat[i]), every)
        hit, _n, fi, dist = tree.find_nearest(Vector(p))
        if hit is None:
            tree, sel = every
            hit, _n, fi, dist = tree.find_nearest(Vector(p))
        idx[i] = sel[fi]
        loc[i] = hit
        maxd = max(maxd, dist)
    tri = orig_tris[idx]
    a, b, c = orig_base[tri[:, 0]], orig_base[tri[:, 1]], orig_base[tri[:, 2]]
    v0, v1, v2 = b - a, c - a, loc - a
    d00 = (v0 * v0).sum(1); d01 = (v0 * v1).sum(1); d11 = (v1 * v1).sum(1)
    d20 = (v2 * v0).sum(1); d21 = (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    den[np.abs(den) < 1e-20] = 1e-20
    wv = (d11 * d20 - d01 * d21) / den
    ww = (d00 * d21 - d01 * d20) / den
    wu = 1.0 - wv - ww
    W = np.clip(np.stack([wu, wv, ww], 1), 0.0, 1.0)
    W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    obj.shape_key_add(name='Basis', from_mix=False)
    for name in key_order:
        d = deltas[name]
        nd = d[tri[:, 0]] * W[:, :1] + d[tri[:, 1]] * W[:, 1:2] + d[tri[:, 2]] * W[:, 2:3]
        kb = obj.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set('co', (new_co + nd).reshape(-1).astype(np.float32))
        kb.value = 0.0
    return maxd


def decimate_mesh_to(obj, target, joint=False):
    """Collapse-decimate obj's mesh (no shape keys on it) to <= target triangles. Multi-material
    pieces go per material part (so thin shells keep their share) unless joint. Returns the
    final triangle count."""
    me = obj.data
    total = tri_count(me)
    if total <= target:
        return total
    nmat = max(1, len(obj.material_slots))
    _t, mi = tris_with_material(me)
    per = np.bincount(mi, minlength=nmat)
    parts = [m for m in range(nmat) if per[m] > 0]
    if joint or len(parts) == 1:
        _decimate_obj(obj, target)
        return tri_count(obj.data)
    alloc = {}
    for m in parts:
        alloc[m] = max(min(int(per[m]), 60), int(target * per[m] / total))
    over = sum(alloc.values()) - target
    if over > 0:
        big = max(parts, key=lambda m: alloc[m])
        alloc[big] = max(60, alloc[big] - over)
    import bmesh
    pieces = []
    for m in parts:
        o2 = obj.copy()
        o2.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(o2)
        bm = bmesh.new()
        bm.from_mesh(o2.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != m], context='FACES')
        bm.to_mesh(o2.data)
        bm.free()
        _decimate_obj(o2, alloc[m])
        pieces.append(o2)
    bm = bmesh.new()
    for o2 in pieces:
        bm.from_mesh(o2.data)
    old = obj.data
    new = bpy.data.meshes.new(old.name + '_dec')
    bm.to_mesh(new)
    bm.free()
    for mat in old.materials:
        new.materials.append(mat)
    obj.data = new
    for o2 in pieces:
        d = o2.data
        bpy.data.objects.remove(o2)
        bpy.data.meshes.remove(d)
    return tri_count(obj.data)


def _decimate_obj(obj, target):
    for attempt in range(4):
        tris = tri_count(obj.data)
        if tris <= target:
            return
        mod = obj.modifiers.new('fsc_dec', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.use_collapse_triangulate = True
        mod.ratio = max(0.01, (target / tris) * (0.98 - 0.04 * attempt))
        dg = bpy.context.evaluated_depsgraph_get()
        new = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True,
                                              depsgraph=dg)
        obj.modifiers.remove(mod)
        old = obj.data
        obj.data = new
        if old.users == 0:
            bpy.data.meshes.remove(old)


# ----------------------------------------------------------------------------- fit

def landmark_front(co):
    """(bbox centre x, front-most y, bbox centre z) of a point set."""
    mn, mx = co.min(0), co.max(0)
    return np.array([(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2])


def landmark_crown(co):
    zmax = co[:, 2].max()
    h = zmax - co[:, 2].min()
    top = co[co[:, 2] > zmax - 0.02 * h]
    return np.array([top[:, 0].mean(), top[:, 1].mean(), zmax])


def globe_verts(obj):
    """Coords of the eyeball / painted-globe material's vertices of an eye piece."""
    me = obj.data
    gi = [i for i, s in enumerate(obj.material_slots)
          if s.material and ('eyeball' in s.material.name.lower() or 'globe' in s.material.name.lower())]
    co = mesh_co(me)
    if not gi:
        return co
    sel = set()
    for p in me.polygons:
        if p.material_index in gi:
            sel.update(p.vertices)
    return co[sorted(sel)]


def solve_similarity(P, Q):
    """Uniform scale s and translation t minimising sum |s P + t - Q|^2; plus the Umeyama
    rotation angle (degrees) a full similarity would have used."""
    pb, qb = P.mean(0), Q.mean(0)
    Pc, Qc = P - pb, Q - qb
    s = float((Pc * Qc).sum() / (Pc * Pc).sum())
    t = qb - s * pb
    H = Pc.T @ Qc
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    ang = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2))))
    return s, t, ang, R


# ----------------------------------------------------------------------------- piercings

def bvh_evaluated(objs):
    """One BVH over the evaluated (slider-deformed) meshes of several parts, in world space
    (Face Studio's clay_rig._bvh_evaluated)."""
    import bmesh
    bm = bmesh.new()
    dg = bpy.context.evaluated_depsgraph_get()
    for obj in objs:
        if obj is None or obj.type != 'MESH':
            continue
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        me.transform(obj.matrix_world)
        bm.from_mesh(me)
        ev.to_mesh_clear()
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    return bvh


def pierce_anchor(sid, head, parts):
    """(position, hole axis) in head space for a piercing socket, from live geometry: Face
    Studio's clay_rig.anchor replicated on explicit parts (ear_L, ear_R, nose, mouth, brow_R,
    eye_R), so it runs headless without the add-on. Uses the parts' current key values."""
    if sid in ('lobe_l', 'lobe_r', 'rim_l', 'rim_r'):
        side = sid[-1].upper()
        obj = parts.get('ear_' + side)
        if obj is None:
            return None
        p = np.array([v.co[:] for v in obj.data.vertices])
        sign = 1 if side == 'L' else -1
        outer = p[p[:, 0] * sign > np.percentile(p[:, 0] * sign, 60)]
        zmin, zmax = outer[:, 2].min(), outer[:, 2].max()
        if sid.startswith('lobe'):
            band = outer[outer[:, 2] < zmin + 0.18 * (zmax - zmin)]
        else:
            band = outer[(outer[:, 2] > zmax - 0.3 * (zmax - zmin)) & (outer[:, 1] > np.median(outer[:, 1]))]
        if not len(band):
            return None
        return Vector(band.mean(0)), Vector((sign, 0, 0))
    lm = head.data.get('fsc_landmarks')
    tip = list(lm['nose_tip']) if lm else [0.0, -0.417, 0.452]
    if sid in ('nostril', 'septum'):
        nose_bvh = bvh_evaluated([parts.get('nose'), head])
        if sid == 'nostril':
            loc, nrm, _, _ = nose_bvh.ray_cast(Vector((0.3, tip[1] + 0.035, tip[2] - 0.008)), Vector((-1, 0, 0)))
            if loc is None or abs(loc.x) > 0.09:
                return None
            return loc - nrm * 0.002, nrm
        loc, nrm, _, _ = nose_bvh.ray_cast(Vector((0.0, tip[1] + 0.025, tip[2] - 0.2)), Vector((0, 0, 1)))
        if loc is None or loc.z < tip[2] - 0.08:
            return None
        return Vector((0.0, loc.y, loc.z + 0.004)), Vector((1, 0, 0))
    if sid == 'brow':
        bvh = bvh_evaluated([head, parts.get('brow_R'), parts.get('eye_R')])
        x, z = -0.15, tip[2] + 0.203
    else:
        bvh = bvh_evaluated([head, parts.get('mouth')])
        x, z = 0.045, tip[2] - 0.107
    loc, nrm, _, _ = bvh.ray_cast(Vector((x, -2, z)), Vector((0, 1, 0)))
    if loc is None:
        return None
    if nrm.y > 0:
        nrm = -nrm
    return loc, nrm


def pierce_matrix(anchor):
    """The socket frame Face Studio gives a piercing (clay_rig.apply_piercings), times its scale."""
    pos, axis = anchor
    up = Vector((0, 0, 1))
    z = axis.normalized()
    y = (up - z * up.dot(z)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = pos
    return m @ Matrix.Scale(PIERCE_SCALE, 4)


def socket_parts(loaded, T, look):
    def lib(slot, side):
        return loaded.get('FSC:%s:%s:%s' % (LIB_SLOT[slot], lib_key(T, slot, look[slot]), side))
    return {'ear_L': lib('ears', 'L'), 'ear_R': lib('ears', 'R'), 'nose': lib('nose', 'C'),
            'mouth': lib('mouth', 'C'), 'brow_R': lib('brows', 'R'), 'eye_R': lib('eyes', 'R')}


def set_values(objs, values):
    for o in objs:
        if o is None or o.type != 'MESH' or not o.data.shape_keys:
            continue
        for kb in o.data.shape_keys.key_blocks[1:]:
            kb.value = values.get(kb.name, 0.0)
    bpy.context.view_layer.update()


def matrix_close(a, b):
    return float(max(abs(a[i][j] - b[i][j]) for i in range(4) for j in range(4)))


def place_piercings(loaded, T, saved, shown):
    """Socket frames for every piercing on the catalog default look at all keys 0, the morph
    deltas each live slider gives each socket, and a replication check against the sockets
    Face Studio saved in the head file for the worn look."""
    head = loaded['FSC_Head']
    look = {k: v for k, v in T['defaults'].items()}
    parts = socket_parts(loaded, T, look)
    objs = [head] + list(parts.values())
    candidates = sorted({kb.name for o in objs if o is not None and o.data.shape_keys
                         for kb in o.data.shape_keys.key_blocks[1:]})
    set_values(objs, {})
    base = {sid: pierce_anchor(sid, head, parts) for sid in PIERCING_SITES}
    missing = [sid for sid, a in base.items() if a is None]
    if missing:
        raise SystemExit('piercing sockets not found on the default look: %s' % missing)
    frames = {sid: pierce_matrix(a) for sid, a in base.items()}
    moved = {sid: {} for sid in PIERCING_SITES}
    for k in candidates:
        set_values(objs, {k: 1.0})
        for sid in PIERCING_SITES:
            a = pierce_anchor(sid, head, parts)
            if a is not None:
                moved[sid][k] = pierce_matrix(a)
    set_values(objs, {})
    # replication check: the worn look's sockets at the head file's saved key values
    worn_parts = {'ear_L': loaded.get('FSC_Ear_L'), 'ear_R': loaded.get('FSC_Ear_R'),
                  'nose': loaded.get('FSC_Nose'), 'mouth': loaded.get('FSC_Mouth'),
                  'brow_R': loaded.get('FSC_Brow_R'), 'eye_R': loaded.get('FSC_Eye_R')}
    wobjs = [head] + list(worn_parts.values())
    for o in wobjs:
        if o is not None and o.data.shape_keys:
            for kb in o.data.shape_keys.key_blocks[1:]:
                kb.value = saved.get(o.name, {}).get(kb.name, 0.0)
    bpy.context.view_layer.update()
    check = {}
    for sid in PIERCING_SITES:
        worn = loaded.get('FSC_Pierce_' + sid)
        if worn is None or not shown.get(worn.name, False):
            check[sid] = 'not worn in the head file'
            continue
        a = pierce_anchor(sid, head, worn_parts)
        if a is None:
            check[sid] = 'no socket on the worn look'
            continue
        check[sid] = {'max_matrix_diff': round(matrix_close(pierce_matrix(a), worn.matrix_world), 7)}
    set_values(wobjs, {})
    return frames, moved, check


def ctx_saved_values(loaded):
    """The key values the head file saved on each worn piece (appended objects keep them until
    this script zeroes them)."""
    out = {}
    for n, o in loaded.items():
        if n.startswith('FSC_') and o.type == 'MESH' and o.data.shape_keys:
            out[o.name] = {kb.name: kb.value for kb in o.data.shape_keys.key_blocks[1:]}
    return out


# ----------------------------------------------------------------------------- colours

def base_color_node(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            inp = n.inputs.get('Base Color')
            if inp and inp.is_linked:
                src = inp.links[0].from_node
                if src.type == 'TEX_IMAGE':
                    return src
    return None


def base_color_image(mat):
    n = base_color_node(mat)
    return n.image if n is not None else None


def flat_base_color(mat):
    for n in mat.node_tree.nodes if mat and mat.use_nodes else []:
        if n.type == 'BSDF_PRINCIPLED':
            c = n.inputs['Base Color'].default_value
            return '#%02x%02x%02x' % tuple(int(round(max(0, min(1, x)) ** (1 / 2.2) * 255)) for x in c[:3])
    return None


def pixel_hash(img):
    w, h = img.size
    px = np.zeros(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return '%dx%d:%s' % (w, h, hashlib.md5(np.round(px * 255).astype(np.uint8).tobytes()).hexdigest())


# ----------------------------------------------------------------------------- materials

def material_role(slot, variant, side, src_name):
    low = src_name.lower()
    if slot == 'base':
        return 'skin_head'
    if slot == 'nose':
        return 'skin_nose'
    if slot == 'mouth':
        return 'skin_mouth'
    if slot == 'ears':
        return 'skin_ear_' + side
    if slot == 'brows':
        return 'brow_' + side
    if slot == 'hair':
        # the added hairstyles carry a procedural scalp cap painted in the style's hair colour
        return 'hair_%s_scalp' % variant if low.endswith('_scalp') else 'hair_' + variant
    if slot == 'beard':
        return 'hair_beard_' + variant
    if slot == 'piercing':
        return 'metal_gold'
    if slot == 'eyes':
        if 'eyeball' in low or 'globe' in low:
            return 'eye_' + side
        if 'liner' in low:
            return 'liner_' + side
        return 'skin_eyelid_%s_%s' % (variant, side)
    return 'skin_' + slot


def tex_cap(T, slot, role):
    over = T.get('tex_caps', {})
    if role.endswith('_scalp'):
        return over.get('scalp', TEX_MAX_SCALP)
    return over.get(slot, TEX_MAX.get(slot, TEX_MAX_DEFAULT))


def strip_normal_links(mat):
    if not mat.use_nodes:
        return
    nt = mat.node_tree
    for n in nt.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            inp = n.inputs.get('Normal')
            if inp:
                for l in list(inp.links):
                    nt.links.remove(l)
    # drop the dangling normal-map image nodes so the exporter cannot pick them up
    for n in list(nt.nodes):
        if n.type == 'NORMAL_MAP':
            nt.nodes.remove(n)
        elif n.type == 'TEX_IMAGE' and n.image is not None and n.image.colorspace_settings.name == 'Non-Color':
            nt.nodes.remove(n)


# ----------------------------------------------------------------------------- GLB read

def read_glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, _ver, _len = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67, 'not a GLB'
    clen, _ctype = struct.unpack('<II', data[12:20])
    js = json.loads(data[20:20 + clen])
    bin_off = 20 + clen
    blen, _btype = struct.unpack('<II', data[bin_off:bin_off + 8]) if len(data) > bin_off else (0, 0)
    return js, data[bin_off + 8:bin_off + 8 + blen], len(data)


def png_size(b):
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', b[16:24])
    return None


# ----------------------------------------------------------------------------- scene prep

def retire_previous_heads(letters):
    """Suffix every datablock of an earlier placement (`HEADS | Type <T>`: objects, meshes,
    shape-key blocks, materials, images) with __v1 so this build's names are exact. Only the
    given type letters are touched (a session that builds A then B must not retire its own A).
    Returns {type letter: {v1 node name: object}}."""
    prev = {}
    for L in letters:
        c = bpy.data.collections.get('HEADS | Type %s' % L)
        if c is None:
            continue
        found = {}
        for o in list(c.objects):
            base_name = o.name
            if o.type == 'MESH':
                for s in o.material_slots:
                    m = s.material
                    if m is None or m.name.endswith('__v1'):
                        continue
                    img = base_color_image(m)
                    if img is not None and not img.name.endswith('__v1'):
                        img.name = img.name + '__v1'
                    m.name = m.name + '__v1'
                if not o.data.name.endswith('__v1'):
                    o.data.name = o.data.name + '__v1'
                if o.data.shape_keys is not None and not o.data.shape_keys.name.endswith('__v1'):
                    o.data.shape_keys.name = o.data.shape_keys.name + '__v1'
            o.name = base_name + '__v1'
            found[base_name] = o
        c.name = 'HEADS | Type %s__v1' % L
        prev[L] = found
        log('retired %d v1 pieces of type %s' % (len(found), L))
    for o in bpy.data.objects:
        if (o.name.startswith('FSC_') or o.name.startswith('FSC:')) and not o.name.endswith('__prev'):
            o.name = o.name + '__prev'
    return prev


def reveal(objs):
    for o in objs:
        if o is None:
            continue
        try:
            o.hide_set(False)
        except RuntimeError:
            pass
        o.hide_viewport = False
        o.hide_render = False


# ----------------------------------------------------------------------------- main

def build(opts):
    """Append, fit, decimate, rename and bone-parent one type's pieces (no export)."""
    T = TYPES[opts['type']]
    L = opts['type'].upper()
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    report = {'type': opts['type'], 'head_blend': T['head_blend'], 'rig': T['rig']}

    # an export session retires both v1 types: the role names (skin_head, eye_L, ...) are shared
    # by the two types, so a v1 Type A left in place would push Type B's names to .001
    prev = retire_previous_heads(opts.get('retire', ['A', 'B']))
    # every collection visible so hidden class collections evaluate (never saved)
    for c in bpy.data.collections:
        c.hide_viewport = False
        c.hide_render = False

    def unexclude(lc):
        if lc.name == 'SKIN_WORK':
            return
        lc.exclude = False
        lc.hide_viewport = False
        for ch in lc.children:
            unexclude(ch)
    unexclude(view_layer.layer_collection)
    rig = bpy.data.objects[T['rig']]
    for r in [o for o in bpy.data.objects if o.type == 'ARMATURE']:
        r.data.pose_position = 'REST'
    # the retired rigid heads, the bodies and the covers are hidden in the character blend
    reveal([bpy.data.objects.get(n) for n in T['old_pieces'] + T['bodies'] + T['covers'] + T['chest']])
    view_layer.update()
    bone = rig.data.bones['head']
    bone_tail_world = rig.matrix_world @ bone.matrix_local @ Matrix.Translation((0, bone.length, 0))

    # ---- old landmarks (world)
    old = {}
    for key in ('old_head', 'old_eye_l', 'old_eye_r', 'old_mouth'):
        co, _t = world_co(bpy.data.objects[T[key]])
        old[key] = co
    Q = np.array([landmark_front(old['old_eye_l']), landmark_front(old['old_eye_r']),
                  landmark_front(old['old_mouth']), landmark_crown(old['old_head'])])

    # ---- append head pieces (and the source paint behind every live recolour)
    with bpy.data.libraries.load(T['head_blend'], link=False) as (src, dst):
        names = [n for n in src.objects if (n.startswith('FSC_') or n.startswith('FSC:'))
                 and not n.endswith(tuple('.%03d' % i for i in range(1, 50)))]
        dst.objects = list(names)
    work = bpy.data.collections.new('HEADPACK_WORK')
    scene.collection.children.link(work)
    loaded = {}
    for src_name, o in zip(names, dst.objects):
        if o is None:
            continue
        work.objects.link(o)
        loaded[src_name] = o
    # what the head file shows (worn) before everything is revealed for evaluation
    shown_in_source = {n: not o.hide_render for n, o in loaded.items()}
    reveal(loaded.values())
    view_layer.update()
    log('appended', len(loaded), 'objects')
    live_sources = sorted({img['fsc_source'] for img in bpy.data.images
                           if img.get('fsc_source') and img.library is None})
    source_images = {}
    with bpy.data.libraries.load(T['head_blend'], link=False) as (src, dst):
        want = [n for n in live_sources if n in src.images]
        dst.images = list(want)
    for n, img in zip(want, dst.images):
        if img is not None:
            source_images[n] = img
    log('appended %d source paints for live recolours' % len(source_images))

    saved_values = ctx_saved_values(loaded)

    # ---- landmark fit (head space, from the worn look; mesh data is at identity)
    def obj_world_np(o):
        M = np.array(o.matrix_world)
        return mesh_co(o.data) @ M[:3, :3].T + M[:3, 3]
    P = np.array([landmark_front(globe_verts(loaded['FSC_Eye_L'])),
                  landmark_front(globe_verts(loaded['FSC_Eye_R'])),
                  landmark_front(obj_world_np(loaded['FSC_Mouth'])),
                  landmark_crown(obj_world_np(loaded['FSC_Head']))])
    s_fit, t_fit, rot_deg, _R = solve_similarity(P, Q)
    pin = T['pinned_fit']
    if opts.get('refit'):
        s, t = s_fit, np.array(t_fit)
    else:
        s, t = pin['scale'], np.array(pin['translation'])
    seat_drop = float(T.get('seat_drop', 0.0))
    t = t - np.array((0.0, 0.0, seat_drop))
    fitted = P * s + t
    resid = np.linalg.norm(fitted - Q, axis=1)
    lm_names = ['eye_L_front', 'eye_R_front', 'mouth_front', 'crown']
    FIT = Matrix.Translation(Vector(t)) @ Matrix.Scale(s, 4)
    head_co_new = obj_world_np(loaded['FSC_Head']) * s + t
    body_co, _bt = world_co(bpy.data.objects[T['body']])
    neck_band = body_co[(np.abs(body_co[:, 0]) < 0.06) & (np.abs(body_co[:, 1]) < 0.08)]
    report['fit'] = {
        'mode': 'refit' if opts.get('refit') else 'pinned to the v1 export',
        'seat_drop': seat_drop,
        'scale': s, 'translation': [float(x) for x in t],
        'landmark_solve': {'scale': s_fit, 'translation': [float(x) for x in t_fit],
                           'best_fit_rotation_ignored_deg': rot_deg,
                           'delta_vs_used': {'scale': s_fit - s,
                                             'translation_m': float(np.linalg.norm(np.array(t_fit) - t))}},
        'landmarks': {n: {'old_world': [round(float(x), 5) for x in Q[i]],
                          'new_head_space': [round(float(x), 5) for x in P[i]],
                          'new_fitted': [round(float(x), 5) for x in fitted[i]],
                          'residual': round(float(resid[i]), 5)} for i, n in enumerate(lm_names)},
        'old_head_bbox': [old['old_head'].min(0).round(4).tolist(), old['old_head'].max(0).round(4).tolist()],
        'new_head_bbox': [head_co_new.min(0).round(4).tolist(), head_co_new.max(0).round(4).tolist()],
        'body_neck_top_z': round(float(neck_band[:, 2].max()), 4) if len(neck_band) else None,
        'eye_distance_old': round(float(np.linalg.norm(Q[0] - Q[1])), 5),
        'eye_distance_new': round(float(np.linalg.norm(fitted[0] - fitted[1])), 5),
    }
    log('FIT used scale %.6f t %s (%s); landmark solve scale %.6f t %s rot(ignored) %.2f deg' % (
        s, np.round(t, 5), report['fit']['mode'], s_fit, np.round(t_fit, 5), rot_deg))
    for i, n in enumerate(lm_names):
        log('  landmark %-12s old %s new %s resid %.5f' % (n, np.round(Q[i], 4), np.round(fitted[i], 4), resid[i]))

    # ---- which library variant each worn piece is
    default_look = {}
    for slot, stem in WORN_STEM.items():
        worn = loaded.get('FSC_%s_L' % stem) if slot in PAIRED else loaded.get('FSC_%s' % stem)
        side = 'L' if slot in PAIRED else 'C'
        hit = None
        if worn is not None and shown_in_source.get(worn.name, False):
            for v in T['slots'][slot]:
                lib = loaded.get('FSC:%s:%s:%s' % (LIB_SLOT[slot], lib_key(T, slot, v), side))
                if lib is not None and lib.data == worn.data:
                    hit = v
                    break
        default_look[slot] = hit
    worn_pierce = {}
    for site in PIERCING_SITES:
        o = loaded.get('FSC_Pierce_' + site)
        kind = None
        if o is not None:
            for v in ('hoop', 'stud', 'spike', 'bar'):
                lib = loaded.get('FSC:piercing:%s:C' % v)
                if lib is not None and lib.data == o.data:
                    kind = v
            worn_pierce[site] = {'shape': kind, 'worn_in_source': shown_in_source.get(o.name, False)}
    report['worn_look_in_source'] = {'slots': default_look, 'piercings': worn_pierce,
                                     'catalog_defaults': T['defaults'],
                                     'saved_key_values': {k: {n: round(v, 4) for n, v in d.items() if v}
                                                          for k, d in saved_values.items()}}
    log('worn look', default_look)

    # ---- piercing sockets (before any key value is touched below)
    frames, moved, pierce_check = place_piercings(loaded, T, saved_values, shown_in_source)
    report['piercing_socket_check'] = pierce_check
    log('piercing socket replication vs the head file:', pierce_check)

    # ---- zero every key value (the pack ships the basis; the runtime drives the weights)
    set_values(list(loaded.values()), {})

    # ---- build export pieces
    pieces = []  # (node_name, slot, variant, side, source_obj)
    pieces.append(('WocHead_%s_base' % L, 'base', None, 'C', loaded['FSC_Head']))
    for slot, variants in T['slots'].items():
        for v in variants:
            sides = ['L', 'R'] if slot in PAIRED else ['C']
            for sd in sides:
                name = 'FSC:%s:%s:%s' % (LIB_SLOT[slot], lib_key(T, slot, v), sd)
                src = loaded.get(name)
                if src is None:
                    raise SystemExit('missing library piece ' + name)
                pieces.append((variant_nodes(L, slot, v)[0 if sd in ('C', 'L') else 1], slot, v, sd, src))
    hair_tucks = {lib_key(T, 'hair', v): v for v in T['slots']['hair']}

    out_coll = bpy.data.collections.new('HEADPACK_OUT')
    scene.collection.children.link(out_coll)
    role_mats = {}
    piece_objs = {}
    per_node = {}
    for nm, slot, v, sd, src in pieces:
        me = src.data.copy()
        me.name = nm
        o = bpy.data.objects.new(nm, me)
        out_coll.objects.link(o)
        me.transform(FIT @ src.matrix_world, shape_keys=True)
        # a scalp tuck ships under the catalog id of the hairstyle it is authored for; a tuck
        # for a hairstyle this head's library does not have can never be applied (Face Studio
        # drives FS_Tuck_<worn library key>), so it is not shipped: under a catalog id it
        # could otherwise collide with a different hairstyle (Type B's FS_Tuck_bob vs f_bob)
        stale = []
        if me.shape_keys:
            for kb in me.shape_keys.key_blocks[1:]:
                if kb.name.startswith('FS_Tuck_'):
                    k = kb.name[len('FS_Tuck_'):]
                    if k not in hair_tucks:
                        stale.append(kb.name)
                    elif hair_tucks[k] != k:
                        kb.name = 'FS_Tuck_' + hair_tucks[k]
        base, deltas, meta = key_arrays(me)
        key_order = [k.name for k in me.shape_keys.key_blocks if k != me.shape_keys.reference_key] if me.shape_keys else []
        live_keys = [k for k in key_order if meta[k]['max_delta_m'] > KEY_EPS and k not in stale]
        for k in stale:
            meta[k]['not_shipped'] = 'tuck for a hairstyle this head has no library piece for'
        src_tris = tri_count(me)
        budget = BUDGET.get(slot)
        orig_tris, orig_mat = tris_with_material(me)
        maxd = 0.0
        if budget and src_tris > budget:
            if me.shape_keys:
                o.shape_key_clear()
            final = decimate_mesh_to(o, budget, joint=slot in JOINT_DECIMATE)
            try:
                if me.name == nm and o.data != me:
                    me.name = nm + '_src'
            except ReferenceError:
                pass  # the single-part path already freed the source copy
            o.data.name = nm
            maxd = rebuild_keys(o, base, orig_tris, orig_mat, deltas, live_keys)
        else:
            final = src_tris
            if me.shape_keys:
                for kb in list(me.shape_keys.key_blocks[1:]):
                    if kb.name not in live_keys:
                        o.shape_key_remove(kb)
                for kb in me.shape_keys.key_blocks:
                    kb.value = 0.0
                if len(me.shape_keys.key_blocks) == 1:
                    o.shape_key_clear()
        # materials by role
        for i, slot_ in enumerate(o.material_slots):
            m = slot_.material
            if m is None:
                continue
            role = material_role(slot, v, sd, m.name)
            cap = tex_cap(T, slot, role)
            if role not in role_mats:
                nm_ = m.copy()
                nm_.name = role
                strip_normal_links(nm_)
                role_mats[role] = {'mat': nm_, 'source': m.name, 'tex_max': cap, 'slot': slot}
            else:
                role_mats[role]['tex_max'] = max(role_mats[role]['tex_max'], cap)
            o.data.materials[i] = role_mats[role]['mat']
        _nt, nmi = tris_with_material(o.data)
        piece_objs[nm] = o
        per_node[nm] = {
            'slot': slot, 'variant': v, 'side': sd, 'source_object': src.name,
            'source_tris': src_tris, 'tris': tri_count(o.data), 'verts': len(o.data.vertices),
            'budget': budget,
            'materials': [s_.material.name for s_ in o.material_slots if s_.material],
            'tris_per_material': {s_.material.name: int((nmi == j).sum()) for j, s_ in enumerate(o.material_slots)
                                  if s_.material},
            'morph_targets_source': key_order, 'morph_targets': live_keys, 'morph_meta': meta,
            'key_rebuild_max_surface_dist_m': round(maxd, 6),
            'bbox_center': [round(float(x), 4) for x in ((mesh_co(o.data).min(0) + mesh_co(o.data).max(0)) / 2)],
        }
        log('piece %-34s tris %5d -> %5d verts %5d keys %d/%d mats %s' % (
            nm, src_tris, per_node[nm]['tris'], per_node[nm]['verts'], len(live_keys), len(key_order),
            per_node[nm]['tris_per_material']))

    # role names are the runtime's tint-table keys: a suffixed name (skin_head.001) would fall
    # back to a shared row, so an export build must own every role name exactly
    clash = sorted('%s -> %s' % (r, i['mat'].name) for r, i in role_mats.items() if i['mat'].name != r)
    if clash and opts.get('strict_names', True):
        raise SystemExit('role material names taken by other datablocks: %s' % clash)

    # ---- piercings: socket frame baked in, each live socket slider as a rigid-motion morph
    pierce_report = {}
    for site in PIERCING_SITES:
        worn = loaded['FSC_Pierce_' + site]
        nm = 'WocHead_%s_piercing_%s' % (L, site)
        local = mesh_co(worn.data)

        def placed(Mx):
            M = np.array(FIT @ Mx)
            return local @ M[:3, :3].T + M[:3, 3]
        P0 = placed(frames[site])
        me = worn.data.copy()
        me.name = nm
        me.vertices.foreach_set('co', P0.reshape(-1).astype(np.float32))
        me.update()
        o = bpy.data.objects.new(nm, me)
        out_coll.objects.link(o)
        keys = []
        for k, Mk in sorted(moved[site].items()):
            Pk = placed(Mk)
            dmax = float(np.linalg.norm(Pk - P0, axis=1).max())
            if dmax < PIERCE_MORPH_MIN:
                continue
            if not keys:
                o.shape_key_add(name='Basis', from_mix=False)
            kb = o.shape_key_add(name=k, from_mix=False)
            kb.data.foreach_set('co', Pk.reshape(-1).astype(np.float32))
            kb.value = 0.0
            keys.append((k, round(dmax, 6)))
        if 'metal_gold' not in role_mats:
            m = worn.material_slots[0].material
            nm_ = m.copy()
            nm_.name = 'metal_gold'
            role_mats['metal_gold'] = {'mat': nm_, 'source': m.name, 'tex_max': TEX_MAX_DEFAULT, 'slot': 'piercing'}
        for i in range(len(o.material_slots)):
            o.data.materials[i] = role_mats['metal_gold']['mat']
        if role_mats['metal_gold']['mat'].name != 'metal_gold' and opts.get('strict_names', True):
            raise SystemExit('metal_gold taken by another datablock')
        piece_objs[nm] = o
        a = frames[site]
        pierce_report[site] = {'shape': worn_pierce.get(site, {}).get('shape'),
                               'socket_head_space': [round(x, 5) for x in a.translation],
                               'morphs': dict(keys)}
        per_node[nm] = {
            'slot': 'piercing', 'variant': site, 'side': 'C', 'source_object': worn.name,
            'source_tris': tri_count(o.data), 'tris': tri_count(o.data), 'verts': len(o.data.vertices),
            'budget': None, 'materials': ['metal_gold'], 'tris_per_material': {'metal_gold': tri_count(o.data)},
            'morph_targets_source': [k for k, _d in keys], 'morph_targets': [k for k, _d in keys],
            'morph_meta': {k: {'slider_min': 0.0 if k == 'FS_Chin_Softness' else -1.0, 'slider_max': 1.0,
                               'max_delta_m': d, 'note': 'socket motion (Face Studio re-anchors the piercing)'}
                           for k, d in keys},
            'key_rebuild_max_surface_dist_m': 0.0,
            'bbox_center': [round(float(x), 4) for x in ((P0.min(0) + P0.max(0)) / 2)],
        }
        log('piercing %-8s %-6s morphs %s' % (site, pierce_report[site]['shape'], keys))
    report['piercings'] = pierce_report

    # ---- textures: source paint for hair / brow roles, per-role caps, shared identical images
    tex_report = {}
    for role, info in sorted(role_mats.items()):
        node = base_color_node(info['mat'])
        if node is None or node.image is None:
            continue
        img = node.image
        info['live_image'] = img.name
        if role.startswith(SOURCE_PAINT_PREFIXES) and img.get('fsc_source'):
            src_img = source_images.get(img['fsc_source'])
            if src_img is None:
                raise SystemExit('no source paint %s for %s' % (img['fsc_source'], role))
            node.image = src_img
    caps = {}
    for role, info in role_mats.items():
        img = base_color_image(info['mat'])
        if img is not None:
            caps[img.name] = max(caps.get(img.name, 0), info['tex_max'])
    for name, lim in caps.items():
        img = bpy.data.images[name]
        w, h = img.size
        f = min(1.0, lim / max(w, h))
        nw, nh = max(4, int(round(w * f / 4)) * 4), max(4, int(round(h * f / 4)) * 4)
        if (nw, nh) != (w, h):
            img.scale(nw, nh)
        img.file_format = 'PNG'
        try:
            img.pack()
        except RuntimeError as e:
            log('pack', name, repr(e))
    by_hash = {}
    for role, info in sorted(role_mats.items()):
        node = base_color_node(info['mat'])
        if node is None:
            continue
        hkey = pixel_hash(node.image)
        if hkey in by_hash and by_hash[hkey] is not node.image:
            node.image = by_hash[hkey]
        else:
            by_hash[hkey] = node.image
    for role, info in sorted(role_mats.items()):
        img = base_color_image(info['mat'])
        entry = {'source_material': info['source'], 'image': None}
        if img is not None:
            entry['image'] = img.name
            entry['size'] = list(img.size)
            entry['paint'] = ('source (un-recoloured)' if role.startswith(SOURCE_PAINT_PREFIXES)
                              and info.get('live_image', '').endswith(' live') else 'as saved in the head file')
            entry['head_file_image'] = info.get('live_image')
        else:
            entry['flat_base_color'] = flat_base_color(info['mat'])
        tex_report[role] = entry
    report['materials'] = tex_report
    log('images shipped: %d for %d materials' % (len({e['image'] for e in tex_report.values() if e['image']}),
                                                 len(tex_report)))

    # ---- parent to the head bone keeping the world transform (mesh data is world space)
    inv = bone_tail_world.inverted()
    for nm, o in piece_objs.items():
        o.parent = rig
        o.parent_type = 'BONE'
        o.parent_bone = 'head'
        o.matrix_parent_inverse = inv
        o.matrix_basis = Matrix.Identity(4)
    view_layer.update()
    err = max((o.matrix_world - Matrix.Identity(4)).to_translation().length for o in piece_objs.values())
    log('max world drift after bone parenting', err)

    head_centre = ((head_co_new.min(0) + head_co_new.max(0)) / 2).tolist()
    v1 = prev.get(L, {})
    v1_default = {'WocHead_%s_base' % L}
    for slot, vv in T['v1_defaults'].items():
        v1_default |= set(variant_nodes(L, slot, vv))
    return {'T': T, 'L': L, 'rig': rig, 'piece_objs': piece_objs, 'per_node': per_node,
            'report': report, 'default_look': default_look, 'work': work, 'out_coll': out_coll,
            'loaded': loaded, 'head_centre': head_centre, 'v1_objs': v1, 'v1_default_nodes': v1_default,
            'collar_z': report['fit']['body_neck_top_z'] or 1.0,
            'variant_nodes': lambda slot, vv: variant_nodes(L, slot, vv)}


def default_nodes(T, L):
    out = ['WocHead_%s_base' % L]
    for slot, v in T['defaults'].items():
        out += variant_nodes(L, slot, v)
    return out


def export_pack(ctx, opts):
    """Export ONLY the rig plus the pieces, verify the GLB, run the fit checks, write the report."""
    T, L, rig = ctx['T'], ctx['L'], ctx['rig']
    piece_objs, per_node, report = ctx['piece_objs'], ctx['per_node'], ctx['report']
    default_look = ctx['default_look']
    view_layer = bpy.context.view_layer
    for o in view_layer.objects:
        o.select_set(False)
    rig.hide_set(False)
    rig.select_set(True)
    for o in piece_objs.values():
        o.hide_set(False)
        o.select_set(True)
    view_layer.objects.active = rig
    os.makedirs(os.path.dirname(os.path.abspath(opts['out'])), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=opts['out'], export_format='GLB', use_selection=True,
        export_animations=False, export_morph=True, export_morph_normal=False,
        export_morph_tangent=False, export_skins=True, export_yup=True, export_apply=False,
        export_extras=False, export_materials='EXPORT', export_image_format='AUTO',
        export_def_bones=False, export_cameras=False,
        export_lights=False)
    js, _bin, nbytes = read_glb_json(opts['out'])
    report['raw_glb'] = verify_glb(js, _bin, nbytes, piece_objs)
    report['nodes'] = per_node
    dnodes = default_nodes(T, L)
    report['catalog_default_look'] = {'look': T['defaults'], 'nodes': dnodes,
                                      'tris': sum(per_node[n]['tris'] for n in dnodes)}
    wnodes = ['WocHead_%s_base' % L]
    for slot, v in default_look.items():
        wnodes += variant_nodes(L, slot, v)
    report['worn_look_in_source']['nodes'] = wnodes
    report['worn_look_in_source']['tris'] = sum(per_node[n]['tris'] for n in wnodes)
    log('catalog default look tris', report['catalog_default_look']['tris'],
        'worn look tris', report['worn_look_in_source']['tris'])

    # ---- fit checks (after export, so nothing below can reach the GLB)
    import woc_head_pack_review as rv
    centre = ctx['head_centre']
    covers = [bpy.data.objects[n] for n in T['covers'] if n in bpy.data.objects]
    report['cover_pokes'] = rv.cover_pokes(piece_objs, covers, centre)
    # the base once more with the bald crown on: the scalp the catalog keeps under a helm is the
    # full one, so this says whether the shorter crown would clear a scalp poke
    base = piece_objs['WocHead_%s_base' % L]
    rv.set_keys([base], {'FS_Bald_Crown': 1.0})
    report['cover_pokes_base_bald_crown'] = rv.cover_pokes({base.name: base}, covers, centre)
    rv.set_keys([base], {})
    base = piece_objs['WocHead_%s_base' % L]
    hco = np.array([base.matrix_world @ v.co for v in base.data.vertices])
    rim = hco[hco[:, 2] < hco[:, 2].min() + 0.004]
    axis = rim[:, :2].mean(0)
    collar = ctx['collar_z']
    levels = [round(z, 4) for z in np.arange(hco[:, 2].min() + 0.002, collar + 0.03, 0.006)]
    bodies = [bpy.data.objects[n] for n in T['bodies'] if n in bpy.data.objects]
    prof = rv.neck_profile(base, bodies, axis, levels)
    neck = {'new': {'summary': rv.neck_summary(prof), 'head_min_z': prof['head_min_z'], 'axis_xy': prof['axis_xy']}}
    v1_base = ctx['v1_objs'].get('WocHead_%s_base' % L)
    if v1_base is not None:
        prof1 = rv.neck_profile(v1_base, bodies[:1], axis, levels)
        neck['v1'] = {'summary': rv.neck_summary(prof1), 'head_min_z': prof1['head_min_z']}
    neck['collar_top_z'] = collar
    report['neck_vs_body'] = neck
    for k, v in neck.items():
        if isinstance(v, dict) and 'summary' in v:
            first = next(iter(v['summary'].values()))
            log('neck %s: %s sectors outside the body, worst %s' % (k, first['sectors_outside_body'], first['worst']))
    if opts['report']:
        with open(opts['report'], 'w') as f:
            json.dump(report, f, indent=1)
        log('wrote report', opts['report'])
    log('DONE', opts['out'], nbytes, 'bytes')


def verify_glb(js, binchunk, nbytes, piece_objs):
    nodes = js.get('nodes', [])
    by_name = {n.get('name'): i for i, n in enumerate(nodes)}
    head_i = by_name.get('head')
    problems = []
    if head_i is None:
        problems.append('no node named head')
    kids = set(nodes[head_i].get('children', [])) if head_i is not None else set()
    for nm in piece_objs:
        i = by_name.get(nm)
        if i is None:
            problems.append('missing node ' + nm)
            continue
        if i not in kids:
            problems.append(nm + ' not a child of head')
        if 'skin' in nodes[i]:
            problems.append(nm + ' has a skin')
        mesh = js['meshes'][nodes[i]['mesh']]
        if mesh.get('name') != nm:
            problems.append('%s mesh named %s' % (nm, mesh.get('name')))
        want = piece_objs[nm].data.shape_keys
        if want:
            names = (mesh.get('extras') or {}).get('targetNames')
            expect = [k.name for k in want.key_blocks[1:]]
            if names != expect:
                problems.append('%s targetNames %s != %s' % (nm, names, expect))
    imgs = []
    for im in js.get('images', []):
        bv = js['bufferViews'][im['bufferView']]
        b = binchunk[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        imgs.append({'name': im.get('name'), 'mime': im.get('mimeType'), 'bytes': bv['byteLength'],
                     'size': png_size(b)})
    out = {'bytes': nbytes, 'nodes': len(nodes), 'meshes': len(js.get('meshes', [])),
           'skins': len(js.get('skins', [])), 'animations': len(js.get('animations', [])),
           'images': imgs, 'problems': problems}
    log('GLB verify: bytes %d nodes %d meshes %d skins %d anims %d images %d problems %s' % (
        nbytes, out['nodes'], out['meshes'], out['skins'], out['animations'], len(imgs), problems))
    return out


def main():
    opts = parse_args()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    ctx = build(opts)
    export_pack(ctx, opts)
    if opts['render'] and opts['review']:
        import woc_head_pack_review as rv
        try:
            rv.render_review(ctx, opts)
        except Exception as e:  # renders are review aids, never block the pack
            import traceback
            traceback.print_exc()
            log('render failed', repr(e))


if __name__ == '__main__':
    main()
